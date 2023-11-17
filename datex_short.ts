
// shortcut functions
// import { Datex } from "./datex.ts";
import { baseURL, Runtime, PrecompiledDXB, Type, Pointer, Ref, PointerProperty, primitive, any_class, Target, IdEndpoint, TransformFunctionInputs, AsyncTransformFunction, TransformFunction, TextRef, Markdown, DecimalRef, BooleanRef, IntegerRef, MinimalJSRef, RefOrValue, PartialRefOrValueObject, datex_meta, ObjectWithDatexValues, Compiler, endpoint_by_endpoint_name, endpoint_name, Storage, compiler_scope, datex_scope, DatexResponse, target_clause, ValueError, logger, Class, getUnknownMeta, Endpoint, INSERT_MARK, CollapsedValueAdvanced, CollapsedValue, SmartTransformFunction, compiler_options, activePlugins, METADATA, handleDecoratorArgs, RefOrValueObject, PointerPropertyParent, InferredPointerProperty, RefLike } from "./datex_all.ts";

/** make decorators global */
import { assert as _assert, property as _property, sync as _sync, endpoint as _endpoint, template as _template, jsdoc as _jsdoc} from "./datex_all.ts";
import { effect as _effect, always as _always, toggle as _toggle, map as _map, equals as _equals, selectProperty as _selectProperty, not as _not } from "./functions.ts";
export * from "./functions.ts";
import { NOT_EXISTING, DX_SLOTS, SLOT_GET, SLOT_SET } from "./runtime/constants.ts";
import { AssertionError } from "./types/errors.ts";
import { getCallerFile, getCallerInfo, getMeta } from "./utils/caller_metadata.ts";
import { eternals, getLazyEternal, waitingEternals, waitingLazyEternals } from "./utils/eternals.ts";

import {instance} from "./js_adapter/js_class_adapter.ts";
export {instance} from "./js_adapter/js_class_adapter.ts";

declare global {
	const property: typeof _property;
    const assert: typeof _assert;

    const jsdoc: typeof _jsdoc;
	const sync: typeof _sync;
	const endpoint: typeof _endpoint;
    const always: typeof _always;
    const toggle: typeof _toggle;
    const map: typeof _map;
    const equals: typeof _equals;
    const selectProperty: typeof _selectProperty;
    const not: typeof _not;
    const effect: typeof _effect;
    const observe: typeof Ref.observe
    const observeAndInit: typeof Ref.observeAndInit
    const unobserve: typeof Ref.unobserve

    // conflict with UIX.template (confusing)
	// const template: typeof _template; 
}

// @ts-ignore global
globalThis.property = _property;
// @ts-ignore global
globalThis.assert = _assert;

// @ts-ignore global
globalThis.sync = _sync;
// @ts-ignore global
globalThis.endpoint = _endpoint;
// // @ts-ignore global
// globalThis.template = _template;
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

    // escape relative paths
    if (typeof dx == "string" && (dx.startsWith('./') || dx.startsWith('../'))) {
        dx = new URL(dx, context_location).toString();
    }

    // escape urls
    if (dx.toString().startsWith('http://') || dx.toString().startsWith('https://') || dx.toString().startsWith('file://') || dx.toString().startsWith('blob:http://') || dx.toString().startsWith('blob:https://')) dx = `url "${dx}"`;

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
Object.defineProperty(_datex, 'meta', {get:()=>getMeta()??getUnknownMeta(), set:()=>{}, configurable:false})
// add datex.get
Object.defineProperty(_datex, 'get', {value:(res:string, type?:Class|Type, location?:URL, plugins?:string[])=>get(res,type,location ?? getCallerFile(),plugins), configurable:false})

// add globalThis.meta
// Object.defineProperty(globalThis, 'meta', {get:()=>getMeta(), set:()=>{}, configurable:false})

export const datex = <typeof _datex & {meta:datex_meta, get:typeof get}><unknown>_datex;
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


// generate a pointer for an object and returns the proxified object or the primitive pointer
/**
 * Returns a pointer property (live ref that points to the property of a Map or Object)
 * @param parentValue Map or Object
 * @param property property name
 */
export function pointer<Key, Parent extends PointerPropertyParent<Key,unknown>>(parentValue:RefLike<Parent>, property:Key): PointerProperty<Parent extends Map<unknown, infer MV> ? MV : Parent[Key&keyof Parent]> // defined 2x with Ref<Parent> and Parent for correct type inference
export function pointer<Key, Parent extends PointerPropertyParent<Key,unknown>>(parentValue:Parent, property:Key): PointerProperty<Parent extends Map<unknown, infer MV> ? MV : Parent[Key&keyof Parent]>
/**
 * Creates a new pointer from a value
 * @param value 
 */
export function pointer<T>(value:RefLike<T>): MinimalJSRef<T> // defined 2x with Ref<T> and T for correct type inference
export function pointer<T>(value:T): MinimalJSRef<T>
export function pointer<T>(value:RefOrValue<T>, property?:unknown): unknown {

    // pointer property
    if (property !== undefined) {
        return PointerProperty.get(value as PointerPropertyParent<any, any>, property);
    }

    // pointer
    else {
        const pointer = <any> Pointer.createOrGet(value).js_value;
        // store as eternal?
        if (waitingEternals.size) {
            const info = getCallerInfo()?.[0];
            if (!info) throw new Error("eternal values are not supported in this runtime environment");
            const unique = `${info.file}:${info.row}`;
            if (waitingEternals.has(unique)) {
                eternals.set(waitingEternals.get(unique)!, pointer);
                waitingEternals.delete(unique);
            }
        }
        if (waitingLazyEternals.size) {
            const info = getCallerInfo()?.[0];
            if (!info) throw new Error("eternal values are not supported in this runtime environment");
            const unique = `${info.file}:${info.row}`;
            if (waitingLazyEternals.has(unique)) {
                Storage.setItem(waitingLazyEternals.get(unique)!, pointer);
                waitingLazyEternals.delete(unique);
            }
        }
        return pointer
    }
    
}

export const $$ = pointer;

type $type = Record<string, Pointer<unknown>|Promise<Pointer<unknown>>>;

/**
 * Used as shortcut for debugging, returns a Pointer or Promise<Pointer>
 * for a given id:
 * ```ts
 * const ptr: Pointer = $.AFEFEF3282389FEFAxE2;
 * ```
 * 
 */
export const $ = new Proxy({} as $type, {
    get(_target,p,_receiver) {
        if (typeof p == "string") {
            const ptr = Pointer.get(p);
            if (ptr) return ptr;
            else return Pointer.load(p)
        }
    },
})


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
export function localtext(local_map: { [lang: string]: string; }) {
    return Runtime.getLocalString(local_map)
}

/**
 * @deprecated use localtext
 */
export const local_text = localtext

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
        if (waitingLazyEternals.has(unique)) {
            const value = await init();
            Storage.setItem(waitingLazyEternals.get(unique)!, value);
            waitingLazyEternals.delete(unique);
            return value;
        }
        else throw new Error("could not handle once() initializer");
    }
    else return existing;
}


const _once = once;
type val = typeof val;
declare global {
    const eternal: undefined
    const lazyEternal: undefined    
    const $$: typeof pointer
    const $: $type

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


// create any filter Target from a string
export function f<T extends endpoint_name>(name:[T]|T):endpoint_by_endpoint_name<T> {
    return <any>Target.get((typeof name == "string" ? name : name[0]));
}

export function printTrace(endpoint: string|Endpoint) {
    endpoint = typeof endpoint == "string" ? Target.get(endpoint) as Endpoint : endpoint;
    return endpoint.printTrace()
}

type printTraceT = typeof printTrace;
declare global {
    const printTrace: printTraceT;
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


Object.defineProperty(globalThis, 'once', {value:once, configurable:false})
Object.defineProperty(globalThis, 'always', {value:_always, configurable:false})
Object.defineProperty(globalThis, 'toggle', {value:_toggle, configurable:false})
Object.defineProperty(globalThis, 'map', {value:_map, configurable:false})
Object.defineProperty(globalThis, 'equals', {value:_equals, configurable:false})
Object.defineProperty(globalThis, 'selectProperty', {value:_selectProperty, configurable:false})
Object.defineProperty(globalThis, 'not', {value:_not, configurable:false})
Object.defineProperty(globalThis, 'effect', {value:_effect, configurable:false})
Object.defineProperty(globalThis, 'observe', {value:Ref.observe, configurable:false})
Object.defineProperty(globalThis, 'observeAndInit', {value:Ref.observeAndInit, configurable:false})
Object.defineProperty(globalThis, 'unobserve', {value:Ref.unobserve, configurable:false})

// @ts-ignore
globalThis.get = get
// @ts-ignore
globalThis.script = script
// @ts-ignore
globalThis.instance = instance;
// @ts-ignore
globalThis.md = md;
// @ts-ignore
globalThis.localtext = localtext;
// @ts-ignore
globalThis.local_text = local_text;
// @ts-ignore
globalThis.label = label;
// @ts-ignore
globalThis.$$ = $$;
// @ts-ignore
globalThis.$ = $;
// @ts-ignore
globalThis.val = val;
// @ts-ignore
globalThis.static_pointer = static_pointer;
// @ts-ignore
globalThis.f = f;
// @ts-ignore
globalThis.printTrace = printTrace;
// @ts-ignore
globalThis.props = props;