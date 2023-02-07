// only "interface" for all DATEX objects, has special hidden properties (symbols) and static methods for object extending

import { DX_TYPE, DX_SLOTS, SLOT_WRITE, SLOT_READ, SLOT_EXEC, EXTENDED_OBJECTS, INHERITED_PROPERTIES, SET_PROXY, SHADOW_OBJECT } from "../runtime/constants.ts";
import { ValueError } from "./errors.ts";
import { Tuple } from "./tuple.ts";
import { type_clause } from "./type.ts";
import { target_clause } from "./addressing.ts";


export type CompatObject<T> = Tuple<T>|Record<string|number, T>


// base class for all Datex object based types (Record, custom typed values)
export abstract class DatexObject {

    private [DX_TYPE]: type_clause

    private [EXTENDED_OBJECTS]: Set<Record<string|symbol,unknown>>;
    private [INHERITED_PROPERTIES]: Set<string>;
    private [SET_PROXY]:(k:unknown, v:unknown)=>void
    private [SHADOW_OBJECT]:Record<string|symbol,unknown>;


    // return whether this objects extends an other object (recursive check)
    static extends(object:Record<string|symbol,unknown>,extends_object:Record<string|symbol,unknown>):boolean {
        const extended_objects = <Set<Record<string|symbol,unknown>>>object[EXTENDED_OBJECTS];
        if (!extended_objects) return false; // does not extend any object
        if (extended_objects.has(extends_object)) return true;
        // recursive check all extended objects
        else {
            for (const ext_object of extended_objects) {
                if (ext_object[EXTENDED_OBJECTS] && DatexObject.extends(ext_object, extends_object)) {
                    return true;
                }
            }
            return false;
        }
    }


    // extend any object (only currently available properties are bound to this object, properties that are added later are ignored)
    // if update_back is false, changes on this object do not reflect onto the extended object
    static extend(object:Record<string|symbol,unknown>, extend_object:Record<string|symbol,unknown>, update_back = true):Record<string|symbol,unknown>|void {
        if (typeof extend_object != "object") throw new ValueError("Cannot extend an object with a primitive value");
        if (typeof object != "object" || object == null) throw new ValueError("Not an object or null");

        // add sets
        if (!object[EXTENDED_OBJECTS]) object[EXTENDED_OBJECTS] = new Set();
        if (!object[INHERITED_PROPERTIES]) object[INHERITED_PROPERTIES] = new Set();

        // already extends
        if (DatexObject.extends(object, extend_object)) return;

        // cross referenced extension - not allowed
        if (DatexObject.extends(extend_object, object)) throw new ValueError("Cross-referenced extensions are not allowed");

        // extended object does not change, just copy key-value pairs
        if (Object.isFrozen(extend_object) || !update_back) {
            for (const key of Object.keys(extend_object)) {
                (<Set<string>>object[INHERITED_PROPERTIES]).add(key);
                object[key] = extend_object[key];
            }
        }

        else {
            for (const key of Object.keys(extend_object)) {
                const descriptor = Object.getOwnPropertyDescriptor(object, key);
                if (!descriptor || descriptor.configurable) {
                    Object.defineProperty(object, key, <PropertyDescriptor>{
                        set(v){
                            extend_object[key] = v;
                        },
                        get(){
                            return extend_object[key]
                        },
                        enumerable: true,
                        configurable: true
                    })
                }
                // cannot define new getter/setters!
                else {
                    console.warn("Cannot create new getter/setter for extendable object key: " + key);
                    object[key] = extend_object[key];
                }
                (<Set<string>>object[INHERITED_PROPERTIES]).add(key);
            }
        }

        (<Set<Record<string|symbol,unknown>>>object[EXTENDED_OBJECTS]).add(extend_object);

        return object;
    }

    // always call this method to seal a DatexObject, not Object.seal(...)
    static seal(object:Record<string|symbol,unknown>){
        if (Object.isSealed(object)) return; // already sealed

        // add required symbol properties (SET_PROXY)
        object[SET_PROXY] = undefined;

        // add getter / setter proxies for all properties (not extended properties)
        // required if DatexObject is a pointer
        const shadow_object:Record<string|symbol,unknown> = object[SHADOW_OBJECT] = {};
        for (const key of Object.keys(object)) {
            // only add if not inherited from an extended object
            if (!(<Set<string>>object[INHERITED_PROPERTIES])?.has(key)) {


                // get descriptor containing getter/setter
                const property_descriptor = Object.getOwnPropertyDescriptor(object,key);

                // add original getters/setters to shadow_object if they exist (and call with right 'this' context)
                if (property_descriptor?.set || property_descriptor?.get) {
                    const descriptor:PropertyDescriptor = {};
                    if (property_descriptor.set) descriptor.set = val => property_descriptor.set?.call(object,val);
                    if (property_descriptor.get) descriptor.get = () =>  property_descriptor.get?.call(object)

                    Object.defineProperty(shadow_object, key, descriptor);
                }
                else shadow_object[key] = object[key];

                Object.defineProperty(object, key, <PropertyDescriptor>{
                    set(v){
                        if (object[SET_PROXY]) (<(k:unknown, v:unknown)=>void>object[SET_PROXY])(key, v); // set via proxy
                        else shadow_object[key] = v;
                    },
                    get(){
                        return shadow_object[key]
                    },
                    enumerable: true,
                    configurable: false
                })
            }

        }

        Object.seal(shadow_object);
        Object.seal(object);
        return object;
    }

    static freeze(object:Record<string|symbol,unknown>){
        Object.freeze(object);
        return object;
    }


    // compat methods for object/tuples
    public static entries(value:Record<string|symbol,unknown>) {
        if (value instanceof Tuple) return value.entries();
        else return Object.entries(value)
    }

    public static keys(value:Record<string|symbol,unknown>) {
        if (value instanceof Tuple) return value.keys();
        else return Object.keys(value)
    }

    public static set(parent:Record<string|symbol,unknown>, key:string|number,value:unknown) {
        if (parent instanceof Tuple) return parent.set(key, value);
        else return parent[key] = value;
    }

    public static get(parent:Record<string|symbol,unknown>, key:string|number) {
        if (parent instanceof Tuple) return parent.get(key);
        else return parent[key];
    }

    public static has(parent:Record<string|symbol,unknown>, key:string|number) {
        if (parent instanceof Tuple) return parent.has(key);
        else return (parent && key in parent);
    }

    // DATEX meta data
    public static setType(value:Record<string|symbol,unknown>, type:type_clause) {
        value[DX_TYPE] = type;
    }


    public static setWritePermission(value:Record<string|symbol,unknown>, permission:target_clause|undefined) {
        if (!value[DX_SLOTS]) value[DX_SLOTS] = new Map();
        (<Map<number,target_clause|undefined>>value[DX_SLOTS]).set(SLOT_WRITE, permission);
    }

    public static setReadPermission(value:Record<string|symbol,unknown>, permission:target_clause|undefined) {
        if (!value[DX_SLOTS]) value[DX_SLOTS] = new Map();
        (<Map<number,target_clause|undefined>>value[DX_SLOTS]).set(SLOT_READ, permission);
    }

    public static setExecPermission(value:Record<string|symbol,unknown>, permission:target_clause|undefined) {
        if (!value[DX_SLOTS]) value[DX_SLOTS] = new Map();
        (<Map<number,target_clause|undefined>>value[DX_SLOTS]).set(SLOT_EXEC, permission);
    }

    // get / set methods
    // get<K extends keyof T>(key:K):T[K] {return (<T><unknown>this)[key];}
    // set<K extends keyof T, V extends T[K]>(key:K, value:V) {(<T><unknown>this)[key] = value;}
    // has<K extends keyof T>(key:K) {return this.hasOwnProperty(key);}
}


