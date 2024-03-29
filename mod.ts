/**
 * Import this module to get access to the Datex namespace.
 * The Datex runtime is not automatically initialized.
 * It needs to be initialized by calling init() and setting assigning the Blockchain
 * module to Datex.Runtime.Blockchain:
 * 
 * ```ts
 * import {Datex, init} from "datex-core-legacy/mod.ts";
 * import { Blockchain } from "datex-core-legacy/network/blockchain_adapter.ts"
 * Datex.Runtime.Blockchain = Blockchain;
 * await init()
 * ```
 * 
 * Loading Datex this way is required when bundling, otherwise the
 * imports cannot be resolved correctly.
 * If the source code is not bundled, "datex-core-legacy/datex.ts" can be imported.
 */
import * as Datex from "./datex_all.ts";

export {Datex};
export * from "./js_adapter/decorators.ts";
export * from "./datex_short.ts";

export {init} from "./init.ts";


/**
 * Polyfills
 */
Object.defineProperty(globalThis.Promise, "withResolvers", {value: function withResolvers() {
	if (!this) throw new TypeError("Promise.withResolvers called on non-object")
	const out: any = {}
	out.promise = new this((resolve_:any, reject_:any) => {
		out.resolve = resolve_
		out.reject = reject_
	})
	return out
}})

declare global {
	interface PromiseConstructor {
		withResolvers<T>(): {
			promise: Promise<T>,
			resolve: (r:T) => void,
			reject: (e:unknown) => void
		};
	}
}

if ((globalThis as any).Datex) throw new Error(`The datex-core-js-legacy library was imported more than once from different sources`);// (v${Datex.Runtime?.VERSION??'X'} from ${Datex.libURL??'unknown'} and v${globalThis.Datex?.Runtime?.VERSION??'X'} from ${globalThis.Datex?.libURL??'unknown'}). Check your imports!`)
(globalThis as any).Datex = Datex;