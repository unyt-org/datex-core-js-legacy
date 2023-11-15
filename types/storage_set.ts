// deno-lint-ignore-file no-this-alias

import { Compiler } from "../compiler/compiler.ts";
import { DX_PTR } from "../runtime/constants.ts";
import { Pointer } from "../runtime/pointers.ts";
import { Storage } from "../runtime/storage.ts";
import { Logger } from "../utils/logger.ts";

const logger = new Logger("StorageSet");

/**
 * Set that outsources values to storage.
 * all methods are async
 */
export class StorageSet<V> {

	#prefix?: string;

	constructor(){
		// TODO: does not work with eternal pointers!
		// Pointer.proxifyValue(this)
	}

	static async from<V>(values: readonly V[]) {
		const set = $$(new StorageSet<V>());
		for (const v of values) await set.add(v);
		return set;
	}

	get prefix() {
		// @ts-ignore
		if (!this.#prefix) this.#prefix = 'dxset::'+this[DX_PTR].idString()+'.';
		return this.#prefix;
	}

	async add(value: V) {
		const storage_key = await this.getStorageKey(value);
		if (await this._has(storage_key)) return; // already exists
		return this._add(storage_key, value);
	}
	protected _add(storage_key:string, value:V) {
		this.activateCacheTimeout(storage_key);
		return Storage.setItem(storage_key, value);
	}

	async has(value: V): Promise<boolean> {
		const storage_key = await this.getStorageKey(value);
		return this._has(storage_key);
	}
	protected _has(storage_key:string) {
		return Storage.hasItem(storage_key)
	}

	async delete(value: V) {
		const storage_key = await this.getStorageKey(value);
		return this._delete(storage_key);
	}
	protected _delete(storage_key:string) {
		return Storage.removeItem(storage_key)
	}

	protected activateCacheTimeout(storage_key:string){
		setTimeout(()=>{
			logger.debug("removing item from cache: " + storage_key);
			Storage.cache.delete(storage_key)
		}, 60_000);
	}

	protected getStorageKey(value: V) {
		const keyHash = Compiler.getUniqueValueIdentifier(value);
		// @ts-ignore DX_PTR
		return this.prefix + keyHash;
	}

	async clear() {
		const promises = [];
		for (const key of await Storage.getItemKeysStartingWith(this.prefix)) {
			promises.push(await Storage.removeItem(key));
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
			const keyGenerator = await Storage.getItemKeysStartingWith(self.prefix);
			
			for (const key of keyGenerator) {
				const value = await Storage.getItem(key);
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
		const keyGenerator = await Storage.getItemKeysStartingWith(this.prefix);
		
		for (const key of keyGenerator) {
			const value = await Storage.getItem(key);
			yield (<V> value);
		}
	}

}