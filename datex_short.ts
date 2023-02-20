
// shortcut functions
import { Datex } from "./datex.ts";
import { baseURL, compiler_scope, datex_scope, DatexResponse, target_clause, ValueError } from "./datex_all.ts";

/** make decorators global */
import {property as _property, sync as _sync, endpoint as _endpoint, template as _template} from "./datex_all.ts";
import { getCallerFile } from "./utils/caller_metadata.ts";

declare global {
	const property: typeof _property;
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



// can be used instead of import(), calls a DATEX get instruction, works for urls, endpoint, ...
export function get<T=unknown>(dx:string|URL, context_location?:URL|string):Promise<T> {
    // auto retrieve location from stack
    context_location ??= getCallerFile();
    // workaround -> convert absolute path to relative (TODO: handle in DATEX?)
    if (typeof dx == "string" && dx.startsWith("/")) dx = "." + dx;
    return <Promise<T>> _datex('get (' + dx + ' )', undefined, undefined, undefined, undefined, context_location)
}


/***** execute DATEX */
// default endpoint: DatexRuntime.endpoint
// sign per default if not local endpoint
// do not encrypt per default
function _datex(dx:TemplateStringsArray, ...args:any[]):Promise<unknown>
function _datex(dx:string|Datex.PrecompiledDXB, data?:unknown[], to?:Datex.Target|target_clause|Datex.endpoint_name, sign?:boolean, encrypt?:boolean, context_location?:URL|string):Promise<unknown>
function _datex(dx:string|TemplateStringsArray|Datex.PrecompiledDXB, data?:unknown[], to?:Datex.Target|target_clause|Datex.endpoint_name, sign?:boolean, encrypt?:boolean, context_location?:URL|string) {

    // auto retrieve location from stack
    if (!context_location) {
        context_location = new Error().stack?.trim()?.match(/((?:https?|file)\:\/\/.*?)(?::\d+)*(?:$|\nevaluate@)/)?.[1];
    }

    // template string (datex `...`)
    if (dx instanceof Array && !(dx instanceof Datex.PrecompiledDXB)) {
        dx = dx.raw.join("?");
        data = Array.from(arguments);
        data.splice(0,1);
        // arguments have no meaning when using template string, set to default
        to = Datex.Runtime.endpoint;
        sign = false;
        encrypt = false;
        context_location = undefined;
    }

    else {
        // default arg values
        data ??= [];
        to ??= Datex.Runtime.endpoint;
        sign ??= to!=Datex.Runtime.endpoint;
        encrypt ??= false;
    }

    // local execution
    if (to === Datex.Runtime.endpoint) return Datex.Runtime.executeDatexLocally(dx, data, {sign, encrypt}, context_location ? new URL(context_location.toString()) : undefined); 
    // remote execution
    else return Datex.Runtime.datexOut([dx, data, {sign, encrypt, context_location: context_location ? new URL(context_location.toString()) : undefined}], typeof to == "string" ? f(<Datex.endpoint_name>to) : to);
    
}

// add datex.meta
Object.defineProperty(_datex, 'meta', {get:()=>Datex.getMeta(), set:()=>{}, configurable:false})
// add datex.get
Object.defineProperty(_datex, 'get', {value:(res:string)=>get(res,getCallerFile()), configurable:false})

// add globalThis.meta
// Object.defineProperty(globalThis, 'meta', {get:()=>Datex.getMeta(), set:()=>{}, configurable:false})

export const datex = <typeof _datex & {meta:Datex.datex_meta, get:typeof get}><unknown>_datex;
// @ts-ignore global datex
globalThis.datex = datex;
// global access to datex and meta
type d = typeof datex;
declare global {
    const datex: d;
    const meta: Datex.datex_meta
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
// similar to the 'compile' command in Datex.Compiler

const context_compiler_scopes = new Map<string, compiler_scope>();
const context_runtime_scopes = new Map<string, datex_scope>();

// OTDO
export async function script(dx:TemplateStringsArray, ...args:any[]):Promise<any>
export async function script(dx:string|Datex.PrecompiledDXB, data?:any[], to?:Datex.Target|target_clause|Datex.endpoint_name, sign?:boolean, encrypt?:boolean):Promise<any>
export async function script(dx:string|TemplateStringsArray|Datex.PrecompiledDXB, data:any[]=[], to:Datex.Target|target_clause|Datex.endpoint_name = Datex.Runtime.endpoint, sign=to!=Datex.Runtime.endpoint, encrypt=false) {
    // template string (script `...`)
    if (dx instanceof Array && !(dx instanceof Datex.PrecompiledDXB)) {
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
        context_compiler_scopes.set(context_string, compiler_scope = Datex.Compiler.createCompilerScope(<string>dx, data, {}, false, false, false, undefined, Infinity))
    }
    // reset scope for next DATEX script snippet
    else {
        Datex.Compiler.resetScope(compiler_scope, <string>dx);
    }
    // compile snippet in compiler scope
    const compiled = <ArrayBuffer> await Datex.Compiler.compileLoop(compiler_scope);


    // RUN:

    // create datex scope to run
    if (!runtime_scope) {
        context_runtime_scopes.set(context_string, runtime_scope = Datex.Runtime.createNewInitialScope(undefined, undefined, undefined, undefined, context_location));
    }
    // set dxb as scope buffer
    Datex.Runtime.updateScope(runtime_scope, compiled, {sender:Datex.Runtime.endpoint, executable:true})
    
    // execute scope -> get script from path
    const value = await Datex.Runtime.simpleScopeExecution(runtime_scope)

    return value;
}


// generate a instance of a JS class / DATEX Type by casting
export function instance<T>(fromClass:{new(...params:any[]):T}, properties?:Datex.CompatPartial<T>): T
export function instance<T>(fromType:Datex.Type<T>, properties?:Datex.CompatPartial<T>): T
export function instance<T>(fromClassOrType:{new(...params:any[]):T}|Datex.Type<T>, properties?:Datex.CompatPartial<T>): T {
    if (fromClassOrType instanceof Datex.Type) return fromClassOrType.cast(properties);
    else return Datex.Type.getClassDatexType(fromClassOrType).cast(properties)
}



// generate a pointer for an object and returns the proxified object or the primitive pointer
export function pointer<T>(value:Datex.CompatValue<T>): Datex.MinimalJSRef<T> {
    return <any> Datex.Pointer.createOrGet(value).js_value;
}

export const $$ = pointer;

// generate primitive pointers
export function decimal(value:Datex.CompatValue<number|bigint|string> = 0): Datex.DecimalRef {
    if (value instanceof Datex.Value) value = value.val; // collapse
    return Datex.Pointer.create(undefined, Number(value)) // adds pointer or returns existing pointer
}
export function integer(value:Datex.CompatValue<bigint|number|string> = 0n): Datex.IntegerRef {
    if (value instanceof Datex.Value) value = value.val; // collapse
    return Datex.Pointer.create(undefined, BigInt(Math.floor(Number(value)))) // adds pointer or returns existing pointer
}
export function text(string:TemplateStringsArray, ...vars:any[]):Promise<Datex.TextRef>
export function text(value?:Datex.CompatValue<any>): Datex.TextRef
export function text(value:Datex.CompatValue<string>|TemplateStringsArray = "", ...vars:any[]): Datex.TextRef|Promise<Datex.TextRef> {
    if (value instanceof Datex.Value) value = value.val; // collapse
    // template transform
    if (value instanceof Array) {
        return <Promise<Datex.TextRef<string>>>_datex(`always '${value.raw.map(s=>s.replace(/\(/g, '\\(').replace(/\'/g, "\\'")).join("(?)")}'`, vars)
    }
    else return Datex.Pointer.create(undefined, String(value)) // adds pointer or returns existing pointer
}
export function boolean(value:Datex.CompatValue<boolean> = false): Datex.BooleanRef {
    if (value instanceof Datex.Value) value = value.val; // collapse
    return Datex.Pointer.create(undefined, Boolean(value)) // adds pointer or returns existing pointer
}


// Markdown
export function md(string:TemplateStringsArray, ...vars:any[]):Promise<Datex.Markdown>
export function md(value?:Datex.CompatValue<string>): Datex.Markdown
export function md(value:Datex.CompatValue<string>|TemplateStringsArray = "", ...vars:any[]): Datex.Markdown|Promise<Datex.Markdown> {
    // transform string reference
    if (value instanceof Datex.Value) return <Promise<Datex.Markdown>> _datex `always <text/markdown> ${value}`
    // template transform
    else if (value instanceof Array) return <Promise<Datex.Markdown>>_datex(`always <text/markdown>'${value.raw.map(s=>s.replace(/\(/g, '\\(').replace(/\'/g, "\\'")).join("(?)")}'`, vars)
    // pointer from string
    else return Datex.Pointer.create(undefined, new Datex.Markdown(value)).val // adds pointer or returns existing pointer
}

// TODO: use this?
// Object.defineProperty(String.prototype, "$", {get(){return text(this)}})
// Object.defineProperty(Number.prototype, "$", {get(){return decimal(this)}})
// Object.defineProperty(BigInt.prototype, "$", {get(){return integer(this)}})


// get string transform matching the current Runtime.ENV language
export function local_text(local_map: { [lang: string]: string; }) {
    return Datex.Runtime.getLocalString(local_map)
}


export function transform<T,V extends Datex.TransformFunctionInputs>(observe_values:V, transform:Datex.TransformFunction<V,T>, persistent_datex_transform?:string) {
    return Datex.Value.collapseValue(Datex.Pointer.createTransform(observe_values, transform, persistent_datex_transform));
}
export async function transformAsync<T,V extends Datex.TransformFunctionInputs>(observe_values:V, transform:Datex.AsyncTransformFunction<V,T>, persistent_datex_transform?:string) {
    return Datex.Value.collapseValue(await Datex.Pointer.createTransformAsync(observe_values, transform, persistent_datex_transform));
}


// map boolean to two values
export function map<K extends string|number, V>(value:Datex.CompatValue<K>, map:Record<K, V>):Datex.MinimalJSRef<V> {
    return <Datex.MinimalJSRef<V>> transform([value], (v)=><any>map[<K>v]);
}

// map boolean to two values
export function select<T extends Datex.primitive>(value:Datex.CompatValue<boolean>, if_true:T, if_false:T):Datex.MinimalJSRef<T>
export function select<T>(value:Datex.CompatValue<boolean>, if_true:T, if_false:T):Datex.MinimalJSRef<T>
export function select<T>(value:Datex.CompatValue<boolean>, if_true:T, if_false:T) {
    return transform([value], v=>v?<any>if_true:<any>if_false, `
    always (
        if (${Datex.Runtime.valueToDatexString(value)}) (${Datex.Runtime.valueToDatexString(if_true)}) 
        else (${Datex.Runtime.valueToDatexString(if_false)})
    )`);
}


// boolean shortcut transforms
export function not(value:Datex.CompatValue<boolean>): Datex.BooleanRef {
    return transform([value], v=>!v);
}
export function and(...values:Datex.CompatValue<boolean>[]): Datex.BooleanRef {
    return transform(values, (...values)=>{
        for (const v of values) {
            if (!v) return false;
        }
        return true;
    });
}
export function or(...values:Datex.CompatValue<boolean>[]): Datex.BooleanRef {
    return transform(values, (...values)=>{
        for (const v of values) {
            if (v) return true;
        }
        return false;
    });
}


// same as datex `always ...`
export async function always(script:TemplateStringsArray, ...vars:any[]):Promise<Datex.Pointer|any> {
    return Datex.Value.collapseValue(await _datex(`always (${script.raw.join("?")})`, vars))
}


// generate a static pointer for an object
export function static_pointer<T>(value:Datex.CompatValue<T>, endpoint:Datex.IdEndpoint, unique_id:number, label?:string|number) {
    const static_id = Datex.Pointer.getStaticPointerId(endpoint, unique_id);
    const pointer = Datex.Pointer.create(static_id, value)
    if (label) pointer.addLabel(typeof label == "string" ? label.replace(/^\$/, '') : label);
    return Datex.Value.collapseValue(pointer);
}

// similar to pointer(), but also adds a label
export function label<T>(label:string|number, value:Datex.CompatValue<T>): T {
    const pointer = Datex.Pointer.createOrGet(value);
    if (pointer instanceof Datex.Pointer) pointer.addLabel(typeof label == "string" ? label.replace(/^\$/, '') : label);
    else throw new ValueError("Cannot add label to value, value is not a pointer");
    return pointer.val;
}



// create a infinitely persistant value stored in the DATEX Datex.Storage
let PERSISTENT_INDEX = 0;

type primitive = number|string|bigint|boolean;

// TODO: remove these?
// export function eternal<T>(id:string|number, type:Datex.Type<T>):Promise<Datex.MinimalJSRef<T>>
// export function eternal<T>(id:string|number, value_class:Datex.any_class<T>):Promise<Datex.MinimalJSRef<T>>
// export function eternal<T>(id:string|number, create:()=>Promise<T>|T):Promise<Datex.MinimalJSRef<T>>

// create default values for type
export function eternal<T>(type:Datex.Type<T>):Promise<Datex.MinimalJSRef<T>>
export function eternal<T>(value_class:Datex.any_class<T>):Promise<Datex.MinimalJSRef<T>>

// create with *primitive* default value
export function eternal<T>(initial_value:T&primitive):Promise<Datex.MinimalJSRef<T>>

// use creator function
export function eternal<T>(create:()=>Promise<T>|T):Promise<Datex.MinimalJSRef<T>>
export function eternal<T>(id_or_create_or_class:(primitive&T)|((()=>Promise<T>|T)|Datex.any_class<T>|Datex.Type<T>), _create_or_class?:(()=>Promise<T>|T)|Datex.any_class<T>|Datex.Type<T>) {
    const create_or_class = (id_or_create_or_class instanceof Function || id_or_create_or_class instanceof Datex.Type || !_create_or_class) ? id_or_create_or_class : _create_or_class;

    // create unique id for eternal call (file location + type)
    const unique = ()=>{
        const type = create_or_class instanceof Datex.Type ? create_or_class : Datex.Type.getClassDatexType(<any>create_or_class);
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
    else if (create_or_class instanceof Datex.Type) {
        creator = () => create_or_class.createDefaultValue();
    }
    // primitive value
    else if (typeof create_or_class == "string" || typeof create_or_class == "number" || typeof create_or_class == "boolean" || typeof create_or_class == "bigint") {
        creator = () => create_or_class; // return primitive value
    }

    if (creator == null) throw new Datex.Error("Undefined creator for eternal creation")
    return Datex.Storage.loadOrCreate(id, creator);
}



// export function not(value:[Datex.endpoint_name]|Datex.endpoint_name) {
//     let target:Datex.Target;
//     if (typeof value == "string") target = f(value);
//     else if (value instanceof Array && typeof value[0] == "string") target = f(value[0]);
//     return new target_clause(Datex.Not.get(target));
// }
// export function person(name:[target_clause_target_name_person]|target_clause_target_name_person) {
//     return Datex.Person.get(typeof name == "string" ? name : name[0]);
// }
// export function institution(name:[target_clause_target_name_institution]|target_clause_target_name_institution) {
//     return Datex.Institution.get(typeof name == "string" ? name : name[0]);
// }
// export function bot(name:[target_clause_target_name_bot]|target_clause_target_name_bot) {
//     return Datex.Bot.get(typeof name == "string" ? name : name[0]);
// }

// // create any filter Datex.Target from a string
// export function ef(filter:Datex.Target) {
//     if (filter instanceof Datex.Target) return filter.toString()
//     return new target_clause(filter).toString();
// }

// create any filter Datex.Target from a string
export function f<T extends Datex.endpoint_name>(name:[T]|T):Datex.endpoint_by_endpoint_name<T> {
    return <any>Datex.Target.get((typeof name == "string" ? name : name[0]));
}








export function syncedValue(parent:any|Datex.Pointer, key?:any):Datex.PointerProperty {
    return Datex.PointerProperty.get(parent, key); 
}

// usage: props(someObjectWithPointer).someProperty  -> DatexPointerProperty<typeof someProperty>
// creates an object from a pointer with all properties as DatexSynced values
// if strong_parent_bounding is on, the child properties are always DatexPointerPropertys, otherwise a Datex.Pointer or other DatexValue might be returned if the property is already a DatexValue
export function props<T extends object = object>(parent:Datex.CompatValue<T>, strong_parent_bounding = true): Datex.ObjectWithDatexValues<T> {
    let pointer:Datex.Pointer<T>;
    parent = Datex.Pointer.pointerifyValue(parent);
    if (parent instanceof Datex.PointerProperty) parent = parent.val; // collapse pointer property

    if (parent instanceof Datex.Pointer) pointer = <Datex.Pointer> parent;
    //else if (parent instanceof Datex.Value) pointer = parent.value;
    else throw new Error("Cannot get pointer properties of non-pointer value");
    //pointer = <Datex.Pointer<T>>Datex.Pointer.createOrGet(parent, undefined, undefined, undefined, true);

    return <Datex.ObjectWithDatexValues<T>> new Proxy({}, {
        get: (_, key) => {
            // other DatexValues can also be returned -> check if property already a DatexValue
            if (!strong_parent_bounding) {
                const property = pointer.getProperty(key);
                if (property instanceof Datex.Value) return property;
            }
            // create a DatexPointerProperty
            return Datex.PointerProperty.get(pointer, <keyof Datex.Pointer<T>>key);
        },
        set: (_, key, value) => {
            Datex.PointerProperty.get(pointer, <keyof Datex.Pointer<T>>key).val = value;
            return true;
        }
    })
}

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
globalThis.transform = transform;
// @ts-ignore
globalThis.transformAsync = transformAsync;
// @ts-ignore
globalThis.always = always;
// @ts-ignore
globalThis.label = label;
// @ts-ignore
globalThis.pointer = pointer;
// @ts-ignore
globalThis.$$ = $$;
// @ts-ignore
globalThis.static_pointer = static_pointer;
// @ts-ignore
globalThis.eternal = eternal;
// @ts-ignore
globalThis.f = f;
// @ts-ignore
globalThis.props = props;
// @ts-ignore
globalThis.and = and;
// @ts-ignore
globalThis.or = or;
// @ts-ignore
globalThis.not = not;