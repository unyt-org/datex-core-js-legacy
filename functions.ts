/**
 * This file contains utility funtions to transform pointer to other pointers.
 * The resulting pointers are automatically updated when the input pointers are updated
 */


import { AsyncTransformFunction, BooleanRef, CollapsedValue, CollapsedValueAdvanced, Decorators, INSERT_MARK, METADATA, MinimalJSRef, Pointer, Ref, RefOrValue, Runtime, SmartTransformFunction, TransformFunction, TransformFunctionInputs, handleDecoratorArgs, primitive } from "unyt_core/datex_all.ts";
import { Datex } from "unyt_core/datex.ts";
import { IterableHandler } from "unyt_core/utils/iterable-handler.ts";




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
export function always<const T,V extends TransformFunctionInputs>(transform:SmartTransformFunction<T>): CollapsedValueAdvanced<Pointer<T>, false, false, CollapsedValue<Pointer<T>>> // return signature from Value.collapseValue(Pointer.smartTransform())
/**
 * Shortcut for datex `always (...)`
 * @param script 
 * @param vars 
 */
export function always<T=unknown>(script:TemplateStringsArray, ...vars:any[]): Promise<MinimalJSRef<T>>
/**
 * always decorator
 * @param target
 * @param name
 */
export function always(target: any, name?: string):any
export function always(scriptOrJSTransform:TemplateStringsArray|SmartTransformFunction<any>, ...vars:any[]) {
    // @always getter decorator
    if (scriptOrJSTransform[METADATA]) {
        console.log("dec",scriptOrJSTransform,vars[0])
        handleDecoratorArgs([scriptOrJSTransform, ...vars], (...args)=>{
            const setMetadata = args[5]
            Decorators.property(...args)
            setMetadata(Decorators.ALWAYS_GETTER, true)
        } );
    }
    // js function
    else if (typeof scriptOrJSTransform == "function") return Ref.collapseValue(Pointer.createSmartTransform(scriptOrJSTransform));
    // datex script
    else return (async ()=>Ref.collapseValue(await datex(`always (${scriptOrJSTransform.raw.join(INSERT_MARK)})`, vars)))()
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
    return Ref.collapseValue(Pointer.createTransform(dependencies, transform, persistent_datex_transform));
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
    return Ref.collapseValue(await Pointer.createTransformAsync(dependencies, transform, persistent_datex_transform));
}


export function map<T, U, O extends 'array'|'map' = 'array'>(iterable: Iterable<T>, mapFn: (value: T, index: number, array: Iterable<T>) => U, options?: {outType: O, spliceArray?: boolean}): O extends "array" ? U[] : Map<number, U> {
	let mapped:U[]|Map<number, U>
	
	// live map
	if (Datex.Pointer.isReference(iterable)) {

		// return map
		if (options?.outType == "map") {
			mapped = $$(new Map())

			new IterableHandler(iterable, {
				map: (v,k)=>{
					return mapFn(v,k,iterable)
				},
				onEntryRemoved: (v,k) => {
					(mapped as Map<number,U>).delete(k)
				},
				onNewEntry: (v,k) => (mapped as Map<number,U>).set(k,v),
				onEmpty: () => (mapped as Map<number,U>).clear()
			})
		}

		// return array
		else {
			mapped = $$([])

			new IterableHandler(iterable, {
				map: (v,k)=>{
					return mapFn(v,k,iterable)
				},
				onEntryRemoved: (v,k) => {
					if (options?.spliceArray) (mapped as U[]).splice(k, 1);
					else delete (mapped as U[])[k];
				},
				onNewEntry: (v,k) => (mapped as U[])[k] = v,
				onEmpty: () => (mapped as U[]).length = 0
			})
		}

		console.warn(mapped)
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
	
	return mapped as any;
}


/**
 * Switches between two values depending if a value is true or false
 * @param value input value
 * @param if_true value selected if true
 * @param if_false value selected if false
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

/**
 * Selects a property from an object
 * @param property property name
 * @param object the reference object
 * @returns 
 */
export function selectProperty<K extends string|number, V>(property:RefOrValue<K>, object:Readonly<Record<K, V>>):MinimalJSRef<V> {
    return <MinimalJSRef<V>> transform([property], (v)=><any>object[<K>v]);
}


/**
 * Inverts a boolean value/reference
 * @param value 
 * @returns 
 */
export function not(value:RefOrValue<boolean>): BooleanRef {
    return transform([value], v=>!v);
}

/**
 * Performs a boolean 'and' operation on one or more boolean values/references
 * @param values 
 * @returns 
 */
export function and(...values:RefOrValue<boolean>[]): BooleanRef {
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
export function or(...values:RefOrValue<boolean>[]): BooleanRef {
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
globalThis.always = always;
// @ts-ignore
globalThis.and = and;
// @ts-ignore
globalThis.or = or;
// @ts-ignore
globalThis.not = not;