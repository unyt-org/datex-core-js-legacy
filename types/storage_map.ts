// import { Logger } from "../utils/logger.ts";
// import { Storage } from "../runtime/Datex.Storage.ts";
// import { Compiler } from "../compiler/compiler.ts";
// const logger = new Logger("StorageMap");

import { Pointer } from "../runtime/pointers.ts";

let logger: import("../utils/logger.ts").Logger;
let Datex: typeof import("../datex.ts").Datex;

// workaround for working module import resolution
async function init() {
	if (logger) return;
	({ Datex } = (await import("../datex.ts")));
	logger = new Datex.Logger("StorageMap");
}

/**
 * get and set values async, relocates values to file storage/indexeddb
 */
export class StorageMap<K,V>  {

	constructor(){
		Pointer.proxifyValue(this)
	}

	async get(key: K): Promise<V|undefined> {
		await init();
		const storage_key = await this.#getStorageKey(key);
		this.#activateCacheTimeout(storage_key);
		return Datex.Storage.getItem(storage_key);
	}

	async has(key: K): Promise<boolean> {
		await init();
		const storage_key = await this.#getStorageKey(key);
		this.#activateCacheTimeout(storage_key);
		return Datex.Storage.hasItem(storage_key)
	}

	async delete(key: K) {
		await init();
		const storage_key = await this.#getStorageKey(key);
		this.#activateCacheTimeout(storage_key);
		await Datex.Storage.removeItem(storage_key)
	}


	async set(key: K, value:V) {
		await init();
		const storage_key = await this.#getStorageKey(key);
		this.#activateCacheTimeout(storage_key);
		return Datex.Storage.setItem(storage_key, value)
	}

	#activateCacheTimeout(storage_key:string){
		setTimeout(()=>{
			logger.debug("removing item from cache: " + storage_key);
			Datex.Storage.cache.delete(storage_key)
		}, 60_000);
	}

	async #getStorageKey(key: K) {
		const keyHash = await Datex.Compiler.getUniqueValueIdentifier(key);
		// @ts-ignore DX_PTR
		return this[Datex.DX_PTR].idString() + "." + keyHash;
	}

}