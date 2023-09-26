/**
 * Represents a JS function with source code that can be transferred between endpoints
 */

import { ExtensibleFunction } from "./function.ts";

export class JSTransferrableFunction extends ExtensibleFunction {
	
	#fn: (...args:unknown[])=>unknown
	source: string

	constructor(fn: (...args:unknown[])=>unknown, public dependencies?: Record<string,unknown>, originalSource?: string) {
		const source = originalSource ?? fn.toString(); // fn.toString() must be called before fn is passed to super
		super(fn);
		this.#fn = fn;
		this.source = source;
	}

	call(...args:any[]) {
		return this.#fn(...args)
	}

}