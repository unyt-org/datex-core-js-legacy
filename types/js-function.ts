/**
 * Represents a JS function with source code that can be transferred between endpoints
 */

import { LazyPointer } from "../runtime/lazy-pointer.ts";
import { Pointer } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
import { ExtensibleFunction, getDeclaredExternalVariables, getDeclaredExternalVariablesAsync, getSourceWithoutUsingDeclaration, Callable, createFunctionWithDependencyInjectionsResolveLazyPointers } from "./function-utils.ts";


export type JSTransferableFunctionOptions = {
	errorOnOriginContext?: Error
}

export class JSTransferableFunction extends ExtensibleFunction {
	
	#fn: (...args:unknown[])=>unknown

	// deno-lint-ignore constructor-super
	private constructor(intermediateFn: (...args:unknown[])=>unknown, public deps: Record<string,unknown>, public source: string, public flags?: string[], options?: JSTransferableFunctionOptions) {
		if (options?.errorOnOriginContext) {
			const invalidIntermediateFunction = () => {throw options.errorOnOriginContext};
			super(invalidIntermediateFunction);
			this.#fn = invalidIntermediateFunction;
		}
		else {
			let ptr: Pointer|undefined;
			const fn = (...args:any[]) => {
				if (!ptr) ptr = Pointer.getByValue(this);
				if (!ptr) throw new Error("Cannot execute js:Function, must be bound to a pointer");
				const origin = ptr.origin.main;
				if (origin !== Runtime.endpoint && !Runtime.trustedEndpoints.get(origin)?.includes("remote-js-execution")) {
					throw new Error("Cannot execute js:Function, origin "+origin+" has no permission to execute js source code on this endpoint");
				}
				return intermediateFn(...args)
			}
			super(fn);
			this.#fn = fn;
		}
		
		this.source = source;
	}


	call(...args:any[]) {
		return this.#fn(...args)
	}

	/**
	 * Returns JS source
	 */
	override toString() {
		return this.source
	}

	/**
	 * @returns true if the provided function is an async function
	 */
	static functionIsAsync(fn: (...args:unknown[])=>unknown): fn is (...args:unknown[])=>Promise<unknown> {
		return fn.constructor.name == "AsyncFunction"
	}


	/**
	 * Create a new JSTransferableFunction from a regular function.
	 * Automatically determines dependency variables declared with use()
	 * 
	 * Important: use createAsync for async functions instead
	 * @param fn 
	 */
	static create<T extends (...args:unknown[])=>unknown>(fn: T, options?:JSTransferableFunctionOptions): JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>> {
        const {vars, flags} = getDeclaredExternalVariables(fn);
		return this.#createTransferableFunction(getSourceWithoutUsingDeclaration(fn), vars, flags, options) as any;
	}

	/**
	 * Create a new JSTransferableFunction from a regular async function.
	 * Automatically determines dependency variables declared with use()
	 * @param fn 
	 */
	static async createAsync<T extends (...args:unknown[])=>Promise<unknown>>(fn: T, options?:JSTransferableFunctionOptions): Promise<JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>>> {
		const {vars, flags} = await getDeclaredExternalVariablesAsync(fn)	
		return this.#createTransferableFunction(getSourceWithoutUsingDeclaration(fn), vars, flags, options) as any;
	}

	/**
	 * Recreate a JSTransferableFunction with existing source code and dependencies
	 * @param source 
	 * @param dependencies 
	 */
	static recreate(source: string, dependencies: Record<string, unknown>){
		return this.#createTransferableFunction(source, dependencies)
	}

	static #createTransferableFunction(source: string, dependencies: Record<string, unknown>, flags?: string[], options?:JSTransferableFunctionOptions) {
        const intermediateFn = createFunctionWithDependencyInjectionsResolveLazyPointers(source, dependencies);
		return new JSTransferableFunction(intermediateFn, dependencies, source, flags, options);
	}

}

export function transferable<T extends (...args:unknown[])=>unknown>(fn: T): JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>>
export function transferable<T extends (...args:unknown[])=>Promise<unknown>>(fn: T): Promise<JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>>>

export function transferable(fn: (...args:unknown[])=>unknown) {
	return JSTransferableFunction.functionIsAsync(fn) ? 
		JSTransferableFunction.createAsync(fn) :
		JSTransferableFunction.create(fn)
}