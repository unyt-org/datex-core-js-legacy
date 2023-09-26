import { Type } from "../types/type.ts";
import { Endpoint } from "../types/addressing.ts";
import { fundamental } from "../types/abstract_types.ts";
import type { Class } from "../utils/global_types.ts";
import { Pointer } from "./pointers.ts";
import { INVALID, NOT_EXISTING } from "./constants.ts";

/** create a custom DATEX JS Interface for a type with handlers 
 *  
 * - serialize efficiently with the serialize function and de-serialize in the cast function
 * - do not use @sync classes in combination with an additional js_interface_configuration!; 
 *   @sync classes are handled like <std:Object> and proxified per default
*/
export type js_interface_configuration<T=any> = {
    __type?: Type<T>,
    // either type or generate_type is needed
    get_type?: (value:T)=>Type<T>, // get a specific <Type> for a value (with variation/parameters)
    cast?: (value:any, type:Type<T>, context?:any, origin?:Endpoint)=>T|typeof INVALID,     // a function that casts a given value to a value of the type of the pseudo cast, if possible
    cast_no_tuple?: (value:any, type:Type<T>, context?:any, origin?:Endpoint)=>T|typeof INVALID,     // a function that casts a given value to a value of the type of the pseudo cast, if possible - ignores construct (cast from tuple)
    serialize?: (value:T)=>fundamental, // a function that creates a fundamental value from a given pseudo class value
                                                // if not provided, assume the value is already a DATEX fundamental value
    empty_generator?: (type:Type<T>, context?:any, origin?:Endpoint)=>any // return an default empty value if the type is casted from <Void>
    override_silently?: (ref:T, value:T)=>void, // reset the reference, copy the value to the ref silently

    class?: Class<T>, // the corresponding JS class or a prototype
    prototype?: object, // the inherited JS prototype
    detect_class?: (value:any)=>boolean, // a function that returns whether the value has the type of the pseudo class

    is_normal_object?: boolean, // if true, handle properties like object properties (no custom handling), ignore add_property, set_property, etc.


    type_params_match?: (params:any[], against_params:any[])=>boolean, // implement for parmetrized types -> return if parameters match

    set_property?: (parent:T, key:any, value:any, exclude?:Endpoint)=>void,
    get_property?: (parent:T, key:any)=>any,
    has_property?: (parent:T, key:any)=>boolean,
    delete_property?: (parent:T, key:any, exclude?:Endpoint)=>void,
    clear?: (parent:T, exclude?:Endpoint)=>void,
    apply_value?: (parent:T, args:any[])=>Promise<any>|any,

    set_property_silently?: (parent:T, key:any, value:any, pointer:Pointer)=>void,
    get_property_silently?: (parent:T, key:any, pointer:Pointer)=>any,
    delete_property_silently?: (parent:T, key:any, pointer:Pointer)=>void,
    clear_silently?: (parent:T, pointer:Pointer)=>void,

    keys?: (parent:T)=>Promise<Iterable<any>>|Iterable<any>, // get keys for value
    values?: (parent:T)=>Promise<Iterable<any>>|Iterable<any>, // get values

    count?: (parent:T)=>Promise<number|bigint>|number|bigint // return size of parent (number of child elements)

    proxify_children?: boolean // set to true if children should be proxified per default
    
    visible_children?: Set<any>

    create_proxy?: (value:T, pointer:Pointer)=>T, // return a Proxy for an object (can also be the same, modified object)


    // x + y
    operator_add?: (first:any, second:any)=>any|typeof INVALID
    operator_subtract?: (first:any, second:any)=>any|typeof INVALID
    operator_divide?: (first:any, second:any)=>any|typeof INVALID
    operator_multiply?: (first:any, second:any)=>any|typeof INVALID
    operator_power?: (first:any, second:any)=>any|typeof INVALID
    operator_modulo?: (first:any, second:any)=>any|typeof INVALID

    operator_and?: (first:any, second:any)=>any|typeof INVALID
    operator_or?: (first:any, second:any)=>any|typeof INVALID
    operator_not?: (first:any, second:any)=>any|typeof INVALID



    // x += y
    action_add?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_subtract?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_divide?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_multiply?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_power?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_modulo?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID

    action_increment?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_decrement?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID

    action_and?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID
    action_or?: (ref:T, value:any, silently:boolean, exclude?:Endpoint)=>void|typeof INVALID

    compare?: (first:T, second:T)=>0|1|-1

}


/** handles (custom) type interfaces with custom JS methods */
export class JSInterface {

    // list of all pseudo class configurations
    static configurations_by_type: Map<Type, js_interface_configuration> = new Map();
    // JS class -> configuration
    static configurations_by_class: Map<Class, js_interface_configuration> = new Map();
    static configurations_by_prototype: Map<object, js_interface_configuration> = new Map();

    static configurations_loaders_by_namespace:Map<string,(type:Type)=>Promise<js_interface_configuration|boolean>> = new Map();


    /** fetch type configuration for a datex type when required, returns the corresponding JS class */
    public static async loadTypeConfiguration(type:Type):Promise<boolean> {
        if (JSInterface.configurations_by_type.has(type)) return true; // already exists
        else {
            if (JSInterface.configurations_loaders_by_namespace.has(type.namespace)) {
                const config = await JSInterface.configurations_loaders_by_namespace.get(type.namespace)(type);

                if (typeof config == "boolean") return config;
                else if (config) type.setJSInterface(config);
                else return false;
                return true;
            }
            else return false;
        }
    }
    
    /** add type namespace handler */
    public static typeConfigurationLoader(namespace:string|string[], loader: (type:Type)=>Promise<js_interface_configuration|boolean>) {
        if (namespace instanceof Array) {
            for (let n of namespace) JSInterface.configurations_loaders_by_namespace.set(n, loader);
        }
        else JSInterface.configurations_loaders_by_namespace.set(namespace, loader);
    }

    public static async getClassForType(type:Type):Promise<Class> {
        // first make sure the configuration is loaded
        if (!await JSInterface.loadTypeConfiguration(type)) throw new TypeError("Could not load type " + type);
        else return JSInterface.configurations_by_type.get(type).class;
    }


    // update a existing pseudo class configuration property or create and update a new configuration
    public static updateJSInterfaceConfiguration<T extends keyof js_interface_configuration>(type:Type, key:T, value:js_interface_configuration[T]){
        // make sure a configuration for the type exists
        let config = JSInterface.configurations_by_type.get(type);

        // create new config
        if (!config) {
            config = {};
            JSInterface.configurations_by_type.set(type, config);
        }
        // update config
        else {
            config[key] = value;
        }

        JSInterface.handleConfigUpdate(type, config);
    }



    public static handleConfigUpdate(type:Type, config:js_interface_configuration){

        if (!type) throw new Error ("A type is required for a type configuration")
        if (!config.class && !config.prototype) throw new Error ("The  'class' or 'prototype' property is required for a type configuration")

        config.__type = type; // save type to config for faster type reference

        JSInterface.configurations_by_type.set(type, config);
        if (config.prototype)  JSInterface.configurations_by_prototype.set(config.prototype, config);
        if (config.class) JSInterface.configurations_by_class.set(config.class, config);

    }

    // apply get_property, set_property, ... if parent matches a pseudo type
    private static applyMethod(type:Type, parent:any, method_name:string, args:any[]):any {
        const config = this.configurations_by_type.get(type.root_type) ?? this.configurations_by_type.get(type);
        if (!config) return NOT_EXISTING;
        if (config.is_normal_object && !(method_name in config)) return NOT_EXISTING; // act like this pseudo class does not exist, handle default (if method is not implemented)
        if (config.detect_class instanceof globalThis.Function && !(<globalThis.Function>config.detect_class)(parent)) return NOT_EXISTING; // detect class invalid
        if (config[method_name] instanceof globalThis.Function) return config[method_name](...args);
        return INVALID;
    }


    // return if a value has a matching pseudo class configuration
    static hasPseudoClass(value:any):boolean {
        for (let [_class, config] of this.configurations_by_class) {
            if (value instanceof _class) { // is class instance
                if (config.detect_class instanceof globalThis.Function && !(<globalThis.Function>config.detect_class)(value)) return false; // detect class invalid
                return true;
            }
        }

        for (let [proto, config] of this.configurations_by_prototype) {
            if (proto.isPrototypeOf(value)) { // has prototype
                if (config.detect_class instanceof globalThis.Function && !(<globalThis.Function>config.detect_class)(value)) return false; // detect class invalid
                return true;
            }
        }
        return false;
    }

    // sets the property of a value
    static handleSetProperty(parent:any, key:any, value:any, type:Type = Type.ofValue(parent), exclude?:Endpoint):void|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "set_property", [parent, key, value, exclude])
    }

    // count value content
    static handleCount(parent:any, type:Type = Type.ofValue(parent)):number|bigint|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "count", [parent]);
    }

    // get the property of a value
    static handleHas( parent:any, property:any, type:Type = Type.ofValue(parent)):boolean|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "has_property", [parent, property]);
    }
    

    // get the property of a value
    static handleGetProperty( parent:any, key:any, type:Type = Type.ofValue(parent)):any|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "get_property", [parent, key]);
    }

    // delete a value (= void)
    static handleDeleteProperty(parent:any, value:any, type:Type = Type.ofValue(parent), exclude?:Endpoint):void|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "delete_property", [parent, value, exclude]);
    }
    
    // get iterable for all values
    static handleGetAllValues(parent:any, type:Type = Type.ofValue(parent)):Iterable<any>|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "values", [parent]);
    }

    // clear value (remove all children)
    static handleClear(parent:any, type:Type = Type.ofValue(parent), exclude?:Endpoint):void|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "clear", [parent, exclude]);
    }

    // get keys for a value
    static handleKeys(parent:any, type:Type = Type.ofValue(parent)):Iterable<any>|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "keys", [parent]);
    }
    // convert a value to a serializable (fundamental) value
    static serializeValue(value:any, type:Type = Type.ofValue(value)):fundamental|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, value, "serialize", [value]);
    }

    // creates a proxy object for a given value
    static createProxy(value:any, pointer:Pointer, type:Type = Type.ofValue(value)):any|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, value, "create_proxy", [value, pointer]);
    }



    // silent property changes (don't trigger DATEX updates)

    // sets the property of a value
    static handleSetPropertySilently(parent:any, key:any, value:any, pointer:Pointer, type:Type = Type.ofValue(parent)):void|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "set_property_silently", [parent, key, value, pointer])
    }

    // delete a value (= void)
    static handleDeletePropertySilently(parent:any, key:any, pointer:Pointer, type:Type = Type.ofValue(parent)):void|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "delete_property_silently", [parent, key, pointer]);
    }
    
    // clear value (remove all children)
    static handleClearSilently(parent:any, pointer:Pointer, type:Type = Type.ofValue(parent)):void|(typeof INVALID| typeof NOT_EXISTING) {
        return this.applyMethod(type, parent, "clear_silently", [parent, pointer]);
    }



    // value -> <Type>
    static getValueDatexType(value:any):Type {

        for (let [_class, config] of this.configurations_by_class) {
            if (value instanceof _class) {
                return config.get_type ? config.get_type(value) : config.__type;
            }
        }

        for (let [proto, config] of this.configurations_by_prototype) {
            if (proto.isPrototypeOf(value)) {
                return config.get_type ? config.get_type(value) : config.__type;
            }
        }

        // try afterwards (less likely to happen)
        for (let [_class, config] of this.configurations_by_class) {
            if (config.detect_class instanceof globalThis.Function && (<globalThis.Function>config.detect_class)(value) ) {
                return config.get_type ? config.get_type(value) : config.__type;
            }
        }
    }

    // js class -> <Type>
    static getClassDatexType(class_constructor:Class):Type {
        let config:js_interface_configuration;

        // get directly from class
        if (config = this.configurations_by_class.get(class_constructor)) return config.__type;
        // get from prototype of class
        if (config = this.configurations_by_class.get(Object.getPrototypeOf(class_constructor))) return config.__type;

        // check full prototype chain (should not happen normally, unnessary to loop through every time)
        // for (let [_class, config] of this.configurations_by_class) {
        //     console.log(_class)
        //     if (class_constructor == _class || _class.isPrototypeOf(class_constructor)) {
        //         return config.__type ?? undefined;
        //     }
        // }
    }
    
}



const iterateMapReverse = function (this:Map<any,any>) {
    const values = Array.from(this.entries());
    // start at the end of the array
    let index = values.length;
    return <IterableIterator<any>>{
      next: function () {
        return {
          done: index === 0,
          value: values[--index]
        };
      }
    }
};
const iterateSetReverse = function (this:Set<any>) {
    const values = Array.from(this.values());
    // start at the end of the array
    let index = values.length;
    return <IterableIterator<any>>{
      next: function () {
        return {
          done: index === 0,
          value: values[--index]
        };
      }
    }
};


// add reverse map/set iterators to cast values in correct order
JSInterface.configurations_by_class[Symbol.iterator] = iterateMapReverse;
JSInterface.configurations_by_type[Symbol.iterator] = iterateSetReverse;
JSInterface.configurations_by_prototype[Symbol.iterator] = iterateMapReverse;


// exposed DatexCustomPseudoClasses methods
export const typeConfigurationLoader = JSInterface.typeConfigurationLoader;
export const updateJSInterfaceConfiguration = JSInterface.updateJSInterfaceConfiguration;

// get a JS class corresponding to a DatexType (try loading the class configuration dynamically if possible)
export function DX_CLASS(type:Type|string){
    return JSInterface.getClassForType(type instanceof Type ? type :  Type.get(type));
}


