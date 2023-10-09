/**
 * Represents a JS function with source code that can be transferred between endpoints
 */

import { ExtensibleFunction, getDeclaredExternalVariables, getDeclaredExternalVariablesAsync } from "./function.ts";

export class JSTransferableFunction extends ExtensibleFunction {
	
	#fn: (...args:unknown[])=>unknown
	source: string

	constructor(fn: (...args:unknown[])=>unknown, public deps?: Record<string,unknown>, originalSource?: string) {
		const source = originalSource ?? fn.toString(); // fn.toString() must be called before fn is passed to super
		
		// get dependencies from use() statement
		if (!deps) {
			const is_async = fn.constructor.name == "AsyncFunction"
			// save external variables
			if (is_async) {
				(async () => {
					deps = await getDeclaredExternalVariablesAsync(fn as (...args: unknown[]) => Promise<unknown>)
				})();
			}
			else {
				deps = getDeclaredExternalVariables(fn)
			}
		}

		super(fn);
		this.#fn = fn;
		this.source = source;
	}

	call(...args:any[]) {
		return this.#fn(...args)
	}

}