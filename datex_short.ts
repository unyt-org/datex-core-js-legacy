
// shortcut functions
// import { Datex } from "./datex.ts";
import { baseURL, Runtime, PrecompiledDXB, Type, Pointer, Ref, PointerProperty, primitive, any_class, Target, IdEndpoint, TransformFunctionInputs, AsyncTransformFunction, TransformFunction, TextRef, Markdown, DecimalRef, BooleanRef, IntegerRef, MinimalJSRef, RefOrValue, PartialRefOrValueObject, datex_meta, ObjectWithDatexValues, Compiler, endpoint_by_endpoint_name, endpoint_name, Storage, compiler_scope, datex_scope, DatexResponse, target_clause, ValueError, logger, Class, getDefaultLocalMeta, Endpoint, INSERT_MARK, CollapsedValueAdvanced, CollapsedValue, SmartTransformFunction, compiler_options, activePlugins, METADATA, handleDecoratorArgs, RefOrValueObject, PointerPropertyParent, InferredPointerProperty } from "./datex_all.ts";

/** make decorators global */
import {property as _property, sync as _sync, endpoint as _endpoint, template as _template, jsdoc as _jsdoc} from "./datex_all.ts";
import { Decorators } from "./js_adapter/js_class_adapter.ts";
import { NOT_EXISTING, DX_SLOTS, SLOT_GET, SLOT_SET } from "./runtime/constants.ts";
import { AssertionError } from "./types/errors.ts";
import { getCallerFile, getCallerInfo, getMeta } from "./utils/caller_metadata.ts";

declare global {
	const property: typeof _property;
    const jsdoc: typeof _property;
	const sync: typeof _sync;
	const endpoint: typeof _endpoint;
	const template: typeof _template;
}

// @ts-ignore global
globalThis.property = _property;
// @ts-ignore global
globalThis.sync = _sync;
// @ts-ignore global
globalThis.endpoint = _endpoint;
// @ts-ignore global
globalThis.template = _template;
// @ts-ignore global
globalThis.jsdoc = _jsdoc;

// can be used instead of import(), calls a DATEX get instruction, works for urls, endpoint, ...
export async function get<T=unknown>(dx:string|URL|Endpoint, assert_type?:Type<T> | Class<T> | string, context_location?:URL|string, plugins?:string[]):Promise<T> {
    // auto retrieve location from stack
    context_location ??= getCallerFile();
    // TODO:just a workaournd, how to do this better
    //  if context location is index.html (no 'x.y' file extension) -> set to root url
    if (!context_location.toString().match(/\/[^\/]*\.[^\/]*$/) && (context_location.toString().startsWith("http://") || context_location.toString().startsWith("https://"))) context_location = new URL(context_location).origin + "/"
    // workaround -> convert absolute path to url/relative (TODO: handle in DATEX?)
    if (typeof dx == "string" && dx.startsWith("/")) {
        if (globalThis.location?.origin) dx = globalThis.location.origin + dx;
        else dx = "." + dx;
    }

    // TODO: activePlugins only workaround
    if (plugins) {
        activePlugins.push(...plugins);
        // TODO: only workaround, delete url cache for dx file, make sure content is fetched again with active plugins (only works if dx is an url)
        Runtime.deleteURLCache(dx.toString())
    }

    // handle edge case blob:http:// -> escape
    if (dx.toString().startsWith('blob:http://') || dx.toString().startsWith('blob:https://')) dx = `url '${dx}'`;

    const res = <T> await _datex('get (' + dx + ' )', undefined, undefined, undefined, undefined, context_location, plugins);
    if (plugins) activePlugins.splice(0, activePlugins.length);

    if (typeof assert_type == "string") assert_type = Type.get(assert_type);

    if (assert_type instanceof Type) {
        if (!assert_type.matches(res)) throw new AssertionError("Invalid type in datex.get: Expected "+assert_type+", found "+Type.ofValue(res)+"")
    }
    else if (assert_type) {
        if (!(res instanceof assert_type)) throw new AssertionError("Invalid type in datex.get: Expected instance of "+assert_type.name+", found "+Type.ofValue(res)+"")
    }

    return res;
}


/***** execute DATEX */
// default endpoint: DatexRuntime.endpoint
// sign per default if not local endpoint
// do not encrypt per default
function _datex<T=unknown>(dx:TemplateStringsArray, ...args:any[]):Promise<T>
function _datex<T=unknown>(dx:string|PrecompiledDXB, data?:unknown[], to?:Target|target_clause|endpoint_name, sign?:boolean, encrypt?:boolean, context_location?:URL|string, plugins?:string[]):Promise<T>
function _datex(dx:string|TemplateStringsArray|PrecompiledDXB, data?:unknown[], to?:Target|target_clause|endpoint_name, sign?:boolean, encrypt?:boolean, context_location?:URL|string, plugins?:string[]) {

    // auto retrieve location from stack
    if (!context_location) {
        context_location = getCallerFile();
    }

    // template string (datex `...`)
    if (dx instanceof Array && !(dx instanceof PrecompiledDXB)) {
        dx = dx.raw.join(INSERT_MARK);
        data = Array.from(arguments);
        data.splice(0,1);
        // arguments have no meaning when using template string, set to default
        to = Runtime.endpoint;
        sign = false;
        encrypt = false;
        context_location = undefined;
    }

    else {
        // default arg values
        data ??= [];
        to ??= Runtime.endpoint;
        sign ??= to!=Runtime.endpoint;
        encrypt ??= false;
    }

    // local execution
    if (to === Runtime.endpoint) return Runtime.executeDatexLocally(dx, data, {plugins, sign, encrypt}, context_location ? new URL(context_location.toString()) : undefined); 
    // remote execution
    else return Runtime.datexOut([dx, data, {plugins, sign, encrypt, context_location: context_location ? new URL(context_location.toString()) : undefined}], typeof to == "string" ? f(<endpoint_name>to) : to);
    
}

// add datex.meta
Object.defineProperty(_datex, 'meta', {get:()=>{
    const meta = getMeta();
    // if (!meta) throw new Error("Function was called locally - no datex.meta available");
    return meta;
}, set:()=>{}, configurable:false})
// add datex.get
Object.defineProperty(_datex, 'get', {value:(res:string, type?:Class|Type, location?:URL, plugins?:string[])=>get(res,type,location ?? getCallerFile(),plugins), configurable:false})
Object.defineProperty(_datex, 'localMeta', {get:()=>getDefaultLocalMeta(), configurable:false})

// add globalThis.meta
// Object.defineProperty(globalThis, 'meta', {get:()=>getMeta(), set:()=>{}, configurable:false})

export const datex = <typeof _datex & {meta?:datex_meta, localMeta:ReturnType<typeof getDefaultLocalMeta>, get:typeof get}><unknown>_datex;
// @ts-ignore global datex
globalThis.datex = datex;
// global access to datex and meta
type d = typeof datex;
declare global {
    const datex: d;
}

export const 〱 = _datex;


// create raw dxb from script or file (used to return in functions)
export function raw<T=unknown>(dx:TemplateStringsArray, ...args:unknown[]):DatexResponse<T>
export function raw<T=unknown>(dx:string):DatexResponse<T>
export function raw<T=unknown>(script_url:URL):DatexResponse<T>
export function raw<T=unknown>(dx_or_url:string|URL|TemplateStringsArray):DatexResponse<T> {
    let data: unknown[] = [];
    // template string (raw `...`)
    if (dx_or_url instanceof Array) {
        dx_or_url = dx_or_url.raw.join("?");
        data = Array.from(arguments);
        data.splice(0,1);
    }
    return new DatexResponse(dx_or_url, data)
}



// execute DATEX as continuos scope with current context location
// similar to the 'compile' command in Compiler

const context_compiler_scopes = new Map<string, compiler_scope>();
const context_runtime_scopes = new Map<string, datex_scope>();

// TODO:
export async function script(dx:TemplateStringsArray, ...args:any[]):Promise<any>
export async function script(dx:string|PrecompiledDXB, data?:any[], to?:Target|target_clause|endpoint_name, sign?:boolean, encrypt?:boolean):Promise<any>
export async function script(dx:string|TemplateStringsArray|PrecompiledDXB, data:any[]=[], to:Target|target_clause|endpoint_name = Runtime.endpoint, sign=to!=Runtime.endpoint, encrypt=false) {
    // template string (script `...`)
    if (dx instanceof Array && !(dx instanceof PrecompiledDXB)) {
        dx = dx.raw.join("?");
        data = Array.from(arguments);
        data.splice(0,1);
    }

    const context_location = baseURL;
    const context_string = context_location.toString();

    let compiler_scope:compiler_scope|undefined = context_compiler_scopes.get(context_string)
    let runtime_scope:datex_scope|undefined = context_runtime_scopes.get(context_string);


    // COMPILE:

    // create compiler scope first time
    if (!compiler_scope) {
        context_compiler_scopes.set(context_string, compiler_scope = Compiler.createCompilerScope(<string>dx, data, {}, false, false, false, undefined, Infinity))
    }
    // reset scope for next DATEX script snippet
    else {
        Compiler.resetScope(compiler_scope, <string>dx);
    }
    // compile snippet in compiler scope
    const compiled = <ArrayBuffer> await Compiler.compileLoop(compiler_scope);


    // RUN:

    // create datex scope to run
    if (!runtime_scope) {
        context_runtime_scopes.set(context_string, runtime_scope = Runtime.createNewInitialScope(undefined, undefined, undefined, undefined, context_location));
    }
    // set dxb as scope buffer
    Runtime.updateScope(runtime_scope, compiled, {sender:Runtime.endpoint, executable:true})
    
    // execute scope -> get script from path
    const value = await Runtime.simpleScopeExecution(runtime_scope)

    return value;
}


// generate a instance of a JS class / DATEX Type by casting
export function instance<T>(fromClass:{new(...params:any[]):T}, properties?:RefOrValueObject<T>): T
export function instance<T>(fromType:Type<T>, properties?:RefOrValueObject<T>): T
export function instance<T>(fromClassOrType:{new(...params:any[]):T}|Type<T>, properties?:RefOrValueObject<T>): T {
    if (fromClassOrType instanceof Type) return fromClassOrType.cast(properties);
    else return Type.getClassDatexType(fromClassOrType).cast(properties)
}

// generate a pointer for an object and returns the proxified object or the primitive pointer
/**
 * Returns a pointer property (live ref that points to the property of a Map or Object)
 * @param parentValue Map or Object
 * @param property property name
 */
export function pointer<const Key, Parent extends PointerPropertyParent<Key,unknown>>(parentValue:RefOrValue<Parent>, property:Key): PointerProperty<Parent extends Map<unknown, infer MV> ? MV : Parent[Key&keyof Parent]>
/**
 * Creates a new pointer from a value
 * @param value 
 */
export function pointer<T>(value:RefOrValue<T>): MinimalJSRef<T>
export function pointer<T>(value:RefOrValue<T>, property?:unknown): unknown {

    // pointer property
    if (property !== undefined) {
        return PointerProperty.get(value as PointerPropertyParent<any, any>, property);
    }

    // pointer
    else {
        const pointer = <any> Pointer.createOrGet(value).js_value;
        // store as eternal?
        if (waiting_eternals.size) {
            const info = getCallerInfo()?.[0];
            if (!info) throw new Error("eternal values are not supported in this runtime environment");
            const unique = `${info.file}:${info.row}`;
            if (waiting_eternals.has(unique)) {
                eternals.set(waiting_eternals.get(unique)!, pointer);
                waiting_eternals.delete(unique);
            }
        }
        if (waiting_lazy_eternals.size) {
            const info = getCallerInfo()?.[0];
            if (!info) throw new Error("eternal values are not supported in this runtime environment");
            const unique = `${info.file}:${info.row}`;
            if (waiting_lazy_eternals.has(unique)) {
                Storage.setItem(waiting_lazy_eternals.get(unique)!, pointer);
                waiting_lazy_eternals.delete(unique);
            }
        }
        return pointer
    }
    
}

export const $$ = pointer;

/**
 * val shortcut function, collapses all ref value (pointers, pointer properties)
 * @param val 
 * @returns 
 */
export function val<T>(val: RefOrValue<T>):T  { // TODO: return inferred type instead of T (ts resolution error, too deep)
    return Ref.collapseValue(val, true, true)
}


// generate primitive pointers
export function decimal(value:RefOrValue<number|bigint|string> = 0): DecimalRef {
    if (value instanceof Ref) value = value.val; // collapse
    return Pointer.create(undefined, Number(value)) // adds pointer or returns existing pointer
}
export function integer(value:RefOrValue<bigint|number|string> = 0n): IntegerRef {
    if (value instanceof Ref) value = value.val; // collapse
    return Pointer.create(undefined, BigInt(Math.floor(Number(value)))) // adds pointer or returns existing pointer
}
export function text(string:TemplateStringsArray, ...vars:any[]):Promise<TextRef>
export function text(value?:RefOrValue<any>): TextRef
export function text(value:RefOrValue<string>|TemplateStringsArray = "", ...vars:any[]): TextRef|Promise<TextRef> {
    if (value instanceof Ref) value = value.val; // collapse
    // template transform
    if (value instanceof Array) {
        return <Promise<TextRef<string>>>_datex(`always '${value.raw.map(s=>s.replace(/\(/g, '\\(').replace(/\'/g, "\\'")).join(INSERT_MARK)}'`, vars)
    }
    else return Pointer.create(undefined, String(value)) // adds pointer or returns existing pointer
}
export function boolean(value:RefOrValue<boolean> = false): BooleanRef {
    if (value instanceof Ref) value = value.val; // collapse
    return Pointer.create(undefined, Boolean(value)) // adds pointer or returns existing pointer
}


// Markdown
export function md(string:TemplateStringsArray, ...vars:any[]):Promise<Markdown>
export function md(value?:RefOrValue<string>): Markdown
export function md(value:RefOrValue<string>|TemplateStringsArray = "", ...vars:any[]): Markdown|Promise<Markdown> {
    // transform string reference
    if (value instanceof Ref) return <Promise<Markdown>> _datex `always <text/markdown> ${value}`
    // template transform
    else if (value instanceof Array) return <Promise<Markdown>>_datex(`always <text/markdown>'${value.raw.map(s=>s.replace(/\(/g, '\\(').replace(/\'/g, "\\'")).join(INSERT_MARK)}'`, vars)
    // pointer from string
    else return Pointer.create(undefined, new Markdown(value)).val // adds pointer or returns existing pointer
}

// TODO: use this?
// Object.defineProperty(String.prototype, "$", {get(){return text(this)}})
// Object.defineProperty(Number.prototype, "$", {get(){return decimal(this)}})
// Object.defineProperty(BigInt.prototype, "$", {get(){return integer(this)}})


// get string transform matching the current Runtime.ENV language
export function local_text(local_map: { [lang: string]: string; }) {
    return Runtime.getLocalString(local_map)
}

/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function transform<T,V extends TransformFunctionInputs>(observe_values:V, transform:TransformFunction<V,T>, persistent_datex_transform?:string) {
    return Ref.collapseValue(Pointer.createTransform(observe_values, transform, persistent_datex_transform));
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export async function transformAsync<T,V extends TransformFunctionInputs>(observe_values:V, transform:AsyncTransformFunction<V,T>, persistent_datex_transform?:string) {
    return Ref.collapseValue(await Pointer.createTransformAsync(observe_values, transform, persistent_datex_transform));
}


// map boolean to two values
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function map<K extends string|number, V>(value:RefOrValue<K>, map:Record<K, V>):MinimalJSRef<V> {
    return <MinimalJSRef<V>> transform([value], (v)=><any>map[<K>v]);
}

// map boolean to two values
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function select<T extends primitive>(value:RefOrValue<boolean>, if_true:T, if_false:T):MinimalJSRef<T>
export function select<T>(value:RefOrValue<boolean>, if_true:T, if_false:T):MinimalJSRef<T>
export function select<T>(value:RefOrValue<boolean>, if_true:T, if_false:T) {
    return transform([value], v=>v?<any>if_true:<any>if_false, `
    always (
        if (${Runtime.valueToDatexString(value)}) (${Runtime.valueToDatexString(if_true)}) 
        else (${Runtime.valueToDatexString(if_false)})
    )`);
}


// boolean shortcut transforms
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function not(value:RefOrValue<boolean>): BooleanRef {
    return transform([value], v=>!v);
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function and(...values:RefOrValue<boolean>[]): BooleanRef {
    return transform(values, (...values)=>{
        for (const v of values) {
            if (!v) return false;
        }
        return true;
    });
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function or(...values:RefOrValue<boolean>[]): BooleanRef {
    return transform(values, (...values)=>{
        for (const v of values) {
            if (v) return true;
        }
        return false;
    });
}


// math operations

/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function add<T>(...values:RefOrValue<T>[]): MinimalJSRef<T>
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function add(...args:any[]) {
    return transform([...args], (...args) => args.reduce((a, b) => a + b, 0));
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function sub(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function sub(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function sub(...args:any[]) {
    return transform([...args], (...args) => args.slice(1).reduce((a, b) => a - b, args[0]));
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function mul(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function mul(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function mul(...args:any[]) {
    return transform([...args], (...args) => args.reduce((a, b) => a * b, 1));
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function div(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function div(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function div(...args:any[]) {
    return transform([...args], (...args) => args.slice(1).reduce((a, b) => a / b, args[0]));
}
/**
 * @deprecated use functions from unyt_core/function.ts
 */
export function pow(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function pow(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function pow(...args:any[]) {
    return transform([...args], (...args) => args.slice(1).reduce((a, b) => a ** b, args[0]));
}


/**
 * @deprecated use functions from unyt_core/function.ts
 * "always" transform function, creates a new pointer containing the result of the callback function.
 * At any point in time, the pointer is the result of the callback function. 
 * If the function has pointers as parameters, as soon as a value of one of the parameters changes,
 * the transformed pointer value is also updated:
 * ```ts
 * const x = $$(10);
 * const y = always (() => x * 2);
 * y.val // 20
 * x.val = 5;
 * y.val // 10
 * ```
 */
export function always<const T,V extends TransformFunctionInputs>(transform:SmartTransformFunction<T>): CollapsedValueAdvanced<Pointer<T>, false, false, CollapsedValue<Pointer<T>>> // return signature from Value.collapseValue(Pointer.smartTransform())

/**
 * @deprecated use functions from unyt_core/function.ts
 *
 * Shortcut for datex `always (...)`
 * @param script 
 * @param vars 
 */
export function always<T=unknown>(script:TemplateStringsArray, ...vars:any[]): Promise<MinimalJSRef<T>>
/**
 * @deprecated use functions from unyt_core/function.ts
 *
 * always decorator
 * @param target
 * @param name
 */
export function always(target: any, name?: string):any
/**
 * @deprecated use functions from unyt_core/function.ts
 *
 * 
 */
export function always(scriptOrJSTransform:TemplateStringsArray|SmartTransformFunction<any>, ...vars:any[]) {
    // @always getter decorator
    if (scriptOrJSTransform[METADATA]) {
        console.log("dec",scriptOrJSTransform,vars[0])
        handleDecoratorArgs([scriptOrJSTransform, ...vars], (...args)=>{
            const setMetadata = args[5]
            Decorators.property(...args)
            setMetadata(Decorators.ALWAYS_GETTER, true)
        } );
    }
    // js function
    else if (typeof scriptOrJSTransform == "function") return Ref.collapseValue(Pointer.createSmartTransform(scriptOrJSTransform));
    // datex script
    else return (async ()=>Ref.collapseValue(await _datex(`always (${scriptOrJSTransform.raw.join(INSERT_MARK)})`, vars)))()
}



// generate a static pointer for an object
export function static_pointer<T>(value:RefOrValue<T>, endpoint:IdEndpoint, unique_id:number, label?:string|number) {
    const static_id = Pointer.getStaticPointerId(endpoint, unique_id);
    const pointer = Pointer.create(static_id, value)
    if (label) pointer.addLabel(typeof label == "string" ? label.replace(/^\$/, '') : label);
    return Ref.collapseValue(pointer);
}

// similar to pointer(), but also adds a label
export function label<T>(label:string|number, value:RefOrValue<T>): T {
    const pointer = Pointer.createOrGet(value);
    if (pointer instanceof Pointer) pointer.addLabel(typeof label == "string" ? label.replace(/^\$/, '') : label);
    else throw new ValueError("Cannot add label to value, value is not a pointer");
    return pointer.val;
}



// create a infinitely persistant value stored in the DATEX Storage
let PERSISTENT_INDEX = 0;

// TODO: remove @deprecated
// create default values for type
export function eternal<T>(type:Type<T>):Promise<MinimalJSRef<T>>
export function eternal<T>(value_class:any_class<T>):Promise<MinimalJSRef<T>>

// create with *primitive* default value
export function eternal<T>(initial_value:T&primitive):Promise<MinimalJSRef<T>>

// use creator function
export function eternal<T>(create:()=>Promise<T>|T):Promise<MinimalJSRef<T>>
export function eternal<T>(id_or_create_or_class:(primitive&T)|((()=>Promise<T>|T)|any_class<T>|Type<T>), _create_or_class?:(()=>Promise<T>|T)|any_class<T>|Type<T>) {
    const create_or_class = (id_or_create_or_class instanceof Function || id_or_create_or_class instanceof Type || !_create_or_class) ? id_or_create_or_class : _create_or_class;

    // create unique id for eternal call (file location + type)
    const unique = ()=>{
        const type = create_or_class instanceof Type ? create_or_class : Type.getClassDatexType(<any>create_or_class);
        const stackInfo = new Error().stack?.toString().split(/\r\n|\n/)[3]?.replace(/ *at/,'').trim(); // line 3: after Error header, unique() call, eternal() call
        return (stackInfo??'*') + ':' + (type ? type.toString() : '*') + ':' + (PERSISTENT_INDEX++)
    }
    const id = (_create_or_class && (typeof id_or_create_or_class == "string" || typeof id_or_create_or_class == "number")) ? id_or_create_or_class : unique();
 
    let creator:(()=>Promise<T>|T)|null = null;
    // is class
    if (typeof create_or_class === "function" && create_or_class.prototype !== undefined) {
        // primitive
        if (create_or_class == String || create_or_class == Number || create_or_class == Boolean)
            creator = ()=><T><unknown>create_or_class();
        // BigInt(0);
        else if (create_or_class == BigInt)
            creator = ()=><T><unknown>create_or_class(0);
        // normal
        else
            creator = ()=>new (<(new (...args: any[]) => T)>create_or_class)();
    }
    // creator function
    else if (typeof create_or_class === "function") {
        creator = <(()=>Promise<T>|T)> create_or_class;
    }
    // DATEX type
    else if (create_or_class instanceof Type) {
        creator = () => create_or_class.createDefaultValue();
    }
    // primitive value
    else if (typeof create_or_class == "string" || typeof create_or_class == "number" || typeof create_or_class == "boolean" || typeof create_or_class == "bigint") {
        creator = () => create_or_class; // return primitive value
    }

    if (creator == null) throw new Error("Undefined creator for eternal creation")
    return Storage.loadOrCreate(id, creator);
}

// call once and return stored value
export function once<T>(init:()=>Promise<T>|T):Promise<T>
export function once<T>(identifier:string, init:()=>Promise<T>|T):Promise<T>

export async function once<T>(id_or_init:string|(()=>Promise<T>|T), _init?:()=>Promise<T>|T) {
    const identifier = typeof id_or_init == "string" ? id_or_init : undefined;
    const init = typeof id_or_init == "function" ? id_or_init : _init!;
    const info = getCallerInfo();
    if (!info?.[0]) throw new Error("once() initializer is not supported in this runtime environment");
    const existing = await getLazyEternal(info, identifier, true)
    if (existing === NOT_EXISTING) {
        const unique = `${info[0].file}:${info[0].row}`;
        if (waiting_lazy_eternals.has(unique)) {
            const value = await init();
            Storage.setItem(waiting_lazy_eternals.get(unique)!, value);
            waiting_lazy_eternals.delete(unique);
            return value;
        }
        else throw new Error("could not handle once() initializer");
    }
    else return existing;
}


let eternals:Map<string,unknown>;
const waiting_eternals = new Map<string,string>();
const waiting_lazy_eternals = new Map<string,string>();

export async function loadEternalValues(){
    eternals = await Storage.loadOrCreate("eternals", ()=>new Map<string,unknown>());
    // console.log("eternal",eternals,Pointer.getByValue(eternals)?.idString())
}

export async function clearEternalValues() {
    eternals.clear();
    await Storage.clearAll();
}


// get a stored eternal value from a caller location
export function getEternal(info?:ReturnType<typeof getCallerInfo>, customIdentifier?:string, return_not_existing = false) {
    info ??= getCallerInfo();
    if (!info) throw new Error("eternal values are not supported in this runtime environment");
    const line = info[0]

    if (!line.file) throw new Error("eternal values are only supported inside module files");

    const unique_row = `${line.file}:${line.row}`;
    const key = customIdentifier!=undefined ? `${line.file}#${customIdentifier}` : `${unique_row}:${line.col}`; // use file location or customIdentifier as key

    if (!eternals.has(key)) {
        waiting_eternals.set(unique_row, key); // assign next pointer to this eternal
        setTimeout(()=>{
            if (waiting_eternals.has(unique_row)) logger.error(`uncaptured eternal value at ${unique_row}: please surround the value with $$(), otherwise it cannot be restored correctly`)
        }, 6000)
        if (return_not_existing) return NOT_EXISTING
    }
    else return eternals.get(key)
}

export async function getLazyEternal(info?:ReturnType<typeof getCallerInfo>, customIdentifier?:string, return_not_existing = false) {
    info ??= getCallerInfo();
    if (!info) throw new Error("eternal values are not supported in this runtime environment");
    const line = info[0]

    if (!line.file) throw new Error("eternal values are only supported inside module files");

    const unique_row = `${line.file}:${line.row}`;
    const key = customIdentifier!=undefined ? `${line.file}#${customIdentifier}` : `${unique_row}:${line.col}`; // use file location or customIdentifier as key
    
    if (!await Storage.hasItem(key)) {
        waiting_lazy_eternals.set(unique_row, key); // assign next pointer to this eternal
        setTimeout(()=>{
            if (waiting_lazy_eternals.has(unique_row)) logger.error(`uncaptured lazy_eternal value at ${unique_row}: please surround the value with $$(), otherwise it cannot be restored correctly`)
        }, 6000)
        if (return_not_existing) return NOT_EXISTING
    }
    else return Storage.getItem(key);
}


// TODO: remove eternal
Object.defineProperty(globalThis, 'eternal', {get:getEternal, configurable:false})
Object.defineProperty(globalThis, 'once', {value:once, configurable:false})

Object.defineProperty(globalThis, 'lazyEternal', {get:getLazyEternal, configurable:false})
// TODO: remove
Object.defineProperty(globalThis, 'lazy_eternal', {get:getLazyEternal, configurable:false})

Object.defineProperty(globalThis, 'eternalVar', {value:(customIdentifier:string)=>getEternal(getCallerInfo(), customIdentifier), configurable:false})
Object.defineProperty(globalThis, 'lazyEternalVar', {value:(customIdentifier:string)=>getLazyEternal(getCallerInfo(), customIdentifier), configurable:false})

const _once = once;
type val = typeof val;
declare global {
    const eternal: undefined
    const lazyEternal: undefined    
    const $$: typeof pointer
    const val: val

    const eternalVar: (customIdentifier:string)=>undefined
    const lazyEternalVar: (customIdentifier:string)=>undefined
    const once: typeof _once;
}


// TODO: '123456'.$$, [1,2,3].$$ ?
// declare global {

//     interface Object {
// 		$$<T>(this:T): MinimalJSRef<T>
// 	}

//     interface String {
// 		$$: MinimalJSRef<string>
// 	}
// }


// load all eternal values from storage

// @ts-ignore NO_INIT
if (!globalThis.NO_INIT) await loadEternalValues();


// create any filter Target from a string
export function f<T extends endpoint_name>(name:[T]|T):endpoint_by_endpoint_name<T> {
    return <any>Target.get((typeof name == "string" ? name : name[0]));
}








export function syncedValue(parent:any|Pointer, key?:any):PointerProperty {
    return PointerProperty.get(parent, key); 
}

// usage: props(someObjectWithPointer).someProperty  -> DatexPointerProperty<typeof someProperty>
// creates an object from a pointer with all properties as DatexSynced values
// if strong_parent_bounding is on, the child properties are always DatexPointerPropertys, otherwise a Pointer or other DatexValue might be returned if the property is already a DatexValue
export function props<T extends object = object>(parent:RefOrValue<T>, strong_parent_bounding = true): ObjectWithDatexValues<T> {
    let pointer:Pointer<T>;
    parent = Pointer.pointerifyValue(parent);
    if (parent instanceof PointerProperty) parent = parent.val; // collapse pointer property

    if (parent instanceof Pointer) pointer = <Pointer> parent;
    //else if (parent instanceof Value) pointer = parent.value;
    else throw new Error("Cannot get pointer properties of non-pointer value");
    //pointer = <Pointer<T>>Pointer.createOrGet(parent, undefined, undefined, undefined, true);

    return <ObjectWithDatexValues<T>> new Proxy({}, {
        get: (_, key) => {
            // other DatexValues can also be returned -> check if property already a DatexValue
            if (!strong_parent_bounding) {
                const property = pointer.getProperty(key);
                if (property instanceof Ref) return property;
            }
            // create a DatexPointerProperty
            return PointerProperty.get(pointer, <keyof Pointer<T>>key);
        },
        set: (_, key, value) => {
            PointerProperty.get(pointer, <keyof Pointer<T>>key).val = value;
            return true;
        }
    })
}

export function translocate<V extends unknown, T extends Record<string,V>>(value:T): {[K in keyof T]:Promise<T[K]>}
export function translocate<T extends Map<unknown,unknown>|Set<unknown>|Array<unknown>|Record<string,unknown>>(value:T):T {
    value = $$(value);
    const ptr = Pointer.getByValue(value)!;
    const id = ptr.idString();

    if (!value) throw new Error("cannot translocate empty value");
    if (!(DX_SLOTS in value)) value[DX_SLOTS] = new Map();


    const getter = (key:unknown)=>{
        const storage_key = id + "." + key;
        console.log("#get",key, storage_key)
        return Storage.getItem(storage_key)
    }
    const setter = async (key:unknown, value:unknown)=>{
        const storage_key = id + "." + key;
        console.log("#set",key, value, storage_key)
        await Storage.setItem(storage_key, value)
        return true;
    }

    value[DX_SLOTS]!.set(SLOT_GET, getter)
    value[DX_SLOTS]!.set(SLOT_SET, setter)

    // link custom getters/setters to proxy
    ptr.setPropertyGetter(getter)
    ptr.setPropertySetter(setter)

    // if (value instanceof Map) return translocateMapJS(value);
    console.log(value);
    return value;
}

// add js binding to read/write translocated properties
// export function translocateObjectJS(value:Record<string,unknown>){

// }

// export function translocateMapJS(value:Map<unknown,unknown>){
//     console.log("trans",value);
//     value.
// }




// @ts-ignore
globalThis.get = get
// @ts-ignore
globalThis.script = script
// @ts-ignore
globalThis.instance = instance;
// @ts-ignore
globalThis.decimal = decimal;
// @ts-ignore
globalThis.integer = integer;
// @ts-ignore
globalThis.text = text;
// @ts-ignore
globalThis.md = md;
// @ts-ignore
globalThis.boolean = boolean;
// @ts-ignore
globalThis.local_text = local_text;
// @ts-ignore
globalThis.label = label;
// @ts-ignore
globalThis.pointer = pointer;
// @ts-ignore
globalThis.$$ = $$;
// @ts-ignore
globalThis.val = val;
// @ts-ignore
globalThis.static_pointer = static_pointer;
// @ts-ignore
globalThis.f = f;
// @ts-ignore
globalThis.props = props;