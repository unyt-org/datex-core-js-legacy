
/**
 * Promise methods return type inference magic
 */

import type { Equals } from "../utils/global_types.ts";

class _PromiseWrapper<T> {
	all(e: T[]) {
	  	return Promise.all<T>(e)
	}
	allSettled(e: T[]) {
		return Promise.allSettled<T>(e)
  	}
	any(e: T[]) {
		return Promise.any<T>(e)
	}
	race(e: T[]) {
		return Promise.race<T>(e)
	}
}


type PromiseFnMapping<T, MethodName extends keyof _PromiseWrapper<T>> = ReturnType<_PromiseWrapper<T>[MethodName]>

export type PromiseMappingFn = typeof Promise.any | typeof Promise.all | typeof Promise.allSettled | typeof Promise.race

export type PromiseMapReturnType<T, Fn extends PromiseMappingFn> = 
	Equals<Fn, typeof Promise.any> extends true ?
	PromiseFnMapping<T, 'any'> : 
	( 	
		Equals<Fn, typeof Promise.allSettled> extends true ?
		PromiseFnMapping<T, 'allSettled'> : 
			(
				Equals<Fn, typeof Promise.all> extends true ?
				PromiseFnMapping<T, 'all'> : 
				(
					Equals<Fn, typeof Promise.race> extends true ?
						PromiseFnMapping<T, 'race'> : 
						never
				)
			)
		
	)


