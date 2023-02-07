import { Pointer, Value } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
import { logger } from "../utils/global_values.ts";
import { StreamConsumer, ValueConsumer } from "./abstract_types.ts";
import { Endpoint, endpoint_name, LOCAL_ENDPOINT, target_clause } from "./addressing.ts";
import { Markdown } from "./markdown.ts";
import { Scope } from "./scope.ts";
import { Tuple } from "./tuple.ts";
import type { datex_scope, compile_info, datex_meta } from "../utils/global_types.ts";
import { Compiler } from "../compiler/compiler.ts";
import { Stream } from "./stream.ts"
import { PermissionError, RuntimeError, TypeError, ValueError } from "./errors.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { VOID } from "../runtime/constants.ts";
import { Type, type_clause } from "./type.ts";

export class ExtensibleFunction {
    constructor(f:globalThis.Function) {
        return Object.setPrototypeOf(f, new.target.prototype);
    }
}



// omit last element from parameters
type Head<T extends any[]> = T extends [ ...infer Head, any ] ? Head : any[];

export interface Callable<args extends any[], return_type> {
    (...args:args): return_type;
} 


/**
 * inject meta info to stack trace
 */

function getDefaultLocalMeta(){
    return {
        sender: Runtime.endpoint,
        current: Runtime.endpoint,
        timestamp: new Date(),
        signed: true,
        type: ProtocolDataType.LOCAL,
        local: true // set true if function was executed locally, not via DATEX (not a DATEX variable)
    }
}

const free_ids:Set<number> = new Set(Array(500).fill(1).map((x, y) => x + y)); // 500 free ids
const meta = new Map<number, any>();

function createMetaMapping(object:any){
    const key = <number> free_ids.values().next().value;
    if (key == undefined) throw new RuntimeError("not enough meta mapping ids (limit 500) - too many function were called at once"); // TODO better solution?
    free_ids.delete(key);
    meta.set(key, object);
    return key;
}
function removeMeta(key:number){
    meta.delete(key);
    free_ids.add(key);
}


// @ts-ignore check for safari
const is_safari = !!globalThis.Deno && (typeof window.webkitConvertPointFromNodeToPage === 'function')

/**
 * Injects meta data to the stack trace, which can be accessed within the function.
 * Calls the function (async) with paramters.
 * @param meta object that can be accessed within the function by calling getMeta()
 * @param ctx value of 'this' inside the function
 * @param fn the function to call
 * @param args function arguments array
 * @returns return value of the function call
 */
async function callWithMeta<args extends any[], returns>(meta:any, ctx:any, fn:(...args:args)=>returns, args:args): any {
    const key = createMetaMapping(meta);
    const encoded = '__DX_meta__'+key+'__';
    try {
        const res = await (is_safari ? new globalThis.Function('f', 'a', '(function '+encoded+'(){f.call(...a)})()')(fn, [ctx, ...args]) : ({[encoded]:()=>fn.call(ctx,...args)})[encoded]());
        removeMeta(key); // clear meta
        return res;
    }
    catch (e) {
        removeMeta(key); // clear meta
        throw e;
    }
}

/**
 * get the current DATEX meta data within a JS function scope
 * @returns meta object
 */
let default_meta:datex_meta;
export function getMeta(){
    const key = new Error().stack?.match(/__DX_meta__([^_]+)__/)?.[1];
    return meta.get(Number(key)) ?? (default_meta ?? (default_meta = Object.freeze(getDefaultLocalMeta())));
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
    params_keys: string[]

    meta_index?: number

    datex_timeout?: number

    about?:Markdown

    private proxy_fn?: globalThis.Function // in case the function should be called remotely, a proxy function



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
        params?:Tuple<Type>,
        meta_index?:number
    ):Function<(...args:Parameters<T>)=>ReturnType<T>> & Callable<Parameters<T>, ReturnType<T>> {
        // already a DATEX Function
        if (ntarget instanceof Function) return ntarget;
        
        // auto detect params and meta index
        if (params == null && meta_index == null) {
            [meta_index, params] = this.getFunctionParamsAndMetaIndex(ntarget, context, key_in_parent)
        }
        return <Function<(...args:Parameters<T>)=>ReturnType<T>> & Callable<Parameters<T>, ReturnType<T>>> new Function<(...args:Parameters<T>)=>ReturnType<T>>(undefined, ntarget, context, location, allowed_callers, anonymize_result, params, meta_index);
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


    private constructor(body?:Scope, ntarget?:T, context?:object|Pointer, location:Endpoint = Runtime.endpoint, allowed_callers?:target_clause, anonymize_result=false, params?:Tuple, meta_index?:number) {
        super((...args:any[]) => this.handleApply(new Tuple(args)));
        
        this.meta_index = meta_index;
        this.params = params??new Tuple();
        this.params_keys = [...this.params.named.keys()];

        this.body = body;
        this.ntarget = ntarget;
        this.location = location;

        // execute DATEX code
        if (body instanceof Scope) {
            this.meta_index = 0;
            const ctx = context instanceof Pointer ? context.val : context;
            this.fn = (meta, ...args:any[])=>body.execute(meta.sender, ctx, args); // execute DATEX code
        }
        // execute native JS code
        else if (typeof ntarget == "function") {
            this.fn = ntarget;
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

        // get parmeters names from function body string
        const function_body:string = fun?.toString();
        const args_match = function_body?.match(/^[^(]*\(([^)]*)\)/)?.[1];
        if (!args_match?.length) return tuple;
        const args_strings = args_match.split(",");
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


    // execute this function remotely, set the endpoint
    private setRemoteEndpoint(endpoint: Endpoint){
        //let my_pointer = <Pointer> Pointer.pointerifyValue(this);

        const sid = Compiler.generateSID(); // fixed sid to keep order
        
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
                const res = await Runtime.datexOut(compile_info, endpoint, undefined, true, undefined, undefined, false, undefined, this.datex_timeout);
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


        // call function remotely
        if (!Runtime.endpoint.equals(this.location) && this.location != LOCAL_ENDPOINT) this.setRemoteEndpoint(this.location);

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
                else throw new PermissionError("No permission to execute functions on external endpoints", SCOPE)
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
        if (!this.fn) throw new RuntimeError("Cannot apply values to a <Function> with no executable DATEX or valid native target");

        const context = (this.context instanceof Value ? this.context.val : this.context);
        let params:any[];
       
        // record
        if (value instanceof Tuple) {
            params = [];
            for (let [key, val] of value.entries()) {
                // normal number index
                if (!isNaN(Number(key.toString()))) {
                    if (Number(key.toString()) < 0) throw new RuntimeError("Invalid function arguments: '" + key + "'");
                    if (Number(key.toString()) >= this.params.size) throw new RuntimeError("Maximum number of function arguments is " + (this.params.size), SCOPE);
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
            if (this.params.size == 0) throw new RuntimeError("Maximum number of function arguments is " + (this.params.size), SCOPE);
            else params = [value];
        }


        // argument type checking
        if (this.params) {
            let i = 0;
            for (const [name, required_type] of this.params.entries()) {

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

        // no meta index, still crop the params to the required size if possible
        // injects meta to stack trace, can be accessed via Datex.getMeta()
        if (this.meta_index==undefined) {
            if (required_param_nr==undefined || params.length<=required_param_nr) {
                return callWithMeta(meta, context, this.fn, params) // this.fn.call(context, ...params); 
            }
            else return callWithMeta(meta, context, this.fn, params.slice(0,required_param_nr));// this.fn.call(context, ...params.slice(0,required_param_nr));
        }
        // inject meta information at given index when calling the function
        else if (this.meta_index==-1) {
            // crop params to required size
            if (required_param_nr==undefined || params.length==required_param_nr) return this.fn.call(context, ...params, meta);
            else if (params.length>required_param_nr) return this.fn.call(context, ...params.slice(0,required_param_nr), meta);
            else return this.fn.call(context, ...params, ...Array(required_param_nr-params.length), meta);
        }
        // add meta index at the beginning
        else if (this.meta_index==0) return this.fn.call(context, meta, ...params);
        // insert meta index inbetween
        else if (this.meta_index > 0) {
            const p1 = params.slice(0,this.meta_index);
            const p2 = params.slice(this.meta_index);
            // is the size of p1 right?
            if (p1.length == this.meta_index) return this.fn.call(context, ...p1, meta, ...p2);
            // p1 too short (p2 is empty in this case)
            else return this.fn.call(context, ...p1, ...Array(this.meta_index-p1.length), meta);
        }
        else {
            throw new RuntimeError("Invalid index for the meta parameter", SCOPE);
        }
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

declare global {
	interface CallableFunction {
		to<T, A extends unknown[], R>(this: (this: T, ...args: A) => R, receiver?:string): (...args: A)=>Promise<R>;
	}
}

function to (receiver:endpoint_name):any
function to (receivers:target_clause):any
function to (this:any, receivers:target_clause|endpoint_name) {
    if (this instanceof Function) {
        return new Proxy(this, {
            apply: (_target, thisArg, argArray:any[]) => {
                return _target.apply(thisArg, argArray) // TODO: inject receivers
            }
        })
    }
    else throw new Error("This function has no bindings for external calls, .to() cannot be used.")
}

// @ts-ignore override function prototype
globalThis.Function.prototype.to = to;