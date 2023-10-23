/**
 * Represents a JS function with source code that can be transferred between endpoints
 */

import { ExtensibleFunction, getDeclaredExternalVariables, getDeclaredExternalVariablesAsync, createFunctionWithDependencyInjections, getSourceWithoutUsingDeclaration, Callable } from "./function-utils.ts";


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
			super(intermediateFn);
			this.#fn = intermediateFn;
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
        const intermediateFn = createFunctionWithDependencyInjections(source, dependencies);
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