import { Pointer, Ref } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
import { logger } from "../utils/global_values.ts";
import type { StreamConsumer, ValueConsumer } from "./abstract_types.ts";
import { BROADCAST, Endpoint, endpoint_name, LOCAL_ENDPOINT, target_clause } from "./addressing.ts";
import { Markdown } from "./markdown.ts";
import { Scope } from "./scope.ts";
import { Tuple } from "./tuple.ts";
import type { datex_scope, compile_info, datex_meta } from "../utils/global_types.ts";
import { Compiler } from "../compiler/compiler.ts";
import { Stream } from "./stream.ts"
import { PermissionError, RuntimeError, TypeError, ValueError } from "./errors.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { DX_EXTERNAL_FUNCTION_NAME, DX_EXTERNAL_SCOPE_NAME, DX_TIMEOUT, VOID } from "../runtime/constants.ts";
import { Type, type_clause } from "./type.ts";
import { callWithMetadata, callWithMetadataAsync, getMeta } from "../utils/caller_metadata.ts";
import { Datex } from "../mod.ts";
import { Callable, ExtensibleFunction, getDeclaredExternalVariables, getDeclaredExternalVariablesAsync, getSourceWithoutUsingDeclaration } from "./function-utils.ts";
import { Conjunction, Disjunction, Target } from "../datex_all.ts";



/**
 * inject meta info to stack trace
 */

export function getDefaultLocalMeta(){
    return Object.seal({
        sender: Runtime.endpoint,
        timestamp: new Date(),
        signed: true,
        encrypted: false,
        type: ProtocolDataType.LOCAL,
        local: true // set true if function was executed locally, not via DATEX (not a DATEX variable)
    })
}

export function getUnknownMeta(){
    return Object.seal({
        sender: BROADCAST,
        timestamp: new Date(),
        signed: false,
        encrypted: false,
        type: ProtocolDataType.REQUEST
    })
}


/** function - execute datex or js code - use for normal functions, not for static scope functions */
export class Function<T extends (...args: any) => any = (...args: any) => any> extends ExtensibleFunction implements ValueConsumer, StreamConsumer {
    
    public context?: object|Pointer;  // the context (this) in which the function exists, if part of an object
    public body?: Scope<ReturnType<T>>
    public ntarget?: T
    public location:Endpoint

    fn?: (...args: any) => ReturnType<T>|Promise<ReturnType<T>> // parameters can be different because of meta

    allowed_callers?:target_clause
    serialize_result = false // return pointer values, not pointers
    anonymize_result:boolean
    params: Tuple<type_clause>
    unknown_params?: boolean // set to true if params can be arbitrary, e.g. for native functions like console.log
    params_keys: string[]

    is_async = true;

    datex_timeout?: number

    about?:Markdown

    private proxy_fn?: globalThis.Function // in case the function should be called remotely, a proxy function

    external_variables?: Record<string,unknown>

    get js_source() {
        if (!this.ntarget) return null;
        return getSourceWithoutUsingDeclaration(this.ntarget)
    }

    static #method_params_source:(target:any, method_name:string, meta_param_index?:number)=>Tuple<Type>
    static #method_meta_index_source:(target:any, method_name:string)=>number

    public static setMethodParamsSource(fn:(target:any, method_name:string, meta_param_index?:number)=>Tuple<Type>){
        this.#method_params_source = fn;
    }

    public static setMethodMetaIndexSource(fn:(target:any, method_name:string)=>number) {
        this.#method_meta_index_source = fn;
    }
    


    // convert normal JS Function to <Function>
    public static createFromJSFunction<T extends (...args: any) => any = (...args: any) => any>(
        ntarget:T, 
        context?:object|Pointer, 
        key_in_parent?:string,
        location:Endpoint = Runtime.endpoint, 
        allowed_callers?:target_clause, 
        anonymize_result=false,
        params?:Tuple<Type>
    ):Function<(...args:Parameters<T>)=>ReturnType<T>> & Callable<Parameters<T>, ReturnType<T>> {
       
        if (ntarget.name.startsWith("bound ")) {
            console.log(ntarget, params, key_in_parent);
            try {
                throw new Error("Cannot convert a bound function to a DATEX function");
            } catch (e) {
                console.error("createFromJSFunction", e)
                return () => {};
            }
        }

        // already a DATEX Function
        if (ntarget instanceof Function) return ntarget;
        
        // auto detect params and meta index
        if (params == null ) {
            params = this.getFunctionParamsAndMetaIndex(ntarget, context, key_in_parent)[1]
        }
        return <Function<(...args:Parameters<T>)=>ReturnType<T>> & Callable<Parameters<T>, ReturnType<T>>> new Function<(...args:Parameters<T>)=>ReturnType<T>>(undefined, ntarget, context, location, allowed_callers, anonymize_result, params);
    }


    // convert DATEX Scope to <Function>
    public static createFromDatexScope(
        scope:Scope, 
        context?:object|Pointer, 
        location:Endpoint = Runtime.endpoint, 
        allowed_callers?:target_clause, 
        anonymize_result=false,
        params?:Tuple
    ) {
        return new Function(scope, undefined, context, location, allowed_callers, anonymize_result, params);
    }

    private constructor(body?:Scope, ntarget?:T, context?:object|Pointer, location:Endpoint = Runtime.endpoint, allowed_callers?:target_clause, anonymize_result=false, params?:Tuple) {
        super((...args:any[]) => this.handleApply(new Tuple(args)));
        
        this.params = params??new Tuple();
        this.params_keys = [...this.params.named.keys()];

        this.body = body;
        this.ntarget = ntarget;
        this.location = location;

        // execute DATEX code
        if (body instanceof Scope) {
            const ctx = context instanceof Pointer ? context.val : context;
            this.fn = (meta, ...args:any[])=>body.execute(meta.sender, ctx, args); // execute DATEX code
        }
        // execute native JS code
        else if (typeof ntarget == "function") {
            const ctx = context instanceof Pointer ? context.val : context;
            this.fn = (ctx && ntarget.bind) ? ntarget.bind(ctx) : ntarget;
            // is asnyc or sync fnc (TODO: only checks for AsyncFunction, function might still return a Promise!)
            this.is_async = this.fn.constructor.name == "AsyncFunction"

            // for native functions like console.log, there are no param declarations in the function declaration
            // we must assume that the function accepts any number of arguments
            // setting this.unknown_params to true will disable parameter size constraints
            if (ntarget.toString().match(/\[native code\]\s*\}/)) {
                this.unknown_params = true
            }

            // get external_variables dependencies from use() statement
            if (this.is_async) {
                (async () => {
                    const {vars, flags} = await getDeclaredExternalVariablesAsync(this.fn!)
                    this.external_variables = vars;
                })();
            }
            else {
                const {vars, flags} = getDeclaredExternalVariables(this.fn)
                this.external_variables = vars;
            }
            
        }

        this.allowed_callers = allowed_callers;
        this.anonymize_result = anonymize_result;

        Object.defineProperty(this,'context',{
            enumerable:false,
            value: context
        });

        // update location if currently @@local, as soon as connected to cloud
        if (this.location == LOCAL_ENDPOINT) {
            Runtime.onEndpointChanged((endpoint)=>{
                logger.debug("update local function location for " + Runtime.valueToDatexString(this))
                this.location = endpoint;
            })
        }


    }

    // returns param data for native js function
    private static getFunctionParamsAndMetaIndex(value:((...params: any[]) => any), parent?:object|Pointer, key_in_parent?:any):[number|undefined, Tuple<Type>] {
        const parent_value = parent instanceof Pointer ? parent.val : parent;

        if (typeof value == "function" && !(value instanceof Function)) {
            // try to get more type info for the method params (from JS decorators etc.)
            const meta_param_index = parent_value ? this.#method_meta_index_source?.(parent_value, key_in_parent) : undefined;
            let params = parent_value ? this.#method_params_source?.(parent_value, key_in_parent, meta_param_index) : undefined;
            if (!params) params = this.getFunctionParams(value);
            return [meta_param_index, params]
        }
        throw new ValueError("Cannot auto-cast native value to <Function>");
    }

    // fallback if no js class adapter method params, get function params from string (all of type <Any>)
    public static getFunctionParams(fun:globalThis.Function) {
        const tuple = new Tuple<Type>();

        // get parameter names from function body string
        const function_body:string = fun?.toString();
        const args_match = function_body?.match(/^[^(]*\(([^)]*)\)/)?.[1];

        if (!args_match?.length) return tuple;
        const args_strings = this.normalizeFunctionParams(args_match).split(",");
        if (args_strings) {
            for (let arg of args_strings) {
                arg = arg.trim().split(/[ =]/)[0];
                let type = Type.std.Any;
                // type comment (until function decorators are added) /*<Type>*/
                const type_comment = arg.match(/^(\S*)\s*\/\*(\<.*>)\*\//);
                if (type_comment) {
                    arg = type_comment[1];
                    type = Type.get(type_comment[2].slice(1,-1)); // TODO better type evaluation (params, etc)?
                }
                tuple.set(arg, type);
            }

        }

        return tuple;
    }

    /**
     * Normalizes a function params string, replacing destructuring with a single variable
     */
    private static normalizeFunctionParams(params: string) {
        let scopes = 0;
        let nestedIndex = undefined;

        let i=0;
        let varCount = 0;
        for (const x of params) {            
            if (x === "["||x === "{") scopes++;
            if (x === "]"||x === "}") scopes--;
            if (nestedIndex == undefined && scopes !== 0) {
                nestedIndex = i;
            }
            else if(nestedIndex != undefined && scopes == 0) {
                params = [...params].toSpliced(nestedIndex, i-nestedIndex+1, 'x_'+(varCount++)).join("")
                i = nestedIndex
                nestedIndex = undefined;
            }
            i++;
        }
        
        return params;
    }


    // execute this function remotely, set the endpoint
    private setRemoteEndpoint(endpoint: Endpoint){
        //let my_pointer = <Pointer> Pointer.pointerifyValue(this);

        const sid = Compiler.generateSID(true); // fixed sid to keep order
        
        // save pointer in variable:
        /**
         * _ = $aaaaa328749823749234;
         * return _(a,b,c);
         * return _(d,e,f);
         * return _(g,h,i);
         * ...
         */
        
        Runtime.datexOut(['#f $=?;', [this], {to:endpoint, end_of_scope:false, sid, return_index: Compiler.getNextReturnIndexForSID(sid)}], endpoint, sid, false);

        this.proxy_fn = async (value: any) => {
            // TODO convert #f to dynami compiler time variable?
            const compile_info:compile_info = [this.serialize_result ? 'value (#f ?);return;' : '#f ?;return;', [value], {to:endpoint, end_of_scope:false, sid, return_index: Compiler.getNextReturnIndexForSID(sid)}];
            
            // run in scope, get result
            try {
                const res = await Runtime.datexOut(compile_info, endpoint, undefined, true, undefined, undefined, false, this.datex_timeout);
                return res;
            } catch (e) {
                // error occured during scope execution => scope is broken, can no longer be used => create new scope
                // TODO can we ignore this somehow?
                logger.debug("Error ocurred, resetting DATEX scope for proxy function");
                this.setRemoteEndpoint(endpoint); // new DATEX scope
                throw e;
            }
        }
    }


    // handle streams
    write(data:any, scope?:datex_scope) {
        return this.handleApply(data, scope);
    }

    async pipe(in_stream:Stream) {
        const reader = in_stream.getReader();
        let next:ReadableStreamReadResult<ArrayBuffer>;
        while (true) {
            next = await reader.read()
            if (next.done) break;
            this.write(next.value);
        }
    }

    // call the function either from JS directly (meta data is automatically generated, sender is always the current endpoint) or from a DATEX scope
    handleApply(value:any, SCOPE?: datex_scope):Promise<ReturnType<T>>|ReturnType<T>{

        // call function remotely if not
        if (!(
            Runtime.endpoint.equals(this.location) || // location is own endpoint instance
            Runtime.endpoint.main.equals(this.location) || // location is own endpoint
            this.location == LOCAL_ENDPOINT || // location is local
            this.fn // already has a local function
        )) this.setRemoteEndpoint(this.location);

        let meta:any; // meta (scope variables)


        // called from DATEX scope
        if (SCOPE) {
            // check exec permissions
            // TODO permission check
            // if (!SCOPE.execution_permission || (this.allowed_callers && !this.allowed_callers.test(SCOPE.sender))) {
            //     throw new PermissionError("No execution permission", SCOPE);
            // }

            // is proxy function: call remote, only if has impersonation permission!
            if (this.proxy_fn) {
                if (SCOPE.impersonation_permission) return this.proxy_fn(value);
                else {
                    console.error("No permission to execute functions on external endpoints", this.proxy_fn)
                    throw new PermissionError("No permission to execute functions on external endpoints ("+this.name+","+this.proxy_fn.name+")", SCOPE)
                }
            }
            // else local call ...
            meta = SCOPE.meta;
        }

        // called locally
        else {
            // proxy function: call remote
            if (this.proxy_fn) return this.proxy_fn(value);
            // else generate meta data
            meta = getDefaultLocalMeta();
        }

        // no function or DATEX provided
        if (!this.fn) {
            throw new RuntimeError("Cannot apply values to a <Function> with no executable DATEX or valid native target");
        }

        const context = (this.context instanceof Ref ? this.context.val : this.context);
        let params:any[];
       
        // record
        if (value instanceof Tuple) {
            params = [];
            for (const [key, val] of value.entries()) {
                // normal number index
                if (!isNaN(Number(key.toString()))) {
                    if (Number(key.toString()) < 0) logger.warn(Datex.Pointer.getByValue(this)?.idString() + ": Invalid function arguments: '" + key + "'");
                    else if (Number(key.toString()) >= this.params.size) {
                        // ignore if no params (TODO: just workaround to prevent errors)
                        // if (this.params.size !== 0) logger.warn(Datex.Pointer.getByValue(this)?.idString()+": Maximum number of function arguments is " + (this.params.size));
                    }
                    params[Number(key.toString())] = val;
                }
                // get index of named argument
                else {
                    const index = this.params_keys.indexOf(key.toString());
                    if (index == -1) throw new RuntimeError("Invalid function argument: '" + key + "'", SCOPE);
                    params[index] = val;
                }
            }
        }
        // no args
        else if (value == VOID) params = [];
        // single arg
        else {
            if (this.params.size == 0 && !this.unknown_params) {
                // ignore if no params (TODO: just workaround to prevent errors)
                // throw new RuntimeError("Maximum number of function arguments is " + (this.params.size), SCOPE);
                params = [];
            }
            else params = [value];
        }


        let isSpread = false; // has argument with ..., unlimited args size
        // argument type checking
        if (this.params) {
            let i = 0;
            for (const [name, required_type] of this.params.entries()) {
                if (typeof name == "string" && name.startsWith("...")) isSpread = true;

                const actual_type = Type.ofValue(params[i]);

                if (
                    required_type
                    && required_type != Type.std.Object  // argument type is not further specified (can be any typescript type)

                    && actual_type!=Type.std.null
                    && actual_type!=Type.std.void // void and null are accepted by default

                    && !Type.matchesType(actual_type, required_type) // root type of actual type match
    
                ) {
                    throw new TypeError(`Invalid argument '${name}': type should be ${required_type.toString()}`, SCOPE);
                }
                i++;
            }
        }

        const required_param_nr = this.params.size;

        // is datex function
        if (this.body) return this.fn.call(context, meta, ...params);

        // no meta index, still crop the params to the required size if possible
        // injects meta to stack trace, can be accessed via Datex.getMeta()
        const call = <CallableFunction&(typeof callWithMetadata)> (this.is_async ? callWithMetadataAsync : callWithMetadata);
        if (this.unknown_params || isSpread || params.length<=required_param_nr) {
            return call(meta, this.fn, params, context) // this.fn.call(context, ...params); 
        }
        else return call(meta, this.fn, params.slice(0,required_param_nr), context);// this.fn.call(context, ...params.slice(0,required_param_nr));
    }


    bodyToString(formatted=false, parentheses=true, spaces = '  '){
        if (this.body) return this.body.bodyToString(formatted, parentheses, spaces)
        else return '(### native code ###)'; // <Void> 'native code';
    }

    override toString(formatted=false, spaces = '  '){
        return `function ${this.params.size== 0 ? '()' : Runtime.valueToDatexString(this.params)}${(formatted ? " ":"")}${this.bodyToString(formatted, true, spaces)}`;
    }

}




/**
 * add to() extension method to functions
 */

type Receiver = target_clause|string|Iterable<Target|string>

declare global {
	interface CallableFunction {
		to<T, A extends unknown[], R>(this: (this: T, ...args: A) => R, receiver?:Receiver): (...args: A)=>Promise<Awaited<Promise<R>>>;
	}
}

function to (this:Function, receivers:Receiver) {
    if (
        receivers 
        && typeof receivers == "object" 
        && typeof (receivers as any)[Symbol.iterator] === 'function'
        && !(receivers instanceof Conjunction) 
        && !(receivers instanceof Disjunction)
    ) {
        receivers = new Disjunction(...[...(receivers as Iterable<Target|endpoint_name>)].map(r => r instanceof Target ? r : Target.get(r as endpoint_name)));
    }
    if (this instanceof Function) {
        return new Proxy(this, {
            apply: (_target, thisArg, argArray:unknown[]) => {
                return (_target as any).apply(thisArg, argArray) // TODO: inject receivers
            }
        })
    }
    else return new Proxy(this, {
        apply: (target, _thisArg, argArray:unknown[]) => {
            const externalScopeName = target[DX_EXTERNAL_SCOPE_NAME];
            const externalFunctionName = target[DX_EXTERNAL_FUNCTION_NAME];
            const timeout = target[DX_TIMEOUT];
            return datex(
                `#public.?.? ?`, 
                [externalScopeName, externalFunctionName, new Tuple(argArray)], 
                receivers as target_clause,
                undefined, undefined, undefined, undefined,
                timeout
            )
        }
    })
}

// @ts-ignore override function prototype
globalThis.Function.prototype.to = to;