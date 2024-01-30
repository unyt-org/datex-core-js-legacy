import { Runtime } from "./runtime/runtime.ts";
import { Pointer } from "./runtime/pointers.ts";
import { LOCAL_ENDPOINT } from "./types/addressing.ts";
import { client_type } from "./utils/constants.ts";
import { Storage, registerStorageAsPointerSource } from "./runtime/storage.ts";
import { logger } from "./utils/global_values.ts";
import { IndexedDBStorageLocation } from "./runtime/storage-locations/indexed-db.ts";
import { LocalStorageLocation } from "./runtime/storage-locations/local-storage.ts";
import { DenoKVStorageLocation } from "./runtime/storage-locations/deno-kv.ts";
import { loadEternalValues } from "./utils/eternals.ts";
import { DX_BOUND_LOCAL_SLOT } from "./runtime/constants.ts";
import { verboseArg } from "./utils/logger.ts";
import { MessageLogger } from "./utils/message_logger.ts";


/**
 * Runtime init (sets ENV, storage, endpoint, ...)
 */
export async function init() {

	// register DatexStorage as pointer source
	registerStorageAsPointerSource();
	// default storage config:

	// @ts-ignore NO_INIT
	if (!globalThis.NO_INIT) {
		if (client_type == "browser") {
			await Storage.addLocation(new IndexedDBStorageLocation(), {
				modes: [Storage.Mode.SAVE_ON_CHANGE, Storage.Mode.SAVE_PERIODICALLY],
				primary: true
			})
			await Storage.addLocation(new LocalStorageLocation(), {
				modes: [Storage.Mode.SAVE_ON_EXIT],
				primary: false
			})
		}
		else if (client_type == "deno") {
			const denoKV = new DenoKVStorageLocation();
			if (denoKV.isSupported()) {
				console.log("Using DenoKV as primary storage location (experimental)")
				await Storage.addLocation(denoKV, {
					modes: [Storage.Mode.SAVE_ON_CHANGE],
					primary: true
				})
			}
			else {
				await Storage.addLocation(new LocalStorageLocation(), {
					modes: [Storage.Mode.SAVE_ON_EXIT, Storage.Mode.SAVE_ON_CHANGE],
					primary: denoKV.isSupported() ? false : true
				})
			}
		}
		
	}

	// listen for endpoint changes
	Runtime.onEndpointChanged((endpoint) => {
		Pointer.pointer_prefix = endpoint.getPointerPrefix();
		// has only local endpoint id (%0000) or global id?
		if (endpoint != LOCAL_ENDPOINT) {
			Pointer.is_local = false;
			// update storage entries that contain pointers with unresolved @@local origin
			Storage.updateEntriesWithUnresolvedLocalDependencies();
		}
		else Pointer.is_local = true;
	})

	// enable periodic pointer subscriber cleanup
	Pointer.enablePeriodicSubscriberCleanup();


	// set runtime endpoint
	Runtime._setEndpoint(LOCAL_ENDPOINT)

	// precompiled dxb
	await Runtime.precompile();

	// set Runtime ENV (not persistent if globalThis.NO_INIT)
	Runtime.ENV = globalThis.NO_INIT ? getDefaultEnv() : await Storage.loadOrCreate("Datex.Runtime.ENV", getDefaultEnv);
	Runtime.ENV[DX_BOUND_LOCAL_SLOT] = "env"

	// workaround, should never happen
	if (!Runtime.ENV) {
		logger.error("Runtime ENV is undefined");
		Runtime.ENV = getDefaultEnv()
	}

	// add environment variables to #env (might override existing env settings (LANG))
	if (client_type === "deno") {
		for (const [key, val] of Object.entries(Deno.env.toObject())) {
			if (key == "LANG") {
				let lang = val.split("-")[0]?.split("_")[0];
				if (lang == "C" || lang?.startsWith("C.")) lang = "en";
				Runtime.ENV[key] = lang;
			}
			else Runtime.ENV[key] = val;
		}
	}

	Runtime.ENV.DATEX_VERSION = Runtime.VERSION;

	function getDefaultEnv() {
		return {
			LANG: globalThis.localStorage?.lang ?? globalThis?.navigator?.language?.split("-")[0]?.split("_")[0] ?? 'en',
			DATEX_VERSION: null
		}
	}


	// init persistent memory
	Runtime.persistent_memory = (await Storage.loadOrCreate("Datex.Runtime.MEMORY", ()=>new Map())).setAutoDefault(Object);


	if (!globalThis.NO_INIT) {
		Runtime.init();

		// @ts-ignore
		globalThis.print = Runtime.STD_STATIC_SCOPE.print
		// @ts-ignore
		globalThis.printf = Runtime.STD_STATIC_SCOPE.printf
		// @ts-ignore
		globalThis.printn = Runtime.STD_STATIC_SCOPE.printn
	}

	// @ts-ignore NO_INIT
	if (!globalThis.NO_INIT) await loadEternalValues();

	// enables message logger when running with -v
	if (verboseArg) MessageLogger.enable()
}
