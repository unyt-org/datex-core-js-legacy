// custom localstorage class that handles browser and node local storage and temporary (session) storage

import { client_type, cwdURL, Deno, logger } from "../utils/global_values.ts";
import { ptr_cache_path } from "./cache_path.ts";

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
			Deno.openSync(ptr_cache_path);
		} catch {
			Deno.mkdirSync(ptr_cache_path, {recursive:true});
		}

		try {
			Deno.openSync(this.#cache_file);
		} catch {
			Deno.writeTextFileSync(this.#cache_file, '{}');
		}
	}


	saveFile(){
		if (!this.#initialized) return;
		this.#createCacheFileIfNotExisting();
		Deno.writeTextFileSync(this.#cache_file, JSON.stringify(this));
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

export const localStorage = client_type == "deno" ? new LocalStorage() : globalThis.localStorage;