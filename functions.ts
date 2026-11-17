/**
 * This file contains utility funtions to transform pointer to other pointers.
 * The resulting pointers are automatically updated when the input pointers are updated
 */


import { AsyncTransformFunction, INSERT_MARK, MaybeObjectRef, MinimalJSRef, Pointer, ReactiveValue, RefLike, RefOrValue, SmartTransformFunction, SmartTransformOptions, TransformFunction, TransformFunctionInputs, logger } from "./datex_all.ts";
import { Datex } from "./mod.ts";
import { PointerError } from "./types/errors.ts";
import { IterableHandler } from "./utils/iterable-handler.ts";
import { AsyncSmartTransformFunction, MinimalJSRefWithIndirectRef, RestrictSameType } from "./runtime/pointers.ts";
import { handleError } from "./utils/error-handling.ts";
import { KnownError } from "./utils/error-handling.ts";

/**
 * A generic transform function, creates a new pointer containing the result of the callback function.
 * At any point in time, the pointer is the result of the callback function.
 * In contrast to the `transform` function, dependency references are automatically detected, they don't need to be explicitly specified.
 * ```ts
 * const x = $$(10);
 * const y = always (() => x * 2);
 * y.val // 20
 * x.val = 5;
 * y.val // 10
 * ```
 */
export function always<T>(transform:SmartTransformFunction<T>, options?: SmartTransformOptions): MinimalJSRefWithIndirectRef<T> // return signature from Value.collapseValue(Pointer.smartTransform())


// only works with JUSIX compilation
export function always<const T>(value:T, options?: SmartTransformOptions): MinimalJSRef<T>

/**
 * Shortcut for datex `always (...)`
 * @param script 
 * @param vars 
 */
export function always<T=unknown>(script:TemplateStringsArray, ...vars:any[]): Promise<MinimalJSRefWithIndirectRef<T>>
export function always(scriptOrJSTransform:TemplateStringsArray|SmartTransformFunction<any>, ...vars:any[]) {
    // js function
    if (typeof scriptOrJSTransform == "function") {
        const options: SmartTransformOptions|undefined = typeof vars[0] == "object" ? vars[0] : undefined;
        // make sure handler is not an async function
        if (scriptOrJSTransform.constructor.name == "AsyncFunction" && !options?._allowAsync) {
            throw new Error("Async functions are not allowed as always transforms")
        }
        const ptr = Pointer.createSmartTransform(scriptOrJSTransform, undefined, undefined, undefined, options);
        if (options?._allowAsync && !ptr.value_initialized && ptr.waiting_for_initial_async_transform) {
            return ptr.waiting_for_initial_async_transform.then(()=>collapseTransformPointer(ptr, options?._collapseStatic, options?._returnWrapper, options?._allowAnyType, options?._rebindStaticToPointers));
        }
        if (!ptr.value_initialized && ptr.waiting_for_initial_async_transform) {
            throw new PointerError(`Promises cannot be returned from always transforms - use 'asyncAlways' instead`);
        }
        else {
            return collapseTransformPointer(ptr, options?._collapseStatic, options?._returnWrapper, options?._allowAnyType, options?._rebindStaticToPointers);
        }
    }
    // datex script
    else if (scriptOrJSTransform.raw instanceof Array) {
        return (async ()=>collapseTransformPointer(await datex(`always (${scriptOrJSTransform.raw.join(INSERT_MARK)})`, vars)))()
    }
    else {
        handleError(new KnownError("You called 'always' with invalid arguments. It seems like you are not using Deno for UIX.", [
            "Install Deno for UIX, see https://docs.unyt.org/manual/uix/getting-started#install-deno",
            "Call 'always' with a function: always(() => ...)"
        ]))
    }
}


function collapseTransformPointer(ptr: Pointer, collapseStatic = false, alwaysReturnWrapper = false, _allowAnyType = false, _rebindStaticToPointers = false) {
    // collapse if transform function is static
    const collapse = collapseStatic && ptr.isStaticTransform;

    if (_allowAnyType) {
        ptr.allowAnyType(true);
    }
    
    if (alwaysReturnWrapper && !collapse) {
        return ptr;
    }
    
    const val = ReactiveValue.collapseValue(ptr, false, collapse);

    if (collapse) ptr.delete();
    // TODO: deproxify static non-primitive objects to garbage-collect pointer and associated data
    if (_rebindStaticToPointers) {
        if (!(val instanceof ReactiveValue)) {
            return Pointer.createOrGet(val);
        }
        else {
            return val;
        }
    }
    else {
        return val;
    }
}

/**
 * A generic transform function, creates a new pointer containing the result of the callback function.
 * At any point in time, the pointer is the result of the callback function.
 * In contrast to the always function, this function can return a Promise
 * ```ts
 * const x = $$(42);
 * const y = await asyncAlways (() => complexCalculation(x.val * 10));
 * 
 * async function complexCalculation(input: number) {
 *    const res = await ...// some async operation
 *    return res
 * }
 * ```
 */
export async function asyncAlways<T>(transform:AsyncSmartTransformFunction<T>, options?: SmartTransformOptions): Promise<MinimalJSRefWithIndirectRef<T>> { // return signature from Value.collapseValue(Pointer.smartTransform())
    const ptr = Pointer.createSmartTransform(transform, undefined, undefined, undefined, options);
    if (!ptr.value_initialized && ptr.waiting_for_initial_async_transform) {
        await ptr.waiting_for_initial_async_transform;
    }
    else {
        logger.warn("asyncAlways: transform function did not return a Promise, you should use 'always' instead")
    }
    return ReactiveValue.collapseValue(ptr) as MinimalJSRef<T>
}

/**
 * Decorator for creating a reactive function.
 * Functions decorated with `reactiveFn` always return a pointer that is automatically updated when input references are updated.
 * This has the same effect as wrapping the function body with `always`.
 * A reactive functions accepts references or values as arguments, but is always called with collapsed values. 
 * This means that you don't have to specifiy `Ref` values as arguments, but can use regular types.
 * 
 * Example:
 * ```ts
 * // create reactive function 'getSquared'
 * const getSquared = reactiveFn((x: number) => x * x);
 * 
 * const x = $$(2);
 * const y = getSquared(x); // Ref<4>
 * x.val = 3;
 * y // Ref<9>
 * ```
 */
export function reactiveFn<ReturnType, Args extends unknown[]>(fn: (...args: Args) => Awaited<RestrictSameType<RefOrValue<ReturnType>>>) {
    return (...args: MapToRefOrVal<Args>) => always(() => {
        const collapsedArgs = args.map(arg => ReactiveValue.collapseValue(arg, true, true)) as Args;
        return fn(...collapsedArgs)
    });
}

type MapToRefOrVal<T extends unknown[]> = {[K in keyof T]: T[K] extends ReactiveValue ? T[K] : RefOrValue<T[K]>}


const getGreetingMessage = (country: RefOrValue<string>) => {
    return always(() => {
        switch (country) {
            case "de": return "Hallo";
            case "fr": return "Bonjour";
            case "es": return "Hola";
            default: return "Hello";
        }
    })
}

/**
 * Runs each time a dependency reference value changes.
 * Dependency references are automatically detected.
 * ```ts
 * const x = $$(10);
 * effect (() => console.log("x is " + x));
 * x.val = 5; // logs "x is 5"
 * ```
 * 
 * Disposing effects:
 * ```ts
 * const x = $$(10);
 * const {dispose} = effect (() => console.log("x is " + x));
 * x.val = 5; // logs "x is 5"
 * dispose();
 * x.val = 6; // no log
 * ```
 */
export function effect<W extends Record<string, WeakKey>|undefined>(handler:W extends undefined ? () => void|Promise<void> :(weakVariables: W) => void|Promise<void>, weakVariables?: W): {dispose: () => void, [Symbol.dispose]: () => void} {
    
    let ptr: Pointer;

    // weak variable binding
    if (weakVariables) {
        const weakVariablesProxy = {};
        for (const [k, v] of Object.entries(weakVariables)) {
            const weakRef = new WeakRef(v);
            Object.defineProperty(weakVariablesProxy, k, {get() {
              const val = weakRef.deref()
              if (!val) {
                // dispose effect
                ptr.is_persistent = false;
                ptr.delete()
                throw Pointer.WEAK_EFFECT_DISPOSED;
              }
              else return val;
            }})
        }
        const originalHandler = handler;
        handler = (() => originalHandler(weakVariablesProxy)) as any;
    }
    
    ptr = Pointer.createSmartTransform(handler as any, undefined, true, true);
    ptr.is_persistent = true;

    return {
        [Symbol.dispose||Symbol.for("Symbol.dispose")]() {
            ptr.is_persistent = false;
            ptr.delete()
        },
        dispose() {
            ptr.is_persistent = false;
            ptr.delete()
        }
    }
}


/**
 * A generic transform function, creates a new pointer containing the result of the callback function.
 * At any point in time, the pointer is the result of the callback function.
 * Dependency references have to be specified. If one of the dependencies changes, the resulting pointe
 * value is recalculated.
 * @param dependencies dependency references
 * @param transform transform function
 * @param persistent_datex_transform optional equivalent datex script describing the transform
 * @returns 
 */
export function transform<T,V extends TransformFunctionInputs>(dependencies:V, transform:TransformFunction<V,T>, persistent_datex_transform?:string) {
    return ReactiveValue.collapseValue(Pointer.createTransform(dependencies, transform, persistent_datex_transform));
}
/**
 * A generic transform function, creates a new pointer containing the result of the callback function.
 * At any point in time, the pointer is the result of the callback function.
 * Dependency references have to be specified. If one of the dependencies changes, the resulting pointe
 * value is recalculated.
 * @param dependencies dependency references
 * @param transform an async transform function (returning a Promise)
 * @param persistent_datex_transform optional equivalent datex script describing the transform
 * @returns 
 */
export async function transformAsync<T,V extends TransformFunctionInputs>(dependencies:V, transform:AsyncTransformFunction<V,T>, persistent_datex_transform?:string) {
    return ReactiveValue.collapseValue(await Pointer.createTransformAsync(dependencies, transform, persistent_datex_transform));
}


/**
 * Updates the reactive array `target` in place to equal `desired` with element-wise splices:
 * entries present in both keep their position relative to each other and are never removed
 * and re-inserted (e.g. rendered elements keep focus/state); others are inserted/removed.
 */
function reconcileInPlace<T>(target: T[], desired: T[]) {
    // Without identity-preserving lists, update by index (one SET per changed index, then truncate
    // or append) as before: list bindings that work by index handle exactly these events.
    if (!Datex.Runtime.OPTIONS.IDENTITY_PRESERVING_LISTS) {
        for (let k = 0; k < desired.length; k++) {
            if (k >= target.length) target.push(desired[k]);
            else if (target[k] !== desired[k]) target[k] = desired[k];
        }
        if (target.length > desired.length) target.splice(desired.length, target.length - desired.length);
        return;
    }
    const desiredSet = new Set(desired);
    let i = 0, j = 0;
    while (j < desired.length) {
        if (i < target.length && target[i] === desired[j]) {i++; j++; continue;}
        if (i < target.length && !desiredSet.has(target[i])) {target.splice(i, 1); continue;}
        // desired[j] belongs here: move it from a later position or insert it
        const later = target.indexOf(desired[j], i + 1);
        if (later >= 0) target.splice(later, 1);
        target.splice(i, 0, desired[j]);
        i++; j++;
    }
    if (target.length > i) target.splice(i, target.length - i);
}

// removes the source observer of a collected observer owner (see observeWeakly)
const weakObserverCleanup = new FinalizationRegistry<{source: unknown, callback: (...args: any[]) => void}>(
    ({source, callback}) => {try {Datex.ReactiveValue.unobserve(source, callback);} catch {}}
);
/**
 * Observes all events of `source` while `owner` is alive: the source only holds a weak
 * reference to the owner, so a long-lived source does not keep the owner (and e.g. a rendered
 * result) alive. Returns a function that removes the observer.
 */
function observeWeakly(source: unknown, owner: {onSourceChange: () => void}) {
    // the callback reaches the owner (and everything it references) only through the WeakRef
    const ownerRef = new WeakRef(owner);
    const callback = () => ownerRef.deref()?.onSourceChange();
    Datex.ReactiveValue.observe(source, callback);
    const token = {};
    weakObserverCleanup.register(owner, {source, callback}, token);
    return () => {
        weakObserverCleanup.unregister(token);
        try {Datex.ReactiveValue.unobserve(source, callback);} catch {}
    };
}

function createLiveMappedArray<T, U>(iterable: Iterable<T>, mapFn: (value: MaybeObjectRef<T>, index: number, array: Iterable<T>) => U): U[] {
    const mapped: U[] = $([]);
    // A mapping function without an index parameter maps every item independently of its
    // position, so the entry of an item can be reused when the item moves (no reconstruction of
    // e.g. a rendered component on reorder/insert/remove). Index-dependent mapping functions keep
    // index semantics: an entry is only reused while its item stays at the same index.
    // Only when enabled: consumers that bind list results by index (older UIX list bindings)
    // expect a moved item to produce a new entry at its new index.
    const indexIndependent = Datex.Runtime.OPTIONS.IDENTITY_PRESERVING_LISTS && mapFn.length < 2;
    const state = {
        source: iterable,
        // current mapping, aligned with `mapped`
        items: [] as unknown[],
        entries: [] as U[],
        unobserve: undefined as (() => void)|undefined,
        disposed: false,
        onSourceChange: () => {}
    };
    // disposal is terminal (also when a mapping function disposes the result while mapping)
    const dispose = () => {
        state.disposed = true;
        state.unobserve?.();
    };
    const mappedRef = new WeakRef(mapped);

    const sync = () => {
        const target = mappedRef.deref();
        if (!target || state.disposed) return;
        const current = Datex.ReactiveValue.collapseValue(state.source, true, true) as Iterable<T>;
        const items: unknown[] = [];
        if (current instanceof Array) {
            for (let i = 0; i < current.length; i++) {
                if (i in current) items.push(current[i]); // skip holes of in-progress native array operations
            }
        }
        else for (const item of current) items.push(item);
        // unchanged (e.g. further per-index events of the same splice): nothing to do
        if (items.length == state.items.length && items.every((item, i) => item === state.items[i])) return;

        // reusable entries of the previous mapping
        const pool = new Map<unknown, U[]>();
        if (indexIndependent) {
            state.items.forEach((item, i) => {
                if (!pool.has(item)) pool.set(item, []);
                pool.get(item)!.push(state.entries[i]);
            });
        }
        const entries = items.map((item, k) => {
            if (indexIndependent) {
                const queue = pool.get(item);
                if (queue?.length) return queue.shift()!;
            }
            else if (k < state.items.length && state.items[k] === item) return state.entries[k];
            return mapFn(item as any, k, state.source);
        });
        // a mapping function disposed the result while it was being mapped
        if (state.disposed) return;
        state.items = items;
        state.entries = entries;
        if (target.length == 0) {
            if (entries.length) target.push(...entries);
        }
        else reconcileInPlace(target, entries);
    };

    // every event of the source (incl. the final ones of splices/pops) re-syncs; the source only
    // holds the observer weakly (see observeWeakly)
    state.onSourceChange = sync;
    const bind = () => {state.unobserve = observeWeakly(state.source, state);};
    bind();
    sync();
    // the result keeps the observer state alive (and unobserves when deleted)
    Datex.Pointer.bindDisposable(mapped, {[Symbol.dispose]: dispose, state} as any);

    const retarget = (newSource: unknown) => {
        if (state.disposed) return;
        state.unobserve?.();
        state.source = newSource as Iterable<T>;
        bind();
        sync();
    };
    Pointer.registerDerivedResult(mapped, retarget, dispose);

    const ptr = Pointer.getByValue(mapped);
    if (ptr) ptr.isTransform = true;
    return mapped;
}

export function map<T, U, O extends 'array'|'map' = 'array'>(iterable: Iterable<T>, mapFn: (value: MaybeObjectRef<T>, index: number, array: Iterable<T>) => U, options?: {outType: O}): O extends "array" ? U[] : Map<number, U> {
    let mapped:U[]|Map<number, U>
    
    // live map
    if (Datex.ReactiveValue.isRef(iterable)) {

        // return map
        if (options?.outType == "map") {
            mapped = $(new Map())

            const iterableHandler = new IterableHandler(iterable, {
                map: (v,k)=>{
                    return mapFn(v,k,iterable)
                },
                onEntryRemoved: (v,k) => {
                    (mapped as Map<number,U>).delete(k)
                },
                onNewEntry: (v,k) => (mapped as Map<number,U>).set(k,v),
                onEmpty: () => (mapped as Map<number,U>).clear()
            })
            // reverse transform binding
            Datex.Pointer.bindDisposable(mapped, iterableHandler)
        }

        // return array (a derived result: re-targeted instead of recreated when a transform
        // re-evaluates this call with a different source, see Pointer.derived)
        else {
            return Pointer.derived("map", iterable, () => createLiveMappedArray(iterable, mapFn)) as any;
        }

    }

    // static map
    else {
        if (options?.outType == "map") {
            mapped = new Map()
            let i = 0;
            for (const val of iterable) {
                mapped.set(i, mapFn(val, i++, iterable))
            }
        }
        else {
            mapped = []
            let i = 0;
            for (const val of iterable) {
                mapped.push(mapFn(val, i++, iterable))
            }
        }
        
    }

    const ptr = Pointer.getByValue(mapped);
    if (ptr) ptr.isTransform = true;
    
    return mapped as any;
}


// unregisters the observers of a collected live filter result
const filterCleanup = new FinalizationRegistry<{binding?: {dispose: () => void}}>(state => state.binding?.dispose());

// binds a live filter result to a source; returns the function that removes the binding.
// Observers only reach the result through `onChange` (which holds it weakly).
function bindFilterSource<T>(array: Array<T>, test: (value: T, index: number, arr: T[]) => boolean, deps: Datex.RefOrValue<any>[]|undefined, onChange: () => void) {
    const current = () => Datex.ReactiveValue.collapseValue(array, true, true) as T[];
    // tracks all predicate dependencies (entry fields, deps) and the array structure
    const signature = always(() => {
        if (deps) for (const dep of deps) Datex.ReactiveValue.collapseValue(dep, true, true);
        const arr = current();
        let sig = String(arr.length) + ":";
        for (let i = 0; i < arr.length; i++) sig += (i in arr && test(arr[i], i, arr)) ? "1" : "0";
        return sig;
    });
    const onSignature = () => onChange();
    const onArray = () => onChange();
    ReactiveValue.observe(signature, onSignature);
    // structural changes that keep the signature (e.g. reorders) are observed directly
    ReactiveValue.observe(array, onArray);
    let disposed = false;
    return {
        signature,
        dispose: () => {
            if (disposed) return;
            disposed = true;
            ReactiveValue.unobserve(signature, onSignature);
            ReactiveValue.unobserve(array, onArray);
        }
    };
}

function createLiveFilteredArray<T>(array: Array<T>, predicate: (value: T, index: number, array: T[]) => boolean, deps?: Datex.RefOrValue<any>[]): T[] {
    const filtered: T[] = $([]);
    // no closure in this function references `filtered` directly (only via the WeakRef), so
    // the cleanup registration below cannot keep it alive
    const filteredRef = new WeakRef(filtered);
    const test = (value: T, index: number, arr: T[]) => !!Datex.ReactiveValue.collapseValue(predicate(value, index, arr), true, true);
    const state = {source: array, binding: undefined as ReturnType<typeof bindFilterSource<T>>|undefined};
    const reconcile = () => {
        const target = filteredRef.deref();
        if (!target) return;
        const arr = Datex.ReactiveValue.collapseValue(state.source, true, true) as T[];
        const desired: T[] = [];
        for (let i = 0; i < arr.length; i++) {
            if (!(i in arr)) continue; // hole during an in-progress native array operation
            if (test(arr[i], i, arr)) desired.push(arr[i]);
        }
        reconcileInPlace(target, desired);
    };
    state.binding = bindFilterSource(array, test, deps, reconcile);
    reconcile();
    const dispose = () => state.binding?.dispose();
    const retarget = (newSource: unknown) => {
        state.binding?.dispose();
        state.source = newSource as Array<T>;
        state.binding = bindFilterSource(state.source, test, deps, reconcile);
        reconcile();
    };
    filterCleanup.register(filtered, state);
    // keeps the binding (and its predicate transform) alive as long as the result lives
    Datex.Pointer.bindDisposable(filtered, {[Symbol.dispose]: dispose, state} as any);
    Pointer.registerDerivedResult(filtered, retarget, dispose);
    const ptr = Pointer.getByValue(filtered);
    if (ptr) ptr.isTransform = true;
    return filtered;
}

/**
 * Live filter: returns a reactive array containing the entries of `array` for which `predicate`
 * is truthy, in source order. It stays correct for every kind of change of the source array
 * (set/push/splice/pop/shift/unshift/sort/reverse/length changes/clear) and for changes of any
 * reactive value the predicate reads (e.g. a field of an entry, or `deps`).
 *
 * Implementation: one transform evaluates the predicate for all entries (so all dependencies
 * are tracked), and every change reconciles the result array with a minimal splice (common
 * prefix and suffix are kept), so observers of the result receive ordinary small updates.
 * (The previous incremental IterableHandler key mapping produced duplicate/stale entries after
 * removals and reorders.)
 */
export function filter<T, U>(array: Array<T>, predicate: (value: T, index: number, array: T[]) => boolean, deps?: Datex.RefOrValue<any>[]): T[] {
    // live filter (a derived result, see Pointer.derived)
    if (Datex.ReactiveValue.isRef(array)) {
        return Pointer.derived("filter", array, () => createLiveFilteredArray(array, predicate, deps)) as T[];
    }

    // static filter
    else return array.filter(predicate)
}


/**
 * Switches between two values depending if a value is true or false
 * @param value input value
 * @param if_true value selected if true
 * @param if_false value selected if false
 */
export function toggle<T>(value:RefLike<boolean>, if_true:T, if_false:T = null as T): MinimalJSRef<T> {
    return transform([value], v=>v?<any>if_true:<any>if_false, 
    // dx transforms not working correctly (with uix)
    /*`
    always (
        if (${Runtime.valueToDatexString(value)}) (${Runtime.valueToDatexString(if_true)}) 
        else (${Runtime.valueToDatexString(if_false)})
    )`*/);
}


/**
 * @deprecated, use toggle()
 */
export const select = toggle;


/**
 * Returns a pointer representing a === b
 * @param a input value
 * @param b input value
 */
export function equals<T,V>(a:RefLike<T>|T, b: RefLike<V>|V): Datex.Pointer<boolean> {
    return transform([a, b], (a,b) =>  Datex.ReactiveValue.collapseValue(a, true, true) === Datex.ReactiveValue.collapseValue(b, true, true), 
    // dx transforms not working correctly (with uix)
        /*`always (${Runtime.valueToDatexString(a)} === ${Runtime.valueToDatexString(b)})`*/) as any;
}


/**
 * Selects a property from an object
 * @param property property name
 * @param object the reference object
 * @returns 
 */
export function selectProperty<K extends string|number, V>(property:RefLike<K>, object:Readonly<Record<K, V>>):MinimalJSRef<V> {
    return <MinimalJSRef<V>> transform([property], (v)=><any>object[<K>v]);
}


/**
 * Inverts a boolean value/reference
 * @param value 
 * @returns 
 */
export function not(value:RefOrValue<boolean>): Pointer<boolean> {
    return transform([value], v=>!v);
}

/**
 * Performs a boolean 'and' operation on one or more boolean values/references
 * @param values 
 * @returns 
 */
export function and(...values:RefOrValue<boolean>[]): Pointer<boolean> {
    return transform(values, (...values)=>{
        for (const v of values) {
            if (!v) return false;
        }
        return true;
    });
}

/**
 * Performs a boolean 'or' operation on one or more boolean values/references
 * @param values 
 * @returns 
 */
export function or(...values:RefOrValue<boolean>[]): Pointer<boolean> {
    return transform(values, (...values)=>{
        for (const v of values) {
            if (v) return true;
        }
        return false;
    });
}

/**
 * Performs an 'add' operation on one or more values (strings, numbers)
 * @param numbers 
 * @returns 
 */
export function add<T>(...numbers:RefOrValue<T>[]): MinimalJSRef<T>
export function add(...args:any[]) {
    return transform([...args], (...args) => args.reduce((a, b) => a + b, 0));
}

/**
 * Performs a 'subtract' operation on one or more numbers
 * @param numbers 
 * @returns 
 */
export function sub(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function sub(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function sub(...args:any[]) {
    return transform([...args], (...args) => args.slice(1).reduce((a, b) => a - b, args[0]));
}

/**
 * Performs a 'multiply' operation on one or more numbers
 * @param numbers 
 * @returns 
 */
export function mul(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function mul(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function mul(...args:any[]) {
    return transform([...args], (...args) => args.reduce((a, b) => a * b, 1));
}

/**
 * Performs a 'division' operation on one or more numbers
 * @param numbers 
 * @returns 
 */
export function div(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function div(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function div(...args:any[]) {
    return transform([...args], (...args) => args.slice(1).reduce((a, b) => a / b, args[0]));
}

/**
 * Performs a 'power' operation on one or more numbers
 * @param numbers 
 * @returns 
 */
export function pow(...numbers:RefOrValue<bigint>[]): MinimalJSRef<bigint>
export function pow(...numbers:RefOrValue<number>[]): MinimalJSRef<number>
export function pow(...args:any[]) {
    return transform([...args], (...args) => args.slice(1).reduce((a, b) => a ** b, args[0]));
}


// @ts-ignore
globalThis.transform = transform;
// @ts-ignore
globalThis.transformAsync = transformAsync;

// @ts-ignore
globalThis.and = and;
// @ts-ignore
globalThis.or = or;
// @ts-ignore
globalThis.not = not;