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
        if (options?._allowAsync && !ptr.value_initialized && ptr.waiting_for_always_promise) {
            return ptr.waiting_for_always_promise.then(()=>collapseTransformPointer(ptr, options?._collapseStatic, options?._returnWrapper, options?._allowAnyType));
        }
        if (!ptr.value_initialized && ptr.waiting_for_always_promise) {
            throw new PointerError(`Promises cannot be returned from always transforms - use 'asyncAlways' instead`);
        }
        else {
            return collapseTransformPointer(ptr, options?._collapseStatic, options?._returnWrapper, options?._allowAnyType);
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


function collapseTransformPointer(ptr: Pointer, collapseStatic = false, alwaysReturnWrapper = false, _allowAnyType = false) {
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
    return val;
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
    if (!ptr.value_initialized && ptr.waiting_for_always_promise) {
        await ptr.waiting_for_always_promise;
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


export function map<T, U, O extends 'array'|'map' = 'array'>(iterable: Iterable<T>, mapFn: (value: MaybeObjectRef<T>, index: number, array: Iterable<T>) => U, options?: {outType: O}): O extends "array" ? U[] : Map<number, U> {
    let mapped:U[]|Map<number, U>
    
    // live map
    if (Datex.ReactiveValue.isRef(iterable)) {

        // return map
        if (options?.outType == "map") {
            mapped = $$(new Map())

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

        // return array
        else {
            mapped = $$([])

            // no gaps in a set -> array splice required
            const spliceArray = iterable instanceof Set; 

            const iterableHandler = new IterableHandler(iterable, {
                map: (v,k)=>{
                    return mapFn(v,k,iterable)
                },
                onEntryRemoved: (v,k) => {
                    if (spliceArray) (mapped as U[]).splice(k, 1);
                    else delete (mapped as U[])[k];
                },
                onNewEntry: (v,k) => {
                    (mapped as U[])[k] = v
                },
                onEmpty: () => {
                    (mapped as U[]).length = 0
                }
            })
            // reverse transform binding
            Datex.Pointer.bindDisposable(mapped, iterableHandler)
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


// TODO: (remove empty entries inbetween)
export function filter<T, U>(array: Array<T>, predicate: (value: T, index: number, array: T[]) => boolean, deps?: Datex.RefOrValue<any>[]): T[] {
    // live map
    if (Datex.ReactiveValue.isRef(array)) {
        console.log("predicate", deps)
      
        // if (Datex.ReactiveValue.isRef(predicate)) {
        //     console.warn("predicate")
        //     observe(predicate, ()=> {
        //         console.log("predicate changed")
        //     })
        // }

        const filtered: U[] = $([])

        const spliceArray = true;

        new IterableHandler<T,U>(array, {
            filter: (v,k):v is T&U => {               
                return predicate(v,k,array)
            },
            onEntryRemoved: (v,k) => {
                if (spliceArray) filtered.splice(k, 1);
                else delete filtered[k];
            },
            onNewEntry: (v,k) => {
                filtered[k] = v
            },
            onSplice: (start, deleteCount, ...items) => {
                filtered.splice(start, deleteCount, ...items)
            },
            onEmpty: () => {
                filtered.length = 0
            }
        });

        if (deps) {
            // TODO cleanup gargabe
            const _deps = $(deps);
            const ref = Datex.Pointer.getByValue(array);
            if (ref)
                observe(_deps, () => {
                    // Trigger event for iterable handler
                    ref.triggerValueInitEvent(false);
                    // Trigger event on always value of filtered array
                    Datex.Pointer.getByValue(filtered)?.
                            triggerValueEvent(ReactiveValue.UPDATE_TYPE.UPDATE, false);
                });
        }

        return filtered as unknown as T[];

    }

    // static map
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