// deno-lint-ignore-file no-namespace
import { Endpoint, endpoints, endpoint_name, IdEndpoint, Person, Target, target_clause, LOCAL_ENDPOINT, BROADCAST } from "../types/addressing.ts";
import { NetworkError, PermissionError, PointerError, RuntimeError, ValueError } from "../types/errors.ts";
import { Compiler, PrecompiledDXB } from "../compiler/compiler.ts";
import { DX_PTR, DX_REACTIVE_METHODS, DX_VALUE, INVALID, NOT_EXISTING, SET_PROXY, SHADOW_OBJECT, UNKNOWN_TYPE, VOID } from "./constants.ts";
import { Runtime, UnresolvedValue } from "./runtime.ts";
import { DEFAULT_HIDDEN_OBJECT_PROPERTIES, logger, TypedArray } from "../utils/global_values.ts";
import type { compile_info, datex_scope, Equals, PointerSource } from "../utils/global_types.ts";
import { Type } from "../types/type.ts";
import { BinaryCode } from "../compiler/binary_codes.ts";
import { JSInterface } from "./js_interface.ts";
import { Stream } from "../types/stream.ts";
import { Tuple } from "../types/tuple.ts";
import { primitive } from "../types/abstract_types.ts";
import { Function as DatexFunction } from "../types/function.ts";
import { Quantity } from "../types/quantity.ts";
import { buffer2hex, hex2buffer } from "../utils/utils.ts";
import { Conjunction, Disjunction, Logical } from "../types/logic.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { Scope } from "../types/scope.ts";
import { Time } from "../types/time.ts";
import "../types/native_types.ts"; // getAutoDefault
import { displayFatalError } from "./display.ts";
import { JSTransferableFunction } from "../types/js-function.ts";
import { sha256 } from "../utils/sha256.ts";
import { AutoMap } from "../utils/auto_map.ts";
import { IterableWeakSet } from "../utils/iterable-weak-set.ts";
import { IterableWeakMap } from "../utils/iterable-weak-map.ts";
import { LazyPointer } from "./lazy-pointer.ts";
import { ReactiveArrayMethods } from "../types/reactive-methods/array.ts";

export type observe_handler<K=any, V extends RefLike = any> = (value:V extends RefLike<infer T> ? T : V, key?:K, type?:Ref.UPDATE_TYPE, transform?:boolean, is_child_update?:boolean, previous?: any, atomic_id?:symbol)=>void|boolean
export type observe_options = {types?:Ref.UPDATE_TYPE[], ignore_transforms?:boolean, recursive?:boolean}

const arrayProtoNames = Object.getOwnPropertyNames(Array.prototype);
const objectProtoNames = Object.getOwnPropertyNames(Object.prototype)

/**
 * use as generic type instead of Ref<T> to prevent "excessively deep type instantiation" error
 */
export type RefLike<T = any> = Pointer<T>|PointerProperty<T>
/**
 * Same as RefLike, but returns Pointer<T>&T for primitive pointers
 */
export type RefLikeOut<T = any> = PointerWithPrimitive<T>|PointerProperty<T>

// root class for pointers and pointer properties, value changes can be observed
export abstract class Ref<T = any> extends EventTarget {

    #observerCount = 0;

    #observers?: Map<observe_handler, observe_options|undefined>
    #observers_bound_objects?: Map<object, Map<observe_handler, observe_options|undefined>>

    #val?: T;

    constructor(value?:RefOrValue<T>) {
        super();
        value = Ref.collapseValue(value);
        if (value!=undefined) this.val = value;
    }

    public get val(): T|undefined {
        if (typeof this.#val !== "object" && typeof this.#val !== "function")
            this.handleBeforeNonReferencableGet();
        return this.#val;
    }
    public set val(value: T|undefined) {
        const previous = this.#val;
        this.#val = <T> Ref.collapseValue(value, true, true);
        if (previous !== this.#val) this.triggerValueInitEvent(false, previous)
    }

    /**
     * get the current #val without triggering getters
     * Only use this internally to get the current value,
     * should not be acessed from outside the Ref
     */
    protected get current_val():T|undefined {
        return this.#val;
    }

    // same as val setter, but can be awaited
    public setVal(value:T, trigger_observers = true, is_transform?:boolean):Promise<any>|void {
        const previous = this.#val;
        this.#val = <T> Ref.collapseValue(value, true, true);
        if (trigger_observers && previous !== this.#val) return this.triggerValueInitEvent(is_transform, previous)
    }
    
    protected triggerValueInitEvent(is_transform = false, previous?:any){
        const value = this.current_val;
        const promises = [];
        for (const [o, options] of this.#observers??[]) {
            if ((!options?.types || options.types.includes(Ref.UPDATE_TYPE.INIT)) && !(is_transform && options?.ignore_transforms)) promises.push(o(value, VOID, Ref.UPDATE_TYPE.INIT, is_transform, undefined, previous));
        }
        for (const [object, observers] of this.#observers_bound_objects??[]) {
            for (const [o, options] of observers??[]) {
                if ((!options?.types || options.types.includes(Ref.UPDATE_TYPE.INIT)) && !(is_transform && options?.ignore_transforms)) promises.push(o.call(object, value, VOID, Ref.UPDATE_TYPE.INIT, is_transform, undefined, previous));
            }
        }
        return Promise.allSettled(promises);
    }

    /**
     * $ shortcut to create transforms for properties (also for primitive values in JS context for now (e.g. toString) - but no DATEX compatibility)
     */
    public get $(): Proxy$<T> {
        return this.handle$(false, true, true); // direct pointer or ->
    }
    public get $$(): Proxy$<T> {
        return this.handle$(true, false, true); // ->
    }

    private handle$(force_pointer_properties=true, setter=true, transform_functions=true): Proxy$<T> {
        const handler:ProxyHandler<any> = {};

        // deno-lint-ignore no-this-alias
        let pointer:Pointer = this;

        // double pointer property..TODO: improve, currently tries to collapse current value
        if (pointer instanceof PointerProperty) {
            pointer = <Pointer>Pointer.getByValue(pointer.val);
            if (!pointer) throw new Error("Nested pointer properties are currently not supported");
        }

        handler.ownKeys = () => {
            return Reflect.ownKeys(pointer.val);
        }
        handler.getOwnPropertyDescriptor = (_target: T, p: string | symbol) => {
            return Reflect.getOwnPropertyDescriptor(pointer.val, p);
        }

        const type = Type.ofValue(pointer.val);
        
        // add DX_REACTIVE_METHODS for array
        if (pointer.val instanceof Array && !(pointer.val as any)[DX_REACTIVE_METHODS]) {
            (pointer.val as any)[DX_REACTIVE_METHODS] = new ReactiveArrayMethods(pointer);
        }
        // add custom DX_REACTIVE_METHODS
        else if (type.interface_config?.get_reactive_methods_object) {
            (pointer.val as any)[DX_REACTIVE_METHODS] = type.interface_config.get_reactive_methods_object(pointer.val);
        }

        handler.get = (_, key) => {
            // array iterator
            if (key === Symbol.iterator) {
                // array
                if (pointer.val instanceof Array) return function* () {
                    for (const key of Object.keys(pointer.val)) yield handler.get!(pointer.val, key, undefined);
                }
                // map
                else if (pointer.val instanceof Map) return function* () {
                    for (const key of pointer.val.keys()) yield [key, handler.get!(pointer.val, key, undefined)];
                }
                else throw new Error("Cannot iterate over pointer properties");
            }

            if (typeof key == "symbol") return pointer.val?.[key];

            // special $ methods
            const reactiveMethods = pointer.val?.[DX_REACTIVE_METHODS];
            if (reactiveMethods && key in reactiveMethods) return reactiveMethods[key];

            if (force_pointer_properties) return PointerProperty.get(pointer, <keyof typeof pointer>key, true);
            else {
                if (!(pointer.val instanceof Array) && ![...pointer.getKeys()].includes(key)) {
                    throw new ValueError("Property "+key.toString()+" does not exist in value");
                }
                if (pointer instanceof Pointer && Pointer.pointerifyValue(pointer.shadow_object?.[key]) instanceof Ref) return Pointer.pointerifyValue(pointer.shadow_object?.[key]);
                else return PointerProperty.get(pointer, <keyof typeof pointer>key, true);
            } 
        }

        const useFunction = transform_functions && typeof this.val == "function";
        // handle function as transform
        if (useFunction) {
            handler.apply = (_target, thisRef, args) => {
                const thisVal = Ref.collapseValue(thisRef, true, true);
                if (typeof thisVal != "function") throw new Error("Cannot create a reference transform, not a function"); 
    
                if (thisRef instanceof PointerProperty) {
                    return Ref.collapseValue(Pointer.createTransform([thisRef.pointer], ()=>{
                        return thisVal(...args);
                    }));
                }
                // currently for non-datex functions, function context is only available via PointerProperty
                else throw new Error("Cannot create a reference transform, missing context for function"); 
            }
        }

        if (setter && pointer instanceof Pointer) {
            handler.set = (_target: unknown, p: string, value: unknown) => {
                (<Pointer<T>>pointer).handleSetReference(p, value);
                return true;
            }
        }
        else handler.set = () => {
            return false;
        }
        
        return <Proxy$<T>> new Proxy(this.val!, handler);
    }


    /**
     * returns a value that can be referenced in JS
     */
    get js_value():CollapsedValueJSCompatible<T> {
        return <any>this;
    }
   
    // call handler when value changes
    // unobserve if handler returns false
    public static observe<V=unknown, K=unknown>(value: V, handler:observe_handler<K, V>, bound_object?:object, key?:K, options?:observe_options):void {
        const pointer = Pointer.pointerifyValue(value);
        if (pointer instanceof Pointer) pointer.observe(handler, bound_object, key, options);
        else if (pointer instanceof Ref) pointer.observe(<observe_handler>handler, bound_object, options);
        else throw new ValueError("Cannot observe this value because it has no pointer")
    }


    // same as observe, but also accepts non-reference values
    // always calls the handler once directly (init)
    public static observeAndInit<V=unknown, K=unknown>(value: V, handler:observe_handler<K, V>, bound_object?:object, key?:K, options?:observe_options):void {
        try {
            this.observe(value, handler, bound_object, key, options);
        } catch {} // throws if value does not have a DATEX reference, can be ignored - in this case no observer is set, only the initial handler call is triggered
        const val = this.collapseValue(value, true, true);
        if (handler.call) handler.call(bound_object, val, undefined, Ref.UPDATE_TYPE.INIT);
        else handler(val, undefined, Ref.UPDATE_TYPE.INIT);
    }

    // call handler when value changes
    public static unobserve<V=unknown, K=unknown>(value: V, handler:observe_handler<K, V>, bound_object?:object, key?:K):void {
        const pointer = Pointer.pointerifyValue(value);
        if (pointer instanceof Pointer) pointer.unobserve(handler, bound_object, key);
        else if (pointer instanceof Ref) pointer.unobserve(<observe_handler>handler, <object>bound_object);
        else throw new ValueError("Cannot unobserve this value because it has no pointer")
    }

   

    // callback on property value change
    // general handler structure is: (value:any, key?:any, type?:T)=>void 
    // when a specific property is updated, the key is set, and value is the property value
    // when the value itself is changed, the new value is available in 'value' and the key is void
    public observe(handler: observe_handler, bound_object?:object, options?:observe_options) {
        if (!handler) throw new ValueError("Missing observer handler")

        // bind object to observer
        if (bound_object) {
            if (!this.#observers_bound_objects) this.#observers_bound_objects = new Map();
            if (!this.#observers_bound_objects.has(bound_object)) this.#observers_bound_objects.set(bound_object, new Map());
            this.#observers_bound_objects.get(bound_object)!.set(handler, options)
        }

        // normal observer
        else {
            if (!this.#observers) this.#observers = new Map();
            this.#observers.set(handler, options);
        }
        this.updateObserverCount(+1);
    }

    // stop observation
    public unobserve(handler:observe_handler): void
    // remove this observer for bound_object
    public unobserve(handler:observe_handler, bound_object?:object): void
    // remove all observers for bound_object
    public unobserve(bound_object:object): void

    public unobserve(handler_or_bound_object:observe_handler|object, bound_object?:object) {

        let wasRemoved = false;

        let handler: observe_handler|undefined
        if (handler_or_bound_object instanceof globalThis.Function) handler = handler_or_bound_object;
        else bound_object = handler_or_bound_object;

        if (bound_object) {
            if (handler) {
                if (this.#observers_bound_objects) {
                    wasRemoved = !!this.#observers_bound_objects.get(bound_object)?.delete(handler)
                    if (this.#observers_bound_objects.get(bound_object)?.size === 0) this.#observers_bound_objects.delete(bound_object)
                }
            }
            else {
                wasRemoved = !!this.#observers_bound_objects?.delete(bound_object);
            }
        }
        else {
            wasRemoved = !!this.#observers?.delete(handler!);
        }
        if (wasRemoved) this.updateObserverCount(-1);
        return wasRemoved;
    }

    toString(){
        return this.val?.toString() ?? '';
    }

    toJSON(){
        return this.val;
    }

    valueOf(){
        return this.val;
    }

    // utility functions

    static collapseValue<V extends RefOrValue<unknown>, P1 extends boolean|undefined = false, P2 extends boolean|undefined = false>(value:V, collapse_pointer_properties?:P1, collapse_primitive_pointers?:P2): CollapsedValueAdvanced<V, P1, P2> {
        // don't collapse js primitive pointers per default
        if (collapse_primitive_pointers == undefined) collapse_primitive_pointers = <P2>false;
        if (collapse_pointer_properties == undefined) collapse_pointer_properties = <P1>false;

        if (value instanceof Ref && (collapse_primitive_pointers || !(value instanceof Pointer && value.is_js_primitive)) && (collapse_pointer_properties || !(value instanceof PointerProperty))) {
            return value.val
        }
        else return <CollapsedValueAdvanced<V, P1, P2>> value;
    }

    // // create a new DatexValue from a DatexCompatValue that is updated based on a transform function
    // static transform<OUT, V = any>(value:RefOrValue<V>, transform:(v:V)=>RefOrValue<OUT>):Ref<OUT> {
    //     const initialValue = transform(Ref.collapseValue(value, true, true)); // transform current value
    //     if (initialValue === VOID) throw new ValueError("initial tranform value cannot be void");
    //     const dx_value = Pointer.create(undefined, initialValue);
    //     if (value instanceof Ref) value.observe(()=>{
    //         const newValue = transform(value.value);
    //         if (newValue !== VOID) dx_value.value = newValue;
    //     }); // transform updates
    //     return dx_value;
    // }
    // static transformMultiple<OUT>(values:RefOrValue<any>[], transform:(...values:RefOrValue<any>[])=>RefOrValue<OUT>):Ref<OUT> {
    //     const initialValue = transform(...values.map(v=>Ref.collapseValue(v, true, true))); // transform current value
    //     if (initialValue === VOID) throw new ValueError("initial tranform value cannot be void");
    //     const dx_value = Pointer.create(undefined, initialValue);
    //     for (let value of values) {
    //         if (value instanceof Ref) value.observe(()=>{
    //             const newValue = transform(...values.map(v=>Ref.collapseValue(v, true, true)));
    //             if (newValue !== VOID) dx_value.value = newValue;
    //         }) // transform updates
    //     }
    //     return dx_value;
    // }

    /**
     * Returns true if the value has a bound pointer or is a Datex.Ref
     */
    public static isRef(value: unknown) {
        return (value instanceof Ref || Pointer.pointer_value_map.has(value));
    }

    // copy the value of a primitive datex value to another primitive value
    static mirror<T extends primitive>(from:RefLike<T>, to:RefLike<T>) {
        from.observe((v,k,p)=> to.val = v);
    }



    protected static capturedGetters? = new Set<Ref>()
    protected static capturedGettersWithKeys? = new Map<Pointer, Set<any>>().setAutoDefault(Set)

    /**
     * true if currently capturing pointer getters in always function
     */
    public static isCapturing = false;
    public static freezeCapturing = false;

    /**
     * Used for handling smart transforms
     * captureGetters must be called before transform, getCaptuedGetters after to
     * get a list of all dependencies
     */
    protected static captureGetters() {
        this.isCapturing = true;
        this.freezeCapturing = false;
        this.capturedGetters = new Set()
        this.capturedGettersWithKeys = new Map().setAutoDefault(Set)
    }

    protected static getCapturedGetters() {
        const captured = {capturedGetters: this.capturedGetters, capturedGettersWithKeys:this.capturedGettersWithKeys};
        this.capturedGetters = undefined;
        this.capturedGettersWithKeys = undefined;
        this.isCapturing = false;
        return captured;
    }

    /**
     * Prevents any values accessed within the callback function from
     * being captured by a transform function (e.g. always)
     */
    public static disableCapturing<T>(callback:()=>T): T {
        this.freezeCapturing = true;
        const res = callback();
        this.freezeCapturing = false;
        return res;
    }

    /**
     * must be called each time before the current collapsed value of the Ref is requested
     * to keep track of dependencies and update transform
     * Examples:
     *  * raw values of a primitive pointer 
     *  * any raw property of a pointer (not a PointerProperty ref)
     *  * toString() for any value
     */
    handleBeforeNonReferencableGet(key:any = NOT_EXISTING) {
        if (Ref.freezeCapturing) return;

        // remember previous capture state
        const previousGetters = Ref.capturedGetters;
        const previousGettersWithKeys = Ref.capturedGettersWithKeys;
        const previousCapturing = Ref.isCapturing;

        // trigger transform update if not live
        if (this.#transformSource && !this.#liveTransform && !this.#forceLiveTransform) {
            Ref.capturedGetters = new Set();
            Ref.capturedGettersWithKeys = new Map().setAutoDefault(Set);
            this.#transformSource.update();
        }
        if (previousCapturing) {
            Ref.isCapturing = true;
            Ref.capturedGetters = previousGetters ?? new Set();
            Ref.capturedGettersWithKeys = previousGettersWithKeys ?? new Map().setAutoDefault(Set);

            if (key === NOT_EXISTING) Ref.capturedGetters.add(this);
            else if (this instanceof Pointer) Ref.capturedGettersWithKeys.getAuto(this).add(key)
            else {
                logger.warn("invalid capture, must be a pointer or property")
            }
        }
    }

    #liveTransform = false;
    #forceLiveTransform = false;
    #transformSource?: TransformSource

    protected set _liveTransform(val: boolean) {
        this.#liveTransform = val;
    }

    /**
     * add a new transform source
     */
    protected setTransformSource(transformSource: TransformSource) {
        if (this.#transformSource) throw new Error("Ref already has a transform source");
        this.#transformSource = transformSource;
        // initial value init
        transformSource.update();
    }
    
    protected deleteTransformSource() {
        this.#transformSource = undefined;
    }

    /**
     * if there are no observers for this value and a live transform exists,
     * the live mode is disabled, otherwise it is enabled
     */
    protected updateObserverCount(add:number) {
        this.#observerCount += add;

        if (this.#transformSource) {
            if (this.#forceLiveTransform) return; // keep enabled
            if (this.#observerCount == 0 && this.#liveTransform) this.disableLiveTransforms(); 
            else if (this.#observerCount && !this.#liveTransform) this.enableLiveTransforms();
        }
    }

    /**
     * only used for garbage collection
     * @param count
     */
    protected forceSetObserverCount(count: number) {
        this.#observerCount = count;
    }

    /**
     * Should be called when live transforms are needed,
     * i.e. when oberservers for this value are active
     */
    protected enableLiveTransforms(triggerUpdate = true) {
        if (this.#forceLiveTransform) return;
        this.#liveTransform = true;
        this.#transformSource!.enableLive(triggerUpdate);
    }

    /**
     * Should be called when live transforms are not needed,
     * i.e. when there are no observers for this value
     */
    protected disableLiveTransforms() {
        if (this.#forceLiveTransform) return;
        this.#liveTransform = false;
        this.#transformSource!.disableLive();
    }

    protected setForcedLiveTransform(forced: boolean, update = true) {
        if (!this.#transformSource) return; // not relevant, no transform source
        // console.log("forced live:",forced)
        this.#forceLiveTransform = forced;
        // always enable if forced
        if (forced) this.#transformSource.enableLive(update);
        // disable if no observers left
        else if (!this.#observerCount) this.disableLiveTransforms();
    }

}


/**
 * @deprecated use Datex.Ref instead
 */
export const Value = Ref;
/**
 * @deprecated use Datex.RefLike instead
 */
export type Value<T = unknown> = RefLike<T>;


export type TransformSource = {
    /**
     * called to indicate that the the .val should now always be
     * automatically updated when dependencies change
     */
    enableLive: (update?: boolean)=>void
    /**
     * called to indicate that the transformed value should now
     * only be calculated when update() is called
     */
    disableLive: ()=>void
    /**
     * called to update the transformed value
     */
    update: ()=>void
}

export type PointerPropertyParent<K,V> = Map<K,V> | Record<K & (string|symbol),V>;
export type InferredPointerProperty<Parent, Key> = PointerProperty<Parent extends Map<unknown, infer MV> ? MV : Parent[Key&keyof Parent]>

// interface to access (read/write) pointer value properties
export class PointerProperty<T=any> extends Ref<T> {

    #leak_js_properties: boolean

    private constructor(public pointer: Pointer, public key: any, leak_js_properties = false) {
        super();
        this.#leak_js_properties = leak_js_properties;
        pointer.is_persistent = true; // TODO: make unpersistent when pointer property deleted
        PointerProperty.synced_pairs.get(pointer)!.set(key, this); // save in map
    }

    private static synced_pairs = new WeakMap<Pointer, Map<any, PointerProperty>>()

    // TODO: use InferredPointerProperty (does not collapse)
    /**
     * Returns a new Pointer property from a parent object/map and property key
     * @param parent 
     * @param key 
     * @param leak_js_properties 
     * @returns 
     */
    public static get<const Key, Parent extends PointerPropertyParent<Key,unknown>>(parent: Parent|Pointer<Parent>, key: Key, leak_js_properties = false): PointerProperty<Parent extends Map<unknown, infer MV> ? MV : Parent[Key&keyof Parent]> {
        
        if (Pointer.isRef(key)) throw new Error("Cannot use a reference as a pointer property key");
        
        let pointer:Pointer;
        if (parent instanceof Pointer) pointer = parent;
        else pointer = Pointer.createOrGet(parent);

        if (!this.synced_pairs.has(pointer)) this.synced_pairs.set(pointer, new Map());

        if (this.synced_pairs.get(pointer)!.has(key)) return this.synced_pairs.get(pointer)!.get(key)!;
        else return new PointerProperty(pointer, key, leak_js_properties);
    }

    // get current pointer property
    public override get val():T {
        // this.handleBeforePrimitiveValueGet();
        return this.pointer.getProperty(this.key, this.#leak_js_properties);
    }

    public override get current_val():T {
        return this.pointer.getProperty(this.key, this.#leak_js_properties);
    }

    // update pointer property
    public override set val(value: T) {
        this.pointer.handleSet(this.key, Ref.collapseValue(value, true, true));
    }
    // same as val setter, but can be awaited
    public override setVal(value: T) {
        return this.pointer.handleSet(this.key, Ref.collapseValue(value, true, true));
    }

    #observer_internal_handlers = new WeakMap<observe_handler, observe_handler>()
    #observer_internal_bound_handlers = new WeakMap<object, WeakMap<observe_handler, observe_handler>>()

    // callback on property value change and when the property value changes internally
    public override observe(handler: observe_handler, bound_object?:Record<string, unknown>, options?:observe_options) {
        const value_pointer = Pointer.pointerifyValue(this.current_val);
        if (value_pointer instanceof Ref) value_pointer.observe(handler, bound_object, options); // also observe internal value changes

        const internal_handler = (v:unknown)=>{
            const value_pointer = Pointer.pointerifyValue(v);
            if (value_pointer instanceof Ref) value_pointer.observe(handler, bound_object, options); // also update observe for internal value changes
            if (handler.call) handler.call(bound_object, v,undefined,Ref.UPDATE_TYPE.INIT)
            // if arrow function
            else handler(v,undefined,Ref.UPDATE_TYPE.INIT)
        };
        this.pointer.observe(internal_handler, bound_object, this.key, options)

        if (bound_object) {
            if (!this.#observer_internal_bound_handlers.has(bound_object)) this.#observer_internal_bound_handlers.set(bound_object, new WeakMap);
            this.#observer_internal_bound_handlers.get(bound_object)!.set(handler, internal_handler)
        }
        else this.#observer_internal_handlers.set(handler, internal_handler)
    }

    public override unobserve(handler: observe_handler, bound_object?:object) {
        const value_pointer = Pointer.pointerifyValue(this.current_val);
        if (value_pointer instanceof Ref) value_pointer.unobserve(handler, bound_object); // also unobserve internal value changes

        let internal_handler:observe_handler|undefined

        if (bound_object) {
            internal_handler = this.#observer_internal_bound_handlers.get(bound_object)?.get(handler);
            this.#observer_internal_bound_handlers.get(bound_object)?.delete(handler);
        }
        else {
            internal_handler = this.#observer_internal_handlers.get(handler);
            this.#observer_internal_handlers.delete(handler);
        }

        if (internal_handler) this.pointer.unobserve(internal_handler, bound_object, this.key); // get associated internal handler and unobserve
    }

}

export type JSPrimitiveToDatexRef<T> = (
    T extends bigint ? IntegerRef :
    T extends string ? TextRef :
    T extends number ? DecimalRef :
    T extends boolean ? BooleanRef :
    T extends Type ? TypeRef :
    T extends Endpoint ? EndpointRef :
    T extends URL ? URLRef :
    never
)

// similar to Datex.Ref, but works better for all descending generic classes in typescript strict mode
export type GenericValue<T> = 
    // specific type class
    JSPrimitiveToDatexRef<T> |
    // generic classes
    RefLike<T>;

export type ReadonlyRef<T> = Readonly<RefLike<T>>;
/**
 * @deprecated Use Datex.RefOrValue instead
 */
export type CompatValue<T> = RefLike<T|undefined>|T;
export type RefOrValue<T> = RefLike<T>|T; // TODO: remove RefLike<T|undefined>, only workaround
/**
 * object with refs or values as properties
 */
export type RefOrValueObject<T> = { [P in keyof T]: RefOrValue<T[P]> }
/**
 * object with refs or values as properties, all optional
 */
export type PartialRefOrValueObject<T> = { [P in keyof T]?: RefOrValue<T[P]> }


// collapsed value
export type CollapsedValue<T extends RefOrValue<unknown>> =
    // (reverse order of inheritance)
    // DATEX Primitives: ---------------------
    T extends IntegerRef ? bigint : 
    T extends TextRef ? string : 
    T extends DecimalRef ? number : 
    T extends BooleanRef ? boolean : 
    T extends TypeRef ? Type : 
    T extends EndpointRef ? Endpoint : 
    T extends URLRef ? URL : 
    // generic value classes 
    T extends PointerProperty<infer TT> ? TT : 
    T extends Pointer<infer TT> ? TT : 
    T extends Ref<infer TT> ? TT : 
    T;

// collapsed value that still has a reference in JS
export type CollapsedValueJSCompatible<T extends RefOrValue<unknown>> = 
    // (reverse order of inheritance)
    // DATEX primitive that keep reference in JS: ---------------------
    T extends TypeRef ? Type : 
    T extends EndpointRef ? Endpoint : 
    T extends URLRef ? URL : 
    // generic value classes
    T extends PointerProperty<infer TT> ? (TT extends primitive ? T : TT) :
    T extends Pointer<infer TT> ? (TT extends primitive ? T : TT) : 
    T extends Ref<infer TT> ? (TT extends primitive ? T : TT) : 
    T;

// number -> Number, ..., get prototype methods
export type PrimitiveToClass<T> = 
    // deno-lint-ignore ban-types
    T extends number ? Number :
    // deno-lint-ignore ban-types
    T extends string ? String :
    // deno-lint-ignore ban-types
    T extends boolean ? Boolean :
    T extends bigint ? BigInt :
    T;


type _Proxy$Function<T> = (T extends (...args: any) => any ? ((...args: Parameters<T>)=>Pointer<ReturnType<T>>) : unknown) // map all function properties to special transform functions that return a reference

type _Proxy$<T>         = _Proxy$Function<T> &
    T extends Array<infer V> ? 
    // array
    {
        [key: number]: RefLikeOut<V>, 
        map<U>(callbackfn: (value: MaybeObjectRef<V>, index: number, array: V[]) => U, thisArg?: any): Pointer<U[]>
    }
    : 
    (
        T extends Map<infer K, infer V> ? 
        {
            get(key: K): RefLikeOut<V>
        }

         // normal object
        : {readonly [K in keyof T]: RefLikeOut<T[K]>} // always map properties to pointer property references
    )
   
type _PropertyProxy$<T> = _Proxy$Function<T> & 
    T extends Array<infer V> ? 
    // array
    {
        [key: number]: PointerProperty<V>, 
        map<U>(callbackfn: (value: MaybeObjectRef<V>, index: number, array: V[]) => U, thisArg?: any): Pointer<U[]>
    } 
    : 
    (
        T extends Map<infer K, infer V> ? 
        {
            get(key: K): PointerProperty<V>
        }
        // normal object
        : {readonly [K in keyof T]: PointerProperty<T[K]>} // always map properties to pointer property references
    )
export type Proxy$<T> = _Proxy$<PrimitiveToClass<T>>
export type PropertyProxy$<T> = _PropertyProxy$<PrimitiveToClass<T>>

export type ObjectRef<T> =
    T
    // TODO:
    // {[K in keyof T]: MaybeObjectRef<T[K]>}
    & 
    {
        $:Proxy$<T> // reference to value (might generate pointer property, if no underlying pointer reference)
        $$:PropertyProxy$<T> // always returns a pointer property reference
    };

export type MaybeObjectRef<T> = T extends primitive|Function ? T : ObjectRef<T>

/**
 * @deprecated use ObjectRef
 */
export type JSValueWith$<T> = ObjectRef<T>;

// TODO: does this make sense? (probably requires proxy for all pointer objects)
// export type JSValueWith$<T> = T & 
//     {[P in keyof T & string as `$${P}`]: Ref<T[P]>} & 
//     {[P in keyof T & string as `$prop_${P}`]: PointerProperty<T[P]>}

// converts Object to Record<string|symbol, unknown>

// convert from any JS/DATEX value to minimal representation with reference
export type MinimalJSRefGeneralTypes<T, _C = CollapsedValue<T>> = 
    _C extends symbol ? symbol : (
        JSPrimitiveToDatexRef<_C> extends never ? ObjectRef<_C> : JSPrimitiveToDatexRef<_C>
    )
// same as MinimalJSRefGeneralTypes, but returns Pointer<2|5> instead of IntegerRef
export type MinimalJSRef<T, _C = CollapsedValue<T>> =
    _C extends symbol ? symbol : ( 
        JSPrimitiveToDatexRef<_C> extends never ? ObjectRef<_C> : (Pointer<_C> & (_C extends boolean ? unknown : _C))
    )

// return Pointer<T>&T for primitives (excluding boolean) and Pointer<T> otherwise
export type PointerWithPrimitive<T> = T extends number|string|boolean|bigint ? Pointer<T>&T : Pointer<T>

export type CollapsedValueAdvanced<T extends RefOrValue<unknown>, COLLAPSE_POINTER_PROPERTY extends boolean|undefined = true, COLLAPSE_PRIMITIVE_POINTER extends boolean|undefined = true, _C = CollapsedValue<T>> = 
    // if
    _C extends primitive ?
        (COLLAPSE_PRIMITIVE_POINTER extends true ? _C : T) : // primitive either collapsed or Pointer returned
    // else
        // if
        T extends PointerProperty ?
            (COLLAPSE_POINTER_PROPERTY extends true ? _C : T) : // PointerProperty either collapsed or PointerProperty returned
        // else
            ObjectRef<_C>  // otherwise pointer is always collapsed


// convert value to DATEX reference value
export type ProxifiedValue<T extends RefOrValue<unknown>> = 
    // already a proxified value
    T extends PointerProperty ? T :
    T extends Pointer? T :
    T extends Ref ? T :
    // proxify
    RefLike<T>

// export type ObjectWithDatexValues<T> = {[K in keyof T]: T[K] extends RefOrValue<infer TT> ? (Ref<TT>&TT) : (Ref<T[K]>&T[K])}; // proxy object generated by props() function
//export type ObjectWithDatexValues<T> = {[K in keyof T]: T[K] extends RefOrValue<infer TT> ? (TT extends primitive ? Ref<TT> : TT) : (T[K] extends primitive ? Ref<T[K]> : T[K])}; // proxy object generated by props() function
export type ObjectWithDatexValues<T> = {[K in keyof T]: ProxifiedValue<T[K]>}; // proxy object generated by props() function
export type CollapsedDatexObject<T> = {[K in keyof T]?: CollapsedValue<T[K]>}; // datex value properties are collapsed
export type CollapsedDatexObjectWithRequiredProperties<T> = {[K in keyof T]: CollapsedValue<T[K]>}; // datex value properties are collapsed
export type CollapsedDatexArray<T extends Record<number,unknown>> = CollapsedDatexObjectWithRequiredProperties<T>; // proxy array generated by props() function

type RefOrValueUnion<U> = (U extends any ? RefOrValue<U> : never)

export type DatexObjectInit<T> = {[K in keyof T]: (T[K] extends boolean ? RefOrValue<T[K]> : RefOrValueUnion<T[K]>) | (T[K] extends undefined ? undefined : never)}; // object that also accepts Datex Pointers etc. as properties, only for initializing
export type DatexObjectPartialInit<T> = {[K in keyof T]?: (T[K] extends boolean ? RefOrValue<T[K]> : RefOrValueUnion<T[K]>)}; // object that also accepts Datex Pointers etc. as properties, only for initializing

// make sure a type union has the same be type (e.g. union of strings, ...)
// returns the input T if valid, otherwise 'never'
type NotTheSameReturnType = never;

export type RestrictSameType<T extends RefOrValue<unknown>, _C = CollapsedValue<T>> =
    // make sure if primitive, it's only one primitive type
    _C extends string ? (Exclude<_C,string> extends never ? T : NotTheSameReturnType) :
    _C extends number ? (Exclude<_C,number> extends never ? T : NotTheSameReturnType) :
    _C extends bigint ? (Exclude<_C,bigint> extends never ? T : NotTheSameReturnType) :
    _C extends boolean ? (Exclude<_C,boolean> extends never ? T : NotTheSameReturnType) :
    _C extends null ? (Exclude<_C,null> extends never ? T : NotTheSameReturnType) :
    _C extends undefined ? (Exclude<_C,undefined> extends never ? T : NotTheSameReturnType) :
    T

// transform functions
export type TransformFunctionInputs = readonly any[];
export type TransformFunction<Values extends TransformFunctionInputs, ReturnType> = (...values:CollapsedDatexArray<Values>)=>RestrictSameType<RefOrValue<ReturnType>>;
export type AsyncTransformFunction<Values extends TransformFunctionInputs, ReturnType> = (...values:CollapsedDatexArray<Values>)=>Promise<RestrictSameType<RefOrValue<ReturnType>>>|RestrictSameType<RefOrValue<ReturnType>>;
export type SmartTransformFunction<ReturnType> = ()=>Awaited<RestrictSameType<RefOrValue<ReturnType>>>;


// send datex updates from pointers only at specific times / intervals
// either create new DatexUpdateScheduler(update_interval) or manually call trigger() to trigger an update for all pointers
export class UpdateScheduler {

    updates_per_receiver: Map<target_clause, Map<Pointer, Map<string|symbol,[string|PrecompiledDXB, any[],boolean]>>> = new Map();
    update_interval?: number;
    active = false;
    #interval?:number

    datex_timeout?:number

    constructor(update_interval?:number){
        this.update_interval = update_interval;
        this.start();
    }

    private setUpdateInterval(){
        if (this.update_interval != null) {
            this.#interval = setInterval(()=>{
                this.trigger()
            }, this.update_interval)
        }
    }
    private clearUpdateInterval(){
        if (this.update_interval != null) clearInterval(this.#interval);
    }

    // start all update triggers
    start(){
        this.active = true;
        this.setUpdateInterval(); // set interval if update_interval defined
    }

    // stop all update triggers
    stop(){
        this.active = false;
        this.clearUpdateInterval();
    }

    // trigger an update
    trigger(){
        if (!this.active) return;
         for (const [receiver, map] of this.updates_per_receiver) {
            const data = [];
            let datex:string|PrecompiledDXB = ''
            const pdxb_array = []; // precompiled datex
            let is_datex_strings = true;

            for (const [ptr, entries] of map) {
                if (!entries.size) continue;

                for (const [entry_datex, entry_data] of entries.values()) {
                    // first entry decides if PrecompiledDXB or string
                    if (is_datex_strings && entry_datex instanceof PrecompiledDXB) is_datex_strings = false;

                    // join dx strings
                    if (typeof entry_datex == "string") {
                        datex+=entry_datex+';';
                    }
                    // join multiple PrecompiledDXB
                    else if (entry_datex instanceof PrecompiledDXB) {
                        pdxb_array.push(entry_datex);
                    }
                    data.push(...entry_data);
                }
                entries.clear();
            }

            // empty string?
            if (is_datex_strings && !datex) continue;
            // empty precompiled?, else generate
            else if (!is_datex_strings) {
                if (pdxb_array.length==0) continue;
                if (pdxb_array.length==0) datex = pdxb_array[0]; // single PrecompiledDXB, just use it
                else datex = PrecompiledDXB.combine(...pdxb_array); // combine multiple
            }

            (async ()=>{
                if (receiver instanceof Disjunction && !receiver.size) return;
                try {
                    await Runtime.datexOut([datex, data, {end_of_scope:false, type:ProtocolDataType.UPDATE}], receiver, undefined, false, undefined, undefined, false, undefined, this.datex_timeout);
                } catch(e) {
                    logger.error("forwarding failed", e)
                }
            })()
            
        }

    }

    intermediate_updates_pointers = new Set<Pointer>();

    // add a pointer for scheduling
    // if skip_intermediate_updates = true, intermediate update are not guaranteed to be transmitted
    addPointer(ptr: Pointer|any, intermediate_updates = false) {
        if (!(ptr instanceof Pointer)) ptr = Pointer.pointerifyValue(ptr);
        if (!(ptr instanceof Pointer)) throw new RuntimeError("value is not a pointer");
        if (intermediate_updates) this.intermediate_updates_pointers.add(ptr);
        ptr.setScheduler(this);
        // use timeout from last pointer
        this.datex_timeout = ptr.datex_timeout;
    }

    // remove pointer from scheduling
    removePointer(ptr: Pointer|any) {
        if (!(ptr instanceof Pointer)) ptr = Pointer.pointerifyValue(ptr);
        if (!(ptr instanceof Pointer)) throw new RuntimeError("value is not a pointer");
        ptr.deleteScheduler();
    }


    /** for the pointers */
    /** important: datex for one pointer either all PrecompiledDXB or all string */
    addUpdate(pointer:Pointer, identifier:string, datex:string|PrecompiledDXB, data:any[], receiver:target_clause, collapse_first_inserted = false) {
        if (!this.updates_per_receiver.has(receiver)) this.updates_per_receiver.set(receiver, new Map());
        const ptr_map = this.updates_per_receiver.get(receiver)!;
        if (!ptr_map.has(pointer)) ptr_map.set(pointer, new Map())
        ptr_map.get(pointer)!.set((!this.intermediate_updates_pointers.has(pointer) && identifier) ? identifier : Symbol(), [datex, data, collapse_first_inserted]);
    }
}

export type pointer_type = number;

// mock pointer used for garbage collection
type MockPointer = {id: string, origin: Endpoint, subscribed?: Endpoint|false, is_origin: boolean} 

export type SmartTransformOptions = {
	cache?: boolean
}

const observableArrayMethods = new Set<string>([
    "entries",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "flat",
    "flatMap",
    "forEach",
    "includes",
    "indexOf",
    "join",
    "keys",
    "lastIndexOf",
    "map",
    "reduce",
    "reduceRight",
    "slice",
    "some",
    "toReversed",
    "toSorted",
    "toSpliced",
    "values",
    "with"
])

/** Wrapper class for all pointer values ($xxxxxxxx) */
export class Pointer<T = any> extends Ref<T> {

    /** STATIC */

    /** Pointer observers */
    private static pointer_add_listeners = new Set<(p:Pointer)=>void>();
    private static pointer_remove_listeners = new Set<(p:Pointer)=>void>();
    private static pointer_property_add_listeners = new Set<(p:Pointer, key:any, value:any)=>void>();
    private static pointer_property_change_listeners = new Set<(p:Pointer, key:any, value:any)=>void>();
    private static pointer_property_delete_listeners = new Set<(p:Pointer, key:any)=>void>();
    private static pointer_value_change_listeners =new Set<(p:Pointer)=>void>();
    private static pointer_for_value_created_listeners = new WeakMap<any, (Set<((p:Pointer)=>void)>)>();
    private static pointer_for_id_created_listeners = new Map<string, (Set<((p:Pointer)=>void)>)>();

    public static onPointerAdded(listener: (p:Pointer)=>void) {
        this.pointer_add_listeners.add(listener);
    }
    public static onPointerRemoved(listener: (p:Pointer)=>void) {
        this.pointer_remove_listeners.add(listener);
    }
    public static onPointerPropertyAdded(listener: (p:Pointer, key:any, value:any)=>void) {
        this.pointer_property_add_listeners.add(listener);
    }
    public static onPointerPropertyChanged(listener: (p:Pointer, key:any, value:any)=>void) {
        this.pointer_property_change_listeners.add(listener);
    }
    public static onPointerPropertyDeleted(listener: (p:Pointer, key:any)=>void) {
        this.pointer_property_delete_listeners.add(listener);
    }
    public static onPointerValueChanged(listener: (p:Pointer)=>void) {
        this.pointer_value_change_listeners.add(listener);
    }

    /**
     * Callback when pointer for a given id was added
     * @param id
     * @param listener 
     * @returns 
     */
    public static onPointerForIdAdded(id:string, listener: (p:Pointer)=>void) {
        const ptr = Pointer.get(id);
        if (ptr && ptr.value_initialized) {
            listener(ptr);
            return;
        }
        // set listener
        if (!this.pointer_for_id_created_listeners.has(id)) this.pointer_for_id_created_listeners.set(id, new Set());
        this.pointer_for_id_created_listeners.get(id)?.add(listener);
    }

    public static onPointerForValueCreated(value:any, listener: (p:Pointer)=>void, trigger_if_exists = true){
        // value already has a pointer?
        if (trigger_if_exists) {
            const ptr = Pointer.getByValue(value);
            if (ptr) {
                listener(ptr);
                return;
            }
        }
        // set listener
        if (!this.pointer_for_value_created_listeners.has(value)) this.pointer_for_value_created_listeners.set(value, new Set());
        this.pointer_for_value_created_listeners.get(value)?.add(listener);
    }
   

    // unsubscribe from all external pointers
    public static unsubscribeFromAllPointers(){
        for (const pointer of this.getAllPointers()) {
            if (!pointer.is_anonymous && !pointer.is_origin) pointer.unsubscribeFromPointerUpdates()
        }
    }

    /**
     *  Pointer Storage
     *  stores all unique pointers + their values
     */

    public static pointers = new Map<string, Pointer>();   // pointer id -> pointer
    public static primitive_pointers = new Map<string, WeakRef<Pointer>>();   // pointer id -> WeakRef<pointer>

    public static pointer_value_map  = new WeakMap<any, Pointer>(); // value -> pointer
    public static pointer_label_map  = new Map<string|number, Pointer>(); // label -> pointer

    public static getAllPointers(): Pointer[] {
        return [...this.pointers.values(), ...[...this.primitive_pointers.values()].map(r => r.deref()).filter(p=>!!p) as Pointer[]] 
    }

    /**
     * returns a unique pointer hash: HASH + UNIQUE TIME
     */
    public static readonly MAX_POINTER_ID_SIZE = 26;
    public static readonly STATIC_POINTER_SIZE = 26;

    private static last_c = 0;
    private static last_t = 0;

    private static time_shift = 0;

    public static POINTER_TYPE:
    {
        ENDPOINT:pointer_type,
        ENDPOINT_PERSONAL:pointer_type,
        ENDPOINT_INSTITUTION:pointer_type,
        IPV6_ID:pointer_type,
        STATIC:pointer_type,
        BLOCKCHAIN_PTR:pointer_type,
        PUBLIC:pointer_type
    } = {
        ENDPOINT: BinaryCode.ENDPOINT,
        ENDPOINT_PERSONAL: BinaryCode.PERSON_ALIAS,
        ENDPOINT_INSTITUTION: BinaryCode.INSTITUTION_ALIAS,
        IPV6_ID: 4,
        STATIC:  5,
        BLOCKCHAIN_PTR:  0xBC, // blockchain ptr $BC, ...
        PUBLIC:  6, // static public address
    }

    static #pointer_prefix?: Uint8Array

    public static get pointer_prefix() {
        if (!this.#pointer_prefix) this.#pointer_prefix = Runtime.endpoint.getPointerPrefix(); // new Uint8Array(21); // gets overwritten in DatexRuntime when endpoint id exists
        return this.#pointer_prefix!;
    }

    static set pointer_prefix(pointer_prefix: Uint8Array) {
        this.#pointer_prefix = pointer_prefix
    }

    static #is_local = true;
    static #local_pointers = new IterableWeakSet<Pointer>();
    public static set is_local(local: boolean) {
        this.#is_local = local;
        // update pointer ids if no longer local
        if (!this.#is_local) {
            for (const pointer of this.#local_pointers) {
                pointer.id = Pointer.getUniquePointerID(pointer);
            }
            this.#local_pointers.clear();
        }
    }
    public static get is_local() {return this.#is_local}

    /** 21 bytes address: 1 byte address type () 18/16 byte origin id - 2/4 byte origin instance - 4 bytes timestamp - 1 byte counter*/
    /**
     * Endpoint id types:
     *  + Full Endpoint ID:   EEEE EEEE EEEE EEEE EE / II
     *  + IPv6 compatible ID: IIII IIII IIII IIII / PPPP 
     * Pointer id types:
     * Associaated with an endpoint id:
     *  + Full Endpoint ID pointer: A EEEE EEEE EEEE EEEE EEII TTTT C    (A = Address type, E = endpoint id, I = instance id, T = timestamp, C = counter )
     *  + IPv6 compatible Address:  A IIII IIII IIII IIII PPPP TTTT C    (I = IPv6 address, P = port) 
     *  + Endpoint static pointer:  A EEEE EEEE EEEE EEEE EEUU UUUU U    (E = endpoint id, U = unique id (agreed among all instances))
     * Global / public:
     *  + Blockchain address:       A BBBB BBBB BBBB                     (B = unique block address)
     *  + Global static pointer:    A UUUU UUUU UUUU                     (U = unique id, stored in blockchain / decentralized) 
     * 
     * 'A' byte: first 3 bits for type, last 5 bits unused, can be used for custom flags 
     * */
    /** total pointer id size: 26 bytes */
    static getUniquePointerID(forPointer:Pointer): Uint8Array {
        const id = new Uint8Array(this.MAX_POINTER_ID_SIZE);
        const id_view = new DataView(id.buffer)
        // add custom origin id
        if (!forPointer.is_origin) id.set(forPointer.origin.getPointerPrefix());
        // add current endpoint origin id
        else id.set(this.pointer_prefix)

        const timestamp = Math.round((new Date().getTime() - Compiler.BIG_BANG_TIME)/1000);

        // reset on new timestamp
        if (timestamp !== this.last_t) {
            // reset time shift if actual time catches up with time shift 
            if (timestamp>this.last_t+this.time_shift) this.time_shift = 0;
            // reset counter if no time shift
            if (this.time_shift == 0) this.last_c = 0;
        }

        // counter overflow -> increment timestamp (should only happen if really necessary)
        if (this.last_c > 255) {
            this.last_c = 0;
            this.time_shift ++;
        }

        // add timestamp (in seconds)
        id_view.setUint32(21,timestamp+this.time_shift, true); // timestamp + time_shift

        // add unique counter
        id_view.setUint8(25, this.last_c++)

        this.last_t = timestamp; // save actual last time a pointer was created

        // add to local pointers list if no global endpoint id yet -> update pointer id as soon as global id available
        if (Pointer.is_local) {
            this.#local_pointers.add(forPointer)
        }

        return id;
    }

    static getStaticPointerId(endpoint:IdEndpoint, unique_id:number): Uint8Array {
        let id = new Uint8Array(this.STATIC_POINTER_SIZE);
        let id_view = new DataView(id.buffer)

        id.set(endpoint.getStaticPointerPrefix());
        id_view.setUint32(13, unique_id, true);

        return id;
    }

    static ANONYMOUS_ID = new Uint8Array(/*24*/1) // is anonymous pointer

    /**
     * returns true if the value has a bound pointer or is a Datex.Ref
     * @deprecated use Ref.isRef
     */
    public static isReference(value:unknown) {
        return Ref.isRef(value);
    }

    // returns the existing pointer for a value, or the value, if no pointer exists
    public static pointerifyValue(value:any):Pointer|any {
        return value instanceof Pointer ? value : this.pointer_value_map.get(value) ?? value;
    }
    // returns pointer only if pointer exists
    public static getByValue<T>(value:RefOrValue<T>):Pointer<T>|undefined{
        return <Pointer<T>>this.pointer_value_map.get(Pointer.collapseValue(value));
    }

    // returns pointer only if pointer exists
    public static getByLabel(label:string|number):Pointer {
        if (!this.pointer_label_map.has(label)) throw new PointerError("Label "+Runtime.formatVariableName(label, '$')+" does not exist");
        return this.pointer_label_map.get(label)!;
    }

    public static labelExists(label:string|number):boolean {
        return this.pointer_label_map.has(label)
    }

    // get pointer by id, only returns pointer if pointer already exists
    static get(id:Uint8Array|string):Pointer|undefined {
        id = Pointer.normalizePointerId(id);
        return this.pointers.get(id) ?? this.primitive_pointers.get(id)?.deref();
    }

    static #pointer_sources = new Set<readonly [source:PointerSource, priority:number]>();
    public static registerPointerSource(source: PointerSource, priority = 0) {
        // sort by prio
        const sorted = [...this.#pointer_sources, [source, priority] as const].sort((a,b)=>b[1]-a[1]);
        this.#pointer_sources.clear();
        sorted.forEach((s)=>this.#pointer_sources.add(s));
    }

    private static loading_pointers:Map<string, {promise: Promise<Pointer>, scopeList: WeakSet<datex_scope>}> = new Map();

    // load from storage or request from remote endpoint if pointer not yet loaded
    static load(id:string|Uint8Array, SCOPE?:datex_scope, only_load_local = false, sender_knows_pointer = true, allow_failure = true): Promise<Pointer>|Pointer{

        const id_string = Pointer.normalizePointerId(id);

        // only load if local pointer id
        if (SCOPE?.exec_conditions?.onlyLocalPointers) {
            const origin = Pointer.getOriginFromPointerId(id_string);
            if (origin !== LOCAL_ENDPOINT && origin !== Runtime.endpoint) {
                throw new Error("Tried to load non-local pointer");
            }
        }

        if (SCOPE) {
            // recursive pointer loading! TODO
            if (this.loading_pointers.get(id_string)?.scopeList.has(SCOPE)) {
                // logger.debug("recursive pointer loading: $"+ id_string);
                return new LazyPointer(id_string)
            }
        }

        if (this.loading_pointers.has(id_string)) {
            if (SCOPE) this.loading_pointers.get(id_string)!.scopeList.add(SCOPE);
            return this.loading_pointers.get(id_string)!.promise;
        }


        this.loading_pointers.set(id_string, null as any);
        const loadPromise = this.handleLoad(id_string, id, SCOPE, only_load_local, sender_knows_pointer, allow_failure);

        // only add load data if load not already finished
        if (this.loading_pointers.has(id_string)) {
            this.addLoadingPointerPromise(id_string, loadPromise, SCOPE);
        }

        return loadPromise;
    }

    /**
     * called for pointer init blocks
     */
    static addLoadingPointerPromise(id: string|Uint8Array, loadedPromise: Promise<Pointer>, scope?: datex_scope) {
        const id_string = Pointer.normalizePointerId(id);
        this.loading_pointers.set(id_string, {promise: loadedPromise, scopeList: new WeakSet()});
        if (scope) this.loading_pointers.get(id_string)!.scopeList.add(scope);
    }

    private static async handleLoad(id_string: string, id:string|Uint8Array, SCOPE:datex_scope|undefined, only_load_local:boolean, sender_knows_pointer:boolean, allow_failure:boolean) {

        // get pointer or create new
        let pointer:Pointer<any> = Pointer.create(id);

        // logger.debug("loading pointer: " + pointer.idString() +  " origin = " + pointer.origin, pointer.#loaded)
        // not allowed: anonymous pointer
        if (pointer.is_anonymous) {
            this.loading_pointers.delete(id_string);
            throw new PointerError("The anonymous pointer has no value", SCOPE)
        }

        // get value if pointer value not yet loaded
        if (!pointer.#loaded) {
            // first try loading from storage
            let stored:any = NOT_EXISTING;
            let source:PointerSource|null = null;
            let priority:number;
            for ([source,priority] of this.#pointer_sources) {
                try {
                    stored = await source.getPointer(pointer.id, !SCOPE, SCOPE?.exec_conditions?.onlyLocalPointers??false);
                }
                catch (e) {
                    this.loading_pointers.delete(id_string);
                    throw e;
                }
                if (stored != NOT_EXISTING) break;
            }

            if (stored!=NOT_EXISTING) {
                // if the value is a pointer with a tranform scope, copy the transform, not the value (TODO still just a workaround to preserve transforms in storage, maybe better solution?)
                if (stored instanceof Pointer && stored.transform_scope) {
                    await pointer.handleTransformAsync(stored.transform_scope.internal_vars, stored.transform_scope);
                }
                // set normal value
                else pointer = pointer.setValue(stored);

                // now sync if source (pointer storage) can sync pointer
                if (source?.syncPointer) source.syncPointer(pointer);

                // use local endpoint as default origin for storage pointer (TODO change?)
                // pointer.origin = Runtime.endpoint;
            }

            // special pointers
          
            // request BC pointer from network
            else if (id_string.startsWith("BC")) {
                // try to subscribe (default: main_node)
                try {
                    pointer = await pointer.subscribeForPointerUpdates(Runtime.main_node); // TODO relay node?
                } catch (e) {
                    this.loading_pointers.delete(id_string);
                    // could not subscribe, remove pointer again
                    pointer.delete();
                    throw e;
                }
            }

            // request pointer value from original sender, if pointer not yet loaded & not subscribe to own endpoint & fix: infinite loop: subscribe invalid pointer <-> subscribe
            else if (!only_load_local && !pointer.is_origin) {

                // waiting subscribe / unsubscribe ! should not happen TODO improve 
                if (SCOPE?.sync) {
                    this.loading_pointers.delete(id_string);
                    pointer.delete();
                    throw new RuntimeError("Cannot subscribe to non-existing pointer", SCOPE);
                }
                else if (SCOPE?.unsubscribe) {
                    this.loading_pointers.delete(id_string);
                    pointer.delete();
                    throw new RuntimeError("Cannot unsubscribe from non-existing pointer", SCOPE)
                }

                // // cannot subscribe to own pointer, this pointer does not exist on the endpoint
                // if (DatexRuntime.endpoint.equals(SCOPE.header.sender)) {
                //     this.loading_pointers.delete(id_string);
                //     throw new DatexRuntimeError("Pointer does not exist 1", SCOPE)
                // }

                // try to subscribe to owner endpoint
                try {
                    pointer = await pointer.subscribeForPointerUpdates();
                } catch (e) {
                    // cannot request from sender endpoint, doesn't know the pointer either
                    if (!sender_knows_pointer) {
                        this.loading_pointers.delete(id_string);
                        pointer.delete();
                        if (e instanceof NetworkError) {
                            if (!allow_failure) displayFatalError('pointer-unresolvable');
                            console.log(pointer, e)
                            // logger.error("Could not get the pointer from the current, the owner, or the requesting endpoint: $"+id_string+". The pointer could not be loaded from the network. " +pointer.origin + " is either offline or the requested pointer data could not be sent in a reasonable amount of time.")
                            throw new PointerError("Could not get the pointer from the current, the owner, or the requesting endpoint: $"+id_string+". The pointer could not be loaded from the network. " +pointer.origin + " is either offline or the requested pointer data could not be sent in a reasonable amount of time.")
                        }
                        else throw e;
                    }
                    // failed, request pointer from sender endpoint
                    try {
                        logger.debug("could not subscribe to origin, requesting pointer from "+SCOPE?.sender+": " + pointer.idString());
                        pointer = await pointer.subscribeForPointerUpdates(SCOPE?.sender);
                    } catch {
                        this.loading_pointers.delete(id_string);
                        pointer.delete();
                        throw e;
                    }
                    
                }

            }

            // pointer is own origin, but not found, request value from sender
            else if (SCOPE?.sender && !only_load_local && pointer.is_origin && !pointer.origin.equals(SCOPE.sender)) {

                // cannot request from sender endpoint, doesn't know the pointer either
                if (!sender_knows_pointer) {
                    this.loading_pointers.delete(id_string);
                    pointer.delete();
                    throw new PointerError("Neither the owner (self) nor the requesting endpoint could find the pointer $" + id_string)
                }

                try {
                    logger.debug("could not find local pointer, requesting pointer from "+SCOPE?.sender+": " + pointer.idString());
                    pointer = await pointer.subscribeForPointerUpdates(SCOPE?.sender, undefined, false);
                } catch  {
                    this.loading_pointers.delete(id_string);
                    pointer.delete();
                    // could not subscribe, remove pointer again
                    pointer.delete();
                    if (!allow_failure) displayFatalError('owned-pointer-unresolvable');
                    throw new PointerError("Owned pointer could not be loaded locally or from sender")
                }
            }

            // intentionally not loaded
            else if (only_load_local) {
                this.loading_pointers.delete(id_string);
                throw new PointerError("Pointer $"+id_string+" was not found locally", SCOPE);
            }

            // pointer does not exist / has no value
            else  {
                this.loading_pointers.delete(id_string);
                // if (globalThis.UIX) UIX.State.resetPage(); // this should not happen
                // else
                if (!allow_failure) displayFatalError('pointer-not-found');
                pointer.delete();
                throw new PointerError("Pointer $"+id_string+" has no assigned value", SCOPE);
            }
        }

        this.loading_pointers.delete(id_string);

        // check read permissions
        pointer.assertEndpointCanRead(SCOPE?.sender)

        return pointer;
    }

    // create/get DatexPointer for value if possible (not primitive) and return value
    static proxifyValue<T,C extends RefOrValue<T> = RefOrValue<T>>(value:C, sealed = false, allowed_access?:target_clause, anonymous = false, persistant= false, check_proxify_as_child = false): C|T {
        if ((value instanceof Pointer && value.is_js_primitive) || value instanceof PointerProperty) return <any>value; // return by reference
        else if (value instanceof Ref) return value.val; // return by value
        const type = Type.ofValue(value)
        const collapsed_value = <T> Ref.collapseValue(value,true,true)
    // if proxify_as_child=false: don't create pointer for this value, return original value
        // e.g.: primitive values
        if ((check_proxify_as_child && !type.proxify_as_child) || type.is_primitive) {
            return <any>collapsed_value;
        }

        // create or get pointer
        else return <any>Pointer.createOrGet(collapsed_value, sealed, allowed_access, anonymous, persistant).val;
    } 

    // create a new pointer or return the existing pointer/pointer property for this value
    static createOrGet<T>(value:RefOrValue<T>, sealed = false, allowed_access?:target_clause, anonymous = false, persistant= false):Pointer<T>{
        if (value instanceof Pointer) return <Pointer<T>>value; // return pointer by reference
        //if (value instanceof PointerProperty) return value; // return pointerproperty TODO: handle pointer properties?
        value = Ref.collapseValue(value, true, true);

        const ptr = Pointer.getByValue(value); // try proxify

        // pointer already exists
        if (ptr) {
            if (ptr.is_placeholder) ptr.unPlaceholder(); // no longer placeholder, becomes normal pointer
            return ptr;
        }
        // create new pointer
        else return <Pointer<T>>Pointer.create(undefined, value, sealed, undefined, persistant, anonymous, false, allowed_access); 
    }

    // create a new pointer or return the existing pointer + add a label
    static createLabel<T>(value:RefOrValue<T>, label:string|number):Pointer<T>{
        let ptr = Pointer.getByValue(value); // try proxify
        // create new pointer
        if (!ptr) {
           ptr = Pointer.create(undefined, value); 
        }
        ptr.addLabel(label);
        return ptr;
    }
    

    // create a new pointer with a transform value
    static createTransform<const T, const V extends TransformFunctionInputs>(observe_values:V, transform:TransformFunction<V,T>, persistent_datex_transform?:string, force_transform = false) {
        const ptr = Pointer.create(undefined, NOT_EXISTING).handleTransform(observe_values, transform, persistent_datex_transform);
        ptr.force_local_transform = force_transform;
        return ptr;
    }

    /**
     * Create a new pointer with a transform value generated with smart js transform
     * @param observe_values 
     * @param transform 
     * @param persistent_datex_transform 
     * @returns 
     */
    static createSmartTransform<const T>(transform:SmartTransformFunction<T>, persistent_datex_transform?:string, forceLive = false, ignoreReturnValue = false, options?:SmartTransformOptions):Pointer<T> {
        return Pointer.create(undefined, NOT_EXISTING).smartTransform(transform, persistent_datex_transform, forceLive, ignoreReturnValue, options);
    }

    static createTransformAsync<const T,V extends TransformFunctionInputs>(observe_values:V, transform:AsyncTransformFunction<V,T>, persistent_datex_transform?:string):Promise<Pointer<T>>
    static createTransformAsync<const T,V extends TransformFunctionInputs>(observe_values:V, transform:Scope<RefOrValue<T>>):Promise<Pointer<T>>
    static createTransformAsync<const T,V extends TransformFunctionInputs>(observe_values:V, transform:AsyncTransformFunction<V,T>|Scope<RefOrValue<T>>, persistent_datex_transform?:string):Promise<Pointer<T>>{
        return Pointer.create(undefined, NOT_EXISTING).handleTransformAsync(observe_values, transform, persistent_datex_transform);
    }

    // only creates the same pointer once => unique pointers
    // throws error if pointer is already allocated or pointer value is primitive
    static create<T>(id?:string|Uint8Array, value:RefOrValue<T>|typeof NOT_EXISTING=NOT_EXISTING, sealed = false, origin?:Endpoint, persistant=false, anonymous = false, is_placeholder = false, allowed_access?:target_clause, timeout?:number):Pointer<T extends symbol ? unknown : T> {
        let p:Pointer<T>;

        // DatexValue: DatexPointer or DatexPointerProperty not valid as object, get the actual value instead
        value = <T|typeof NOT_EXISTING> Ref.collapseValue(value,true,true)

        // is js primitive value
        if (Object(value) !== value && typeof value !== "symbol") {
            
            if (value instanceof TypedArray) value = <T>Runtime.serializeValue(value); // convert to ArrayBuffer

            // id already in use
            if (typeof id != "symbol" && id && (p = <Pointer<T>> this.get(id))) {
                if (p.is_js_primitive) {
                    if (value!=NOT_EXISTING) p.val = value; // update value of this pointer
                    if (origin) p.origin = origin; // override origin
                }
                else {
                    throw new PointerError("Cannot assign a native primitive value to a initialized non-primitive pointer");
                }
            }
            else {
                let pp:any;

                switch (typeof value) {
                    case "string": pp = TextRef; break;
                    case "number": pp = DecimalRef; break;
                    case "bigint": pp = IntegerRef; break;
                    case "boolean": pp = BooleanRef; break;
                }
                
                if (!pp) throw new PointerError("Cannot create a pointer for this value type");
               
                // create new
                return new (<typeof Pointer>pp)(id, <any>value, sealed, origin, persistant, anonymous, is_placeholder, allowed_access, timeout)
            }
        }
        
        // value already allocated to a pointer
        else if (this.pointer_value_map.has(value)) {
            let existing_pointer = <Pointer<T>> Pointer.pointer_value_map.get(value);
            // is placeholder, add id
            if (existing_pointer.is_placeholder) {
                existing_pointer.unPlaceholder(id)
                return existing_pointer;
            }
            // stays anonymous
            if (existing_pointer.is_anonymous) return existing_pointer;
            // value already has a pointer
            else throw new PointerError("A pointer has already been allocated to this value ("+Runtime.valueToDatexString(value)+")");
        }

        // id already allocated to a pointer
        else if (typeof id != "symbol" && id && (p = <Pointer<T>> this.get(id))) {
            if (value!=NOT_EXISTING) p.val = <any>value; // set value of this pointer, if not yet set
            if (origin) p.origin = origin; // override origin
            return p;
        }

        // create a completely new pointer
        else {
            let pp:any = Pointer;

            if (value instanceof Type) pp = TypeRef;
            else if (value instanceof URL) pp = URLRef;
            else if (value instanceof Endpoint) pp = EndpointRef;

            return new (<typeof Pointer>pp)<T>(id, <any>value, sealed, origin, persistant, anonymous, is_placeholder, allowed_access, timeout)
        }
    }

    public static normalizePointerId(id:string|Uint8Array):string {
        // correct size depending on pointer id type
        if (id instanceof Uint8Array) {
            if (id[0] == Pointer.POINTER_TYPE.STATIC) return buffer2hex(id,undefined,Pointer.STATIC_POINTER_SIZE, true) 
            else return buffer2hex(id,undefined,Pointer.MAX_POINTER_ID_SIZE, true)
        }
        else if (typeof id == "string") {
            const has_$ = id.startsWith("$");
            const buffer = hex2buffer(id.replace("$",""), undefined, true); 
            return (has_$ ? "$" : "") + this.normalizePointerId(buffer);
        }
        else throw Error("Cannot normalize invalid pointer id - must be string or Uint8Array")
    }


    public onGargabeCollection(callback: (event: Event) => void) {
        this.addEventListener("garbageCollection", callback);
    }

    /**
     *  Pointer Garbage collection
     *  handles no longer needed pointers
     */


    private static garbage_registry = new FinalizationRegistry<MockPointer>((mockPtr) => {
        this.handleGarbageCollected(mockPtr)
    });

    // clean up after garbage collection:
    private static handleGarbageCollected(mockPtr: MockPointer){
        logger.debug("$" + mockPtr.id + " was garbage collected");

        // cleanup for complex pointer that still has an instance
        const pointer = Pointer.get(mockPtr.id);
        if (pointer) {
            pointer.#garbage_collected = true;
            pointer.delete()
        }
        else {
            this.cleanup(mockPtr)
        }
    
    }
    
    // cleanup for primitive and complex pointer
    private static cleanup(mockPtr: MockPointer) {
        // unsubscribe
        const doUnsubscribe = !!(!mockPtr.is_origin && mockPtr.origin)
        if (doUnsubscribe && mockPtr.subscribed) this.unsubscribeFromPointerUpdates(mockPtr.subscribed, mockPtr.id);

        // remove subscriber cache
        Runtime.subscriber_cache?.delete(mockPtr.id);
    }


    // custom datex pointer array splice function
    private arraySplice(start?: number, deleteCount?: number, ...items: any[]):any[] {
        // is clear?
        if (start == 0 && deleteCount == (<Array<unknown>><unknown>this.shadow_object).length && items.length == 0) {
            this.handleClear();
            return [];
        }
        if (deleteCount == undefined) deleteCount = (<Array<unknown>><unknown>this.shadow_object).length; // default deleteCount: all
        if (deleteCount && deleteCount < 0) deleteCount = 0;
        return this.handleSplice(start??0, deleteCount, items);
    }
    

    /** END STATIC */



    protected constructor(id?:Uint8Array|string, value:T=<any>NOT_EXISTING, sealed:boolean = false, origin?:Endpoint, persistant = false/*TODO handle persistant?*/, anonymous = false, is_placeholder = false, allowed_access?:target_clause, timeout?:number) {
        super();
        // TODO is_placeholder is deprecated? (no longer in use)
        // is only a temporary placeholder pointer (has to be replaced with another pointer with an id, behaves like an anonymous pointer until then)
        if (is_placeholder) {
            this.#is_placeholder = true;
            anonymous = true;
        }
        // is id anonymous ($00)?
        if ((typeof id == "string" && id.match(/^0+$/)) || (id instanceof Uint8Array && id.every(x => x == 0))) {
            anonymous = true;
        }

        this.#is_persistent = persistant;
        this.sealed = sealed;
        if (origin) this.origin = origin; // also updates #is_origin
        this.#is_anonymous = anonymous;
        this.#allowed_access = allowed_access;

        this.datex_timeout = timeout;

        // set pointer id (after this.#is_anonymous is set)
        if (anonymous) {
            this.id = Pointer.ANONYMOUS_ID;
        }
        else if (typeof id == "string" || id instanceof Uint8Array) {
            this.id = id;
        }
        // generate new random pointer id
        else {
            this.id = Pointer.getUniquePointerID(this);
        }

        // get origin based on pointer id if no origin provided
        // TODO different pointer address formats / types
        if (!this.origin && id && !anonymous && this.#id_buffer && (this.pointer_type == Pointer.POINTER_TYPE.ENDPOINT || this.pointer_type == Pointer.POINTER_TYPE.ENDPOINT_PERSONAL || this.pointer_type == Pointer.POINTER_TYPE.ENDPOINT_INSTITUTION)) {
            this.origin = Pointer.getOriginFromPointerId(this.#id_buffer);
            // <Endpoint>Target.get(this.#id_buffer.slice(1,19), this.#id_buffer.slice(19,21), this.pointer_type);
            //console.log("pointer origin based on id: " + this.toString() + " -> " + this.origin)
        }
        else if (!this.origin) this.origin = Runtime.endpoint; // default origin is local endpoint

        // set value
        if (<any>value != NOT_EXISTING) this.val = value;

        // set update_endpoint and trigger suscribers getter (get from cache)
        this.#update_endpoints = this.subscribers
    }

    /**
     * extracts the origin from a pointer id
     * @param id_buffer 
     * @returns 
     */
    static getOriginFromPointerId(id_buffer: Uint8Array|string) {
        if (typeof id_buffer == "string") {
            try {id_buffer = hex2buffer(id_buffer, Pointer.MAX_POINTER_ID_SIZE, true);}
            catch (e) {throw new SyntaxError('Invalid pointer id: $' + id_buffer.slice(0, 48));}
        }
        const pointer_type = id_buffer[0];
        return <Endpoint>Target.get(id_buffer.slice(1,19), id_buffer.slice(19,21), pointer_type);
    }
    
    // delete pointer again (reset everything) if not needed
    public delete() {
        
        // common pointer cleanup
        Pointer.cleanup(this)

        // special complex pointer-specific cleanup:

        // delete from maps
        if (this.#loaded && !this.#garbage_collected && this.current_val) {
            Pointer.pointer_value_map.delete(this.current_val);
        } 
        if (this.original_value) {
            Pointer.pointer_value_map.delete(this.original_value);
            delete this.original_value[DX_PTR]
        }
        this.#loaded = false;

        // disable transform source
        this.forceSetObserverCount(0) // make sure observer counter is 0
        this.setForcedLiveTransform(false);
        this.deleteTransformSource();

        // remove property observers
        for (const [value, handler] of this.#active_property_observers.values()) {
            Ref.unobserve(value, handler, this.#unique);
        }

        // delete labels
        for (const label of this.labels??[]) Pointer.pointer_label_map.delete(label);
        
        Pointer.pointers.delete(this.#id);
        Pointer.primitive_pointers.delete(this.#id)

        // remove disposables
        for (const disposable of this.#boundDisposables) {
            console.log("disposing", disposable)
            disposable[Symbol.dispose]?.()
        }

        // call remove listeners (todo: also for primitive pointers)
        if (!this.is_anonymous) for (const l of Pointer.pointer_remove_listeners) l(this);
    }

    #boundDisposables = new Set<{[Symbol.dispose]: ()=>any}>()

    // binds a disposable object to this pointer that gets disposed as soon as the pointer is garbage collected
    public bindDisposable(disposable: {[Symbol.dispose]: ()=>any}) {
        this.#boundDisposables.add(disposable);
        if (!this.is_js_primitive) {
            if (!this.val[Pointer.DISPOSABLES]) this.val[Pointer.DISPOSABLES] = []
            this.val[Pointer.DISPOSABLES].push(disposable);
        }
    }

    static DISPOSABLES = Symbol("DISPOSABLES")

    public static bindDisposable(value: any, disposable: {[Symbol.dispose]: ()=>any}) {
        const ptr = value instanceof Pointer ? value : this.getByValue(value);
        if (ptr) {
            ptr.bindDisposable(disposable);
        }
        else throw new Error("Cannot bind a disposable value to a non-pointer value")
    }


    [Symbol.dispose]() {
        this.delete()
    }
    
    #original_value: T extends {[key:string]:unknown} ? WeakRef<T> : void //  weak ref to original value (not proxyfied)
    #shadow_object: WeakRef<{[key:string]:unknown}>|T // object to make changes and get values from without triggering DATEX updates
    #type:Type // type of the value

    #unwrapped_transform_type?: Type

    #loaded = false

    get value_initialized() {return this.#loaded}

    #is_placeholder = false
    #is_js_primitive = false;

    #is_persistent: boolean // indicates if this pointer can get garbage collected
    #is_anonymous: boolean // pointer should never be sent via datex as reference, always serialize the value
    
    #pointer_type:pointer_type // pointer type (full id, static, ...)

    // id as hex string and ArrayBuffer
    #id:string
    #id_buffer:Uint8Array
    #origin: Endpoint
    #is_origin = true;
    #subscribed: boolean|Endpoints = false

    get subscribed() {return this.#subscribed}

    //readonly:boolean = false; // can the value ever be changed?
    sealed:boolean = false; // can the value be changed from the client side? (otherwise, it can only be changed via DATEX calls)
    #scheduler: UpdateScheduler|null = null  // has fixed update_interval

    #allowed_access?: target_clause // who has access to this pointer?, undefined = all

    #garbage_collectable = false;
    #garbage_collected = false;

    #labels = new Set<string|number>();
   
    get garbage_collectable () {return this.#garbage_collectable} // indicates if pointer can be garbage collected
    get garbage_collected () {return this.#garbage_collected} // indicates if pointer can be garbage collected
    get allowed_access(){return this.#allowed_access}
    get is_placeholder(){return this.#is_placeholder}
    get id_buffer(){return this.#id_buffer}
    get is_origin(){return this.#is_origin}
    get is_js_primitive(){return this.#is_js_primitive} // true if js primitive (number, boolean, ...) or 'single instance' class (Type, Endpoint) that cannot be directly addressed by reference
    get is_anonymous(){return this.#is_anonymous}
    get origin(){return this.#origin}

    get is_persistent() { return this.#is_persistent || this.subscribers?.size != 0}
    // change the persistant state of this pointer
    set is_persistent(persistant:boolean) {
        if (persistant && !this.#is_persistent) {
            this.#is_persistent = true;
            this.updateGarbageCollection()
        }
        else if (!persistant && this.#is_persistent){
            this.#is_persistent = false;
            this.updateGarbageCollection()
        }
    }

    get labels(){return this.#labels}
    get pointer_type(){return this.#pointer_type}

    #updateIsJSPrimitive(val:any = this.val) {
        const type = this.#type ?? Type.ofValue(val);
        this.#is_js_primitive = (typeof val !== "symbol") && !(Object(val) === val && !type.is_js_pseudo_primitive && !(type == Type.js.NativeObject && globalThis.Element && val instanceof globalThis.Element))
    }

    /**
     * Throws if endpoint is not in allowed_access list and not a trusted endpoint with protected-pointer-access.
     * Never throws if Runtime.OPTIONS.PROTECT_POINTERS is set to false
     * @param endpoint 
     * @returns 
     */
    public assertEndpointCanRead(endpoint?: Endpoint) {
        if (
            Runtime.OPTIONS.PROTECT_POINTERS 
            && !(endpoint == Runtime.endpoint)
            && this.is_origin 
            && (!endpoint || !Logical.matches(endpoint, this.allowed_access, Target))
            && (endpoint && !Runtime.trustedEndpoints.get(endpoint.main)?.includes("protected-pointer-access"))
        ) {
            throw new PermissionError("Endpoint has no read permissions for this pointer")
        }
    }

    private set origin(origin:Endpoint){
        this.#origin = origin
        this.#is_origin = !!Runtime.endpoint?.equals(this.#origin);
    }


    /**
     * add endpoint to allowed_access list
     * @param endpoint
     */
    public grantAccessTo(endpoint: Endpoint, _force = false) {
        if (!_force && !Runtime.OPTIONS.PROTECT_POINTERS) throw new Error("Read permissions are not enabled per default (set Datex.Runtime.OPTIONS.PROTECT_POINTERS to true)")
        if (!this.#allowed_access || this.#allowed_access == BROADCAST) this.#allowed_access = new Disjunction()
        if (this.#allowed_access instanceof Disjunction) this.#allowed_access.add(endpoint)
        else throw new Error("Invalid access filter, cannot add endpoint (TODO)")
    }


    /**
     * add public access to pointer
     * @param endpoint
     */
    public grantPublicAccess(_force = false) {
        if (!_force && !Runtime.OPTIONS.PROTECT_POINTERS) throw new Error("Read permissions are not enabled per default (set Datex.Runtime.OPTIONS.PROTECT_POINTERS to true)")
        this.#allowed_access = BROADCAST;
    }


    /**
     * remove endpoint from allowed_access list
     * @param endpoint 
     */
    public revokeAccessFor(endpoint: Endpoint, _force = false) {
        if (!_force && !Runtime.OPTIONS.PROTECT_POINTERS) throw new Error("Read permissions are not enabled per default (set Datex.Runtime.OPTIONS.PROTECT_POINTERS to true)")
        if (this.#allowed_access instanceof Disjunction) this.#allowed_access.delete(endpoint)
        else throw new Error("Invalid access filter, cannot add endpoint (TODO)")
    }


    /**
     * always get the original reference for property, even if hidden in shadow_object
     */
    public static getOriginalPropertyRef(val:any, propName:any) {
        const ptr = this.getByValue(val);
        if (ptr) return ptr.shadow_object?.[propName] ?? val[propName];
        else return val[propName]
    }

    /**
     * Changes the id of the pointer to point to the new origin (and also changes the .origin)
     * @param new_owner
     * @param recursive if true, also change the ownership for all properties recursively
     */
    public transferOwnership(new_owner:Endpoint|endpoint_name, recursive = false) {
        const endpoint = new_owner instanceof Endpoint ? new_owner : (<Person>Endpoint.get(new_owner));
        const old_id = this.idString();
        this.origin = endpoint;
        this.id = Pointer.getUniquePointerID(this);
    
        logger.info(`pointer transfer to origin ${this.origin}: ${old_id} -> ${this.idString()}`);

        if (recursive && !this.type.is_primitive) {
            for (const key of this.getKeys()) {
                const prop = this.getProperty(key);
                const pointer = Pointer.getByValue(prop);
                if (pointer) pointer.transferOwnership(new_owner, recursive);
            }
        }
    }

    public static transferOwnership(value:any, new_owner:Endpoint|endpoint_name, recursive = false) {
        const pointer = Pointer.getByValue(value);
        if (!pointer) throw new PointerError("Cannot transfer ownership of non-pointer value");
        return pointer.transferOwnership(new_owner, recursive);
    }

    // don't call this method, call addPointer on DatexUpdateScheduler
    setScheduler(scheduleder: UpdateScheduler){
        this.#scheduler = scheduleder
    }
    // don't call this method, call deletePointer on DatexUpdateScheduler
    deleteScheduler(){
        this.#scheduler = null;
    }

    public addLabel(label: string|number){
        if (Pointer.pointer_label_map.has(label)) throw new PointerError("Label " + Runtime.formatVariableName(label, '$') + " is already assigned to a pointer");
        this.#labels.add(label);
        this.is_persistent = true; // make pointer persistant
        Pointer.pointer_label_map.set(label, this)

        const id = this.id;
    }


    /**
     * create a new transformed pointer from an existing pointer
     */
    public transform<R>(transform:TransformFunction<[this],R>) {
        return Ref.collapseValue(Pointer.createTransform([this], transform));
    }

    /**
     * create a new transformed pointer from an existing pointer (Async transform function)
     */
    public transformAsync<R>(transform:AsyncTransformFunction<[this],R>) {
        return Ref.collapseValue(Pointer.createTransformAsync([this], transform));
    }


    /**
    * Subscribe for external pointer updates at remote endpoint -> might return a different pointer if current pointer was placeholder
    */

    public async subscribeForPointerUpdates(override_endpoint?:Endpoint, get_value = !this.#loaded, keep_pointer_origin = false):Promise<Pointer> {
        
        // never subscribe if pointer is bound to a transform function
        if (this.transform_scope) {
            return this;
        }

        if (this.#subscribed) {
            // logger.debug("already subscribed to " + this.idString());
            return this;
        }
        
        const endpoint = override_endpoint ?? this.origin;
        // logger.debug("subscribing to " + this.idString() + ", origin = " +  this.origin +  (this.origin!=endpoint ? ", requesting from: " + endpoint : '') + ', get value: ' + get_value);
        if (this.origin==endpoint) logger.debug `subscribing to #color(65, 102, 238)${this.idString()}, origin: ${this.origin.toString()}${get_value?', getting value':''}`
        else logger.debug `subscribing to #color(65, 102, 238)${this.idString()}, origin: ${this.origin.toString()}, request: ${endpoint.toString()}${get_value?', getting value':''}`


        if (get_value) {
            // try {
            const pointer_value = await Runtime.datexOut(['#origin <== ?', [this]], endpoint) 
            if (pointer_value === VOID) { // TODO: could be allowed, but is currently considered a bug
                throw new RuntimeError("pointer value "+this.idString()+" was resolved to void");
            }
            this.#subscribed = endpoint;

            // // set function receiver
            // if (pointer_value instanceof Function) {
            //     pointer_value.setRemoteEndpoint(endpoint);
            // }
            if (!keep_pointer_origin) this.origin = endpoint;

            // fall back to trusted endpoint when origin is offline, if not already a override endpoint 
            if (!override_endpoint) {
                Pointer.observeOriginOnline(this.origin, this.id);
            }

            if (!this.#loaded) return this.setValue(pointer_value); // set value
            else return this;
        }

        // value already cached, don't wait for it, no response
        else {
            Pointer.addToSubscriberPool(this, endpoint);
            this.#subscribed = endpoint;
            this.origin = endpoint;
            return this;
        }
    
    }

    /**
     * Observes online state of pointer origin and subscribes to fallback endpoint if origin is offline
     * @param origin
     * @param ptrId 
     */
    private static observeOriginOnline(origin: Endpoint, ptrId: string) {
        const handler = async function(online: boolean) {
            const ptr = Pointer.get(ptrId);
            // pointer no longer exists, unobserve
            if (!ptr) {
                logger.debug("unobserving pointer origin online state for " + ptrId);
                origin.online.unobserve(handler);
                return;
            }
            let foundFallback = false;
            for (const [trustedEndpoint, permissions] of Runtime.trustedEndpoints) {
                if (permissions.includes("fallback-pointer-source")) {
                    logger.debug(origin  + " is offline, subscribing to trusted endpoint " + trustedEndpoint)
                    ptr.#subscribed = false;
                    try {
                        await ptr.subscribeForPointerUpdates(trustedEndpoint);
                        foundFallback = true;
                        break;
                    }
                    catch (e) {
                        console.log(e)
                    }
                }
            }
            if (!foundFallback) {
                logger.debug("pointer origin " + origin  + " for "+ptrId+" is offline, could not find a trusted fallback endpoint for pointer synchronisation")
            }
        }
        origin.online.observe(handler)
    }

    static #subscriber_pool = new Map<Endpoint, Set<Pointer>>().setAutoDefault(Set)

    private static addToSubscriberPool(pointer:Pointer, endpoint:Endpoint) {
        const pool = this.#subscriber_pool.getAuto(endpoint);
        if (!pool) {
            logger.error("getAuto not working");
            return;
        }
        pool.add(pointer);

        // immediately clear pool if limit reached
        if (pool.size >= 40) this.subscribeSubscriberPool(endpoint);
        // otherwise, wait some time until subscribing
        else setTimeout(()=>this.subscribeSubscriberPool(endpoint),2000);
    }

    private static subscribeSubscriberPool(endpoint:Endpoint) {
        const pool = this.#subscriber_pool.get(endpoint);
        if (!pool) return;
        this.#subscriber_pool.delete(endpoint);

        let datex = '';
        const pointers = [];
        for (const ptr of pool) {
            datex += '#origin <==: ?;'
            pointers.push(ptr)
        }
        logger.debug("subscription pool for " + endpoint + ", " + pointers.length + " pointers");
        Runtime.datexOut([datex, pointers, {type:ProtocolDataType.UPDATE}], endpoint, undefined, false); 
    }


    public async unsubscribeFromPointerUpdates() {
        if (!this.#subscribed) return; // already unsubscribed
        await Pointer.unsubscribeFromPointerUpdates(this.#subscribed, this.id)
        this.#subscribed = false;
    }

    public static async unsubscribeFromPointerUpdates(endpoint: Endpoint, pointerId: string) {
        logger.debug("unsubscribing from " + pointerId + " ("+endpoint+")");
        try {
            await Runtime.datexOut(['#origin </= $' + pointerId], endpoint, undefined, true);
        }
        catch {}
    }


    // make normal pointer from placeholder
    unPlaceholder(id?:string|Uint8Array) {
        this.#is_anonymous = false; // before id change
        this.id = id ?? Pointer.getUniquePointerID(this) // set id
        this.#is_placeholder = false; // after id change
        // first time actual visible pointer
        for (const l of Pointer.pointer_add_listeners) l(this);
        // pointer for id listeners
        if (Pointer.pointer_for_id_created_listeners.has(this.id)) {
            for (const l of Pointer.pointer_for_id_created_listeners.get(this.id)!) l(this);
            Pointer.pointer_for_id_created_listeners.delete(this.id)
        }

    }

    // set id if not set initially set
    get id():string{ return this.#id }
    
    set id (id:Uint8Array|string) {
        // if (!this.is_placeholder && this.id !== undefined && !Pointer.#local_pointers.has(this)) {
        //     // console.log("TODO: pointer transfer map")
        // }
        // is id transfer for placeholder, trigger value init

        if (typeof id == "string") {
            // convert string to buffer
            try {this.#id_buffer = hex2buffer(id, Pointer.MAX_POINTER_ID_SIZE, true);}
            catch (e) {throw new SyntaxError('Invalid pointer id: $' + id.slice(0, 48));}
            this.#id = Pointer.normalizePointerId(id)
        }
        else if (id instanceof Uint8Array) {
            this.#id_buffer = id;
            this.#id = Pointer.normalizePointerId(id)
        }
        else this.#id = Pointer.normalizePointerId(id)

        // get pointer type
        this.#pointer_type = this.#id_buffer[0];

        // add to pointer list
        if (!this.is_anonymous) {
            if (this.is_js_primitive) Pointer.primitive_pointers.set(this.#id, new WeakRef(this)); 
            else Pointer.pointers.set(this.#id, this); 
        }
    }

    // set value, might return new pointer if placeholder pointer existed or converted to primitive pointer
    setValue<TT>(v:T extends typeof NOT_EXISTING ? TT : T):Pointer<T extends typeof NOT_EXISTING ? TT : T> {
        // primitive value and not yet initialized-> new pointer
        if (!this.value_initialized && (Object(v) !== v || v instanceof ArrayBuffer)) {
            Pointer.pointers.delete(this.id); // force remove previous non-primitive pointer (assume it has not yet been used)
            Pointer.primitive_pointers.delete(this.id)
            return <any>Pointer.create(this.id, v, this.sealed, this.origin, this.is_persistent, this.is_anonymous, false, this.allowed_access, this.datex_timeout)
        }
        //placeholder replacement
        if (Pointer.pointer_value_map.has(v)) {
            if (this.#loaded) {throw new PointerError("Cannot assign a new value to an already initialized pointer")}
            const existing_pointer = Pointer.pointer_value_map.get(v)!;
            existing_pointer.unPlaceholder(this.id) // no longer placeholder, this pointer gets 'overriden' by existing_pointer
            return existing_pointer;
        }
        else {
            this.val = <any>v;
            return <any>this;
        }
    }


    

    override get val():T {
        if (this.#garbage_collected) throw new PointerError("Pointer was garbage collected");
        else if (!this.#loaded) {
            throw new PointerError("Cannot get value of uninitialized pointer")
        }
        // deref and check if not garbage collected
        if (!this.is_persistent && !this.is_js_primitive && super.val instanceof WeakRef) {
            const val = super.val.deref();
            // seems to be garbage collected
            if (val === undefined && this.#loaded && !this.#is_js_primitive) {
                Pointer.handleGarbageCollected(this)
                throw new PointerError("Pointer was garbage collected");
            }
            // can be returned
            return val;
        }
        // return the value directly
        else return super.val;
    }

    override set val(v: T) {
        // TODO: fixme, check this.#loaded && this.original_value!==undefined?
        const valueExists = this.#loaded && (this.original_value!==undefined || this.is_js_primitive);
        if (valueExists) this.updateValue(v);
        else this.initializeValue(v);
    }

    // same as get val, with current_val (calling super.current_val)
    override get current_val():T|undefined {
        if (this.#garbage_collected) throw new PointerError("Pointer was garbage collected");
        else if (!this.#loaded) {
            throw new PointerError("Cannot get value of uninitialized pointer")
        }
        // deref and check if not garbage collected
        if (!this.is_persistent && !this.is_js_primitive && super.current_val instanceof WeakRef) {
            const val = super.current_val.deref();
            // seems to be garbage collected
            if (val === undefined && this.#loaded && !this.#is_js_primitive) {
                Pointer.handleGarbageCollected(this)
                throw new PointerError("Pointer was garbage collected");
            }
            // can be returned
            return val;
        }
        // return the value directly
        else return super.current_val;
    }


    // same as val setter, but can be awaited - don't confuse with Pointer.setValue (TODO: rename?)
    override setVal(v: T, trigger_observers = true, is_transform?:boolean) {
        // TODO: fixme, check this.#loaded && this.original_value!==undefined?
        const valueExists = this.#loaded && (this.original_value!==undefined || this.is_js_primitive);
        if (valueExists) return this.updateValue(v, trigger_observers, is_transform);
        else return this.initializeValue(v, is_transform); // observers not relevant for init
    }

    // also trigger event for all property specific observers
    override triggerValueInitEvent(is_transform = false, previous?: any) {
        const value = this.current_val;

        // TODO: await promises?
        for (const [key, entry] of this.change_observers) {
            for (const [o, options] of entry) {
                if ((!options?.types || options.types.includes(Ref.UPDATE_TYPE.INIT))) o(value, key, Ref.UPDATE_TYPE.INIT); 
            }
        }
        for (const [object, entries] of this.bound_change_observers) {
            for (const [key, handlers] of entries) {
                for (const [handler, options] of handlers) {
                    if ((!options?.types || options.types.includes(Ref.UPDATE_TYPE.INIT))) {
                        const res = handler.call(object, value, key, Ref.UPDATE_TYPE.INIT);
                        if (res === false) this.unobserve(handler, object, key);
                    }
                }
            }
        }

        return super.triggerValueInitEvent(is_transform, previous)
    }


    /**
     * returns a value that can be referenced in JS
     * if it has a primitive value, the pointer itself is returned
     */
    override get js_value():CollapsedValueJSCompatible<T> {
        return <any> (this.is_js_primitive ? this : this.val)
    }

    /**
     * Sets the initial value of the pointer
     * @param v initial value
     */
    protected initializeValue(v:RefOrValue<T>, is_transform?:boolean) {
        let val = Ref.collapseValue(v,true,true);

        if (typeof val == "symbol" && Symbol.keyFor(val) !== undefined) {
            throw new Error("Global and well-known symbols (e.g. Symbol.for('name') or Symbol.iterator) are no yet supported as pointer values")
        }

        // get transform wrapper
        if (is_transform) val = this.getInitialTransformValue(val)

        // Save reference to original
        this.#type = Type.ofValue(val);

        // console.log("loaded : "+ this.id + " - " + this.#type, val)

        if (val == undefined) this.#is_js_primitive = true;
        else this.#updateIsJSPrimitive(val);
        
        // init proxy value for non-JS-primitives value (also treat non-uix HTML Elements as primitives)
        if (!this.is_js_primitive) {

            // already an existing non-primitive pointer
            if (Pointer.getByValue(val)) {
                this.#loaded = true;
                super.setVal(val, true, is_transform)
            }

            // normal
            else {
                this.#original_value = this.#shadow_object = <any> new WeakRef(<any>val);

                // TODO: is this required somewhere?
                // add reference to this DatexPointer to the original value
                if (!this.is_anonymous) {
                    try {
                        Object.defineProperty(val, DX_PTR, {value: this, enumerable: false, writable: true, configurable: true})
                    } catch(e) {}
                }
    
                if (this.sealed) this.visible_children = new Set(Object.keys(val)); // get current keys and don't allow any other children
                else if (this.type.visible_children) this.visible_children = this.type.visible_children; // use visible_children from type
    
                // save original value in map to find the right pointer for this value in the future
                Pointer.pointer_value_map.set(val, this);
                // create proxy
                const value = this.addObjProxy((val instanceof UnresolvedValue) ? val[DX_VALUE] : val); 
                // add $, $$
                if (typeof value !== "symbol") this.add$Properties(value);

                // // add reference to this DatexPointer to the value
                // if (!this.is_anonymous) {
                //     try {value[DX_PTR] = this;
                //     } catch(e) {}
                // }
    
                this.#loaded = true; // this.value exists (must be set to true before the super.value getter is called)
    
                if (val instanceof UnresolvedValue) {
                    this.#shadow_object = new WeakRef(val[DX_VALUE]) // original value, update here
                    val[DX_VALUE] = value; // override DX_VALUE with proxified value
                    super.setVal(val, true, is_transform)
                } 
                else super.setVal(value, true, is_transform)
    
    
                // creates weakref & adds garbage collection listener
                this.updateGarbageCollection(); 
    
                // proxify children, if not anonymous
                if (this.type.proxify_children) this.proxifyChildren();
    
                // save proxy + original value in map to find the right pointer for this value in the future
                Pointer.pointer_value_map.set(value, this);
    
                // pointer for value listeners?
                if (Pointer.pointer_for_value_created_listeners.has(val)) {
                    for (const l of Pointer.pointer_for_value_created_listeners.get(val)!) l(this);
                    Pointer.pointer_for_value_created_listeners.delete(val)
                }
                // pointer for id listeners
                if (Pointer.pointer_for_id_created_listeners.has(this.id)) {
                    for (const l of Pointer.pointer_for_id_created_listeners.get(this.id)!) l(this);
                    Pointer.pointer_for_id_created_listeners.delete(this.id)
                }
    
                // seal original value
                if (this.sealed) Object.seal(this.original_value);
            }

            // always use live transforms for non-primitive pointers:
            if (!is_transform) this.setForcedLiveTransform(true)
            
            // update registry
            Pointer.primitive_pointers.delete(this.#id); 
            Pointer.pointers.set(this.#id, this); 
        }

        // init value for JS-primitives value 
        else {
            this.#loaded = true; // this.value exists
            super.setVal(val, true, is_transform)

            // update registry
            Pointer.primitive_pointers.set(this.#id, new WeakRef(this)); 
            Pointer.pointers.delete(this.#id); 

            // pointer for id listeners
            if (Pointer.pointer_for_id_created_listeners.has(this.id)) {
                for (const l of Pointer.pointer_for_id_created_listeners.get(this.id)!) l(this);
                Pointer.pointer_for_id_created_listeners.delete(this.id)
            }

            // adds garbage collection listener
            this.updateGarbageCollection(); 
        }
       
    
        this.afterFirstValueSet();
    }

    protected add$Properties(val:object){
        try {
            // $ reference getter
            Object.defineProperty(val, "$", {
                get: ()=>this.$,
                enumerable: false
            })
            // $$ reference getter
            Object.defineProperty(val, "$$", {
                get: ()=>this.$$,
                enumerable: false
            })
        }
        catch(e) {
            logger.error("Cannot set $ properties for " + this.idString())
        }
    }

    /**
     * Overrides the current value of the pointer (only if the value has the correct type)
     * @param v new value
     * @returns promise which resolves when all update side effects are resolved
     */
    protected updateValue(v:RefOrValue<T>, trigger_observers = true, is_transform?:boolean) {
        const val = <T> Ref.collapseValue(v,true,true);
        const newType = Type.ofValue(val);

        // not changed (relevant for primitive values)
        if (this.current_val === val) {
            return;
        }

        if (this.type?.interface_config?.allow_transform_value) {
            let error:string|boolean
            if ((error = this.type.interface_config.allow_transform_value(newType, this)) !== true) {
                throw new ValueError("Invalid value type for transform pointer "+this.idString()+": " + newType + (error ? " - " + error : ""));
            }
        }
        else if ((v!==null&&v!==undefined) && !Type.matchesType(newType, this.type)) throw new ValueError("Invalid value type for pointer "+this.idString()+": " + newType + " - must be " + this.type);

        let updatePromise: Promise<any>|void;

        // set primitive value, reference not required
        if (this.is_js_primitive) {
            const didCustomUpdate = this.customTransformUpdate(val)
            if (!didCustomUpdate) updatePromise = super.setVal(val, trigger_observers, is_transform);
        }
        else {
            const didCustomUpdate = this.customTransformUpdate(val)
            if (!didCustomUpdate) this.type.updateValue(this.original_value, val);
            if (trigger_observers) updatePromise = this.triggerValueInitEvent(is_transform); // super.value setter is not called, trigger value INIT seperately
        }

        // propagate updates via datex
        if (this.send_updates_to_origin) {
            this.handleDatexUpdate(null, '#0=?;? = #0', [this.current_val, this], this.origin, true)
        }
        if (this.update_endpoints.size) {
            logger.debug("forwarding update to subscribers", this.update_endpoints);
            // console.log(this.#update_endpoints);
            this.handleDatexUpdate(null, '#0=?;? = #0', [this.current_val, this], this.update_endpoints, true)
        }

        // pointer value change listeners
        for (const l of Pointer.pointer_value_change_listeners) l(this);

        return updatePromise;
    }

    protected afterFirstValueSet(){
        // custom timeout from type?
        if (this.type.timeout!=undefined && this.datex_timeout==undefined) this.datex_timeout = this.type.timeout
        setTimeout(()=>{for (const l of Pointer.pointer_add_listeners) l(this)},0);
        Object.freeze(this);
    }


    #transform_scope?:Scope;
    get transform_scope() {return this.#transform_scope}

    #force_transform = false; // if true, the pointer transform function is always sent via DATEX
    set force_local_transform(force_transform: boolean) {this.#force_transform = force_transform}
    get force_local_transform() {return this.#force_transform}

    /**
     * transform observed values to update pointer value (using a transform function or DATEX transform scope)
     * @param values values to be observed (should be same as internal_vars in scope)
     * @param transform DATEX Scope or JS function
     * @param persistent_datex_transform  JUST A WORKAROUND - if transform is a JS function, a DATEX Script can be provided to be stored as a transform method
     */
    protected async handleTransformAsync<R,V extends TransformFunctionInputs>(observe_values:V, transform:AsyncTransformFunction<V,T&R>|Scope<RefOrValue<T&R>>, persistent_datex_transform?:string): Promise<Pointer<R>> {     
        
        const transformMethod = transform instanceof Function ? transform : ()=>transform.execute(Runtime.endpoint);

        const initialValue = await (observe_values.length==1 ? transformMethod(...<CollapsedDatexObjectWithRequiredProperties<V>>[Ref.collapseValue(observe_values[0], true, true)]) : transformMethod(...<CollapsedDatexObjectWithRequiredProperties<V>>observe_values.map(v=>Ref.collapseValue(v, true, true)))); // transform current value
        if (initialValue === VOID) throw new ValueError("initial tranform value cannot be void");
        this.setVal(initialValue, true, true);
        
        if (transform instanceof Scope) this.#transform_scope = transform; // store transform scope
        else if (persistent_datex_transform) {
            await this.setDatexTransform(persistent_datex_transform) // TODO: only workaround
        }

        // transform updates
        for (const value of observe_values) {
            if (value instanceof Ref) value.observe(async ()=>{
                const newValue = await (observe_values.length==1 ? transformMethod(...<CollapsedDatexObjectWithRequiredProperties<V>>[Ref.collapseValue(observe_values[0], true, true)]) : transformMethod(...<CollapsedDatexObjectWithRequiredProperties<V>>observe_values.map(v=>Ref.collapseValue(v, true, true)))); // update value
                if (newValue !== VOID) this.setVal(newValue, true, true)
            });
        }
        return <Pointer<T&R>>this;
    }

    protected handleTransform<R,V extends TransformFunctionInputs>(observe_values:V, transform:TransformFunction<V,T&R>, persistent_datex_transform?:string): Pointer<R> {     
        const initialValue = observe_values.length==1 ? transform(...<CollapsedDatexObjectWithRequiredProperties<V>>[Ref.collapseValue(observe_values[0], true, true)]) : transform(...<CollapsedDatexObjectWithRequiredProperties<V>>observe_values.map(v=>Ref.collapseValue(v, true, true))); // transform current value
        if (initialValue === VOID) throw new ValueError("initial tranform value cannot be void");
        this.setVal(initialValue, true, true);
        
        if (persistent_datex_transform) {
            this.setDatexTransform(persistent_datex_transform) // TODO: only workaround
        }

        // transform updates
        for (const value of observe_values) {
            if (value instanceof Ref) value.observe(()=>{
                const newValue = observe_values.length==1 ? transform(...<CollapsedDatexObjectWithRequiredProperties<V>>[Ref.collapseValue(observe_values[0], true, true)]) : transform(...<CollapsedDatexObjectWithRequiredProperties<V>>observe_values.map(v=>Ref.collapseValue(v, true, true))); // update value
                // await promise (should avoid in non-async transform)
                if (newValue instanceof Promise) newValue.then((val)=>this.setVal(val, true, true));
                else if (newValue !== VOID) this.setVal(newValue, true, true);
            });
        }

        return this as unknown as Pointer<R>;
    }

    protected getInitialTransformValue(val: T) {
        const type = Type.ofValue(val);
        this.#unwrapped_transform_type = type;
        if (type.interface_config?.wrap_transform) val = type.interface_config.wrap_transform(val);
        return val;
    }


    protected customTransformUpdate(val: T) {
        if (this.type.interface_config?.handle_transform) {
            this.type.interface_config.handle_transform(val, this)
            return true;
        }
        else return false;
    }

    public static WEAK_EFFECT_DISPOSED = Symbol("WEAK_EFFECT_DISPOSED")

    protected smartTransform<R>(transform:SmartTransformFunction<T&R>, persistent_datex_transform?:string, forceLive = false, ignoreReturnValue = false, options?:SmartTransformOptions): Pointer<R> {
        if (persistent_datex_transform) this.setDatexTransform(persistent_datex_transform) // TODO: only workaround

        const deps = new IterableWeakSet<Ref>();
        const keyedDeps = new IterableWeakMap<Pointer, Set<any>>().setAutoDefault(Set);

        let isLive = false;
        let isFirst = true;

        const returnCache = new Map<string, any>()

        const getDepsHash = () => {
            const norm = 
                [...deps].map(v=>Runtime.valueToDatexStringExperimental(v, false, false, false, true)).join("\n") + "\n" +
                [...keyedDeps].map(([ptr, keys]) => 
                    [...keys].map(key => Runtime.valueToDatexStringExperimental(ptr.getProperty(key), false, false, false, false)).join("\n")
                ).join("\n")
            const hash = sha256(norm)
            return hash;
        }

        const update = () => {
            // no live transforms needed, just get current value
            // capture getters in first update() call to check if there
            // is a static transform and show a warning
            if (!isLive && !isFirst) {
                this.setVal(transform() as T, true, true);
            }
            // get transform value and update dependency observers
            else {
                isFirst = false;

                let val!: T
                let capturedGetters: Set<Ref<any>> | undefined;
                let capturedGettersWithKeys: AutoMap<Pointer<any>, Set<any>> | undefined;

                if (options?.cache) {
                    const hash = getDepsHash()
                    if (returnCache.has(hash)) {
                        logger.debug("using cached transform result with hash " + hash)
                        val = returnCache.get(hash)
                    } 
                }

                // no cached value found, run transform function
                if (val === undefined) {
                    Ref.captureGetters();
    
                    try {
                        val = transform() as T;
                        // also trigger getter if pointer is returned
                        Ref.collapseValue(val, true, true); 
                    }
                    catch (e) {
                        if (e !== Pointer.WEAK_EFFECT_DISPOSED) console.error(e);
                        // invalid result, no update
                        return;
                    }
                    // always cleanup capturing
                    finally {
                        ({capturedGetters, capturedGettersWithKeys} = Ref.getCapturedGetters());
                    }
                }

                if (!ignoreReturnValue && !this.value_initialized) {
                    if (val == undefined) this.#is_js_primitive = true;
                    else this.#updateIsJSPrimitive(Ref.collapseValue(val,true,true));
                }
                
                // set isLive to true, if not primitive
                if (!this.is_js_primitive) {
                    isLive = true;
                    this._liveTransform = true
                }
    
                // update value
                if (!ignoreReturnValue) this.setVal(val, true, true);

                // remove return value if captured by getters
                // TODO: this this work as intended?
                capturedGetters?.delete(val instanceof Pointer ? val : Pointer.getByValue(val));
                capturedGettersWithKeys?.delete(val instanceof Pointer ? val : Pointer.getByValue(val));

                const hasGetters = capturedGetters||capturedGettersWithKeys;
                const gettersCount = (capturedGetters?.size??0) + (capturedGettersWithKeys?.size??0);

                // no dependencies, will never change, this is not the intention of the transform
                if (!ignoreReturnValue && hasGetters && !gettersCount) {
                    logger.warn("The transform value for " + this.idString() + " is a static value:", val);
                }

                if (isLive) {

                    if (capturedGetters) {
                        // unobserve no longer relevant dependencies
                        for (const dep of deps) {
                            if (!capturedGetters?.has(dep)) {
                                dep.unobserve(update, this.#unique);
                                deps.delete(dep)
                            }
                        }
                        // observe newly discovered dependencies
                        for (const getter of capturedGetters) {
                            if (deps.has(getter)) continue;
                            deps.add(getter)
                            getter.observe(update, this.#unique);
                        }
                    }

                    if (capturedGettersWithKeys) {
                        // unobserve no longer relevant dependencies
                        for (const [ptr, keys] of keyedDeps) {
                            const capturedKeys = capturedGettersWithKeys.get(ptr);
                            for (const key of keys) {
                                if (!capturedKeys?.has(key)) {
                                    ptr.unobserve(update, this.#unique, key);
                                    keys.delete(key)
                                }
                            }
                            if (keys.size == 0) keyedDeps.delete(ptr);
                        }

                        // observe newly discovered dependencies
                        for (const [ptr, keys] of capturedGettersWithKeys) {
                            const storedKeys = keyedDeps.getAuto(ptr);

                            for (const key of keys) {
                                if (storedKeys.has(key)) continue;
                                ptr.observe(update, this.#unique, key);
                                storedKeys.add(key);
                            }
                           
                        }
                    }
                    

                    if (options?.cache) {
                        const hash = getDepsHash()
                        returnCache.set(hash, val);
                    }
                }
            }
            
        }

        // set transform source with TransformSource interface
        this.setTransformSource({
            enableLive: (doUpdate = true) => {
                isLive = true;
                // get current value and automatically reenable observers
                if (doUpdate) update(); 
            },
            disableLive: () => {
                isLive = false;
                // disable all observers
                for (const dep of deps) dep.unobserve(update, this.#unique);
                for (const [ptr, keys] of keyedDeps) {
                    for (const key of keys) ptr.unobserve(update, this.#unique, key);
                }

                deps.clear();
            },
            update
        })

        if (forceLive) this.enableLiveTransforms(false);

        return this as unknown as Pointer<R>;
    }


    // TODO: JUST A WORKAROUND - if transform is a JS function, a DATEX Script can be provided to be stored as a transform method
    async setDatexTransform(datex_transform:string) {
        // TODO: fix and reenable
        try {
            this.#transform_scope = (await Runtime.executeDatexLocally(datex_transform)).transform_scope;
        }
        catch (e) {
            console.log("transform error", e);
        }
    }

    #registeredForGC = false;
    static #persistentPrimitivePointers = new Set<Pointer>();

    #updatePersistent() {
        if (this.is_persistent) {
            // make sure complex pointer value is persisted
            if (super.val instanceof WeakRef) super.setVal(super.val.deref(), false);
            // make sure primitive pointer is persisted
            if (this.#is_js_primitive) Pointer.#persistentPrimitivePointers.add(this);
        }
        else {
            // make sure complex pointer value is not persisted (add WeakRef if not yet added)
            if (!this.is_js_primitive && !(super.val instanceof WeakRef)) super.setVal(<any>new WeakRef(<any>super.val), false);
            // make sure primitive pointer is not persisted
            if (this.#is_js_primitive) Pointer.#persistentPrimitivePointers.delete(this);  
        }
    }

    // enable / disable garbage collection based on subscribers & is_persistant
    updateGarbageCollection(){
        if (!this.value_initialized) return;

        // remove WeakRef (keep value) if persistant, or has subscribers
        if (this.is_persistent) {
            //logger.warn("blocking " + this + " from beeing garbage collected")
            this.#garbage_collectable = false;

            // make sure persistent state is up to date
            this.#updatePersistent();

            if (this.#registeredForGC) {
                logger.debug("disabled garbage collection for " + this.id);
                Pointer.garbage_registry.unregister(this)
                this.#registeredForGC = false;
            }
        }
        // register finaliztion register (only once)
        else if (!this.#registeredForGC) {

            // add to garbage collection after timeout
            const _keep = this.current_val;
            setTimeout(()=>{
                if (!this.garbage_collected && this.value_initialized && !this.is_persistent) {
                    _keep; // prevent garbage collection until timeout finished
                    
                    // make sure persistent state is up to date
                    this.#updatePersistent();

                    this.#garbage_collectable = true;
                    try {
                        // TODO: update #subscribed of mockPointer when changed
                        const mockPointer = {id: this.id, origin: this.origin, is_origin: this.is_origin, subscribed: this.#subscribed};
                        this.#registeredForGC = true;
                        Pointer.garbage_registry.register(<object><unknown>(this.is_js_primitive ? this : this.current_val), mockPointer, this)
                    }
                    catch (e){
                        console.log(e)
                        logger.error("couldn't register for garbage collection: ", this.idString())
                    }
                }
            }, Runtime.OPTIONS.GARBAGE_COLLECTION_TIMEOUT);
        }
    }

    // only exists for non-js-primitive values
    public get original_value():T {    
        return (<WeakRef<any>>this.#original_value)?.deref()
    }

    // shadow object store primitive pointers per reference, collapses object pointers (to prevent garbage collection)
    public get shadow_object():{[key:string]:unknown}|undefined {    
        return (<WeakRef<any>>this.#shadow_object)?.deref()
    }

    get type():Type{
        return this.#unwrapped_transform_type ?? this.#type;
    }


    public extended_pointers = new Set<Pointer>()

    /**
     * sync all properties from one pointer with an other
     * only guaranteed to work for pointers with the same type, other (incompatible) types might cause problems
     * @param otherPointer 
     */
    public extend(otherPointer:Pointer|object, update_back = true) {
        if (!(otherPointer instanceof Pointer)) throw "not a pointer";
        logger.info(this + " is extending pointer " + otherPointer);

        for (let property of otherPointer.getKeys()) {
            this.extendProperty(otherPointer, property, update_back)
        }
    }

    // extend pointer (updates in both directions or in one direction)
    public extendProperty(otherPointer:Pointer, key:any, update_back = true) {
        console.log("extend poperty",key);
        if (!(otherPointer instanceof Pointer)) throw "not a pointer";

        this.extended_pointers.add(otherPointer);

        // add property
        this.val[key] = otherPointer.val[key];
        
        // prevent infinite loops
        let changing1 = false;
        let changing2 = false;

        // reflect changes from other pointer
        otherPointer.observe(value=>{
            if (changing2) return;
            changing1 = true;
            console.warn("other pointer cahnged", key, value)
            this.handleSet(key, value, false)
            changing1 = false;
        }, undefined, key);

        if (update_back) {
            // reflect own changes to other pointer
            this.observe(value=>{
                if (changing1) return;
                changing2 = true;
                console.warn("own pointer cahnged", key, value)
                otherPointer.handleSet(key, value)
                changing2 = false;
            }, undefined, key);
        }

    }



    public datex_timeout?:number

    public visible_children?:Set<string>; // list of all children that are visible to DATEX
    public sealed_properties?:Set<string>;
    public anonymous_properties?:Set<string>;

    // returns if a property of a @sync class can be read, returns true if not a @sync class
    public canReadProperty(property_name:string):boolean {
        return (!this.visible_children&& !DEFAULT_HIDDEN_OBJECT_PROPERTIES.has(property_name)) || this.visible_children.has(property_name)
    }
    
    // returns if a property of a @sync class can be updated, returns true if not a @sync class
    public canUpdateProperty(property_name:string):boolean {
        return this.canReadProperty(property_name) && (!this.sealed_properties || !this.sealed_properties.has(property_name));
    }

    #subscribers?: Disjunction<Endpoint>

    public get subscribers() {
        if (!this.#subscribers) {
            if (Runtime.subscriber_cache?.has(this.id)) {
                this.#subscribers = new Disjunction(...Runtime.subscriber_cache.get(this.id)!)
                logger.debug("restored subscriber cache for " + this.idString() + ":",this.#subscribers)
            }
            else this.#subscribers = new Disjunction();
        }
        return this.#subscribers!;
    }

    public addSubscriber(subscriber: Endpoint) {
        if (this.subscribers.has(subscriber)) {
            // logger.warn(subscriber.toString() + " re-subscribed to " + this.idString());
            //return;
        }
        this.subscribers.add(subscriber);
        if (this.subscribers.size == 1) this.updateGarbageCollection() // first subscriber
        if (this.streaming.length) setTimeout(()=>this.startStreamOutForEndpoint(subscriber), 1000); // TODO do without timeout?
        // force enable live mode also if primitive (subscriber is not handled a new observer)
        if (this.is_js_primitive) this.setForcedLiveTransform(true)

        // update subscriber_cache
        Runtime.subscriber_cache?.getAuto(this.id).add(subscriber)
    }

    public removeSubscriber(subscriber: Endpoint) {
        this.subscribers.delete(subscriber);
        // no subscribers left
        if (this.subscribers.size == 0) {
            // disable force live mode for primitives (subscriber is not handled a new observer)
            if (this.is_js_primitive) this.setForcedLiveTransform(false)
            this.updateGarbageCollection() 
        }

        // update subscriber_cache
        if (this.subscribers.size == 0) {
            Runtime.subscriber_cache?.delete(this.id);
        }
        else {
            Runtime.subscriber_cache?.getAuto(this.id).delete(subscriber)
        }
    }
    


    // updates are from datex (external) and should not be distributed again or local update -> should be distributed to subscribers
    #update_endpoints: Disjunction<Endpoint>; // endpoint to update

    get send_updates_to_origin() {
        // assumes origin is not current endpoint
        // don't send if exclude_origin_from_updates set or has a local transform_scope
        return this.origin && !this.is_origin && !(this.#exclude_origin_from_updates || this.transform_scope)
    }

    #exclude_origin_from_updates?:boolean;
    public excludeEndpointFromUpdates(endpoint:Endpoint) {
        // TODO origin equals id also for remote endpoints!
        if (this.origin.equals(endpoint)) this.#exclude_origin_from_updates = true;
        else {
            this.#update_endpoints = new Disjunction(...this.subscribers);
            this.#update_endpoints.delete(endpoint);
        }
    }
    public enableUpdatesForAll() {
        this.#exclude_origin_from_updates = false;
        this.#update_endpoints = this.subscribers;
    }
    get update_endpoints() {
        if (!this.#update_endpoints) this.#update_endpoints = this.subscribers
        return this.#update_endpoints!;
    }


    // TODO merge with Datex.Runtime.runtime_actions.getKeys
    public getKeys(array_indices_as_numbers = false):Iterable<any> {
        // restricted to visible_children
        if (this.visible_children) return this.visible_children;

        let keys = JSInterface.handleKeys(this.current_val, this.type);
        if (keys == INVALID) throw new ValueError("Value has no iterable content");
        if (keys == NOT_EXISTING) {
            if (this.current_val instanceof Array) {
                if (array_indices_as_numbers) return [...this.current_val.keys()]
                else return [...this.current_val.keys()].map(BigInt);
            }
            else keys = Object.keys(this.current_val); // default Object.keys
        }
        return keys;
    }

    // proxify a (child) value, use the pointer context
    private proxifyChild(name:any, value:any) {
        let child = value === NOT_EXISTING ? this.shadow_object[name] : value;
        
        // special native function -> <Function> conversion;
        if (typeof child == "function" && !(child instanceof DatexFunction) && !(child instanceof JSTransferableFunction)) {
            child = DatexFunction.createFromJSFunction(child, this, name);
        }

        // create/get pointer, same permission filter
        return Pointer.proxifyValue(child, false, this.allowed_access, this.anonymous_properties?.has(name), false, true);
    }

    /** proxify the child elements of a proxified value */
    private proxifyChildren() {

        // console.log("is objet like " + this.type, this.type.interface_config.is_normal_object)

        if (!this.shadow_object) return;
        // normal object with properties
        if (!this.type.interface_config || this.type.interface_config.is_normal_object) this.objProxifyChildren();
        // other children (e.g. Set, Map)
        else this.specialProxifyChildren()

        return;
    }

    /**
     * Add pointers to all non-primitive children recursively.
     * For special objects like Maps, Sets, ...
     */
    private specialProxifyChildren() {
        if (!this.type.interface_config) throw new Error("Cannot proxify children of type " + this.type);
        for (const key of this.getKeys()) {
            const prop = this.getProperty(key);
            // "Set" like type
            if (prop == NOT_EXISTING) {
                if (!this.type.interface_config.action_add || !this.type.interface_config.action_subtract) 
                    throw new Error("Cannot add children to type " + this.type);
                this.type.interface_config.action_subtract(this.val, key, true) 
                this.type.interface_config.action_add(this.val, this.proxifyChild(undefined, key), true) 
            }
            // key->value relationship
            else {
                if (!this.type.interface_config.set_property_silently) 
                    throw new Error("Cannot set property of type " + this.type);
                this.type.interface_config.set_property_silently(this.val, key, this.proxifyChild(undefined, prop), this) 
            }
        }
    }

    /**
     * Add pointers to all non-primitive children recursively.
     * For normal objects-like values with properties
     */
    private objProxifyChildren() {
        const high_priority_keys = new Set();// remember higher priority keys in prototype chain, don't override observer with older properties in the chain

        const value = this.shadow_object!;
        for (const name of this.visible_children ?? Object.keys(value)) {
            const type = Type.ofValue(value[name])

            // non primitive value - proxify always
            if (!type.is_primitive) {
                // custom timeout for remote proxy function
                if (value[name] instanceof DatexFunction && this.type?.children_timeouts?.has(name)) {
                    value[name].datex_timeout = this.type.children_timeouts.get(name);
                }
                // save property to shadow_object
                this.initShadowObjectProperty(name, this.proxifyChild(name, NOT_EXISTING))
            }

            // already proxified child - set observers
            else if (value[name] instanceof Ref) {
                this.initShadowObjectPropertyObserver(name, value[name]);
            }
            high_priority_keys.add(name);
        }

        // also observe prototype reference properties
        let prototype = value;
        // iterate up until Object.protoype reached
        while ((prototype = Object.getPrototypeOf(prototype)) != Object.prototype) {
            for (const name of this.visible_children ?? Object.keys(prototype)) {
                try {
                    if (prototype[name] instanceof Ref && !high_priority_keys.has(name)) { // only observer Values, and ignore if already observed higher up in prototype chain
                        this.initShadowObjectPropertyObserver(name, <Ref>prototype[name]);
                    }
                } catch (e) {
                    logger.warn("could not check prototype property:",name)
                }
               
                high_priority_keys.add(name);
            }
        }
    }

    #custom_prop_getter?:(key:unknown)=>unknown
    #custom_prop_setter?:(key:unknown, value:unknown)=>unknown

    public setPropertyGetter(getter:(key:unknown)=>unknown) {
        this.#custom_prop_getter = getter; 
    }

    public setPropertySetter(setter: (key:unknown, value:unknown)=>unknown) {
        this.#custom_prop_setter = setter; 
    }


    /** create proxy for object and adds listeners */
    private addObjProxy(obj:T):T {   

        // custom proxy
        const res = JSInterface.createProxy(obj, this, this.type);
        if (res != INVALID && res != NOT_EXISTING) return res; // proxy created successfully

        if (typeof obj == "symbol" || obj instanceof Stream || obj instanceof DatexFunction || obj instanceof JSTransferableFunction) { // no proxy needed?!
            return obj;
        }

        // fake primitives TODO: dynamic mime types
        if (obj instanceof Quantity || obj instanceof Time || obj instanceof Type || obj instanceof URL  || obj instanceof Target || obj instanceof Blob || (globalThis.HTMLImageElement && obj instanceof HTMLImageElement)) {
            return obj;
        }

        // convert date to time
        if (obj instanceof Date) {
            return <T><unknown> new Time(obj);
        }

        // special native function -> <Function> conversion
        if (typeof obj == "function" && !(obj instanceof DatexFunction) && !(obj instanceof JSTransferableFunction)) return <T><unknown> DatexFunction.createFromJSFunction(obj as (...params: any[]) => any);

        // get prototype and prototype of prototype (TODO go up the full protoype chain??!)
        let prototype1 = Object.getPrototypeOf(obj);
        let prototype2 = prototype1 && Object.getPrototypeOf(prototype1);
        if (prototype1 == Object.prototype) prototype1 = undefined;
        if (prototype2 == Object.prototype) prototype2 = undefined;

        // is a sealed 'DatexObject' (no proxy needed, getters/setters already included in DatexObject)
        if (obj[SHADOW_OBJECT] && Object.isSealed(obj)) {
            obj[SET_PROXY] = (k,v)=>this.handleSet(k,v);
            this.#shadow_object = new WeakRef(obj[SHADOW_OBJECT]);
            return obj;
        }

        // only define getters/setters (no Proxy wrapper class)
        else if (!Object.isSealed(obj) &&this.visible_children) {

            // set new shadow_object to handle properties in background
            const shadow_object = {[DX_PTR]:this};
            this.#shadow_object = new WeakRef(shadow_object);

            for (const name of this.visible_children) {

                /** extract existing getter + setter */
                // get descriptor containing getter/setter
                const property_descriptor = Object.getOwnPropertyDescriptor(obj,name) 
                    ?? (prototype1 && Object.getOwnPropertyDescriptor(prototype1,name))
                    ?? (prototype2 && Object.getOwnPropertyDescriptor(prototype2,name));

                // add original getters/setters to shadow_object if they exist (and call with right 'this' context)
                if (property_descriptor?.set || property_descriptor?.get) {
                    
                    // @property getter: set pointer as property instead of getter
                    // TODO: what should happen if getter & SETTER set (still use always transform?)
                    if (property_descriptor.get && !property_descriptor?.set) {
                        
                        // copied from always in datex_short
                        const transformRef = Pointer.createSmartTransform(property_descriptor.get.bind(obj));

                        Object.defineProperty(shadow_object, name, {value:transformRef})
                    }
                    // bind default getters and setters
                    else {
                        const descriptor:PropertyDescriptor = {};
                        if (property_descriptor.set) descriptor.set = val => property_descriptor.set?.call(obj,val);
                        if (property_descriptor.get) descriptor.get = () =>  property_descriptor.get?.call(obj)
    
                        Object.defineProperty(shadow_object, name, descriptor);
                    }
                   
                }
                // no original getter/setter
                else shadow_object[name] = obj[name];

               
                // new getter + setter
                Object.defineProperty(obj, name, {
                    configurable:  true, // TODO: cant be false because of uix @content bindings, fix
                    enumerable: true,
                    set: val => { 
                        this.handleSet(name, val);
                    },
                    get: () => { 
                        this.handleBeforeNonReferencableGet(name);
                        // important: reference shadow_object, not this.shadow_object here, otherwise it might get garbage collected
                        return Ref.collapseValue(shadow_object[name], true, true);
                    }
                });
            
            }

            return obj;
        }
 
        // create Proxy class around object
        if (typeof obj == "object" && obj != null) {

            const is_array = Array.isArray(obj);

            if (is_array) {
                // overwrite special array methods TODO

                try {
                    Object.defineProperty(obj, "splice", {
                        value: this.arraySplice.bind(this),
                        enumerable: false,
                        writable: false
                    })
                }
                catch (e) {
                    logger.error("Cannot set custom array methods on " + this.idString())
                }
            }

			const proxy = new Proxy(<any>obj, {
                get: (_target, key) => {
                    if (key == DX_PTR) return this;
                    if (this.#custom_prop_getter && (!this.shadow_object || !(key in this.shadow_object)) && !(typeof key == "symbol")) return this.#custom_prop_getter(key);
                    const val:any = Ref.collapseValue(this.shadow_object?.[key], true, true);

                    if (key != "$" && key != "$$") {
                        if (is_array) this.handleBeforeNonReferenceableGetArray(key);
                        else this.handleBeforeNonReferencableGetObject(key)
                    }

                    // should fix #private properties, but does not seem to work for inheriting classes?
                    if (typeof val == "function" 
                        && key != "$" 
                        && key != "$$" 
                        && typeof val.bind == "function"
                        // ignore constructors
                        && key != "constructor"
                        // ignore builtin object/array methods
                        && !(_target.constructor == Array && (arrayProtoNames.includes(key as string)))
                        && !(_target.constructor == Object && (objectProtoNames.includes(key as string)))
                    ) {
                        const propertyDesc = Object.getOwnPropertyDescriptor(_target, key);
                        if (propertyDesc && propertyDesc.writable == false && propertyDesc.configurable == false) {
                            // not allowed, return without bind
                            return val;
                        }
                        return val.bind(_target);
                    }
                    else return val;
                },
                set: (target, val_name: keyof any, val: any) => {
                    if (this.#custom_prop_setter) {
                        return this.#custom_prop_setter(val_name, val);
                    }

                    // length changed
                    if (is_array && val_name == "length") {
                        // add empty values
                        if (val > obj.length) {
                            // do not change in DATEX
                            //for (let i=obj.length; i<val;i++) this.handleSet(i, undefined);
                            throw new ValueError("<Array> property 'length' cannot be increased");
                        }
                        // delete values
                        else if (val < obj.length) {
                            for (let i=obj.length-1; i>=val;i--) {
                                if (i in obj) this.handleDelete(BigInt(i));
                            }
                            // update array length if shorter than previous
                            obj.length = val;
                        }
                        
                        return true;
                    }

                    // ignore DATEX handling if array and not an index property
                    if (is_array && !(typeof val_name == "number" || typeof val_name == "bigint" || /^[0-9]+$/.test(globalThis.String(val_name)))) {
                        target[val_name] = val;
                        return true;
                    }

                    // also ignore symbol keys
                    if (typeof val_name == "symbol") {
                        target[val_name] = val;
                        return true;
                    }

                    this.handleSet(is_array ? BigInt(Number(val_name)) : val_name, val);

                    // x = void => delete; trim array to match DATEX Arrays
                    if (is_array && val === VOID && Number(val_name)+1==obj.length) Runtime.runtime_actions.trimArray(obj)

                    return true;
                },
                deleteProperty: (target, prop) => {

                    this.handleDelete(is_array ? BigInt(Number(prop)) : prop);   
                    
                    // trim array to match DATEX Arrays
                    if (is_array && Number(prop)+1==obj.length) Runtime.runtime_actions.trimArray(obj)

                    return true
                }
            });

            // set right 'this' context for getters / setters
            for (const name of [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertyNames(prototype1??{}), ...Object.getOwnPropertyNames(prototype2??{})]) {
                // get descriptor containing getter/setter
                const property_descriptor = Object.getOwnPropertyDescriptor(obj,name) 
                ?? Object.getOwnPropertyDescriptor(prototype1,name) 
                ?? (prototype2 && Object.getOwnPropertyDescriptor(prototype2,name));

                // add original getters/setters to shadow_object if they exist (and call with right 'this' context)
                if (property_descriptor?.set || property_descriptor?.get) {
                    try {
                        Object.defineProperty(obj, name, {
                            set: val => {property_descriptor.set?.call(proxy,val)},
                            get: () =>  property_descriptor.get?.call(proxy)
                        });
                    }
                    catch (e) {
                        console.log(obj, name);
                        console.log(e)
                    }
                }
            }

            return proxy;
        }

        else {
            return obj;
        }
    }


    private handleBeforeNonReferenceableGetArray(key: string|symbol) {
        // assumes map, filter, etc. gets called after property is accessed
        if (typeof key=="string" && observableArrayMethods.has(key)) this.handleBeforeNonReferencableGet()
        else this.handleBeforeNonReferencableGetObject(key);
    }

    private handleBeforeNonReferencableGetObject(key: string|symbol) {
        if (Object.hasOwn(this.shadow_object!, key)) {
            this.handleBeforeNonReferencableGet(key);
        }
    }


    // get property by key
    // if leak_js_properties is true, primitive + prototype methods (like toString are also accessible) - should only be used in JS context
    public getProperty(key:unknown, leak_js_properties = false) {
        let property_value = JSInterface.handleGetProperty(this.shadow_object, key, this.type)
        if (property_value == INVALID || property_value == NOT_EXISTING) {
            // all JS properties
            if (leak_js_properties && this.current_val && key in this.current_val) {
                property_value = this.current_val?.[key]; 
                // also bind non-datex function to parent
                return (typeof property_value == "function") ? (...args:unknown[])=>(<Function>property_value).apply(this.current_val, args) : property_value;
            }
            // restricted to DATEX properties
            else if (this.shadow_object && key in this.shadow_object) property_value = Ref.collapseValue(this.shadow_object[key], true, true)
        }
        return property_value;
    }

    // update reference of property to new value
    handleSetReference(key:string, value:unknown, ignore_if_unchanged = true) {
        value = Pointer.pointerifyValue(value); // make sure the value is a reference if possible (can also be a plain value)
        // convert key to datex conform key
        key = Pointer.proxifyValue(key);

        // does property exist in DATEX?
        if (!this.type.isPropertyAllowed(key)) {
            throw new ValueError("Property '" + key + "' does not exist")
        }

        // JS number -> bigint conversion
        if (typeof value == "number" && this.type.getAllowedPropertyType(key).root_type == Type.std.integer) value = BigInt(value);

        // invalid type for value?
        this.type.assertPropertyValueAllowed(key, value)

        this.initShadowObjectProperty(key, value);

    }

    // directly set value of property (reference)
    handleSet(key:unknown, value:unknown, ignore_if_unchanged = true, always_use_provided_value = false) {

        if (!this.current_val) return;
        // convert value/key to datex conform value/key
        value = this.type.proxify_children&&!always_use_provided_value ? this.proxifyChild(key, value) : value;
        key = Pointer.proxifyValue(key);
        
        const obj = this.current_val;
        let existed_before = false;

        // write permission?
        
        // does property exist in DATEX?
        if (!this.type.isPropertyAllowed(key)) {
            throw new ValueError("Property '" + key + "' does not exist")
        }

        // JS number -> bigint conversion
        if (typeof value == "number" && this.type.getAllowedPropertyType(key).root_type == Type.std.integer) value = BigInt(value);

        // invalid type for value?
        this.type.assertPropertyValueAllowed(key, value)

        // get current value
        const current_value = this.getProperty(key);


        // value has not changed, TODO ? only okay if undefined and not key not previously in object (explicitly setting to void/undefined)
        if (current_value === value && ignore_if_unchanged) {
            return;
        }


        if (current_value !== undefined) existed_before = true;
  
        // try set on custom pseudo class
        const res = JSInterface.handleSetPropertySilently(obj, key, value, this, this.type);
        if (res == INVALID || res == NOT_EXISTING) this.updateShadowObjectProperty(key, value); // set on original_value

        // change to <Int> for DATEX if <Array>
        if ((res == INVALID || res == NOT_EXISTING) && this.shadow_object instanceof Array) key = BigInt(key); 

        // inform observers
        return this.handleSetObservers(key, value, existed_before, current_value);
    }

    /**
     * trigger local and remote observers for SET action
     * @param key property key
     * @param value optional value, if not set, resolved via key
     * @param existed_before was the property already initialized on the value
     * @returns 
     */
    handleSetObservers(key: any, value?: any, existed_before = false, previous?: any) {

        // get current value
        value = value ?? this.getProperty(key);

        if (this.send_updates_to_origin) {
            this.handleDatexUpdate(key, Runtime.PRECOMPILED_DXB.SET_PROPERTY, [this, key, value], this.origin)
        }
        if (this.update_endpoints.size) {
            this.handleDatexUpdate(key, Runtime.PRECOMPILED_DXB.SET_PROPERTY, [this, key, value], this.update_endpoints)
        }

        // make sure the array index is a number
        if (this.current_val instanceof Array) key = Number(key);


        // inform listeners
        // property changed
        if (existed_before && Pointer.pointer_property_change_listeners.size) {
            setTimeout(()=>{
                for (const l of Pointer.pointer_property_change_listeners) l(this, key, value)
            }, 0)
        }
        // property was added new
        else if (!existed_before && Pointer.pointer_property_add_listeners.size) {
            setTimeout(()=>{
                for (const l of Pointer.pointer_property_add_listeners) l(this, key, value)
            }, 0)
        }

        // inform observers
        return this.callObservers(value, key, Ref.UPDATE_TYPE.SET, false, false, previous)
    }


    handleAdd(value:any) {
        if(!this.current_val) return;

        // convert value to datex conform value
        value = this.type.proxify_children ? this.proxifyChild(undefined, value) : value;

        const obj = this.current_val;

        let index:number;

        if (this.shadow_object instanceof Array) index = this.shadow_object.push(value); // Array push
        // try set on custom pseudo class
        else {
            try {
                this.type.handleActionAdd(obj, value, true);
            } catch (e) {
                 throw new ValueError("Cannot add values to this value");
            }
        }
        

        // propagate updates via datex
        if (this.send_updates_to_origin) {
            this.handleDatexUpdate(null, '? += ?', [this, value], this.origin)
        }
        if (this.update_endpoints.size) {
            this.handleDatexUpdate(null, '? += ?', [this, value], this.update_endpoints)
        }
        

        // inform listeners
        if (Pointer.pointer_property_add_listeners.size) {
            setTimeout(()=>{
                index = index ?? (<any[]>Runtime.serializeValue(this.current_val))?.indexOf(value) // array: use index, Set: first serialize to array and get index
                for (const l of Pointer.pointer_property_add_listeners) l(this, index, value)
            }, 0);
        }


        // inform observers
        return this.callObservers(value, VOID, Ref.UPDATE_TYPE.ADD)

    }

    private streaming:[boolean?] = []; // use array because DatexPointer is sealed
    startStreamOut() {
        const obj = this.current_val;

        // only if this.value is a DatexStream
        if (!obj || !(obj instanceof Stream)) return;

        this.streaming.push(true); // also stream for all future subscribers

        if (this.send_updates_to_origin) {
            logger.info("streaming to parent " + this.origin);
            this.handleDatexUpdate(null, '? << ?'/*DatexRuntime.PRECOMPILED_DXB.STREAM*/, [this, obj], this.origin)
        }
        if (this.update_endpoints.size) {
            logger.info("streaming to subscribers " + this.update_endpoints);
            this.handleDatexUpdate(null, '? << ?'/*DatexRuntime.PRECOMPILED_DXB.STREAM*/, [this, obj], this.update_endpoints)
        }
    }

    // TODO better way than streaming individually to every new subscriber?
    startStreamOutForEndpoint(endpoint:Endpoint) {
        logger.info("streaming to new subscriber " + endpoint);
        this.handleDatexUpdate(null, '? << ?'/*DatexRuntime.PRECOMPILED_DXB.STREAM*/, [this, this.current_val], endpoint)
    }
    

    /** all values are removed */
    handleClear() {
        if(!this.current_val) return;

        let obj = this.current_val;

        // get keys before clear (array indices as numbers, not integers)
        const keys = this.getKeys(true);

        const res = JSInterface.handleClearSilently(obj, this, this.type);
        if (res == INVALID || res == NOT_EXISTING) {
            if (this.shadow_object instanceof Array) Array.prototype.splice.call(this.shadow_object, 0, this.shadow_object.length); // Array clear
            else throw new ValueError("Cannot perform clear operation on this value");
        }


        // propagate updates via datex?
        if (this.send_updates_to_origin) {
            this.handleDatexUpdate(null, Runtime.PRECOMPILED_DXB.CLEAR_WILDCARD, [this], this.origin)
        }
        if (this.update_endpoints.size) {
            this.handleDatexUpdate(null, Runtime.PRECOMPILED_DXB.CLEAR_WILDCARD, [this], this.update_endpoints)
        }



        // inform listeners
        if (Pointer.pointer_property_delete_listeners.size) {
            setTimeout(()=>{
                for (const l of Pointer.pointer_property_delete_listeners) l(this, undefined)
            }, 0)
        }

        // inform observers
        this.callObservers(VOID, VOID, Ref.UPDATE_TYPE.CLEAR)
    }

    /** all values are removed */
    handleSplice(start_index:number, deleteCount:number, replace:Array<bigint>) {
        if(!this.current_val) return;

        if (deleteCount == 0 && !replace.length) return; // nothing changes

        const obj = this.current_val;

        if (!(obj instanceof Array)) {
            logger.error("Cannot handle splice for non-array value");
            return;
        }
        
        const start = BigInt(start_index);
        const end = BigInt(start_index+deleteCount);
        let size = BigInt(deleteCount);
        const replace_length = BigInt(replace.length);

        // removed overflows array length
        if (start+size > obj.length) size = BigInt(obj.length) - start;


        const netDeleteCount = deleteCount - replace?.length;
        const originalLength = obj.length;
        // array splice
        // trigger BEFORE_DELETE
        for (let i = obj.length - netDeleteCount; i < obj.length; i++) {
            this.callObservers(obj[i], i, Ref.UPDATE_TYPE.BEFORE_DELETE)
        }

        // previous entries
        const previous = [...obj]

        const ret = Array.prototype.splice.call(this.shadow_object, start_index, deleteCount, ...replace);

        // propagate updates via datex?
        if (this.send_updates_to_origin) {
            if (!replace?.length) this.handleDatexUpdate(null, '#0 = ?0; #1 = count #0;#0.(?1..?2) = void;#0.(?1..#1) = #0.(?3..#1);', [this, start, end, start+size], this.origin) // no insert
            else this.handleDatexUpdate(null, '#0=?0;#0.(?4..?1) = void; #0.(?2..((count #0) + ?3)) = #0.(?4..(count #0));#0.(?4..?5) = ?6;', [this, end, start-size+replace_length, replace_length, start, start+replace_length, replace], this.origin) // insert
        }
        if (this.update_endpoints.size) {
            if (!replace?.length) this.handleDatexUpdate(null, '#0 = ?0; #1 = count #0;#0.(?1..?2) = void;#0.(?1..#1) = #0.(?3..#1);', [this, start, end, start+size], this.update_endpoints) // no insert
            else  this.handleDatexUpdate(null, '#0=?0;#0.(?4..?1) = void; #0.(?2..((count #0) + ?3)) = #0.(?4..(count #0));#0.(?4..?5) = ?6;', [this, end, start-size+replace_length, replace_length, start, start+replace_length, replace], this.update_endpoints) // insert
        }

        // inform observers TODO what to do here?
        //for (let o of this.general_change_observers||[]) o(undefined); 
        
        // inform listeners
        if (Pointer.pointer_property_delete_listeners.size) {
            setTimeout(()=>{
                for (const l of Pointer.pointer_property_delete_listeners) l(this, undefined)
            }, 0)
        }

        const atomicId = Symbol("ATOMIC_SPLICE")

        // inform observers after splice finished - value already in right position
        for (let i = originalLength-1; i>=start_index; i--) {
            // element moved here?
            if (i < obj.length) {
                this.callObservers(obj[i], i, Ref.UPDATE_TYPE.SET, undefined, undefined, previous[i], atomicId)
            }
            // end of array, trigger delete
            else {
                this.callObservers(VOID, i, Ref.UPDATE_TYPE.DELETE, undefined, undefined, previous[i], atomicId)
            }
        }
       

        return ret;
    }

    /** value is removed (by key)*/
    handleDelete(key:any, arrayResize = false) {
        if(!this.current_val) return;

        const obj = this.current_val;

        // does property exist in DATEX?
        if (!this.type.isPropertyAllowed(key)) {
            throw new ValueError("Property '" + key + "' does not exist")
        }

        const previous = this.getProperty(key);
        // inform observers before delete
        this.callObservers(previous, key, Ref.UPDATE_TYPE.BEFORE_DELETE)

        const res = JSInterface.handleDeletePropertySilently(obj, key, this, this.type);
        if (res == INVALID || res == NOT_EXISTING) {
            if (arrayResize && this.shadow_object instanceof Array && typeof key == "number") {
                this.shadow_object.splice(key, 1);
            }
            else delete this.shadow_object[key]; // normal object
        }

        // propagate updates via datex
        
        if ((res == INVALID || res == NOT_EXISTING) && this.shadow_object instanceof Array) key = BigInt(key); // change to <Int> for DATEX if <Array>

        if (this.send_updates_to_origin) {
            this.handleDatexUpdate(null, '?.? = void', [this, key], this.origin)
        }
        if (this.update_endpoints.size) {
            this.handleDatexUpdate(null, '?.? = void', [this, key], this.update_endpoints)
        }
        

       
        // inform listeners
        if (Pointer.pointer_property_delete_listeners.size) {
            setTimeout(()=>{
                for (let l of Pointer.pointer_property_delete_listeners) l(this, key)
            }, 0);
        }
        
        // inform observers
        return this.callObservers(VOID, key, Ref.UPDATE_TYPE.DELETE, undefined, undefined, previous)

    }

    /** value is removed */
    handleRemove(value:any) {
        if(!this.current_val) return;

        let obj = this.current_val;

        // inform observers before remove
        this.callObservers(value, undefined, Ref.UPDATE_TYPE.BEFORE_REMOVE)

        // try set on custom pseudo class
        try {
            this.type.handleActionSubtract(obj, value, true);
        } catch (e) {
            throw new ValueError("Cannot subtract values from this value");
        }
        

        // propagate updates via datex
        if (this.send_updates_to_origin) {
            this.handleDatexUpdate(null, '? -= ?', [this, value], this.origin)
        }
        if (this.update_endpoints.size) {
            logger.debug("forwarding delete to subscribers " + this.update_endpoints);
            this.handleDatexUpdate(null, '? -= ?', [this, value], this.update_endpoints)
        }


        // inform listeners
        if (Pointer.pointer_property_delete_listeners.size) {
            setTimeout(()=>{
                for (let l of Pointer.pointer_property_delete_listeners) l(this, value)
            }, 0);
        }

        // inform observers
        return this.callObservers(value, VOID, Ref.UPDATE_TYPE.REMOVE)

    }

    // actual update to subscribers/origin
    // if identifier is set, further updates to the same identifier are overwritten
    async handleDatexUpdate(identifier:string|null, datex:string|PrecompiledDXB, data:any[], receiver:endpoints, collapse_first_inserted = false){
        
        // let schedulter handle updates (cannot throw errors)
        if (this.#scheduler) {
            this.#scheduler.addUpdate(this, identifier, datex, data, receiver, collapse_first_inserted);
        }

        // directly send update
        else {
            if (receiver instanceof Disjunction && !receiver.size) return;
            try {
                await Runtime.datexOut([datex, data, {collapse_first_inserted, type:ProtocolDataType.UPDATE}], receiver, undefined, false, undefined, undefined, false, undefined, this.datex_timeout);
            } catch(e) {
                //throw e;
                logger.error("forwarding failed", e, datex, data)
            }
        }

    }

    // set new reference
    protected initShadowObjectProperty(key:string, value:unknown){
        if (!this.shadow_object) throw new Error("pointer has no shadow object");

        this.shadow_object[key] = value;

        // add observer for internal changes
        if (value instanceof Ref) {
            this.initShadowObjectPropertyObserver(key, value);
        }

    }

    #active_property_observers = new Map<string, [Ref, observe_handler<unknown, RefLike<any>>]>();
    #unique = {}

    // set observer for internal changes in property value reference
    protected initShadowObjectPropertyObserver(key:string, value:Ref){
        // console.log("set reference observer" + this.idString(),key,value)

        // remove previous observer for property
        if (this.#active_property_observers.has(key)) {
            const [value, handler] = this.#active_property_observers.get(key)!;
            Ref.unobserve(value, handler, this.#unique);
        }

        // new observer 
        // TODO: is weak pointer reference correct here?
        const ref = new WeakRef(this);
        const handler = (_value: unknown, _key?: unknown, _type?: Ref.UPDATE_TYPE, _is_transform?: boolean, _is_child_update?: boolean, previous?: any) => {
            const self = ref.deref();
            if (!self) return;
            // console.warn(_value,_key,_type,_is_transform)
            // inform observers (TODO: more update event info?, currently just acting as if it was a SET)
            self.callObservers(_value, key, Ref.UPDATE_TYPE.SET, _is_transform, true, previous)
        };

        Ref.observeAndInit(value, handler, this.#unique);
        this.#active_property_observers.set(key, [value, handler]);
    }


    // update value of property reference
    protected updateShadowObjectProperty(key:string, value:unknown){
        if (!this.shadow_object) throw new Error("pointer has no shadow object");
        // TODO: this currently only makes sense for primitive pointers in JS? in DATEX style, to update the property containing an object value, you should use x.$.z = {}, not x.z = {}. but might get confusing for now..
        const reference = Pointer.pointerifyValue(this.shadow_object[key]);
        if (reference instanceof Pointer && reference.is_js_primitive) reference.val = value; // update reference value (for primitive pointers at least)
        else this.shadow_object[key] = value; // update normal
    }


    private change_observers: Map<any, Map<observe_handler, observe_options|undefined>> = new Map();
    private bound_change_observers: Map<object, Map<any, Map<observe_handler, observe_options|undefined>>> = new Map();
    private general_change_observers: Map<observe_handler, observe_options|undefined> = new Map(); // property_update is always true, undefined for other DatexValues / when the actual value is updated
    private bound_general_change_observers: Map<object, Map<observe_handler, observe_options|undefined>> = new Map(); // property_update is always true, undefined for other DatexValues / when the actual value is updated

    // observe pointer value change (primitive) of change of a key
    public override observe<K=unknown>(handler:observe_handler<K, this>, bound_object?:object, key?:K, options?:observe_options):void {
        if (!handler) throw new ValueError("Missing observer handler")
        
        // TODO handle bound_object in pointer observers/unobserve
        // observe all changes
        if (key == undefined) {
            super.observe(handler, bound_object, options); // default observer

            if (bound_object) {
                if (!this.bound_general_change_observers.has(bound_object)) this.bound_general_change_observers.set(bound_object, new Map());
                this.bound_general_change_observers.get(bound_object)!.set(handler, options);
            }
            else this.general_change_observers.set(handler, options); // observer property updates
        }
        // observe specific property
        else {
            // make sure the array index is a number
            if (this.current_val instanceof Array) key = <K><unknown>Number(key);

            if (bound_object) {
                if (!this.bound_change_observers.has(bound_object)) {
                    this.bound_change_observers.set(bound_object, new Map());
                }
                const bound_object_map = this.bound_change_observers.get(bound_object)!;
                if (!bound_object_map.has(key)) bound_object_map.set(key, new Map());
                bound_object_map.get(key)!.set(handler, options);
            }
            else {
                if (!this.change_observers.has(key)) this.change_observers.set(key, new Map());
                this.change_observers.get(key)!.set(handler, options);
            }
        }
    }



    public override unobserve<K=any>(handler:(value:any, key?:K, type?:Ref.UPDATE_TYPE)=>void, bound_object?:object, key?:K):void {
        // unobserve all changes
        if (key == undefined) {
            super.unobserve(handler, bound_object); // default observer

            if (bound_object) {
                this.bound_general_change_observers.get(bound_object)?.delete(handler);
                if (this.bound_general_change_observers.get(bound_object)?.size === 0) this.bound_general_change_observers!.delete(bound_object)
            }
            else this.general_change_observers.delete(handler); // observer property updates
        }

        // unobserve observer for specific property
        else {
            if (bound_object) {
                this.bound_change_observers.get(bound_object)?.get(key)?.delete(handler);
                if (this.bound_change_observers.get(bound_object)?.size == 0) this.bound_change_observers.delete(bound_object);
                else if (this.bound_change_observers.get(bound_object)?.get(key)?.size === 0) this.bound_change_observers.get(bound_object)!.delete(key);
            }
            else this.change_observers.get(key)?.delete(handler);
        }
    }


    private callObservers(value:any, key:any, type:Ref.UPDATE_TYPE, is_transform = false, is_child_update = false, previous?: any, atomic_id?: symbol) {
        const promises = [];
        // key specific observers
        if (key!=undefined) {
            for (const [o, options] of this.change_observers.get(key)||[]) {
                if ((!options?.types || options.types.includes(type)) && !(is_transform && options?.ignore_transforms) && (!is_child_update || !options || options.recursive)) promises.push(o(value, key, type, is_transform, is_child_update, previous, atomic_id)); 
            }
            // bound observers
            for (const [object, entries] of this.bound_change_observers.entries()) {
                for (const [k, handlers] of entries) {
                    if (k === key) {
                        for (const [handler, options] of handlers) {
                            if ((!options?.types || options.types.includes(type)) && !(is_transform && options?.ignore_transforms) && (!is_child_update || !options || options.recursive)) {
                                const res = handler.call(object, value, key, type, is_transform, is_child_update, previous, atomic_id);
                                promises.push(res)
                                if (res === false) this.unobserve(handler, object, key);
                            }
                        }
                    }
                }
            }
        } 
        // general observers
        for (const [o, options] of this.general_change_observers||[]) {
            if ((!options?.types || options.types.includes(type)) && !(is_transform && options?.ignore_transforms) && (!is_child_update || !options || options.recursive)) promises.push(o(value, key, type, is_transform, is_child_update, previous, atomic_id));
        }    
        // bound generalobservers
        for (const [object, handlers] of this.bound_general_change_observers||[]) {
            for (const [handler, options] of handlers) {
                if ((!options?.types || options.types.includes(type)) && !(is_transform && options?.ignore_transforms) && (!is_child_update || !options || options.recursive)) {
                    const res = handler.call(object, value, key, type, is_transform, is_child_update, previous, atomic_id)
                    promises.push(res)
                    if (res === false) this.unobserve(handler, object, key);
                }
            }
        }

        return Promise.allSettled(promises);
    }


    idString(){
        return `$${this.id}`
    }

}


export namespace Ref {
    export enum UPDATE_TYPE {
        INIT, // set (initial) reference
        UPDATE, // update value
        SET, // set property
        DELETE, // delete property
        CLEAR, // clear
        ADD, // add child
        REMOVE, // remove child
        BEFORE_DELETE,
        BEFORE_REMOVE
    }
}

// js primitives
export class TextRef<T extends string = string> extends Pointer<T> {}
export class IntegerRef extends Pointer<bigint> {}
export class DecimalRef extends Pointer<number> {}
export class BooleanRef extends Pointer<boolean> {}

// pseudo primitives
export class TypeRef extends Pointer<Type> {}
export class EndpointRef extends Pointer<Endpoint> {}
export class URLRef extends Pointer<URL> {}




/** proxy function (for remote calls) */

export function getProxyFunction(method_name:string, params:{filter:target_clause, dynamic_filter?: target_clause, sign?:boolean, scope_name?:string, timeout?:number}):(...args:any[])=>Promise<any> {
    return function(...args:any[]) {
        const filter = params.dynamic_filter ? new Conjunction(params.filter, params.dynamic_filter) : params.filter;

        const params_proto = Object.getPrototypeOf(params);
        if (params_proto!==Object.prototype) params_proto.dynamic_filter = undefined; // reset, no longer needed for call

        const compile_info:compile_info = [`#public.${params.scope_name}.${method_name} ?`, [new Tuple(args)], {to:filter, sign:params.sign}];
        return Runtime.datexOut(compile_info, filter, undefined, true, undefined, undefined, false, undefined, params.timeout);
    }
}


export function getProxyStaticValue(name:string, params:{filter?:target_clause, dynamic_filter?: target_clause, sign?:boolean, scope_name?:string, timeout?:number}):(...args:any[])=>Promise<any> {
    return function() {
        let filter = params.dynamic_filter ? new Conjunction(params.filter, params.dynamic_filter) : params.filter;

        let params_proto = Object.getPrototypeOf(params);
        if (params_proto!==Object.prototype) params_proto.dynamic_filter = undefined; // reset, no longer needed for call

        const compile_info:compile_info = [`#public.${params.scope_name}.${name}`, [], {to:filter, sign:params.sign}];
        return Runtime.datexOut(compile_info, filter, undefined, true, undefined, undefined, false, undefined, params.timeout);
    }
}


// @ts-ignore devconsole
globalThis.snapshot = ()=>{
    let x = "";
    for (const ptr of Pointer.getAllPointers()) {
        x += ptr.idString() + " := ";
        try {
            x += Runtime.valueToDatexString(ptr,false,true);
        } catch (e) {
            x += "?? " + e.message
        }
        x +=  ";\n";
    }
    console.log(x)
}