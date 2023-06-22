// all Datex.*
import * as Datex from "./datex_all.ts";
import { client_type } from "./datex_all.ts";
import { DenoKVStorageLocation } from "./runtime/storage-locations/deno-kv.ts";
import { IndexedDBStorageLocation } from "./runtime/storage-locations/indexed-db.ts";
import { LocalStorageLocation } from "./runtime/storage-locations/local-storage.ts";
export {Datex};

// @ts-ignore
if (globalThis.Datex) throw new Error(`The unyt core library was imported more than once from different sources`)// (v${Datex.Runtime?.VERSION??'X'} from ${Datex.libURL??'unknown'} and v${globalThis.Datex?.Runtime?.VERSION??'X'} from ${globalThis.Datex?.libURL??'unknown'}). Check your imports!`)
// @ts-ignore
globalThis.Datex = Datex;
// decorators
export * from "./js_adapter/legacy_decorators.ts";

// shortcut methods ($$, string, int, ...)
export * from "./datex_short.ts";


// default storage config:

// @ts-ignore NO_INIT
if (!globalThis.NO_INIT) {
    if (client_type == "browser") {
		await Datex.Storage.addLocation(new IndexedDBStorageLocation(), {
			modes: [Datex.Storage.Mode.SAVE_ON_CHANGE, Datex.Storage.Mode.SAVE_PERIODICALLY],
			primary: true
		})
	}    
	// else {
	// 	await Datex.Storage.addLocation(new DenoKVStorageLocation(), {
	// 		modes: [Datex.Storage.Mode.SAVE_ON_CHANGE, Datex.Storage.Mode.SAVE_PERIODICALLY],
	// 		primary: true
	// 	})
	// }
    
    await Datex.Storage.addLocation(new LocalStorageLocation(), {
        modes: [Datex.Storage.Mode.SAVE_ON_EXIT],
		primary: client_type == "deno"
    })
}



// const short = await import("./datex_short.ts");

// export const $$ = short.$$;
// export const f = short.f;
// export const datex = short.datex;
// export const static_pointer = short.static_pointer;
// export const always = short.always;
// export const decimal = short.decimal;
// export const text = short.text;
// export const integer = short.integer;
// export const boolean = short.boolean;
// export const instance = short.instance;
// export const local_text = short.local_text;
// export const script = short.script;
// export const transform = short.transform;
// export const get = short.get;
// export const props = short.props;
// export const pointer = short.pointer;
// export const eternal = short.eternal;
// export const map = short.map;
// export const select = short.select;
// export const and = short.and;
// export const or = short.or;
// export const not = short.not;