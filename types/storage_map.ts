// deno-lint-ignore-file no-this-alias

import { Compiler } from "../compiler/compiler.ts";
import { DX_PTR } from "../runtime/constants.ts";
import { Pointer } from "../runtime/pointers.ts";
import { Storage } from "../runtime/storage.ts";
import { Logger } from "../utils/logger.ts";

const logger = new Logger("StorageMap");


/**
 * WeakMap that outsources values to storage.
 * The API is similar to the JS WeakMap API, but all methods are async.
 * In contrast to JS WeakMaps, primitive keys are also allowed.
 * The StorageWeakMap holds no strong references to its keys in storage.
 * This means that the pointer of a key can be garbage collected.
 */
export class StorageWeakMap<K,V> {

	#prefix?: string;

	constructor(){
		Pointer.proxifyValue(this)
	}


	static async from<K,V>(entries: readonly (readonly [K, V])[]){
		const map = $$(new StorageWeakMap<K,V>());
		for (const [key, value] of entries) await map.set(key, value);
		return map;
	}

	protected get _prefix() {
		if (!this.#prefix) this.#prefix = 'dxmap::'+(this as any)[DX_PTR].idString()+'.';
		return this.#prefix;
	}

	async get(key: K): Promise<V|undefined> {
		const storage_key = await this.getStorageKey(key);
		return this._get(storage_key);
	}
	protected _get(storage_key:string) {
		this.activateCacheTimeout(storage_key);
		return Storage.getItem(storage_key);
	}

	async has(key: K): Promise<boolean> {
		const storage_key = await this.getStorageKey(key);
		return this._has(storage_key);
	}
	protected _has(storage_key:string) {
		return Storage.hasItem(storage_key)
	}

	async delete(key: K) {
		const storage_key = await this.getStorageKey(key);
		return this._delete(storage_key);
	}
	protected _delete(storage_key:string) {
		return Storage.removeItem(storage_key)
	}


	async set(key: K, value:V) {
		const storage_key = await this.getStorageKey(key);
		return this._set(storage_key, value);
	}
	protected _set(storage_key:string, value:V) {
		this.activateCacheTimeout(storage_key);
		return Storage.setItem(storage_key, value)
	}

	protected activateCacheTimeout(storage_key:string){
		setTimeout(()=>{
			logger.debug("removing item from cache: " + storage_key);
			Storage.cache.delete(storage_key)
		}, 60_000);
	}

	protected async getStorageKey(key: K) {
		const keyHash = await Compiler.getUniqueValueIdentifier(key);
		// @ts-ignore DX_PTR
		return this._prefix + keyHash;
	}

	async clear() {
		const promises = [];
		for (const key of await Storage.getItemKeysStartingWith(this._prefix)) {
			promises.push(await Storage.removeItem(key));
		}
		await Promise.all(promises);
	}

}

/**
 * Set that outsources values to storage.
 * The API is similar to the JS Map API, but all methods are async.
 */
export class StorageMap<K,V> extends StorageWeakMap<K,V> {

	static override async from<K,V>(entries: readonly (readonly [K, V])[]){
		const map = $$(new StorageMap<K,V>());
		for (const [key, value] of entries) await map.set(key, value);
		return map;
	}

	#key_prefix = 'key.'

	override async set(key: K, value: V): Promise<boolean> {
		const storage_key = await this.getStorageKey(key);
		const storage_item_key = this.#key_prefix + storage_key;
		// store value
		await this._set(storage_key, value);
		// store key
		this.activateCacheTimeout(storage_item_key);
		return Storage.setItem(storage_item_key, key)
	}

	override async delete(key: K) {
		const storage_key = await this.getStorageKey(key);
		const storage_item_key = this.#key_prefix + storage_key;
		// delete value
		await this._delete(storage_key);
		// delete key
		return Storage.removeItem(storage_item_key)
	}

	/**
	 * Async iterator that returns all keys.
	 */
	keys() {
		const self = this;
		const key_prefix = this.#key_prefix;
		return (async function*(){
			const keyGenerator = await Storage.getItemKeysStartingWith(self._prefix);
			
			for (const key of keyGenerator) {
				const keyValue = await Storage.getItem(key_prefix+key);
				yield (<K> keyValue);
			}
		})()
	}

	/**
	 * Returns an array containing all keys.
	 * This can be used to iterate over the keys without using a (for await of) loop.
	 */
	async keysArray() {
		const keys = [];
		for await (const key of this.keys()) keys.push(key);
		return keys;
	}

	/**
	 * Async iterator that returns all values.
	 */
	values() {
		const self = this;
		return (async function*(){
			const keyGenerator = await Storage.getItemKeysStartingWith(self._prefix);
			
			for (const key of keyGenerator) {
				const value = await Storage.getItem(key);
				yield (<V> value);
			}
		})()
	}

	/**
	 * Returns an array containing all values.
	 * This can be used to iterate over the values without using a (for await of) loop.
	 */
	async valuesArray() {
		const values = [];
		for await (const value of this.values()) values.push(value);
		return values;
	}

	/**
	 * Async iterator that returns all entries.
	 */
	entries() {
		return this[Symbol.asyncIterator]()
	}

	/**
	 * Returns an array containing all entries.
	 * This can be used to iterate over the entries without using a (for await of) loop.
	 */
	async entriesArray() {
		const entries = [];
		for await (const entry of this.entries()) entries.push(entry);
		return entries;
	}

	async *[Symbol.asyncIterator]() {
		const keyGenerator = await Storage.getItemKeysStartingWith(this._prefix);
		
		for (const key of keyGenerator) {
			const keyValue = await Storage.getItem(this.#key_prefix+key);
			const value = await Storage.getItem(key);
			yield (<[K,V]> [keyValue, value]);
		}
	}

	override async clear() {
		const promises = [];
		for (const key of await Storage.getItemKeysStartingWith(this._prefix)) {
			promises.push(await Storage.removeItem(key));
			promises.push(await Storage.removeItem(this.#key_prefix+key));
		}
		await Promise.all(promises);
	}


}