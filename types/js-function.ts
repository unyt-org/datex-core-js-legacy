/**
 * Represents a JS function with source code that can be transferred between endpoints
 */

import { Pointer } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
import type { Endpoint } from "./addressing.ts";
import { ExtensibleFunction, getDeclaredExternalVariables, getDeclaredExternalVariablesAsync, getSourceWithoutUsingDeclaration, Callable, createFunctionWithDependencyInjectionsResolveLazyPointers, hasUnresolvedLazyDependencies, getSourceWithResolvedPaths } from "./function-utils.ts";


export type JSTransferableFunctionOptions = {
	errorOnOriginContext?: Error,
	isLocal?: boolean,
	// when set, all relative import paths in the function body will be resolved relative to this URL
	contextURL?: URL,
	/**
	 * Endpoint that originally created the function source.
	 * If set, permission checks also require this endpoint to be allowed to execute JS
	 * (needed when a remote function is recreated locally, e.g. to rebind 'this')
	 */
	sourceOrigin?: Endpoint,
	/**
	 * Set to false if the source was received from an unverified (unsigned) sender
	 */
	sourceVerified?: boolean
}

export class JSTransferableFunction extends ExtensibleFunction {
	
	#fn: (...args:unknown[])=>unknown

	// promise that resolves when all lazy dependencies are resolved
	public lazyResolved: Promise<void>

	// endpoint that created the JS source (if known)
	public readonly sourceOrigin?: Endpoint
	// false if the source was received in a message with an unverified (unsigned) sender
	#sourceVerified = true

	public get sourceVerified() {
		return this.#sourceVerified;
	}

	/**
	 * Marks the source of this function as unverified (received from an unsigned remote sender).
	 * Unverified functions can never be executed unless they are local functions.
	 */
	public markSourceUnverified() {
		this.#sourceVerified = false;
	}

	// deno-lint-ignore constructor-super
	private constructor(intermediateFn: (...args:unknown[])=>unknown, lazyResolved: Promise<void>, public deps: Record<string,unknown>, public source: string, public flags?: string[], options?: JSTransferableFunctionOptions) {
		if (options?.errorOnOriginContext) {
			const invalidIntermediateFunction = () => {throw options.errorOnOriginContext};
			super(invalidIntermediateFunction);
			this.#fn = invalidIntermediateFunction;
		}
		else {
			let ptr: Pointer|undefined;
			const fn = (...args:any[]) => {
				if (!options?.isLocal) {
					if (!ptr) ptr = Pointer.getByValue(this);
					if (!ptr) throw new Error("Cannot execute js:Function, must be bound to a pointer");
					// SECURITY: source must come from a verified (signed or local) sender
					if (!this.#sourceVerified) {
						throw new Error("Cannot execute js:Function, source was received from an unverified sender");
					}
					// SECURITY: the creator of the source must be allowed to execute JS on this endpoint
					// (the pointer origin alone is derived from the pointer id, which can be chosen by the sender)
					if (this.sourceOrigin && !Runtime.canExecuteRemoteJS(this.sourceOrigin)) {
						throw new Error("Cannot execute js:Function, origin "+this.sourceOrigin+" has no permission to execute js source code on this endpoint");
					}
					if (!Runtime.canExecuteRemoteJS(ptr.origin)) {
						throw new Error("Cannot execute js:Function, origin "+ptr.origin+" has no permission to execute js source code on this endpoint");
					}
				}
				return intermediateFn(...args)
			}
			super(fn);
			this.#fn = fn;
		}

		this.lazyResolved = lazyResolved;
		this.sourceOrigin = options?.sourceOrigin;
		if (options?.sourceVerified === false) this.#sourceVerified = false;

		this.source = source;
	}


	handleCall(...args:any[]) {
		return this.#fn(...args)
	}

	// waits until all lazy dependencies are resolved and then calls the function
	async callLazy() {
		await this.lazyResolved;
		return this.handleCall()
	}

	public get hasUnresolvedLazyDependencies() {
		return hasUnresolvedLazyDependencies(this.deps)
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
	static create<T extends (...args:unknown[])=>unknown>(fn: T, options:JSTransferableFunctionOptions = {}, useDeclaration?: {vars:{[k:string]:unknown}, flags?:string[]}): JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>> {
        const {vars, flags} = useDeclaration ?? getDeclaredExternalVariables(fn);
		options.isLocal ??= true;
		let source = getSourceWithoutUsingDeclaration(fn);
		if (options.contextURL) source = getSourceWithResolvedPaths(source, options.contextURL);
		return this.#createTransferableFunction(source, vars, flags, options) as any;
	}

	/**
	 * Create a new JSTransferableFunction from a regular async function.
	 * Automatically determines dependency variables declared with use()
	 * @param fn 
	 */
	static async createAsync<T extends (...args:unknown[])=>Promise<unknown>>(fn: T, options:JSTransferableFunctionOptions = {}): Promise<JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>>> {
		const {vars, flags} = await getDeclaredExternalVariablesAsync(fn)	
		options.isLocal ??= true;
		let source = getSourceWithoutUsingDeclaration(fn);
		if (options.contextURL) source = getSourceWithResolvedPaths(source, options.contextURL);
		return this.#createTransferableFunction(source, vars, flags, options) as any;
	}

	/**
	 * Recreate a JSTransferableFunction with existing source code and dependencies
	 * @param source 
	 * @param dependencies 
	 */
	static recreate(source: string, dependencies: Record<string, unknown>, options?: JSTransferableFunctionOptions){
		return this.#createTransferableFunction(source, dependencies, undefined, options)
	}

	static #createTransferableFunction(source: string, dependencies: Record<string, unknown>, flags?: string[], options?:JSTransferableFunctionOptions) {
        const {intermediateFn, lazyResolved} = createFunctionWithDependencyInjectionsResolveLazyPointers(source, dependencies, !options?.isLocal);
		return new JSTransferableFunction(intermediateFn, lazyResolved, dependencies, source, flags, options);
	}

}

export function transferable<T extends (...args:unknown[])=>unknown>(fn: T): JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>>
export function transferable<T extends (...args:unknown[])=>Promise<unknown>>(fn: T): Promise<JSTransferableFunction & Callable<Parameters<T>, ReturnType<T>>>

export function transferable(fn: (...args:unknown[])=>unknown) {
	return JSTransferableFunction.functionIsAsync(fn) ? 
		JSTransferableFunction.createAsync(fn) :
		JSTransferableFunction.create(fn)
}