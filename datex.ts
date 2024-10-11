
/**
 * Default entrypoint for Datex, autmatically
 * initialized the Runtime
 */

export * from "./mod.ts";
import {init} from "./init.ts"

// load blockchain (after runtime modules are all initialized)
import { Blockchain } from "./network/blockchain_adapter.ts"
import { Runtime } from "./runtime/runtime.ts";
Runtime.Blockchain = Blockchain;


// workaround for backwards compatibility with Deno < 2.0.0
if (!globalThis.window) {
	globalThis.window = globalThis;
}

await init();