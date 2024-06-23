/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  Datex JS Class Adapter (@sync classes)                                              ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Unyt core library                                                                   ║
 ║  Visit docs.unyt.org/unyt_js for more information                                    ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2022  Benedikt Strehle               ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */

/** Imports **/

// import "../lib/reflect-metadata/Reflect.js";
import { Runtime, StaticScope } from "../runtime/runtime.ts";

import { Logger } from "../utils/logger.ts";
import { endpoint_name, LOCAL_ENDPOINT, Target, target_clause } from "../types/addressing.ts";
import { Type } from "../types/type.ts";
import { getProxyFunction, getProxyStaticValue, ObjectRef, Pointer, UpdateScheduler } from "../runtime/pointers.ts";
import { Function as DatexFunction } from "../types/function.ts";
import { DatexObject } from "../types/object.ts";
import { Tuple } from "../types/tuple.ts";
import { DX_PERMISSIONS, DX_TYPE, DX_ROOT, INIT_PROPS, DX_EXTERNAL_SCOPE_NAME, DX_EXTERNAL_FUNCTION_NAME, DX_TIMEOUT } from "../runtime/constants.ts";
import type { Class } from "../utils/global_types.ts";
import { Conjunction, Disjunction, Logical } from "../types/logic.ts";
import { client_type } from "../utils/constants.ts";
import { Assertion } from "../types/assertion.ts";
import { getCallerInfo } from "../utils/caller_metadata.ts";
import { createFunctionWithDependencyInjectionsResolveLazyPointers } from "../types/function-utils.ts";

const { Reflect: MetadataReflect } = client_type == 'deno' ? await import("https://deno.land/x/reflect_metadata@v0.1.12/mod.ts") : {Reflect};

const logger = new Logger("DATEX JS Adapter");


const CONSTRUCT_OPTIONS = Symbol("CONSTRUCT_OPTIONS");

// create metadata symbol
if (!Symbol['metadata']) Symbol['metadata'] = Symbol('metadata');
export const METADATA:unique symbol = Symbol['metadata'];


// generate a instance of a JS class / DATEX Type by casting
export function instance<T>(fromClass:{new(...params:any[]):T}, properties?:PartialRefOrValueObject<T>): T
export function instance<T>(fromType:Type<T>, properties?:PartialRefOrValueObject<T>): T
export function instance<T>(fromClassOrType:{new(...params:any[]):T}|Type<T>, properties?:PartialRefOrValueObject<T>): T {
    if (fromClassOrType instanceof Type) return fromClassOrType.cast(properties);
    else return Type.getClassDatexType(fromClassOrType).cast(properties)
}


// handles all decorators
export class Decorators {

    static IS_EXPOSED    = Symbol("IS_EXPOSED");
    static IS_REMOTE     = Symbol("IS_REMOTE");

    static IS_EACH       = Symbol("IS_EACH");
    static IS_SYNC       = Symbol("IS_SYNC");
    static IS_ANONYMOUS  = Symbol("IS_ANONYMOUS");
    static IS_SEALED     = Symbol("IS_SEALED");
    static ANONYMIZE     = Symbol("ANONYMIZE");

    static PROPERTY      = Symbol("PROPERTY");
    static STATIC_PROPERTY  = Symbol("STATIC_PROPERTY");
    static SERIALIZE     = Symbol("SERIALIZE");
    static JSDOC         = Symbol("JSDOC");

    static ALLOW_FILTER  = Symbol("ALLOW_FILTER");
    static SEND_FILTER   = Symbol("SEND_FILTER");

    static NAMESPACE     = Symbol("SCOPE_NAME");

    static DEFAULT       = Symbol("ROOT_EXTENSION");
    static DEFAULT_PROPERTY = Symbol("ROOT_VARIABLE");

    static DOCS          = Symbol("DOCS");

    static META_INDEX    = Symbol("META_INDEX");

    static SIGN          = Symbol("SIGN");
    static ENCRYPT       = Symbol("ENCRYPT");
    static NO_RESULT     = Symbol("NO_RESULT");
    static TIMEOUT       = Symbol("TIMEOUT");
    static OBSERVER      = Symbol("OBSERVER");
    static SCHEDULER     = Symbol("SCHEDULER");

    static FORCE_TYPE    = Symbol("FORCE_TYPE");
    static FROM_TYPE     = Symbol("FROM_TYPE");


    public static setMetadata(context:DecoratorContext, key:string|symbol, value:unknown) {
        // handle inheritance for nested object: if metadata has prototype but no own properties, inherit nested
        if (Object.getPrototypeOf(context.metadata) && !Object.getOwnPropertyNames(context.metadata).length && !Object.getOwnPropertySymbols(context.metadata).length) {
            const proto = Object.getPrototypeOf(context.metadata);
            for (const key of [...Object.getOwnPropertyNames(proto), ...Object.getOwnPropertySymbols(proto)]) {
                context.metadata[key] = {};
                if (proto[key]?.public) (context.metadata[key] as any).public = Object.create(proto[key].public);
                if (proto[key]?.constructor)(context.metadata[key] as any).constructor = proto[key].constructor;
            }
        }

        if (!context.metadata[key]) context.metadata[key] = {}
        const data = context.metadata[key] as {public?:Record<string|symbol,any>, constructor?:any}
        if (context.kind == "class") {
            data.constructor = value;
        }
        else {
            if (!data.public) data.public = {};
            data.public[context.name] = value;
        }  
    }


    /** @endpoint(endpoint?:string|Datex.Endpoint, namespace?:string): declare a class as a #public property */
    static endpoint(endpoint:target_clause|endpoint_name, scope_name:string|undefined, value: Class, context: ClassDecoratorContext) {
        // target endpoint
        if (endpoint) {
            Decorators.addMetaFilter(
                endpoint, 
                context,
                Decorators.SEND_FILTER
            )
        }
        else {
            this.setMetadata(context, Decorators.SEND_FILTER, true) // indicate to always use local endpoint (expose)
        }

        // custom namespace name
        this.setMetadata(context, Decorators.NAMESPACE, scope_name ?? value.name);
        registerPublicStaticClass(value, 'public', context.metadata);
    }

    /** @entrypoint is set as endpoint entrypoint */
    static entrypoint(value:Class, context: ClassDecoratorContext) {
        this.setMetadata(context, Decorators.SEND_FILTER, true) // indicate to always use local endpoint (expose)
        this.setMetadata(context, Decorators.NAMESPACE, value.name);
        registerPublicStaticClass(value, 'entrypoint', context.metadata);
    }

    /** @entrypointProperty is set as a property of the endpoint entrypoint */
    static entrypointProperty(value:Class, context: ClassDecoratorContext) {
        this.setMetadata(context, Decorators.SEND_FILTER, true) // indicate to always use local endpoint (expose)
        this.setMetadata(context, Decorators.NAMESPACE, value.name);
        registerPublicStaticClass(value, 'entrypointProperty', context.metadata);
    }


    /** @docs(content:string): add docs to a static scope class / pseudo class */
    static docs(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[string?] = []) {
    
        // invalid decorator call
        if (kind != "class") logger.error("@docs can only be used for classes");

        // handle decorator
        else {
            setMetadata(Decorators.DOCS, params[0])
        }
    }

    /** @sign(sign?:boolean): sign outgoing DATEX requests (default:true) */
    static sign(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[boolean?] = []) {
        setMetadata(Decorators.SIGN, params[0])
    }

    /** @encrypt(encrpyt?:boolean): encrypt outgoing DATEX requests (default:false) */
    static encrypt(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[boolean?] = []) {
        setMetadata(Decorators.ENCRYPT, params[0])
    }

    /** @no_result: do not wait for the result */
    static no_result(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:undefined) {
        setMetadata(Decorators.NO_RESULT, true)
    }

    /** @timeout(msecs?:number): DATEX request timeout */
    static timeout(timeMs:number, context:ClassMethodDecoratorContext) {
        if (isFinite(timeMs) && timeMs > 2**31) throw new Error("@timeout: timeout too big (max value is 2^31), use Infinity if you want to disable the timeout")
        this.setMetadata(context, Decorators.TIMEOUT, timeMs)
    }

    /** @allow(allow:filter): Allowed endpoints for class/method/field */
    static allow(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[target_clause?] = []) {
        Decorators.addMetaFilter(
            params[0], 
            setMetadata, getMetadata, Decorators.ALLOW_FILTER
        )
    }

    /** @to(to:filter): Send DATEX requests to endpoints */
    static to(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[(target_clause|endpoint_name)?] = []) {
        Decorators.addMetaFilter(
            params[0], 
            setMetadata, getMetadata, Decorators.SEND_FILTER
        )
    }

    /** @each: sent to all subscribers */
    static each(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:undefined) {
        
        // invalid decorator call
        if (is_static) logger.error("Cannot use @each for static field '" + name.toString() +"'");

        // handle decorator
        else {
            setMetadata(Decorators.IS_EACH, true)
        }
    }


    /** @property: add a field as a template property */
    static property<T>(type:string|Type<T>|Class<T>, context: ClassFieldDecoratorContext|ClassGetterDecoratorContext|ClassMethodDecoratorContext) {

        if (context.static) {
            this.setMetadata(context, Decorators.STATIC_PROPERTY, context.name)
        }
        else {
            this.setMetadata(context, Decorators.PROPERTY, context.name)
        }

        // type
        if (type) {
            const normalizedType = normalizeType(type);
            this.setMetadata(context, Decorators.FORCE_TYPE, normalizedType)
        }
    }


     /** @assert: add type assertion function */
    static assert<T>(assertion: (val:T) => boolean|string|undefined, context: ClassFieldDecoratorContext) {
        if (context.static) logger.error("Cannot use @assert with static fields");
        else {
            const assertionType = new Conjunction(Assertion.get(undefined, assertion, false));
            this.setMetadata(context, Decorators.FORCE_TYPE, assertionType)
        }
    }

    /** @jsdoc parse jsdoc comments and use as docs for DATEX type*/
    // TODO: only works with real js decorators, otherwise line numbers don't match
    static jsdoc(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[]) {

        logger.error("@jsdoc decorators are not yet supported")
        // const caller = getCallerInfo()?.at(-1)!;

        // if (!caller?.file || !caller.row) {
        //     logger.error("cannot get JSDoc data (@jsdoc was used on the " + kind + " "+name+")")
        //     return;
        // }

        // (async()=>{
        //     const path = new Path(caller.file!);
        //     const content = (await path.getTextContent()).split("\n").slice(Math.min(0,caller.row-60), caller.row).join("\n");    
        //     setMetadata(Decorators.JSDOC, "TODO")
        // })()
    }


    /** @serialize: custom serializer for a template property */
    static serialize(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[Function]) {
        if (is_static) logger.error("@serialize decorator cannot be used for static fields");
        else if (kind != "field" && kind != "getter" && kind != "setter" && kind != "method") logger.error("Invalid use of @serialize decorator");
        else if (!params?.[0]) logger.error("Missing serializer method on @serialize decorator");

        else {
            setMetadata(Decorators.SERIALIZE, params[0])
        }

    }


    /** @sync: sync class/property */
    static sync(type: string|Type|undefined, value: Class, context?: ClassDecoratorContext, callerFile?:string) {
        
        if (context) {
            this.setMetadata(context ?? {kind: "class", metadata:(value as any)[METADATA]}, Decorators.IS_SYNC, true)
        }

        const originalClass = value;

        let normalizedType: Type;

        // get template type
        if (typeof type == "string" || type instanceof Type) {
            normalizedType = normalizeType(type, false, "ext");
        }
        else if (
            originalClass[METADATA]?.[Decorators.FORCE_TYPE] && 
            Object.hasOwn(originalClass[METADATA]?.[Decorators.FORCE_TYPE], 'constructor')
        ) normalizedType = originalClass[METADATA]?.[Decorators.FORCE_TYPE]?.constructor
        else {
            if (!originalClass.name) throw new Error("Cannot create DATEX type mapping for an anonymous class")
            normalizedType = Type.get("ext", originalClass.name.replace(/^_/, '')); // remove leading _ from type name
        }

        if (!callerFile && client_type == "deno" && normalizedType.namespace !== "std") {
            callerFile = getCallerInfo()?.[3]?.file ?? undefined;
            if (!callerFile) {
                logger.error("Could not determine JS module URL for type '" + normalizedType + "'")
            }
        }
        
        // return new templated class
        return createTemplateClass(originalClass, normalizedType, true, true, callerFile, context?.metadata);
    }


    /** @update(interval:number|scheduler:DatexUpdateScheduler): set update interval / scheduler */
    static update(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params:[(number|UpdateScheduler)?] = []) {
        
        if (params[0] instanceof UpdateScheduler) setMetadata(Decorators.SCHEDULER, params[0])
        else setMetadata(Decorators.SCHEDULER, new UpdateScheduler(params[0]));
    }

    // handle ALLOW_FILTER for classes, methods and fields
    // adds filter
    private static addMetaFilter(new_filter:target_clause|endpoint_name, context: DecoratorContext, filter_symbol:symbol){
        if (typeof new_filter == "string") this.setMetadata(context, filter_symbol, Target.get(new_filter))
        else this.setMetadata(context, filter_symbol, new_filter)
    }
}

/**
 * Converts strings into Datex.Type and checks if type parameters are allowed
 * @param type 
 * @param allowTypeParams 
 * @returns 
 */
function normalizeType(type:Type|string|Class, allowTypeParams = true, defaultNamespace = "std") {
    if (typeof type == "string") {
        // extract type name and parameters
        const [typeName, paramsString] = type.replace(/^\</,'').replace(/\>$/,'').match(/^((?:[\w-]+\:)?[\w-]*)(?:\((.*)\))?$/)?.slice(1) ?? [];
        if (paramsString && !allowTypeParams) throw new Error(`Type parameters not allowed (${type})`);
        
        if (!typeName) throw new Error("Invalid type: " + type);

        // TODO: only json-compatible params are allowed for now to avoid async
        const parsedParams = paramsString ? JSON.parse(`[${paramsString}]`) : undefined;
        return Type.get(typeName.includes(":") ? typeName : defaultNamespace+":"+typeName, parsedParams)
    }
    else if (type instanceof Type) {
        if (!allowTypeParams && type.parameters?.length) throw new Error(`Type parameters not allowed (${type})`);
        return type
    }
    else if (typeof type == "function") {
        const classType = Type.getClassDatexType(type)
        if (!classType) throw new Error("Could not get a DATEX type for class " + type.name + ". Only @sync classes can be used as types");
        return classType
    }
    else {
        console.error("invalid type",type)
        throw new Error("Invalid type")
    }
}

type class_data = {name:string, static_scope:StaticScope, properties: string[], metadata:any}

const PROPERTY_COLLECTION = Symbol("PROPERTY_COLLECTION");
const registeredClasses = new Map<Function,class_data>();
const pendingClassRegistrations = new Map<Class, Set<'public'|'entrypoint'|'entrypointProperty'>>().setAutoDefault(Set);

function registerPublicStaticClass(publicClass:Class, type:'public'|'entrypoint'|'entrypointProperty', metadata?:Record<string,any>){
    pendingClassRegistrations.getAuto(publicClass).add(type);
    initPublicStaticClass(publicClass, type, metadata)
}

export function initPublicStaticClasses(){    
    for (const [reg_class, types] of [...pendingClassRegistrations]) {
        for (const type of [...types]) {
            initPublicStaticClass(reg_class, type)
        }
    }
    pendingClassRegistrations.clear();
}

function initPublicStaticClass(publicClass: Class, type: 'public'|'entrypoint'|'entrypointProperty', metadata?:Record<string|symbol,any>) {
    if (!Runtime.endpoint || Runtime.endpoint === LOCAL_ENDPOINT) return;

    metadata ??= (<any>publicClass)[METADATA];
    if (!metadata) throw new Error(`Missing metadata for class ${publicClass.name}`)
    let targets = metadata[Decorators.SEND_FILTER]?.constructor;
    if (targets == true) targets = Runtime.endpoint; // use own endpoint per default

    let data = registeredClasses.get(publicClass);
    
    // expose if current endpoint matches class endpoint
    if (Logical.matches(Runtime.endpoint, targets, Target)) {
        data ??= getStaticClassData(publicClass, true, type == 'public', metadata);
        if (!data) throw new Error("Could not get data for static class")
        exposeStaticClass(publicClass, data);
    }

    // also enable remote access if not exactly and only the current endpoint
    if (Runtime.endpoint !== targets) {
        data ??= getStaticClassData(publicClass, false, false, metadata);
        if (!data) throw new Error("Could not get data for static class")
        remoteStaticClass(publicClass, data, targets)
    }

    // set method timeouts
    for (const [method_name, timeout] of Object.entries(metadata[Decorators.TIMEOUT]?.public??{})) {
        const method = (publicClass as any)[method_name];
        if (method) method[DX_TIMEOUT] = timeout
    }

    // set entrypoint
    if (type == 'entrypoint') {
        data ??= getStaticClassData(publicClass, true, false, metadata);
        if (Runtime.endpoint_entrypoint) logger.error("Existing entrypoint was overridden with @entrypoint class " + publicClass.name);
        Runtime.endpoint_entrypoint = data.static_scope;
    }
    else if (type == 'entrypointProperty') {
        data ??= getStaticClassData(publicClass, true, false, metadata);
        if (Runtime.endpoint_entrypoint == undefined) Runtime.endpoint_entrypoint = {[PROPERTY_COLLECTION]:true}
        if (typeof Runtime.endpoint_entrypoint !== "object" || !Runtime.endpoint_entrypoint[PROPERTY_COLLECTION]) logger.error("Cannot set endpoint property " + publicClass.name + ". The entrypoint is already set to another value.");
        Runtime.endpoint_entrypoint[publicClass.name] = data.static_scope;
    }
    
    // DatexObject.seal(data.static_scope);
    registeredClasses.set(publicClass, data);
    pendingClassRegistrations.get(publicClass)!.delete(type);
}


function exposeStaticClass(original_class:Class, data:class_data) {

    const exposed_public = data.metadata[Decorators.STATIC_PROPERTY]?.public;
    const exposed_private = data.metadata[Decorators.STATIC_PROPERTY]?.private;
    
    for (const name of data.properties) {

        // is a (exposed) property
        if ((exposed_public?.hasOwnProperty(name) && exposed_public[name]) || (exposed_private?.hasOwnProperty(name) && exposed_private[name])) {
            
            const current_value = (<any>original_class)[name];
            const static_scope = data.static_scope;

            // function
            if (typeof current_value == "function")  {
                // set allowed endpoints for this method
                //static_scope.setAllowedEndpointsForProperty(name, this.method_a_filters.get(name))

                const fn = original_class[name];
                fn[DX_EXTERNAL_SCOPE_NAME] = static_scope.name;
                fn[DX_EXTERNAL_FUNCTION_NAME] = exposed_public[name]

                const dx_function = Pointer.proxifyValue(DatexFunction.createFromJSFunction(current_value, original_class, name), true, undefined, false, true) ; // generate <Function>

                static_scope.setVariable(name, dx_function); // add <Function> to static scope
            }

            // field
            else {
                // set static value (datexified)
                const setProxifiedValue = (val:any) => static_scope.setVariable(name, Pointer.proxifyValue(val, true, undefined, false, true));
                setProxifiedValue(current_value);

                /*** handle new value assignments to this property: **/

                // similar to addObjProxy in DatexRuntime / DatexPointer
                const property_descriptor = Object.getOwnPropertyDescriptor(original_class, name);

                // add original getters/setters to static_scope if they exist
                if (property_descriptor?.set || property_descriptor?.get) {
                    Object.defineProperty(static_scope, name, {
                        set: val => { 
                            property_descriptor.set?.call(original_class,val);
                        },
                        get: () => { 
                            return property_descriptor.get?.call(original_class);
                        }
                    });
                }

                // new getter + setter
                Object.defineProperty(original_class, name, {
                    get:()=>static_scope.getVariable(name),
                    set:(val)=>setProxifiedValue(val)
                });
            }
        }
    }

}

function remoteStaticClass(original_class:Class, data:class_data, targets:target_clause) {

    // console.warn("remote class", original_class, data);

    let class_send_filter:target_clause = targets;
    // @ts-ignore
    if (class_send_filter == Object) class_send_filter = undefined;

    let send_filter = data.metadata[Decorators.SEND_FILTER]?.public;
    if (send_filter == true) send_filter = Runtime.endpoint; // use own endpoint per default

    const remote_public = data.metadata[Decorators.STATIC_PROPERTY]?.public;
    const remote_private = data.metadata[Decorators.STATIC_PROPERTY]?.private;
    const timeout_public = data.metadata[Decorators.TIMEOUT]?.public;
    const timeout_private = data.metadata[Decorators.TIMEOUT]?.private;

    // prototype for all options objects of static proxy methods (Contains the dynamic_filter)
    let options_prototype: {[key:string]:any} = {};

    // add builtin methods
    
    Object.defineProperty(original_class, 'to', {
        value: function(...targets:(Target|endpoint_name)[]){
            options_prototype.dynamic_filter = new Disjunction<Target>(); 
            for (const target of targets) {
                if (typeof target == "string") options_prototype.dynamic_filter.add(Target.get(target))
                else options_prototype.dynamic_filter.add(target)
            }
            return this;
        },
        configurable: false,
        enumerable: false,
        writable: false
    });

    
    for (const name of data.properties) {

        // is a (remote) proeprty
        if ((remote_public?.hasOwnProperty(name) && remote_public[name]) || (remote_private?.hasOwnProperty(name) && remote_private[name])) {
        
            const current_value = (<any>original_class)[name];

            const timeout = timeout_public?.[name]??timeout_private?.[name];
            const filter = new Conjunction(class_send_filter, send_filter?.[name]); 
    
            // function
            if (typeof current_value == "function")  {      
                const options = Object.create(options_prototype);
                Object.assign(options, {filter, sign:true, scope_name:data.name, timeout});
                const proxy_fn = getProxyFunction(name, options);
                Object.defineProperty(original_class, name, {value:proxy_fn})
            }
    
            // field
            else {
                const options = Object.create(options_prototype);
                Object.assign(options, {filter, sign:true, scope_name:data.name, timeout});
                const proxy_fn = getProxyStaticValue(name, options);
                Object.defineProperty(original_class, name, {
                    get: proxy_fn // set proxy function for getting static value
                });
            }
        }
    
    }

    

}


function getStaticClassData(original_class:Class, staticScope = true, expose = true, metadata?:Record<string,any>) {
    metadata ??= (<any>original_class)[METADATA];
    if (!metadata) return;
    const static_scope_name = typeof metadata[Decorators.NAMESPACE]?.constructor == 'string' ? metadata[Decorators.NAMESPACE]?.constructor : original_class.name;
    const static_properties = Object.getOwnPropertyNames(original_class)

    return {
        metadata,
        static_scope: staticScope ? StaticScope.get(static_scope_name, expose) : null,
        name: static_scope_name,
        properties: static_properties
    }
}



const templated_classes = new Map<Function, Function>() // original class, templated class

export function createTemplateClass(original_class: Class, type:Type, sync = true, add_js_interface = true, callerFile?:string, metadata?:Record<string,any>){

    if (templated_classes.has(original_class)) return templated_classes.get(original_class)!;

    original_class[DX_TYPE] = type;

    // set JS interface
    if (add_js_interface) {
        type.setJSInterface({
            class: original_class,
            proxify_children: true, // proxify children per default
            is_normal_object: true, // handle like a normal object
        });
    }

    if (callerFile) {
        type.jsTypeDefModule = callerFile;
    }

    metadata ??= original_class[METADATA];

    // set constructor, replicator, destructor
    const constructor_name = original_class.prototype['construct'] ? 'construct' : null; // Object.keys(metadata?.[Decorators.CONSTRUCTOR]?.public??{})[0]
    const replicator_name = original_class.prototype['replicate'] ? 'replicate' : null; // Object.keys(metadata?.[Decorators.REPLICATOR]?.public??{})[0]
    const destructor_name = original_class.prototype['destruct'] ? 'destruct' : null; // Object.keys(metadata?.[Decorators.DESTRUCTOR]?.public??{})[0]

    if (constructor_name) type.setConstructor(original_class.prototype[constructor_name]);
    if (replicator_name) type.setReplicator(original_class.prototype[replicator_name]);
    if (destructor_name) type.setDestructor(original_class.prototype[destructor_name]);

    // set template
    const property_types = metadata?.[Decorators.FORCE_TYPE]?.public;
    const allow_filters = metadata?.[Decorators.ALLOW_FILTER]?.public;

    const template = {};
    template[DX_PERMISSIONS] = {}

    // extend prototype template?
    let prototype = original_class;
    // iterate up until Object.protoype reached
    while ((prototype = Object.getPrototypeOf(prototype)) != Object.prototype) {
        if ((prototype[DX_TYPE])?.template) {
            DatexObject.extend(template, prototype[DX_TYPE].template);
            break;
        }
        // is root of dx prototype chain, stop
        if (prototype[DX_ROOT]) break;
    }



    // iterate over all properties TODO different dx_name?
    for (const [name, dx_name] of Object.entries(metadata?.[Decorators.PROPERTY]?.public??{})) {
        let metadataConstructor = MetadataReflect.getMetadata && MetadataReflect.getMetadata("design:type", original_class.prototype, name);
        // if type is Object -> std:Any
        if (metadataConstructor == Object) metadataConstructor = null;
        // set best guess for property type
        template[name] = property_types?.[name] ?? (metadataConstructor && Type.getClassDatexType(metadataConstructor)) ?? Type.std.Any; // add type
        if (allow_filters?.[name]) template[DX_PERMISSIONS][name] = allow_filters[name]; // add filter
    }

    type.setTemplate(template)

    // create shadow class extending the actual class
    const sync_auto_cast_class = proxyClass(original_class, type, metadata?.[Decorators.IS_SYNC]?.constructor ?? sync)
    
    // only for debugging / dev console TODO remove
    // globalThis[sync_auto_cast_class.name] = sync_auto_cast_class;

    templated_classes.set(original_class, sync_auto_cast_class);

    return sync_auto_cast_class;
}

// Reflect metadata / decorator metadata, get parameters & types if available
function getMethodParams(target:Function, method_name:string, meta_param_index?:number):Tuple{
    
    if (!(method_name in target)) return null;

    const tuple = new Tuple();
    const metadata:any[] = MetadataReflect.getMetadata && MetadataReflect.getMetadata("design:paramtypes", target, method_name);

    if (!metadata) return null;

    // get parmeters names from function body string
    const function_body:string = target[method_name]?.toString();

    const args_match = function_body?.match(/^[^(]*\(([^)]*)\)/)?.[1];

    if (args_match) {
        const args_strings = normalizeFunctionParams(args_match)?.split(",");

        if (args_strings) {
            for (let i=0;i<args_strings.length;i++) {
                args_strings[i] = args_strings[i].trim().split(/[ =]/)[0];
            }
    
            // add type metadata
            let i = 0;
            for (const arg of args_strings) {
                if (meta_param_index != null && meta_param_index == i) {i++; continue} // skip meta param index
                tuple.set(arg, metadata[i] ? Type.getClassDatexType(metadata[i]) : Type.std.Any);
                i++;
            }
        }
    }

    return tuple;
}
function getMetaParamIndex(target:Function, method_name:string):number {
    return target[METADATA]?.[Decorators.META_INDEX]?.public?.[method_name] ??
        (MetadataReflect.getMetadata && MetadataReflect.getMetadata("unyt:meta", target, method_name));
}

// TODO: refactor, merge with parser in function.ts
function normalizeFunctionParams(params: string) {
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


DatexFunction.setMethodParamsSource(getMethodParams)
DatexFunction.setMethodMetaIndexSource(getMetaParamIndex)


// new version for implemented feature functions / attributes: call datex_advanced() on the class (ideally usa as a decorator, currently not supported by ts)

export interface DatexClass<T extends (new (...args: unknown[]) => unknown) = (new (...args: unknown[]) => unknown), Construct = InstanceType<T>["construct" & keyof InstanceType<T>]> {

    new(...args: Construct extends (...args: any) => any ? Parameters<Construct> : ConstructorParameters<T>): datexClassType<T>;

}

export type MethodKeys<T> = {
    [K in keyof T]: T[K] extends (...args: any) => any  ? K : never;
}[keyof T];

export type dc<T extends Record<string,any>&{new (...args:unknown[]):unknown}, OT extends {new (...args:unknown[]):unknown} = ObjectRef<T>> = 
    DatexClass<OT> &
    Pick<OT, keyof OT> & 
    ((struct:Omit<InstanceType<OT>, MethodKeys<InstanceType<T>>>) => datexClassType<OT>);

/**
 * Workaround to enable correct @sync class typing, until new decorators support it.
 * Usage:
 * ```ts
 * @sync class _MyClass {}
 * export const MyClass = datexClass(_MyClass)
 * export type MyClass = datexClassType<typeof _MyClass>
 * ```
 */
export function datexClass<T extends Record<string,any>&{new (...args:any[]):any}>(_class:T) {
    return <dc<ObjectRef<T>>> _class;
}

export type datexClassType<T extends abstract new (...args: any) => any> = ObjectRef<InstanceType<T>>


/**
 * @deprecated use datexClass
 */
export const datex_advanced = datexClass;

// extend a given class to create a auto-sync a class which autmatically creates synced objects (does not create a DATEX pseudo type configuration)
// if no type is provided, <ext:ClassName> is created as type by default
export function proxyClass<T extends { new(...args: any[]): any;}>(original_class:T, type?:Type, auto_sync = true):DatexClass&T {
                
    type = type ?? Type.get("ext", original_class.name)!;
    
    // add Proxy trap for construct
    const new_class = new Proxy(original_class, {
        construct(target: T, args: any[], newTarget:Function) {
            // cast from type
            if (new_class == newTarget) {
                // cast and immediately create pointer if auto_sync
                return type.cast(new Tuple(args), undefined, undefined, auto_sync);
            }
            // just return new instance
            else {
                const instance:any = Reflect.construct(target, args, newTarget);
                if (args[0]?.[INIT_PROPS]) {
                    args[0][INIT_PROPS](instance);
                }
                return instance;
            }
        },
        apply(target,_thisArg,argArray) {
            return Pointer.createOrGet(instance(target, argArray[0])).js_value
        },
        getPrototypeOf(target) {
            return original_class
        }
    });

    // custom class methods
    // -> MyClass.options(...).new(...);
    Object.defineProperty(new_class, 'options', {value: function(options:{properties:any}){
        original_class[CONSTRUCT_OPTIONS] = options;
        return new_class;
    }});

    Object.defineProperty(new_class, 'new', {value: function(...args:any[]){
        return new new_class(...args);
    }});

    return new_class;
}