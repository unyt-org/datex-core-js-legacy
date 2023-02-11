// all Datex.*
import * as Datex from "./datex_all.ts";
export {Datex};

// @ts-ignore
if (globalThis.Datex) throw new Error(`The unyt core library was imported more than once from different sources`)// (v${Datex.Runtime?.VERSION??'X'} from ${Datex.libURL??'unknown'} and v${globalThis.Datex?.Runtime?.VERSION??'X'} from ${globalThis.Datex?.libURL??'unknown'}). Check your imports!`)
// @ts-ignore
globalThis.Datex = Datex;
// shortcut methods ($$, string, int, ...)
export * from "./datex_short.ts";

// decorators
export * from "./js_adapter/legacy_decorators.ts";