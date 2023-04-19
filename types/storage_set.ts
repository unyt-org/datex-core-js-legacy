// deno-lint-ignore-file no-this-alias
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
	logger = new Datex.Logger("StorageSet");
}


/**
 * Set that outsources values to storage.
 * all methods are async
 */
export class StorageSet<V> {

	#prefix?: string;

	constructor(){
		Pointer.proxifyValue(this)
	}

	static async from<V>(values: readonly V[]) {
		const set = new StorageSet<V>();
		for (const v of values) await set.add(v);
		return set;
	}

	get prefix() {
		// @ts-ignore
		if (!this.#prefix) this.#prefix = 'dxset::'+this[Datex.DX_PTR].idString()+'.';
		return this.#prefix;
	}

	async add(value: V) {
		const storage_key = await this.getStorageKey(value);
		if (await this._has(storage_key)) return; // already exists
		return this._add(storage_key, value);
	}
	protected async _add(storage_key:string, value:V) {
		await init();
		this.activateCacheTimeout(storage_key);
		return Datex.Storage.setItem(storage_key, value);
	}

	async has(value: V): Promise<boolean> {
		const storage_key = await this.getStorageKey(value);
		return this._has(storage_key);
	}
	protected async _has(storage_key:string) {
		await init();
		return Datex.Storage.hasItem(storage_key)
	}

	async delete(value: V) {
		const storage_key = await this.getStorageKey(value);
		return this._delete(storage_key);
	}
	protected async _delete(storage_key:string) {
		await init();
		return Datex.Storage.removeItem(storage_key)
	}

	protected activateCacheTimeout(storage_key:string){
		setTimeout(()=>{
			logger.debug("removing item from cache: " + storage_key);
			Datex.Storage.cache.delete(storage_key)
		}, 60_000);
	}

	protected async getStorageKey(value: V) {
		await init();
		const keyHash = await Datex.Compiler.getUniqueValueIdentifier(value);
		// @ts-ignore DX_PTR
		return this.prefix + keyHash;
	}

	async clear() {
		const promises = [];
		for (const key of await Datex.Storage.getItemKeysStartingWith(this.prefix)) {
			promises.push(await Datex.Storage.removeItem(key));
		}
		await Promise.all(promises);
	}


	keys() {
		return this[Symbol.asyncIterator]()
	}
	async keysArray() {
		const keys = [];
		for await (const key of this.keys()) keys.push(key);
		return keys;
	}

	values() {
		return this[Symbol.asyncIterator]()
	}
	async valuesArray() {
		const values = [];
		for await (const value of this.values()) values.push(value);
		return values;
	}

	entries() {
		const self = this;
		return (async function*(){
			await init();
			const keyGenerator = await Datex.Storage.getItemKeysStartingWith(self.prefix);
			
			for (const key of keyGenerator) {
				const value = await Datex.Storage.getItem(key);
				yield (<[V,V]> [value,value]);
			}
		})()
	}
	async entriesArray() {
		const entries = [];
		for await (const entry of this.entries()) entries.push(entry);
		return entries;
	}

	async *[Symbol.asyncIterator]() {
		await init();
		const keyGenerator = await Datex.Storage.getItemKeysStartingWith(this.prefix);
		
		for (const key of keyGenerator) {
			const value = await Datex.Storage.getItem(key);
			yield (<V> value);
		}
	}

}