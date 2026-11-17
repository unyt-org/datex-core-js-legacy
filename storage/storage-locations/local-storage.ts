import { Compiler } from "../../compiler/compiler.ts";
import { Storage, SyncStorageLocation } from "../storage.ts";
import { Pointer } from "../../runtime/pointers.ts";
import { Runtime } from "../../runtime/runtime.ts";
import { NOT_EXISTING } from "../../runtime/constants.ts";
import { base64ToArrayBuffer } from "../../utils/utils.ts";
import { arrayBufferToBase64 } from "../../datex_all.ts";
import { localStorage } from "./local-storage-compat.ts";
import type { ExecConditions } from "../../utils/global_types.ts";
import { client_type } from "../../utils/constants.ts";

/**
 * Orders keys like Deno's localStorage listing (SQLite BINARY collation on UTF-8 = code point order).
 * JS `<` compares UTF-16 code units, which differs only for surrogates vs U+E000..U+FFFF.
 */
function compareKeys(a: string, b: string) {
	if (a === b) return 0;
	const n = Math.min(a.length, b.length);
	let i = 0;
	while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
	if (i === n) return a.length - b.length;
	let ca = a.charCodeAt(i), cb = b.charCodeAt(i);
	if (ca >= 0xD800 && ca <= 0xDFFF) ca += 0x10000;
	if (cb >= 0xD800 && cb <= 0xDFFF) cb += 0x10000;
	return ca - cb;
}

/** first index whose key is >= key */
function lowerBound(keys: string[], key: string) {
	let lo = 0, hi = keys.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (compareKeys(keys[mid], key) < 0) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/**
 * Sorted in-memory index of the DATEX item/pointer keys in Deno's localStorage.
 * Listing keys through localStorage enumerates every stored key (all items, pointers, reference
 * counts) for each StorageMap/StorageSet iteration or size query. The index keeps the same
 * order as the native listing and is updated by this location's own writes. It is rebuilt from
 * the native listing whenever localStorage.length differs from the expected count (writes by
 * other code, e.g. DATEX meta keys or a localStorage.clear()).
 */
class DenoKeyIndex {
	#items: string[] = [];
	#pointers: string[] = [];
	#length = -1;

	#ensure() {
		if (localStorage.length === this.#length) return;
		const items: string[] = [], pointers: string[] = [];
		const keys = Reflect.ownKeys(localStorage) as string[];
		for (const key of keys) {
			if (key.startsWith(Storage.item_prefix)) items.push(key.slice(Storage.item_prefix.length));
			else if (key.startsWith(Storage.pointer_prefix)) pointers.push(key.slice(Storage.pointer_prefix.length));
		}
		items.sort(compareKeys);
		pointers.sort(compareKeys);
		this.#items = items;
		this.#pointers = pointers;
		this.#length = keys.length;
	}

	#list(pointers: boolean) {
		this.#ensure();
		return pointers ? this.#pointers : this.#items;
	}

	/** keys in native order, optionally restricted to a prefix (snapshot) */
	keys(pointers: boolean, prefix?: string) {
		const keys = this.#list(pointers);
		if (!prefix) return keys.slice();
		const start = lowerBound(keys, prefix);
		let end = start;
		while (end < keys.length && keys[end].startsWith(prefix)) end++;
		return keys.slice(start, end);
	}

	/** call after a successful localStorage.setItem */
	added(pointers: boolean, key: string) {
		if (this.#length < 0) return; // not built yet
		const keys = pointers ? this.#pointers : this.#items;
		const i = lowerBound(keys, key);
		if (keys[i] === key) return;
		keys.splice(i, 0, key);
		this.#length++;
	}

	/** call after localStorage.removeItem */
	removed(pointers: boolean, key: string) {
		if (this.#length < 0) return;
		const keys = pointers ? this.#pointers : this.#items;
		const i = lowerBound(keys, key);
		if (keys[i] !== key) return;
		keys.splice(i, 1);
		this.#length--;
	}
}

// Deno's localStorage is process-local (SQLite file per location); browser localStorage is shared
// between tabs and keeps the native listing.
const keyIndex = client_type == "deno" ? new DenoKeyIndex() : undefined;

export class LocalStorageLocation extends SyncStorageLocation {
	name = "LOCAL_STORAGE"

	supportsExecConditions = true

	isSupported() {
		return !!localStorage;
	}

	onAfterSnapshot(isExit: boolean) {
		// exit snapshot is always saved independantly
		if (!isExit && localStorage.saveFile) localStorage.saveFile(); // deno local storage, save file afer save on exit or interval
	}

	setItem(key: string, value: unknown) {
		const inserted_ptrs = new Set<Pointer>();
        localStorage.setItem(Storage.item_prefix+key, Compiler.encodeValueBase64(value, inserted_ptrs));  // serialized pointer
        keyIndex?.added(false, key);
        return inserted_ptrs;
	}

	getItem(key: string, conditions?: ExecConditions) {
		const base64 = localStorage.getItem(Storage.item_prefix+key);
		if (base64==null) return NOT_EXISTING;
		else return Runtime.decodeValueBase64(base64, false, conditions);
	}

	*getItemKeys(prefix?: string) {
		if (keyIndex) {
			yield* keyIndex.keys(false, prefix);
			return;
		}
		for (const key of Reflect.ownKeys(localStorage) as string[]) { // ownKeys avoids a getItem per key (Deno proxy descriptors)
			if (key.startsWith(Storage.item_prefix)) {
				yield key.replace(Storage.item_prefix,"");
			}
		}
	}

	*getPointerIds() {
		if (keyIndex) {
			yield* keyIndex.keys(true);
			return;
		}
		for (const key of Reflect.ownKeys(localStorage) as string[]) { // ownKeys avoids a getItem per key (Deno proxy descriptors)
			if (key.startsWith(Storage.pointer_prefix)) {
				yield key.replace(Storage.pointer_prefix,"");
			}
		}
	}

	hasItem(key:string) {
		return localStorage.getItem(Storage.item_prefix+key) != null
	}

	removeItem(key: string): void {
		localStorage.removeItem(Storage.item_prefix+key) // delete from local storage
		keyIndex?.removed(false, key);
	}
	getItemValueDXB(key: string): ArrayBuffer|null {
		const base64 = localStorage.getItem(Storage.item_prefix+key);
        if (base64!=null) return base64ToArrayBuffer(base64);
		return null;
	}
	setItemValueDXB(key: string, value: ArrayBuffer) {
		localStorage.setItem(Storage.item_prefix+key, arrayBufferToBase64(value));
		keyIndex?.added(false, key);
	}
	
	setPointer(pointer: Pointer<any>): Set<Pointer<any>> {
		const inserted_ptrs = new Set<Pointer>();
        localStorage.setItem(Storage.pointer_prefix+pointer.id, Compiler.encodeValueBase64(pointer, inserted_ptrs, true, false, true));  // serialized pointer
        keyIndex?.added(true, pointer.id);
        return inserted_ptrs;
	}
	async getPointerValue(pointerId: string, outer_serialized: boolean, conditions?: ExecConditions): Promise<unknown> {
		const base64 = localStorage.getItem(Storage.pointer_prefix+pointerId);
        if (base64 == null) return NOT_EXISTING;
        return await Runtime.decodeValueBase64(base64, outer_serialized, conditions);
	}
	removePointer(pointerId: string): void {
		localStorage.removeItem(Storage.pointer_prefix+pointerId);
		keyIndex?.removed(true, pointerId);
	}
	getPointerValueDXB(pointerId: string): ArrayBuffer|null {
		const base64 = localStorage.getItem(Storage.pointer_prefix+pointerId);
        if (base64!=null) return base64ToArrayBuffer(base64);
		return null;
	}
	setPointerValueDXB(pointerId: string, value: ArrayBuffer) {
		localStorage.setItem(Storage.pointer_prefix+pointerId, arrayBufferToBase64(value));
		keyIndex?.added(true, pointerId);
	}

	hasPointer(pointerId: string): boolean {
		return !!localStorage.getItem(Storage.pointer_prefix+pointerId)
	}

	clear() {
		for (const key of Reflect.ownKeys(localStorage) as string[]) { // ownKeys avoids a getItem per key (Deno proxy descriptors)
			if (key.startsWith(Storage.item_prefix) || key.startsWith(Storage.pointer_prefix)) localStorage.removeItem(key);
		}
		// the length check rebuilds the index on the next listing
	}

}