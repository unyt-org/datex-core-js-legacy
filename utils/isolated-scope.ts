import { JSTransferableFunction } from "../types/js-function.ts";

/**
 * Functions that are isolated by construction: created by a module-level (or static) factory
 * whose closure contains only the dependencies explicitly passed to that factory. This is the
 * guarantee isolatedScope otherwise establishes by reconstructing the function from its source
 * with only its use() dependencies, so such functions are returned unchanged.
 */
const isolatedByConstruction = new WeakSet<(...args: any[]) => any>();

/**
 * Marks a function as isolated by construction (see above). Only use this for functions created
 * inside a factory that receives every dependency as a parameter and references nothing else
 * from an enclosing function scope (module-level bindings are fine).
 */
export function markIsolated<F extends (...args: any[]) => any>(fn: F): F {
	isolatedByConstruction.add(fn);
	return fn;
}

export function isolatedScope(handler:(...args: any[]) => any) {
	if (isolatedByConstruction.has(handler)) return handler;
	return JSTransferableFunction.create(handler);
}
