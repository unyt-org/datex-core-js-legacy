// deno-lint-ignore-file no-this-alias

import { Compiler } from "../compiler/compiler.ts";
import { DX_PTR } from "../runtime/constants.ts";
import { Pointer } from "../runtime/pointers.ts";
import { MatchResult, Storage } from "../storage/storage.ts";
import { Logger } from "../utils/logger.ts";
import { MatchInput, match } from "../utils/match.ts";
import type { Class } from "../utils/global_types.ts";
import { MatchOptions } from "../utils/match.ts";
import { Type } from "./type.ts";

const logger = new Logger("StorageSet");

/**
 * WeakSet that outsources values to storage.
 * The API is similar to the JS WeakSet API, but all methods are async.
 * In contrast to JS WeakSets, primitive values are also allowed.
 * The StorageWeakSet holds no strong references to its values in storage.
 * This means that the pointer of a value can be garbage collected.
 */
export class StorageWeakSet<V> {

	/**
	 * Time in milliseconds after which a value is removed from the in-memory cache
	 * Default: 5min
	 */
	cacheTimeout = 5 * 60 * 1000;

	/**
	 * If true, non-pointer objects are allowed as 
	 * values in the map (default)
	 * Otherwise, object values are automatically proxified
	 * when added to the map.
	 */
	allowNonPointerObjectValues = false;

	#prefix?: string;

	// StorageWeakSets are not bound to a pointer per default, but a pointer is automatically created if needed
	#_pointer?: Pointer;
	get #pointer() {
		if (!this.#_pointer) this.#_pointer = Pointer.getByValue(this);
		if (!this.#_pointer) {
			Pointer.proxifyValue(this);
			this.#_pointer = Pointer.getByValue(this)!;
		}
		return this.#_pointer;
	}

	static async from<V>(values: readonly V[]) {
		const set = $$(new StorageSet<V>());
		for (const v of values) await set.add(v);
		return set;
	}

	get _prefix() {
		if (!this.#prefix) this.#prefix = 'dxset::'+this.#pointer.idString()+'.';
		return this.#prefix;
	}

	async add(value: V) {
		const storage_key = await this.getStorageKey(value);
		if (await this._has(storage_key)) return this; // already exists
		await this._add(storage_key, null);
		return this;
	}
	protected _add(storage_key:string, value:V|null) {
		// proxify value
		if (!this.allowNonPointerObjectValues) {
			value = this.#pointer.proxifyChild("", value);
		}
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
			Storage.cache.delete(storage_key)
		}, this.cacheTimeout);
	}

	protected async getStorageKey(value: V) {
		const keyHash = await Compiler.getUniqueValueIdentifier(value);
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
 * The API is similar to the JS Set API, but all methods are async.
 */
export class StorageSet<V> extends StorageWeakSet<V> {


	#size?: number;

	get size() {
		if (this.#size == undefined) throw new Error("size not yet available. use getSize() instead");
		return this.#size;
	}

	async getSize() {
		if (this.#size != undefined) return this.#size;
		else {
			await this.#determineSizeFromStorage(); 
			return this.#size!
		}
	}

	/**
	 * Sets this.#size to the correct value determined from storage.
	 */
	async #determineSizeFromStorage() {
		const calculatedSize = await Storage.getItemCountStartingWith(this._prefix);
		this.#updateSize(calculatedSize);
	}

	#updateSize(newSize: number) {
		this.#size = newSize;
	}

	async #incrementSize() {
		this.#updateSize(this.#size == undefined ? await this.getSize() : this.#size + 1);
	}
	
	async #decrementSize() {
		this.#updateSize(this.#size == undefined ? await this.getSize() : this.#size - 1);
	}


	/**
	 * Appends a new value to the StorageWeakSet.
	 */
	async add(value: V) {
		const storage_key = await this.getStorageKey(value);
		if (await this._has(storage_key)) return this; // already exists
		await this._add(storage_key, value);
		await this.#incrementSize();
		return this;
	}

	async delete(value: V) {
		const wasDeleted = await super.delete(value);
		if (wasDeleted) await this.#decrementSize();
		return wasDeleted;
	}

	async clear(): Promise<void> {
		await super.clear();
		await this.#updateSize(0);
	}

	/**
	 * Async iterator that returns all keys.
	 */
	keys() {
		return this[Symbol.asyncIterator]()
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
		return this[Symbol.asyncIterator]()
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
		const self = this;
		return (async function*(){
			const keyGenerator = await Storage.getItemKeysStartingWith(self._prefix);
			
			for (const key of keyGenerator) {
				const value = await Storage.getItem(key);
				yield (<[V,V]> [value,value]);
			}
		})()
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
			const value = await Storage.getItem(key);
			yield (<V> value);
		}
	}

	match<Options extends MatchOptions, T extends V & object>(valueType:Class<T>|Type<T>, matchInput: MatchInput<T>, options?: Options): Promise<MatchResult<T, Options>> {
		return match(this as unknown as StorageSet<T>, valueType, matchInput, options)
	}
}