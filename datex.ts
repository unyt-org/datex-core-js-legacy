
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

await init();