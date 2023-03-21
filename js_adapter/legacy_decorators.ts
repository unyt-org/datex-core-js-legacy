/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  Typescript Legacy Decorators for the DATEX JS Interface                             ║
 ║  - Use until the JS decorator proposal (TC39 Stage 2) is fully implemented           ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Unyt core library                                                                   ║
 ║  Visit docs.unyt.org/unyt_js for more information                                    ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2021 unyt.org                        ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */

import { Decorators, METADATA } from "./js_class_adapter.ts";
import { } from "../runtime/runtime.ts";
import { endpoint_name, Target, target_clause } from "../types/addressing.ts";
import { Type } from "../types/type.ts";
import { UpdateScheduler, Pointer } from "../runtime/pointers.ts";

// decorator types
export type context_kind = 'class'|'method'|'getter'|'setter'|'field'|'auto-accessor';
export type context_name = string|symbol|undefined;
export type context_meta_setter = (key:symbol, value:any) => void
export type context_meta_getter = (key:symbol ) => any

type decorator_target = {[key: string]: any} & Partial<Record<keyof Array<any>, never>>;
type decorator_target_optional_params = decorator_target | Function; // only working for static methods!

const __metadataPrivate = new WeakMap();
const createObjectWithPrototype = (obj:object, key:any) => Object.hasOwnProperty.call(obj, key) ? obj[key] : Object.create(obj[key] || Object.prototype);


// get context kind (currently only supports class, method, field)
function getContextKind(args:any[]):context_kind {
    if (typeof args[0] == "function" && args[1] == null && args[2] == null) return 'class';
    if ((typeof args[0] == "function" || typeof args[0] == "object") && (typeof args[2] == "function" || typeof args[2]?.value == "function")) return 'method';
    if ((typeof args[0] == "function" || typeof args[0] == "object") && typeof args[1] == "string") return 'field';
}
// is context static field/method?
function isContextStatic(args:any[]):boolean {
    return typeof args[0] == "function" && args[1] != null;
}


// add optional arguments, then call JS Interface decorator handler
export function handleDecoratorArgs(args:any[], method:(value:any, name:context_name, kind:context_kind, is_static:boolean, is_private:boolean, setMetadata:context_meta_setter, getMetadata:context_meta_getter, params?:any[]) => any, first_argument_is_function = false):(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor) => any {
    let kind = getContextKind(args);
    // is @decorator(x,y,z)
    if (!kind || first_argument_is_function) { 
        // inject args as decorator params
        const params = args; // x,y,z
        return (...args:any[]) => {
            let kind = getContextKind(args);
            // same as below (in else), + params
            let is_static = isContextStatic(args);
            let target = args[0];
            let name = kind == 'class' ? args[0].name : args[1];
            let value = kind == 'class' ? args[0] : args[2]?.value;
            let meta_setter = createMetadataSetter(target, name, kind == 'class');
            let meta_getter = createMetadataGetter(target, name, kind == 'class');
            //console.log("@"+method.name + " name: " + name + ", kind: " + kind + ", is_static:" + is_static + ", params:", params, value)
            return method(value, name, kind, is_static, false, meta_setter, meta_getter, params);
        }
    }
    // is direct @decorator
    else {
        let is_static = isContextStatic(args);
        let target = args[0];
        let name = kind == 'class' ? args[0].name : args[1];
        let value = kind == 'class' ? args[0] : args[2]?.value;
        let meta_setter = createMetadataSetter(target, name, kind == 'class');
        let meta_getter = createMetadataGetter(target, name, kind == 'class');
        //console.log("@"+method.name + " name: " + name + ", kind: " + kind + ", is_static:" + is_static, value)
        return method(value, name, kind, is_static, false, meta_setter, meta_getter);
    }
}

function createMetadataSetter(target:Function, name:string, is_constructor = false, is_private=false) {
    return (key:symbol, value:unknown)=>{
        if (typeof key !== "symbol") {
            throw new TypeError("the key must be a Symbol");
        }

        target[METADATA] = createObjectWithPrototype(target, METADATA);
        target[METADATA][key] = createObjectWithPrototype(target[METADATA], key);
        target[METADATA][key].public = createObjectWithPrototype(target[METADATA][key], "public");
        
        if (!Object.hasOwnProperty.call(target[METADATA][key], "private")) {
            Object.defineProperty(target[METADATA][key], "private", {
                get() {
                    return Object.values(__metadataPrivate.get(target[METADATA][key]) || {}).concat(Object.getPrototypeOf(target[METADATA][key])?.private || []);
                }
            });
        }
        // constructor
        if (is_constructor) {
            target[METADATA][key].constructor = value;
        } 
        // private
        else if (is_private) {
            if (!__metadataPrivate.has(target[METADATA][key])) {
                __metadataPrivate.set(target[METADATA][key], {});
            }
            __metadataPrivate.get(target[METADATA][key])[name] = value;
        } 
        // public
        else {
            target[METADATA][key].public[name] = value;
        } 
    }
}
function createMetadataGetter(target:Function, name:string, is_constructor = false, is_private=false) {
    return (key:symbol) => {
        if (target[METADATA] && target[METADATA][key]) {
            if (is_constructor) return target[METADATA][key]["constructor"]?.[name];
            else if (is_private) return (__metadataPrivate.has(target[METADATA][key]) ? __metadataPrivate.get(target[METADATA][key])?.[name] : undefined)  
            else return target[METADATA][key].public?.[name] 
        }
    }
}

// legacy decorator functions

// @deprecated
// TODO: remove, use @property (also for static methods)
export function expose(allow?: target_clause):any
export function expose(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor):any
export function expose(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.public);
}



// @deprecated
// TODO: remove, use endpoint
export function scope(name:string):any
export function scope(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor):any
export function scope(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.namespace);
}

// @deprecated
// TODO: remove, use endpoint
export function namespace(name:string):any
export function namespace(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor):any
export function namespace(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.namespace);
}

// use instead of @namespace @to
export function endpoint(endpoint:target_clause|endpoint_name, scope_name?:string):any
export function endpoint(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor):any
export function endpoint(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.endpoint);
}


export function endpoint_default(target: any, name?: string, method?:any):any
export function endpoint_default(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.default);
}

export function default_property(target: any, name?: string, method?:any):any
export function default_property(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.default_property);
}

// @deprecated
// TODO: remove, use @property (also for static methods)
export function remote(from?: target_clause):any
export function remote(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_: string)
export function remote(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.remote);
}


export function docs(content: string):any
export function docs(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.docs);
}

export function meta(index: number):any
export function meta(target: any, name?: string, method?:any)
export function meta(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.meta);
}

export function sign(sign: boolean):any
export function sign(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor)
export function sign(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.sign);
}

export function encrypt(encrypt: boolean):any
export function encrypt(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor)
export function encrypt(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.encrypt);
}

export function no_result(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor)
export function no_result(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.no_result);
}

export function timeout(msecs: number):any
export function timeout(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.timeout);
}

export function allow(allow?: target_clause):any
export function allow(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.allow);
}

export function to(to?: target_clause|endpoint_name):any
export function to(...args:any[]) {
    return handleDecoratorArgs(args, Decorators.to);
}


export function sealed(target: any, name?: string, method?:any)
export function sealed(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.sealed);
}


export function each(target: any, name?: string, method?:any)
export function each(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.each);
}

export function sync(type:string|Type):any
export function sync(target: any, name?: string, method?:any):any
export function sync(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.sync);
}


export function template(type:string|Type):any
export function template(target: any, name?: string, method?:any):any
export function template(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.template);
}

export function property(name:string|number):any
export function property(target: any, name?: string, method?:any):any
export function property(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.property);
}

export function jsdoc(target: any, name?: string, method?:any):any
export function jsdoc(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.jsdoc);
}


export function serialize(serializer:(parent:any, value:any)=>any):any
export function serialize(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.serialize, true);
}


export function observe(handler:Function):any
export function observe(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.observe);
}

export function anonymize(_invalid_param_0_: decorator_target_optional_params, _invalid_param_1_?: string, _invalid_param_2_?: PropertyDescriptor)
export function anonymize(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.anonymize);
}

export function anonymous<T>(_target: T):T
export function anonymous(target: any, name?: string, method?: PropertyDescriptor)
export function anonymous(...args:any[]) {
    // no decorator, but function encapsulating object to make it syncable (proxy)
    if (args[0]==undefined || args[0] == null || (args[1]===undefined && args[0] && typeof args[0] == "object")) {
        return Pointer.create(null, args[0], /*TODO*/false, undefined, false, true).val;
    }
    // decorator
    return handleDecoratorArgs(args, Decorators.anonymous);
}


export function type(type:string|Type):any
export function type(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.type);
}

export function from(type:string|Type):any
export function from(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.from);
}

export function update(interval:number):any
export function update(scheduler:UpdateScheduler):any
export function update(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.update);
}

// special sync class methods
export function constructor(target: any, propertyKey: string, descriptor: PropertyDescriptor)
export function constructor(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.constructor);
}

export function replicator(target: any, propertyKey: string, descriptor: PropertyDescriptor)
export function replicator(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.replicator);
}

export function destructor(target: any, propertyKey: string, descriptor: PropertyDescriptor)
export function destructor(...args:any[]): any {
    return handleDecoratorArgs(args, Decorators.destructor);
}

