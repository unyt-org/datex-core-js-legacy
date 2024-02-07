// custom localstorage class that handles browser and node local storage and temporary (session) storage

import { logger } from "../../utils/global_values.ts";
import { client_type } from "../../utils/constants.ts";
import { ptr_cache_path } from "../../runtime/cache_path.ts";
import { normalizePath } from "../../utils/normalize-path.ts";

class LocalStorage implements Storage {
	[name: string]: any;
	get length() {return Object.getOwnPropertyNames(this).length}

	#cache_file?: URL

	#initialized = false;

	#init() {
		if (this.#initialized) return;
		this.#initialized = true;

		this.clear();

		// create cache file
		this.#createCacheFileIfNotExisting();

		// try to parse JSON
		try {
			const serialized = Deno.readFileSync(this.#cache_file);
			const data = JSON.parse(new TextDecoder().decode(serialized));
			Object.assign(this, data);
		}
		catch {
			logger.warn("Could not read localStorage file")
		} // ignore

	}

	#createCacheFileIfNotExisting(){
		const name = '@@local' // Runtime.endpoint.toString(); - not working, not yet initialized at this time

		// file setup
		this.#cache_file = new URL(name, ptr_cache_path);
		try {
			try {
				const file = Deno.openSync(normalizePath(ptr_cache_path));
				file.close()
			} catch {
				Deno.mkdirSync(normalizePath(ptr_cache_path), {recursive:true});
			}
	
			try {
				const file = Deno.openSync(normalizePath(this.#cache_file));
				file.close()
			} catch {
				Deno.writeTextFileSync(normalizePath(this.#cache_file), '{}');
			}
		}
		catch {
			logger.error("Cannot save local storage cache file")
		}
	}


	saveFile(){
		if (!this.#initialized) return;
		this.#createCacheFileIfNotExisting();
		if (this.#cache_file) Deno.writeTextFileSync(normalizePath(this.#cache_file), JSON.stringify(this));
	}


	clear(): void {
		this.#init();
		for (const key of Object.getOwnPropertyNames(this)) {
			delete this[key];
		}
	}
	getItem(key: string): string {
		this.#init();
		return this[key];
	}
	key(index: number): string {
		this.#init();
		return Object.getOwnPropertyNames(this)[index];
	}
	removeItem(key: string): void {
		this.#init();
		delete this[key];
	}
	setItem(key: string, value: string): void {
		this.#init();
		this[key] = String(value);
	}

}

// old deno worker problems
// if (client_type !== "deno" && client_type !== "worker" && !globalThis.localStorage) {
// 	throw "no localStorage available (are you using the latest Deno version?)"
// }

// export const localStorage = client_type == "deno" ? new LocalStorage() : globalThis.localStorage;
// if (client_type == "deno") globalThis.localStorage = localStorage;


// migrate from compat localStorage to deno localStorage
// TODO: remove this at some point
if (client_type == "deno" && !globalThis.NO_INIT) {
	try {
		const cache_file = new URL('@@local', ptr_cache_path);
		const serialized = Deno.readFileSync(cache_file);
		const data = JSON.parse(new TextDecoder().decode(serialized));
		const entries = Object.entries(data);
		for (const [key, value] of entries as [string, string][]) {
			globalThis.localStorage.setItem(key, value);
		}
		await Deno.rename(cache_file, new URL('@@local.backup', ptr_cache_path));
		logger.success("Migrated "+entries.length+" items from compat pointer storage to deno localStorage")
	}
	catch {}
}

export const localStorage = globalThis.localStorage