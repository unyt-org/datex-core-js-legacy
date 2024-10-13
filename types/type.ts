import { DX_PERMISSIONS, DX_TEMPLATE, DX_TYPE, EXTENDED_OBJECTS, INIT_PROPS, INVALID, NOT_EXISTING, VOID } from "../runtime/constants.ts";
import { Runtime, TypedValue } from "../runtime/runtime.ts";
import { JSInterface, js_interface_configuration } from "../runtime/js_interface.ts";
import { Endpoint, Target } from "./addressing.ts";
import { AssertionError, CompilerError, NetworkError, PermissionError, PointerError, RuntimeError, SecurityError, SyntaxError, TypeError, ValueError } from "./errors.ts";
import { Markdown } from "./markdown.ts";
import { DatexObject } from "./object.ts";
import { Tuple } from "./tuple.ts";
import { Stream } from "./stream.ts";
import { Scope } from "./scope.ts";
import { Quantity } from "./quantity.ts";
import { Function as DatexFunction } from "./function.ts";
import { logger, TypedArray } from "../utils/global_values.ts";
import { BinaryCode } from "../compiler/binary_codes.ts"
import { RefOrValue, Pointer, ReactiveValue, PointerProperty } from "../runtime/pointers.ts";
import { clause, Conjunction, Disjunction, Logical, Negation } from "./logic.ts";
import { Debugger } from "../runtime/debugger.ts";
import { Time } from "./time.ts";
import type { Task } from "./task.ts";
import { Assertion } from "./assertion.ts";
import type { Iterator } from "./iterator.ts";
import {StorageMap, StorageWeakMap} from "./storage-map.ts"
import {StorageSet, StorageWeakSet} from "./storage-set.ts"
import { ExtensibleFunction } from "./function-utils.ts";
import { JSTransferableFunction } from "./js-function.ts";
import type { MatchCondition } from "../storage/storage.ts";
import { sendReport } from "../utils/error-reporting.ts";

export type inferDatexType<T extends Type> = T extends Type<infer JST> ? JST : any;

// types with '&|~' combinations
export type type_clause<T=any> = clause<Type<T>>

/** <ns:type> */
export class Type<T = any> extends ExtensibleFunction {

    // part of the datex standard types, complex or primitive, no specific type casting needed
    static fundamental_types = ["text", "image", "audio", "video", "model", "application", "decimal", "integer", "boolean", "target", "endpoint", "null", "void", "time", "quantity", "url", "buffer", "Array", "Object", "Tuple", "Type", "Negation", "Conjunction", "Disjunction"]
    // have a primitive datex representation:
    static primitive_types = ["text", "image", "audio", "video", "model", "application", "decimal", "integer", "boolean", "target", "endpoint", "null", "void", "time", "quantity", "url", "buffer"];
    // have a custom datex representation (+ all primitive)
    static compact_rep_types = ["Datex", "Type"];
    // should be serialized, but is not a complex type (per default, only complex types are serialized)
    static serializable_not_complex_types = ["buffer"]
    // values that are represented js objects but have a single instance per value, handle like normal js primitives
    static pseudo_js_primitives = ["Type", "endpoint", "target", "url", "RegExp"]


    public static types = new Map<string, Type>();   // type name -> type

    public static type_templates = new Map<Type, object>();   // type name -> type (only required for Datex viewer tree view)
    public static template_types = new WeakMap<object, Type>();   // type name -> type (only required for Datex viewer tree view)

    // <namespace:name/variation(parameters)>
    namespace:string = 'std'
    name:string = ''
    variation:string = ''
    parameters:any[] // special type parameters

    #jsTypeDefModule?: string|URL // URL for the JS module that creates the corresponding type definition
    #potentialJsTypeDefModule?: string|URL // remember jsTypeDefModule if jsTypeDefModuleMapper is added later

    get jsTypeDefModule():string|URL|undefined {return this.#jsTypeDefModule}
    set jsTypeDefModule(url: string|URL) {
        // custom module mapper
        if (Type.#jsTypeDefModuleMapper) this.#jsTypeDefModule = Type.#jsTypeDefModuleMapper(url, this);
        // default: only allow http/https modules
        else if (url.toString().startsWith("http://") || url.toString().startsWith("https://")) {
            this.#jsTypeDefModule = url;
        }
        this.#potentialJsTypeDefModule = url;
    }

    root_type: Type; // DatexType without parameters and variation
    base_type: Type; // DatexType without parameters

    is_complex = true;
    is_primitive = false;
    is_js_pseudo_primitive = false;
    has_compact_rep = false; // has special compact representation, like @sdfaf or <type>
    serializable_not_complex = false
    
    timeout?: number // timeout for request on values of this type

    // TODO: make true per default? currently results in stack overflows for some std types
    #proxify_children = false // proxify all (new) children of this type
    children_timeouts?: Map<string, number> // individual timeouts for children
    
    static #jsTypeDefModuleMapper?: (url:string|URL, type: Type) => string|URL|undefined
    
    static setJSTypeDefModuleMapper(fn:  (url:string|URL, type: Type) => string|URL|undefined) {
        this.#jsTypeDefModuleMapper = fn;
        // update existing typedef modules
        for (const type of this.types.values()) {
            if (type.#potentialJsTypeDefModule) type.jsTypeDefModule = type.#potentialJsTypeDefModule;
        }
    }

    /**
     * Should proxify all children with proxify_as_child=true
     * when creating a pointer of this type
     */
    get proxify_children() {return this.interface_config?.proxify_children ?? this.#proxify_children}
    set proxify_children(proxify: boolean) {if (this.interface_config) {this.interface_config.proxify_children = proxify}; this.#proxify_children = proxify}

    /**
     * Prevents proxification if a child of a parent with proxified children.
     * Primitive values are not proxified per default
     */
    proxify_as_child = true;

    // all children allowed by the template
    #visible_children: Set<any>
    get visible_children(): Set<any> {return this.#visible_children ?? this.interface_config?.visible_children}

    // get about Markdown
    #about: string
    #about_md: Markdown
    get about() {
        if (!this.#about_md) {
            this.#about_md = new Markdown(`## ${this.toString().replace("<","\\<").replace(">","\\>")}\n${this.#about}`);
        }
        return this.#about_md
    }

    /**
     * true if this type has no custom handling for indirect references
     */
    get supportsIndirectRefs() {
        // only supported if indirect references are not already handled by a custom transform (e.g. for UIX elements)
        return Runtime.OPTIONS.INDIRECT_REFERENCES && !this.interface_config?.handle_transform
    }

    // templated type (struct)
    #template: {[key:string]:Type}|any[] & T
    // constructor, replicator, destructor
    #constructor_fn: globalThis.Function
    #replicator_fn: globalThis.Function
    #destructor_fn: globalThis.Function

    // configuration for advanced JS interface
    get interface_config():js_interface_configuration<any> {
        return this.#interface_config ?? (this.root_type != this ? this.root_type?.interface_config : undefined);
    }

    #interface_config: js_interface_configuration

    #implemented_types = new Set<Type>(); // template [EXTENDED_OBJECTS] + additional types
    get implemented_types(){
        return this.#implemented_types;
    }

    public addImplementedType(type: Type) {
        this.#implemented_types.add(type);
    }

    // add a constructor function
    public setConstructor(constructor_fn:globalThis.Function) {
        this.#constructor_fn = constructor_fn;
    }
    // add a replicator function
    public setReplicator(replicator_fn:globalThis.Function) {
        this.#replicator_fn = replicator_fn;
    }  
    // add a destructor function
    public setDestructor(destructor_fn:globalThis.Function) {
        this.#destructor_fn = destructor_fn;
    }

    // maps DATEX template type representation to corresponding typescript types
    public setTemplate<NT extends Object>(template: NT):Type<Partial<({ [key in keyof NT]: (NT[key] extends Type<infer TT> ? TT : any ) })>>
    public setTemplate(template: object) {
        // DatexObject.freeze(template);
        this.#template = <any>template;
        this.#visible_children = new Set(Object.keys(this.#template));
        // add extended types from template
        for (const t of this.#template[EXTENDED_OBJECTS]??[]) {
            this.#implemented_types.add(Type.template_types.get(t))
        }
        
        Type.type_templates.set(this, template)
        Type.template_types.set(template, this);

        return <any>this;
    }


    get template() {
        return this.#template;
    }

    /**
     * Creates a new instance of this type from a given object - throws error if required properties are missing or have wrong type if strict=true
     * Only works for types with a template
     */
    public new(value:Record<string,unknown> = {}, strict = true, assign_to_object:Record<string,unknown> = {[DX_TYPE]: this}):T {
        if (!this.#template) throw new RuntimeError("Type has no template");
        if (!(typeof value == "object")) throw new RuntimeError("Cannot create template value from non-object value");

        if (strict) {
            for (const key of Object.keys(value)) {
                if (!(key in this.#template)) {
                    throw new ValueError("Property '" + key + "' is not allowed");
                }
            }    
        }

        // add all allowed properties (check template types)
        for (const key of Object.keys(this.#template)) {
            // @ts-ignore this.#template is always a Tuple
            const required_type = this.#template[key];
 
            // check if can set property (has setter of value)
            const desc = Object.getOwnPropertyDescriptor(assign_to_object, key);
            if (desc && !desc.writable) {
                logger.debug("skipping unwriteable template property " + key);
                continue; // cannot set, skip
            }
            
            // TODO how to handle protoype properties?
            // don't set to void/undefined if key not in properties object, prevents overrides of JS prototype properties/methods
            if (!(key in value)) {
                if (strict) throw new ValueError("Property '" + key + "' is required");
            }

            try {

                // no type check available
                if (!required_type) {
                    assign_to_object[key] = value[key];
                }
                // check value type
                else if (key in value && Type.matches(value[key], required_type)) {
                    assign_to_object[key] = value[key];
                }
                // JS number->bigint conversion
                else if (key in value && required_type.root_type == Type.std.integer && typeof value[key] == "number" && Number.isInteger(value[key])) {
                    assign_to_object[key] = BigInt(value[key]);
                }
                // add default template value
                else if (value[key] == VOID && required_type.template) {
                    assign_to_object[key] = required_type.new({}, strict);
                }
                else if (value[key] == VOID) assign_to_object[key] = VOID;
                // try to cast to struct
                else if (required_type instanceof Type && required_type.namespace == "struct" && Type.ofValue(value[key]) == Type.std.Object) {
                    assign_to_object[key] = required_type.new(value[key] as Record<string,unknown>, strict)
                }
                else throw new ValueError("Property '" + key + "' must be of type " + required_type);
            }
            catch (e) {
                // TODO: catch required? for readonly properties
                // error while assigning to readonly property from prototype chain might still occur
                if (e instanceof TypeError) {
                    logger.debug("ignoring unwriteable template prototype property " + key);
                }
                else if (strict) throw e;
            }
            
        }
        // copy permissions from template
        if (this.#template[DX_PERMISSIONS]) {
            const permissions = assign_to_object[DX_PERMISSIONS] = {}
            for (let [key,val] of Object.entries(this.#template[DX_PERMISSIONS])) {
                permissions[key] = val;
            }
        }

        assign_to_object[DX_TEMPLATE] = this.#template;

        return <any>(assign_to_object instanceof DatexObject ? DatexObject.seal(assign_to_object) : assign_to_object);
    }

    /**
     * Result must be awaited and collapsed with Runtime.collapseValueCast
     */
    public createDefaultValue(context?:any, origin:Endpoint = Runtime.endpoint, context_location?: URL): Promise<any>{
        return Runtime.castValue(this, VOID, context, context_location, origin);
    }

    static #current_constructor:globalThis.Function|null;

    public static isConstructing(value:object) {
        return value.constructor == this.#current_constructor;
    }

    public hasMatchingJSClassOrPrototype() {
        return (!!this.interface_config?.class) || (!!this.interface_config?.prototype)
    }

    // cast any value to a value of this type (for custom types)
    public cast(value: any, context?:any, origin:Endpoint = Runtime.endpoint, make_pointer = false, ignore_js_config = false, assigningPtrId?: string, strict = false):T {
        // unknown type (no template or config)
        //if (!this.interface_config && !this.template) return UNKNOWN_TYPE;

        // has a JS configuration
        if (!ignore_js_config && this.interface_config){
            // generate default value
            if (value === VOID && this.interface_config.empty_generator instanceof globalThis.Function) return this.interface_config.empty_generator(this, context, origin);
            // custom cast method
            else if (this.interface_config.cast) {
                return this.interface_config.cast(value, this, context, origin, assigningPtrId);
            }
            else if (this.interface_config.cast_no_tuple && !(value instanceof Tuple)) {
                return this.interface_config.cast_no_tuple(value, this, context, origin, assigningPtrId);
            }
            // special cast: prototype
            else if (typeof value == "object" && this.interface_config.prototype) {
                const object = Object.create(this.interface_config.prototype)
                Object.assign(object, value);
                return object;
            }
        }

        // no JS config or no custom casting -> handle default constructor
        // 'pseudo constructor arguments', multiple args if tuple, if not object! (normal cast), use value as single argument
        let args:any[];
        let is_constructor = true;
        if (value instanceof Tuple) args = value.toArray(); // multiple constructor arguments with tuple (ignores keys!)
        else if (typeof value != "object" || value === null) args = [value] // interpret any non-object value as a constructor argument
        else {
            args = [];
            is_constructor = false; // is replicated object, not created with constructor arguments
        }

        const propertyInitializer = this.getPropertyInitializer(value, true, strict);
        const instance = this.newJSInstance(is_constructor, args, propertyInitializer);

        // initialize properties, if not [INIT_PROPS] yet called inside constructor
        if (!is_constructor) propertyInitializer[INIT_PROPS](instance);

        // call DATEX construct methods and create pointer
        return this.construct(instance, args, is_constructor, make_pointer);
    }

    /** returns an object with a [INIT_PROPS] function that can be passed to newJSInstance() or called manually */
    public getPropertyInitializer(value:any, useTemplate = true, strict = false) {
        // TODO: is it okay to call INIT_PROPS multiple times? required for inherited classes
        //const initialized = {i:false};
        // property initializer - sets existing property for pointer object (is passed as first constructor argument when reconstructing)
        return Object.freeze({
            [INIT_PROPS]: (instance:any)=>{
                // if (initialized.i) return; 
                // initialized.i=true; 
                this.initProperties(instance, value, useTemplate, strict)
            }
        })
    }

    public newJSInstance(is_constructor = true, args?:any[], propertyInitializer?:{[INIT_PROPS]:(instance:any)=>void}) {
        // create new instance - TODO 'this' as last constructor argument still required?
        Type.#current_constructor = this.interface_config?.class??null;
        const instance = <T> (this.interface_config?.class ? Reflect.construct(Type.#current_constructor, is_constructor?[...args]:(propertyInitializer ? [propertyInitializer] : [])) : {[DX_TYPE]: this});
        Type.#current_constructor = null;
        return instance;
    }

    public initProperties(instance:any, value:any, useTemplate = true, strict = false) {
        if (!value) return;
        // initialize with template
        if (useTemplate && this.#template) this.new(value, strict, instance)
        // just copy all properties if no template found
        else {
            for (const [key, val] of Object.entries(value)) {
                if (val instanceof JSTransferableFunction) {
                    // workaround create new transferable function with correct "this" context
                    instance[key] = $$(JSTransferableFunction.recreate(val.source, {...val.deps, 'this':instance}));
                }
                else if (typeof val == "function" && typeof val.bind == "function") instance[key] = val.bind(instance);
                else instance[key] = val;
            }
        }
    }

    public construct(instance:T, args?:any[], is_constructor = true, make_pointer = false) {
        instance[DX_TEMPLATE] = this.#template;

        // make pointer?
        if (make_pointer) {
            instance = Pointer.create(null, instance, false, undefined, false, false).val
        }

        // call custom DATEX constructor or replicator
        if (is_constructor && this.#constructor_fn) {
            const res = this.#constructor_fn.apply(instance, args)
            // catch promise rejections (not awaited)
            if (res instanceof Promise) res.catch(e=>{console.error(e)})
        }
        else if (!is_constructor && this.#replicator_fn) {
            const res = this.#replicator_fn.apply(instance, args);
            // catch promise rejections (not awaited)
            if (res instanceof Promise) res.catch(e=>{console.error(e)})
        }
        
        return instance;
    }


    // JS interface configuration

    public setJSInterface(configuration:js_interface_configuration<T>):Type<T>{
        this.#interface_config = configuration;
        JSInterface.handleConfigUpdate(this, configuration);
        return this;
    }


    // about (documentation/description)

    public setAbout(about: string | Markdown) {
        if (about instanceof Markdown) this.#about_md = about;
        else if (typeof about == "string") this.#about = about;
        else throw new ValueError("Invalid about, must be <string>");
    }


    // never call the constructor directly!! should be private
    constructor(namespace?:string, name?:string, variation?:string, parameters?:any[]) {
        super(namespace && namespace != "std" ? (val:any) => this.cast(val, undefined, undefined, true) : undefined)
        if (name) this.name = name;
        if (namespace) this.namespace = namespace;
        if (variation) this.variation = variation;
        
        this.parameters = parameters;
        this.base_type = parameters ? Type.get(namespace, name, variation) : this; // get base type without parameters
        this.root_type = (variation||parameters) ? Type.get(namespace, name) : this; // get root type without variation and parameters

        this.is_primitive = namespace=="std" && Type.primitive_types.includes(this.name);
        this.is_complex   = namespace!="std" || !Type.fundamental_types.includes(this.name);
        this.is_js_pseudo_primitive = (namespace=="std"||namespace=="js") && Type.pseudo_js_primitives.includes(this.name);
        this.has_compact_rep = namespace=="std" && (this.is_primitive || Type.compact_rep_types.includes(this.name));
        this.serializable_not_complex = Type.serializable_not_complex_types.includes(this.name);

        
        if (!parameters) Type.types.set((this.namespace||"std")+":"+this.name+"/"+(this.variation??""), this); // add to pointer list
    }



    // get parametrized type
    public getParametrized(parameters:any[]):Type<T>{
        return Type.get(this.namespace, this.name, this.variation, parameters);
    }

    // get type variation
    public getVariation(variation:string):Type<T>{
        return Type.get(this.namespace, this.name, variation, this.parameters);
    }

    // type check (type is a subtype of this)
    public matchesType(type:type_clause){
        return Type.matchesType(type, this);
    }
    public matches(value:RefOrValue<any>): value is T  {
        return Type.matches(value, this);
    }


    public setChildTimeout(child:string, timeout: number) {
        if (!this.children_timeouts) this.children_timeouts = new Map();
        this.children_timeouts.set(child, timeout)
    }


    // match type against visible_children
    public isPropertyAllowed(property:any) {
        // all children allowed or specific child allowed
        return !this.visible_children || this.visible_children.has(property);
    }

    // match type against template
    /**
     * @deprecated, use assertPropertyValueAllowed
     */
    public isPropertyValueAllowed(property:any, value:any) {
        if (!this.#template) return true;
        else if (typeof property !== "string") return true; // only strings handled by templates
        else return (!this.#template[property] || Type.matches(value, this.#template[property])) // check if value allowed
    }

    public assertPropertyValueAllowed(property:any, value:any) {
        if (!this.#template) return true;
        else if (typeof property !== "string") return true; // only strings handled by templates
        else if (this.#template[property]) Type.assertMatches(value, this.#template[property]) // assert value allowed
    }

    // get type for value in template
    public getAllowedPropertyType(property:any):Type {
        if (!this.#template) return Type.std.Any;
        else if (typeof property !== "string") return Type.std.void; // key must be a string (TOOD type None?)
        else return this.#template[property]
    }

    // operators and other type specific runtime behaviour

    public updateValue(ref:T, value:T) {

        if (Type.ofValue(ref)!==this) {
            throw new ValueError("Cannot update value, reference has wrong type")
        }

        if (this.interface_config?.override_silently instanceof Function) {
            this.interface_config.override_silently(ref, value)
        }

        // default array update
        else if (ref instanceof Array) {
            if (!(value instanceof Array)) throw new ValueError("Cannot update array value with non-array value")
            ref.splice(0, ref.length, ...(value as any))
        }

        // default object update
        else if (typeof ref == "object") {
            if (typeof value != "object") throw new ValueError("Cannot update value with non-object-like value")
            
            for (const prop of Object.getOwnPropertyNames(ref)) {
                if (prop === "$" || prop == "$$") continue; // skip $ properties
                delete (ref as any)[prop];
            }
            Object.assign(ref as any, Runtime.serializeValue(value))
        }

        // js function, no change? should not happen
        else if (this as Type<any> == Type.js.TransferableFunction && ref?.toString?.() === value?.toString?.()) {
            console.log("no change for fn", value)
        }

        else {
            console.error("Cannot update value of type " + this.toString(), new Error().stack);
            sendReport("invalid-function-value-update", {
                fn: value?.toString(),
            }).catch(console.error)
            // TODO:
            // throw new ValueError("Cannot update value of type " + this.toString());
        }
    }

    public handleOperatorAdd(first:any, second:any) {
        if (this.interface_config?.operator_add instanceof Function) {
            return this.interface_config.operator_add(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorSubtract(first:any, second:any) {
        if (this.interface_config?.operator_subtract instanceof Function) {
            return this.interface_config.operator_subtract(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorMultiply(first:any, second:any) {
        if (this.interface_config?.operator_multiply instanceof Function) {
            return this.interface_config.operator_multiply(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorDivide(first:any, second:any) {
        if (this.interface_config?.operator_divide instanceof Function) {
            return this.interface_config.operator_divide(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorModulo(first:any, second:any) {
        if (this.interface_config?.operator_modulo instanceof Function) {
            return this.interface_config.operator_modulo(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorPower(first:any, second:any) {
        if (this.interface_config?.operator_power instanceof Function) {
            return this.interface_config.operator_power(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorAnd(first:any, second:any) {
        if (this.interface_config?.operator_and instanceof Function) {
            return this.interface_config.operator_and(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorOr(first:any, second:any) {
        if (this.interface_config?.operator_or instanceof Function) {
            return this.interface_config.operator_or(first, second)
        }
        else return NOT_EXISTING
    }
    public handleOperatorNot(first:any, second:any) {
        if (this.interface_config?.operator_not instanceof Function) {
            return this.interface_config.operator_not(first, second)
        }
        else return NOT_EXISTING
    }

    public handleCompare(first:T, second:T) {
        if (this.interface_config?.compare instanceof Function) {
            return this.interface_config.compare(first, second)
        }
        else return NOT_EXISTING
    }

    public handleApply(ref:T, value:any) {
        if (this.interface_config?.apply_value instanceof Function) {
            return this.interface_config.apply_value(ref, value)
        }
        else return NOT_EXISTING
    }

    public handleActionAdd(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_add instanceof Function) {
            if (this.interface_config.action_add(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for add assign action"); 
        }
        else throw new ValueError("Add assign action not implemented for type");
    }
    public handleActionSubtract(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_subtract instanceof Function) {
            if (this.interface_config.action_subtract(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for subtract assign action"); 
        }
        else throw new ValueError("Subtract assign action not implemented for type");
    }
    public handleActionMultiply(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_multiply instanceof Function) {
            if (this.interface_config.action_multiply(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for multiply assign action"); 
        }
        else throw new ValueError("Multiply assign action not implemented for type");
    }
    public handleActionDivide(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_divide instanceof Function) {
            if (this.interface_config.action_divide(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for divide assign action"); 
        }
        else throw new ValueError("Divide assign action not implemented for type");
    }
    public handleActionPower(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_power instanceof Function) {
            if (this.interface_config.action_power(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for power assign action"); 
        }
        else throw new ValueError("Power assign action not implemented for type");
    }
    public handleActionModulo(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_modulo instanceof Function) {
            if (this.interface_config.action_modulo(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for modulo assign action"); 
        }
        else throw new ValueError("Modulo assign action not implemented for type");
    }
    public handleActionAnd(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_and instanceof Function) {
            if (this.interface_config.action_and(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for and assign action"); 
        }
        else throw new ValueError("And assign action not implemented for type");
    }
    public handleActionOr(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_or instanceof Function) {
            if (this.interface_config.action_or(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for or assign action"); 
        }
        else throw new ValueError("Or assign action not implemented for type");
    }
    public handleActionIncrement(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_increment instanceof Function) {
            if (this.interface_config.action_increment(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for increment assign action"); 
        }
        else throw new ValueError("Increment assign action not implemented for type");
    }
    public handleActionDecrement(ref:T, value:any, silently = false, exclude?:Endpoint) {
        if (this.interface_config?.action_decrement instanceof Function) {
            if (this.interface_config.action_decrement(ref, value, silently, exclude) === INVALID) throw new ValueError("Invalid value for decrement assign action"); 
        }
        else throw new ValueError("Decrement assign action not implemented for type");
    }


    #string?:string

    toString(){
        if (!this.#string) {
            this.#string = `<${
                (this.namespace && this.namespace != 'std') ? this.namespace+":":""}${this.name}${
                this.variation?'/'+this.variation:''}${
                this.parameters?(
                    this.parameters.length == 1 ? '('+Runtime.valueToDatexString(this.parameters[0])+')':
                    '('+this.parameters.map(p=>Runtime.valueToDatexString(p)).join(",")+')'
                ):''
            }>`;
        }
        return this.#string;
    }

    toJSON(){
        return "dx::"+this.toString();
    }

    /** static */

    public static or(...types:type_clause[]){
        if (types.length == 1) return types[0]; // no or required
        return new Disjunction(...types);
    }

    public static and(...types:type_clause[]){
        if (types.length == 1) return types[0]; // no and required
        return new Conjunction(...types);
    }

    // @implements LogicalComparator<T>
    static logicalMatch(value: Type<any>, against: Type<any>) {
        
		if (against === value) return true;
        if (against == Type.std.Any) return true; // every type implements <Any>
		if (value.implemented_types.has(against)) return true; // TODO:implemented_types

        // custom match based on type parameters
        else if (against.parameters) {
            // must have same base type
            if (value.base_type === against.base_type) {
                // custom JS interface config match function
                if (value.base_type.interface_config?.type_params_match instanceof Function) {
                    return value.base_type.interface_config.type_params_match(value.parameters??[], against.parameters??[])
                }
                else return false

            }
            else return false;
        }

        // // value base type matches
        // else if (value.root_type) return this.logicalMatch(value.base_type, against);

        // value base type matches
        else if (value.base_type !== value) return this.logicalMatch(value.base_type, against);
        else if (value.root_type !== value) return this.logicalMatch(value.root_type, against);

        // no match
		else return false;
    }

    // type check (type is a subtype of matches_type)
    // TODO: swap arguments
    public static matchesType(type:type_clause, against: type_clause, assertionValue?:any, throwInvalidAssertion = false) {
        return Logical.matches(type, against, Type, assertionValue, throwInvalidAssertion);
    }


    private static matchesTemplate(template:object, parent_template:object){
        if (template == parent_template) return true;
        // recursive check all templates
        else {
            for (let object of template[EXTENDED_OBJECTS]||[]) {
                if (typeof object == "object" && this.matchesTemplate(object, parent_template)) return true;
            }
            return false;
        }
    }

    public static assertMatches<T extends Type>(value:RefOrValue<any>, type:type_clause): asserts value is (T extends Type<infer TT> ? TT : any) {
        const res = Type.matches(value, type, true);
        if (!res) throw new ValueError("Value must be of type " + type)
    }

    // check if root type of value matches exactly
    public static matches<T extends Type>(value:RefOrValue<any>, type:type_clause, throwInvalidAssertion = false): value is (T extends Type<infer TT> ? TT : any)  {
        value = ReactiveValue.collapseValue(value, true, true);
        // value has a matching DX_TEMPLATE
        if (type instanceof Type && type.template && value?.[DX_TEMPLATE] && this.matchesTemplate(value[DX_TEMPLATE], type.template)) return true;
        // compare types

        // workaround: explicit text length matching, TODO: more general solution
        // e.g. text matches text(10)
        if (Type.ofValue(value) == Type.std.text && type !== Type.std.text && type instanceof Type && type.base_type === Type.std.text) {
            return value.length <= type.parameters[0];
        }

        // typed array matching
        if (Type.ofValue(value) == Type.std.Array && type !== Type.std.Array && type instanceof Type && type.base_type === Type.std.Array) {
            // check if all elements match
            for (const val of value) {
                if (!Type.matches(val, type.parameters[0])) return false;
            }
            return true;
        }

        // workaound: more specific integer, allow any bigint
        if (type instanceof Type && type.root_type === Type.std.integer && typeof value == "bigint") return true;

        return Type.matchesType(Type.ofValue(value), type, value, throwInvalidAssertion);
    }

    public static extends(type:Type, extends_type:type_clause){
        return type!=extends_type && Type.matchesType(type, extends_type);
    }

    public static get<T = any>(name:string, parameters?:any[]):Type<T>
    public static get<T = any>(namespace:string, name:string, variation?:string, parameters?:any[]):Type<T>
    public static get<T = any>(namespace:string, name_or_parameters?:string|any[], variation?:string, parameters?:any[]):Type<T> {
        let name:string;
        if (name_or_parameters instanceof Array) parameters = name_or_parameters;
        else if (typeof name_or_parameters == "string") name = name_or_parameters;
        else if (name_or_parameters!=undefined) throw new TypeError("Invalid type name or parameters");

        if (namespace?.includes(":")) [namespace, name] = namespace.split(":");
        if (name === undefined) {
            name = namespace;
            namespace = "std";
        }
        if (!namespace) namespace = "std";
        if (!name) throw new Error("Invalid type");
        if (name?.includes("/")) [name, variation] = name.split("/");

        if (parameters) return new Type(namespace, name, variation, parameters);
        else return this.types.get(namespace+":"+name+"/"+(variation??"")) || new Type(namespace, name, variation, parameters);
    }

    public static has(namespace?:string, name?:string, variation?:string) {
        if (namespace.includes(":")) [namespace, name] = namespace.split(":");
        if (name.includes("/")) [name, variation] = name.split("/");
        return this.types.has((namespace||"std")+":"+name+"/"+(variation??""));
    }

    /**
     * Force bind a DATEX Type to a value (should be compatible with the JS type of the value)
     * @param value the JS value
     * @param type the new DATEX Type that should be bound to the value
     * @returns the JS value with the bound DATEX Type (still the same reference)
     */
    public static bindType<T>(value:T, type:Type<T>): T {
        value[DX_TYPE] = type;
        return value;
    }

    // get datex type from value
    public static ofValue<T=any>(value:RefOrValue<T>):Type<T> {

        if (value instanceof Pointer) {
            return value.current_type ?? Type.std.void;
        }
        else if (value instanceof PointerProperty && value.type instanceof Type) {
            return value.type as Type<T>;
        }

        value = ReactiveValue.collapseValue(value,true,true)

        // // should not happen
        // else if (value instanceof Pointer) {
        //     value = value.type;
        //     // console.warn("Tried to get the type of a pointer reference")
        //     // throw new RuntimeError("Tried to get the type of a pointer reference");
        // }

        // special case: handle before set (todo change?)
        if (value instanceof Conjunction) return <Type<T>>Type.std.Conjunction;
        if (value instanceof Disjunction) return <Type<T>>Type.std.Disjunction;
        if (value instanceof Negation) return <Type<T>>Type.std.Negation;

        if (value instanceof WeakRef) return <Type<T>>Type.std.WeakRef;

        // get type from DX_TYPE property
        if (value?.[DX_TYPE]) return value[DX_TYPE];

        // get type from pointer
        let type:Type|undefined
        if ((type = Pointer.getByValue(value)?.current_type)) return type;

        // get custom type
        const custom_type = JSInterface.getValueDatexType(value);

        if (!custom_type) {
            if (value === VOID) return Type.std.void;
            if (value === null) return Type.std.null;

            if (value?.[DX_TYPE]) return value[DX_TYPE]; // override Datex Type

            if (value instanceof Quantity) return <Type<T>>Type.std.quantity;
            if (typeof value == "string") return <Type<T>>Type.std.text;
            if (typeof value == "bigint") return <Type<T>>Type.std.integer;
            if (typeof value == "number") return <Type<T>>Type.std.decimal;
            if (typeof value == "boolean") return <Type<T>>Type.std.boolean;
            if (typeof value == "symbol") return Type.js.Symbol as unknown as Type<T>;
            if (value instanceof RegExp) return Type.js.RegExp as unknown as Type<T>;
            if (globalThis.MediaStream && value instanceof MediaStream) return Type.js.MediaStream as unknown as Type<T>;

            if (value instanceof TypedArray) {
                switch (value.constructor) {
                    case Uint8Array: return Type.js.TypedArray.getVariation('u8') as unknown as Type<T>;
                    case Uint16Array: return Type.js.TypedArray.getVariation('u16') as unknown as Type<T>;
                    case Uint32Array: return Type.js.TypedArray.getVariation('u32') as unknown as Type<T>;
                    case BigUint64Array: return Type.js.TypedArray.getVariation('u64') as unknown as Type<T>;
                    case Int8Array: return Type.js.TypedArray.getVariation('i8') as unknown as Type<T>;
                    case Int16Array: return Type.js.TypedArray.getVariation('i16') as unknown as Type<T>;
                    case Int32Array: return Type.js.TypedArray.getVariation('i32') as unknown as Type<T>;
                    case BigInt64Array: return Type.js.TypedArray.getVariation('i64') as unknown as Type<T>;
                    case Float32Array: return Type.js.TypedArray.getVariation('f32') as unknown as Type<T>;
                    case Float64Array: return Type.js.TypedArray.getVariation('f64') as unknown as Type<T>;
                    default: throw new ValueError("Invalid TypedArray");
                }
            }
            
            if (value instanceof ArrayBuffer) return <Type<T>>Type.std.buffer;
            if (value instanceof Tuple) return <Type<T>>Type.std.Tuple;
            if (value instanceof Array) return <Type<T>>Type.std.Array;

            if (value instanceof File) return Type.js.File as unknown as Type<T>;

            // mime types
            if (value instanceof Blob) {
                return Type.get("std", ...(value.type ? value.type.split("/") : ["application","octet-stream"]) as [string, string])
            }
            if (Runtime.mime_type_classes.has(value.constructor)) return Type.get("std", ...<[string, string]>Runtime.mime_type_classes.get(value.constructor).split("/"))

            if (value instanceof SyntaxError) return Type.std.SyntaxError;
            if (value instanceof CompilerError) return Type.std.CompilerError;
            if (value instanceof PointerError) return Type.std.PointerError;
            if (value instanceof ValueError) return Type.std.ValueError;
            if (value instanceof PermissionError) return Type.std.PermissionError;
            if (value instanceof TypeError) return Type.std.TypeError;
            if (value instanceof NetworkError) return Type.std.NetworkError;
            if (value instanceof RuntimeError) return Type.std.RuntimeError;
            if (value instanceof SecurityError) return Type.std.SecurityError;
            if (value instanceof AssertionError) return Type.std.AssertionError;

            if (value instanceof Error) return <Type<T>>Type.std.Error;
    
            if (value instanceof Time) return <Type<T>>Type.std.time;
            if (value instanceof URL) return <Type<T>>Type.std.url;

            // loose function check: normal Functions are also considered std.Functions, because they get converted anyways once they get in touch with DATEX (also required for correct pointer type recognition when setting the value)
            if (value instanceof Type) return <Type<T>>Type.std.Type;
            if (value instanceof Function) return <Type<T>>Type.std.Function;
            if (value instanceof DatexFunction) return <Type<T>>Type.std.Function;
            if (value instanceof Stream) return <Type<T>>Type.std.Stream;
            if (value instanceof Endpoint) return <Type<T>>Type.std.endpoint;
            if (value instanceof Target) return <Type<T>>Type.std.target;
            if (value instanceof Scope) return <Type<T>>Type.std.Scope;
    
            if (typeof value == "object") {
                const proto = Object.getPrototypeOf(value);
                // plain object
                if (proto === Object.prototype || proto === null)
                    return <Type<T>>Type.std.Object;
                // complex object with prototype
                else 
                    return <Type<T>>Type.js.NativeObject;
            }
    
            else return <Type<T>>Type.js.NativeObject;
        }
        return custom_type;
    }


    // get datex type from js class
    public static getClassDatexType<T=any>(forClass:{new():T}):Type<T> {

        const _forClass:any = forClass;

        if (_forClass[DX_TYPE]) return _forClass[DX_TYPE]; // type shortcut

        // handle before set
        if (_forClass == Conjunction) return <Type<T>>Type.std.Conjunction;
        if (_forClass == Disjunction) return <Type<T>>Type.std.Disjunction;
        if (_forClass == Negation) return <Type<T>>Type.std.Negation;


        const custom_type = JSInterface.getClassDatexType(_forClass);

        if (!custom_type) {

            if (_forClass == Quantity || Quantity.isPrototypeOf(_forClass)) return <Type<T>>Type.std.quantity;
            if (_forClass == globalThis.String || globalThis.String.isPrototypeOf(_forClass)) return <Type<T>>Type.std.text;
            if (_forClass == BigInt || BigInt.isPrototypeOf(_forClass)) return <Type<T>>Type.std.integer;
            if (_forClass == Number || Number.isPrototypeOf(_forClass)) return <Type<T>>Type.std.decimal;
            if (_forClass == globalThis.Boolean || globalThis.Boolean.isPrototypeOf(_forClass)) return <Type<T>>Type.std.boolean;
            if (_forClass == Symbol || Symbol.isPrototypeOf(_forClass)) return <Type<T>>Type.js.Symbol;
            if (_forClass == RegExp || RegExp.isPrototypeOf(_forClass)) return Type.js.RegExp as unknown as Type<T>;
            if (_forClass == File || File.isPrototypeOf(_forClass)) return Type.js.File as unknown as Type<T>;
            if (globalThis.MediaStream && _forClass == MediaStream) return Type.js.MediaStream as unknown as Type<T>;
            if (_forClass == WeakRef || WeakRef.isPrototypeOf(_forClass)) return <Type<T>>Type.std.WeakRef;

            if (TypedArray.isPrototypeOf(_forClass)) {
                switch (_forClass) {
                    case Uint8Array: return Type.js.TypedArray.getVariation('u8') as unknown as Type<T>;
                    case Uint16Array: return Type.js.TypedArray.getVariation('u16') as unknown as Type<T>;
                    case Uint32Array: return Type.js.TypedArray.getVariation('u32') as unknown as Type<T>;
                    case BigUint64Array: return Type.js.TypedArray.getVariation('u64') as unknown as Type<T>;
                    case Int8Array: return Type.js.TypedArray.getVariation('i8') as unknown as Type<T>;
                    case Int16Array: return Type.js.TypedArray.getVariation('i16') as unknown as Type<T>;
                    case Int32Array: return Type.js.TypedArray.getVariation('i32') as unknown as Type<T>;
                    case BigInt64Array: return Type.js.TypedArray.getVariation('i64') as unknown as Type<T>;
                    case Float32Array: return Type.js.TypedArray.getVariation('f32') as unknown as Type<T>;
                    case Float64Array: return Type.js.TypedArray.getVariation('f64') as unknown as Type<T>;
                    default: throw new ValueError("Invalid TypedArray");
                }
            }

            if (_forClass == ArrayBuffer) return <Type<T>>Type.std.buffer;
            if (_forClass == Tuple || Tuple.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Tuple;
            if (_forClass == Array || Array.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Array;

            if (_forClass ==  SyntaxError || SyntaxError.isPrototypeOf(_forClass)) return Type.std.SyntaxError;
            if (_forClass ==  CompilerError || CompilerError.isPrototypeOf(_forClass)) return Type.std.CompilerError;
            if (_forClass ==  PointerError || PointerError.isPrototypeOf(_forClass)) return Type.std.PointerError;
            if (_forClass ==  ValueError || ValueError.isPrototypeOf(_forClass)) return Type.std.ValueError;
            if (_forClass ==  PermissionError || PermissionError.isPrototypeOf(_forClass)) return Type.std.PermissionError;
            if (_forClass ==  TypeError || TypeError.isPrototypeOf(_forClass)) return Type.std.TypeError;
            if (_forClass ==  NetworkError || NetworkError.isPrototypeOf(_forClass)) return Type.std.NetworkError;
            if (_forClass ==  RuntimeError || RuntimeError.isPrototypeOf(_forClass)) return Type.std.RuntimeError;
            if (_forClass ==  SecurityError || SecurityError.isPrototypeOf(_forClass)) return Type.std.SecurityError;
            if (_forClass ==  AssertionError || AssertionError.isPrototypeOf(_forClass)) return Type.std.AssertionError;

            if (_forClass ==  Error || Error.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Error;

            if (_forClass ==  Markdown || Markdown.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Markdown;
            if (_forClass ==  Time || Time.isPrototypeOf(_forClass)) return <Type<T>>Type.std.time;
            if (_forClass ==  URL || URL.isPrototypeOf(_forClass)) return <Type<T>>Type.std.url;

            if (_forClass ==  Type || Type.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Type;
            if (_forClass ==  DatexFunction || DatexFunction.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Function;
            if (_forClass ==  Function || Function.isPrototypeOf(_forClass)) return <Type<T>>Type.js.Function;
            if (_forClass ==  Stream || Stream.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Stream;
            if (_forClass ==  Endpoint || Endpoint.isPrototypeOf(_forClass)) return <Type<T>>Type.std.endpoint;
            if (_forClass ==  Target || Target.isPrototypeOf(_forClass)) return <Type<T>>Type.std.target;
            if (_forClass ==  Scope || Scope.isPrototypeOf(_forClass)) return <Type<T>>Type.std.Scope;

            if (_forClass == Object) return <Type<T>>Type.std.Object;

            else return <Type<T>>Type.js.NativeObject;
        }
        return custom_type;
    }

    // TODO
    public static doesValueHaveProperties(value:any):boolean {
        return value && typeof value == "object" && !(
            value instanceof Quantity ||
            value instanceof Time ||
           // value instanceof Target ||
            value instanceof ArrayBuffer
        ) 
    }

    // can change object properties of none-primitive (x[y] = z)
    public static isValueObjectEditable(value:any):boolean {
        return !(value instanceof Set || value instanceof DatexFunction) 
    }


    /**
     * js: namespace
     */
    static js = {
        NativeObject: Type.get<object>("js:Object"), // special object type for non-plain objects (objects with prototype) - no automatic children pointer initialization
        TransferableFunction: Type.get<JSTransferableFunction>("js:Function"),
        Symbol: Type.get<symbol>("js:Symbol"),
        RegExp: Type.get<RegExp>("js:RegExp"),
        MediaStream: Type.get<MediaStream>("js:MediaStream"),
        File: Type.get<File>("js:File"),
        TypedArray: Type.get<TypedArray>("js:TypedArray"),
        AsyncGenerator: Type.get<AsyncGenerator>("js:AsyncGenerator"),
        Promise: Type.get<Promise<any>>("js:Promise"),
        ReadableStream: Type.get<ReadableStream>("js:ReadableStream"),
        WritableStream: Type.get<WritableStream>("js:WritableStream"),
        Request: Type.get<Request>("js:Request"),
        Response: Type.get<Response>("js:Response"),
    }

    /**
     * std: namespace
     */
    static std = {
        integer: Type.get<bigint>("std:integer"),
        integer_8: Type.get<bigint>("std:integer").getVariation("8"),
        integer_16: Type.get<bigint>("std:integer").getVariation("16"),
        integer_32: Type.get<bigint>("std:integer").getVariation("32"),
        integer_64: Type.get<bigint>("std:integer").getVariation("64"),

        integer_u8: Type.get<bigint>("std:integer").getVariation("u8"),
        integer_u16: Type.get<bigint>("std:integer").getVariation("u16"),
        integer_u32: Type.get<bigint>("std:integer").getVariation("u32"),
        integer_u64: Type.get<bigint>("std:integer").getVariation("u64"),

        text: Type.get<string>("std:text"),
        text_plain: Type.get<Blob>("std:text").getVariation("plain"),
        text_datex: Type.get<Blob>("std:text").getVariation("datex"),
        text_markdown: Type.get<Markdown>("std:text").getVariation("markdown"),

        sized_text: (size: number) => Type.get<string>("std:text").getParametrized([size]),


        image: Type.get<Blob>("std:image"),
        video: Type.get<Blob>("std:video"),
        audio: Type.get<Blob>("std:audio"),
        model: Type.get<Blob>("std:model"),

        application: Type.get<Blob>("std:application"),
        application_pdf: Type.get<Blob&{type:"application/pdf"}>("std:application").getVariation("pdf"),

        decimal: Type.get<number>("std:decimal"),
        quantity: Type.get<Quantity>("std:quantity"),
        boolean: Type.get<boolean>("std:boolean"),
        null: Type.get<null>("std:null"),
        void: Type.get<undefined>("std:void"),
        buffer: Type.get<ArrayBuffer>("std:buffer"),
        url: Type.get<URL>("std:url"),
        time: Type.get<Time>("std:time"),

        target: Type.get<Target>("std:target"),
        endpoint: Type.get<Endpoint>("std:endpoint"),

        Set: Type.get<Set<any>>("std:Set"),
        Map: Type.get<(Map<any,any>)>("std:Map"),
        Transaction: Type.get("std:Transaction"),

        Object: Type.get<object>("std:Object"),
        Array: Type.get<Array<any>>("std:Array"),
        Array_8: Type.get<Array<number>>("std:Array").getVariation("8"),
        Array_16: Type.get<Array<number>>("std:Array").getVariation("16"),
        Array_32: Type.get<Array<number>>("std:Array").getVariation("32"),
        Array_64: Type.get<Array<bigint>>("std:Array").getVariation("64"),
        Array_u8: Type.get<Array<number>>("std:Array").getVariation("u8"),
        Array_u16: Type.get<Array<number>>("std:Array").getVariation("u16"),
        Array_u32: Type.get<Array<number>>("std:Array").getVariation("u32"),
        Array_u64: Type.get<Array<bigint>>("std:Array").getVariation("u64"),

        Tuple: Type.get<Tuple>("std:Tuple"),
        ExtObject: Type.get<object>("std:ExtObject"),

        Type: Type.get<Type>("std:Type"),
        Function: Type.get<Function>("std:Function"),
        Stream: Type.get<Stream>("std:Stream"),

        Deferred: Type.get<Stream>("std:Deferred"),

        Negation: Type.get<Negation<any>>("std:Negation"),
        Conjunction: Type.get<Conjunction<any>>("std:Conjunction"),
        Disjunction: Type.get<Disjunction<any>>("std:Disjunction"),
        Task: Type.get<Task>("std:Task"),
        Assertion:  Type.get<Assertion>("std:Assertion"),
        Iterator: Type.get<Iterator<any>>("std:Iterator"),

        MatchCondition: Type.get<MatchCondition<any,any>>("std:MatchCondition"),

        StorageMap: Type.get<StorageMap<unknown, unknown>>("std:StorageMap"),
        StorageWeakMap: Type.get<StorageWeakMap<unknown, unknown>>("std:StorageWeakMap"),
        StorageSet: Type.get<StorageSet<unknown>>("std:StorageSet"),
        StorageWeakSet: Type.get<StorageWeakSet<unknown>>("std:StorageWeakSet"),

        Error: Type.get<Error>("std:Error"),
        SyntaxError: Type.get("std:SyntaxError"),
        CompilerError: Type.get("std:CompilerError"),
        PointerError: Type.get("std:PointerError"),
        ValueError: Type.get("std:ValueError"),
        PermissionError: Type.get("std:PermissionError"),
        TypeError: Type.get("std:TypeError"),
        NetworkError: Type.get("std:NetworkError"),
        RuntimeError: Type.get("std:RuntimeError"),
        SecurityError: Type.get("std:DatexSecurityError"),
        AssertionError: Type.get("std:AssertionError"),

        WeakRef: Type.get("std:WeakRef"),

        Scope: Type.get<Scope>("std:Scope"),

        Debugger: Type.get<Debugger>("std:Debugger"),

        // abstract types
        Any: Type.get<any>("std:Any"),
        SyncConsumer: Type.get<any>("std:SyncConsumer"), // <<<
        ValueConsumer: Type.get<any>("std:ValueConsumer"), // any function or stream sink
        StreamConsumer: Type.get<any>("std:StreamConsumer"), // any function or stream sink

    }


    static short_types:{[key:number]:Type} = {
        [BinaryCode.STD_TYPE_TEXT]: Type.std.text,
        [BinaryCode.STD_TYPE_INT]: Type.std.integer,
        [BinaryCode.STD_TYPE_FLOAT]: Type.std.decimal,
        [BinaryCode.STD_TYPE_BOOLEAN]: Type.std.boolean,
        [BinaryCode.STD_TYPE_NULL]: Type.std.null,
        [BinaryCode.STD_TYPE_VOID]: Type.std.void,
        [BinaryCode.STD_TYPE_BUFFER]: Type.std.buffer,
        [BinaryCode.STD_TYPE_CODE_BLOCK]: Type.std.Scope,
        [BinaryCode.STD_TYPE_UNIT]: Type.std.quantity,
        [BinaryCode.STD_TYPE_ARRAY]: Type.std.Array,
        [BinaryCode.STD_TYPE_OBJECT]: Type.std.Object,
        [BinaryCode.STD_TYPE_SET]: Type.std.Set,
        [BinaryCode.STD_TYPE_MAP]: Type.std.Map,
        [BinaryCode.STD_TYPE_TUPLE]: Type.std.Tuple,
        [BinaryCode.STD_TYPE_FUNCTION]: Type.std.Function,
        [BinaryCode.STD_TYPE_STREAM]: Type.std.Stream,
        [BinaryCode.STD_TYPE_ASSERTION]: Type.std.Assertion,
        [BinaryCode.STD_TYPE_TASK]: Type.std.Task,
        [BinaryCode.STD_TYPE_ITERATOR]: Type.std.Iterator,
        [BinaryCode.STD_TYPE_ANY]: Type.std.Any,
        [BinaryCode.STD_TYPE_URL]: Type.std.url,
        [BinaryCode.STD_TYPE_TIME]: Type.std.time
    }
}

// add type implementation references
Type.std.Function.addImplementedType(Type.std.ValueConsumer);
Type.std.endpoint.addImplementedType(Type.std.ValueConsumer);
Type.std.Assertion.addImplementedType(Type.std.StreamConsumer);

Type.std.Function.addImplementedType(Type.std.StreamConsumer);
Type.std.Stream.addImplementedType(Type.std.StreamConsumer);


Type.std.Assertion.setJSInterface({
    class: Assertion,
    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(),
})


Type.std.StorageWeakMap.setJSInterface({
    class: StorageWeakMap,
    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(['_type']),
})

Type.std.StorageMap.setJSInterface({
    class: StorageMap,
    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(['_type']),
})

Type.std.StorageWeakSet.setJSInterface({
    class: StorageWeakSet,
    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(['_type']),
})

Type.std.StorageSet.setJSInterface({
    class: StorageSet,
    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(['_type']),
})

// proxify_children leads to problems with native types - use plain objects for pointer propagation + don't propagate proxification
Type.js.NativeObject.proxify_children = false
Type.js.NativeObject.proxify_as_child = false;
Type.std.Object.proxify_children = true
Type.std.Array.proxify_children = true


/**
 * useful global type aliases
 */

export const string = Type.std.text
export const number = Type.std.decimal
export const boolean = Type.std.boolean
export const bigint = Type.std.integer
export const any = Type.std.Any

Object.defineProperty(globalThis, "string", {value: string})
Object.defineProperty(globalThis, "number", {value: number})
Object.defineProperty(globalThis, "boolean", {value: boolean})
Object.defineProperty(globalThis, "bigint", {value: bigint})
Object.defineProperty(globalThis, "any", {value: any})


declare global {
    const string: typeof Type.std.text
    const number: typeof Type.std.decimal
    const boolean: typeof Type.std.boolean
    const bigint: typeof Type.std.integer
    const any: typeof Type.std.Any
}