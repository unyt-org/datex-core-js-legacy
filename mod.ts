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
export * from "./js_adapter/legacy_decorators.ts";
export * from "./datex_short.ts";

export {init} from "./init.ts";

if ((globalThis as any).Datex) throw new Error(`The datex-core-js-legacy library was imported more than once from different sources`);// (v${Datex.Runtime?.VERSION??'X'} from ${Datex.libURL??'unknown'} and v${globalThis.Datex?.Runtime?.VERSION??'X'} from ${globalThis.Datex?.libURL??'unknown'}). Check your imports!`)
(globalThis as any).Datex = Datex;