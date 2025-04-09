// deno-lint-ignore-file no-this-alias

import { Compiler } from "../compiler/compiler.ts";
import { VOID } from "../runtime/constants.ts";
import { Pointer, ReactiveValue } from "../runtime/pointers.ts";
import { MatchOptions, Storage } from "../storage/storage.ts";
import { Class } from "../utils/global_types.ts";
import { MatchInput, MatchResult, match } from "../utils/match.ts";
import { Type } from "./type.ts";


/**
 * WeakMap that outsources values to storage.
 * The API is similar to the JS WeakMap API, but all methods are async.
 * In contrast to JS WeakMaps, primitive keys are also allowed.
 * The StorageWeakMap holds no strong references to its keys in storage.
 * This means that the pointer of a key can be garbage collected.
 */
export class StorageWeakMap<K,V> {

	/**
	 * Create a new StorageWeakMap instance with the given key and value types.
	 * @param keyType Class or DATEX Type of the keys
	 * @param valueType	Class or DATEX Type of the values
	 * @returns 
	 */
	static of<K,V>(keyType:Class<K>|Type<K>|undefined|null, valueType: Class<V>|Type<V>): StorageWeakMap<K,V> {
		const storageMap = new this<K,V>();
		storageMap.#_type = valueType instanceof Type ? valueType : Type.getClassDatexType(valueType);
		storageMap._type = storageMap.#_type.namespace + ":" + storageMap.#_type.name;
		return storageMap;
	}

	_type?: string
	#_type?: Type<V>;

	protected get type() {
		if (!this._type) return undefined;
		if (!this.#_type) this.#_type = Type.get(this._type);
		return this.#_type;
	}

	#prefix?: string;

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

	// StorageWeakMaps are not bound to a pointer per default, but a pointer is automatically created if needed
	#_pointer?: Pointer;
	get #pointer() {
		if (!this.#_pointer) this.#_pointer = Pointer.getByValue(this);
		if (!this.#_pointer) {
			Pointer.proxifyValue(this);
			this.#_pointer = Pointer.getByValue(this)!;
		}
		return this.#_pointer;
	}

	static async from<K,V>(entries: readonly (readonly [K, V])[]){
		const map = $$(new StorageWeakMap<K,V>());
		for (const [key, value] of entries) await map.set(key, value);
		return map;
	}

	protected get _prefix() {
		if (!this.#prefix) this.#prefix = 'dxmap::'+this.#pointer.idString()+'.';
		return this.#prefix;
	}

	async get(key: K): Promise<V|undefined> {
		const storage_key = await this.getStorageKey(key);
		return this._get(storage_key);
	}

	protected _get(storage_key:string) {
		this.handleBeforeNonReferencableGet();
		this.activateCacheTimeout(storage_key);
		return Storage.getItem(storage_key);
	}

	async has(key: K): Promise<boolean> {
		const storage_key = await this.getStorageKey(key);
		return this._has(storage_key);
	}
	protected _has(storage_key:string) {
		this.handleBeforeNonReferencableGet();
		return Storage.hasItem(storage_key)
	}

	async delete(key: K) {
		const storage_key = await this.getStorageKey(key);
		return this._delete(storage_key, key);
	}
	protected async _delete(storage_key:string, key: K) {
		const res = await Storage.removeItem(storage_key)
		this.#pointer.callObservers(VOID, key, ReactiveValue.UPDATE_TYPE.DELETE);
		return res;
	}

	async set(key: K, value:V) {
		const storage_key = await this.getStorageKey(key);
		return this._set(storage_key, key, value);
	}
	protected async _set(storage_key:string, key:K, value:V) {
		// proxify value
		if (!this.allowNonPointerObjectValues) {
			value = this.#pointer.proxifyChild("", value);
		}
		this.activateCacheTimeout(storage_key);
		await Storage.setItem(storage_key, value);
		this.#pointer.callObservers(value, key, ReactiveValue.UPDATE_TYPE.SET, false, false)
		return this;
	}

	protected activateCacheTimeout(storage_key:string){
		setTimeout(()=>{
			Storage.cache.delete(storage_key)
		}, this.cacheTimeout);
	}

	protected async getStorageKey(key: K) {
		const keyHash = await Compiler.getUniqueValueIdentifier(key);
		// @ts-ignore DX_PTR
		return this._prefix + keyHash;
	}

	async clear() {
		const promises = [];
		for (const key of await Storage.getItemKeysStartingWith(this._prefix)) {
			promises.push(Storage.removeItem(key));
		}
		await Promise.all(promises);
		this.handleClear();
	}

	protected handleBeforeNonReferencableGet() {
		this.#pointer.handleBeforeNonReferencableGet();
	}

	protected handleClear() {
		this.#pointer.callObservers(VOID, VOID, ReactiveValue.UPDATE_TYPE.CLEAR);
	}
}

/**
 * Set that outsources values to storage.
 * The API is similar to the JS Map API, but all methods are async.
 */
export class StorageMap<K,V> extends StorageWeakMap<K,V> {

	/**
	 * Create a new StorageMap instance with the given key and value types.
	 * @param keyType Class or DATEX Type of the keys
	 * @param valueType Class or DATEX Type of the values
	 * @returns 
	 */
	static override of<K, V>(keyType:Class<K>|Type<K>, valueType: Class<V>|Type<V>): StorageMap<K, V> {
		return super.of(keyType, valueType) as StorageMap<K, V>;
	}

	static override async from<K,V>(entries: readonly (readonly [K, V])[]){
		const map = $$(new StorageMap<K,V>());
		for (const [key, value] of entries) await map.set(key, value);
		return map;
	}

	#key_prefix = 'key.'

	#size?: number;

	get size() {
		this.handleBeforeNonReferencableGet();
		if (this.#size == undefined) throw new Error("size not yet available. use getSize() instead");
		return this.#size;
	}

	async getSize() {
		this.handleBeforeNonReferencableGet();
		if (this.#size != undefined) return this.#size;
		else {
			await this.#determineSizeFromStorage(); 
			return this.#size!
		}
	}

	async getKeyForValue(value: V): Promise<K|undefined> {
		this.handleBeforeNonReferencableGet();
		const keyId = await Storage.getItemKey(value);
		const key = await Storage.getItem(this.#key_prefix + keyId);
		return key;
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

	override async set(key: K, value: V): Promise<this> {
		const storage_key = await this.getStorageKey(key);
		const storage_item_key = this.#key_prefix + storage_key;
		// store value
		await this._set(storage_key, key, value);
		// store key
		this.activateCacheTimeout(storage_item_key);
		const alreadyExisted = await Storage.setItem(storage_item_key, key);
		if (!alreadyExisted) await this.#incrementSize();
		return this;
	}

	override async delete(key: K) {
		const storage_key = await this.getStorageKey(key);
		const storage_item_key = this.#key_prefix + storage_key;
		// delete value
		await this._delete(storage_key, key);
		// delete key
		const existed = await Storage.removeItem(storage_item_key)
		if (existed) await this.#decrementSize();
		return existed;
	}

	/**
	 * Async iterator that returns all keys.
	 */
	keys() {
		this.handleBeforeNonReferencableGet();
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
		this.handleBeforeNonReferencableGet();
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
		this.handleBeforeNonReferencableGet();
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
		this.handleClear();
	}

	match<Options extends MatchOptions, T extends V & object>(matchInput: MatchInput<T>, options?: Options, valueType?: Type<T>): Promise<MatchResult<Options['returnKeys'] extends true ? K : T, Options>> {
		this.handleBeforeNonReferencableGet();
		valueType ??= this.type as any;
		if (!valueType) throw new Error("Cannot determine value type. Please provide a valueType parameter to match()");
		return match(this as unknown as StorageMap<unknown, T>, valueType, matchInput, options) as any;
	}

}