import { Runtime } from "../../runtime/runtime.ts";
import { Compiler } from "../../compiler/compiler.ts";
import { Pointer } from "../../runtime/pointers.ts";

import { NOT_EXISTING } from "../constants.ts";
import { AsyncStorageLocation, site_suffix } from "../storage.ts";

import localforage from "../../lib/localforage/localforage.js";
import { ExecConditions } from "../../utils/global_types.ts";

// db based storage for DATEX value caching (IndexDB in the browser)
const datex_item_storage = <globalThis.Storage><unknown> localforage.createInstance({name: "dxitem::"+site_suffix});
const datex_pointer_storage = <globalThis.Storage><unknown> localforage.createInstance({name: "dxptr::"+site_suffix});


export class IndexedDBStorageLocation extends AsyncStorageLocation {

	name = "INDEXED_DB"

	supportsExecConditions = true

	isSupported() {
		return !!globalThis.indexedDB;
	}

	async setItem(key: string,value: unknown): Promise<boolean> {
		await datex_item_storage.setItem(key, <any>Compiler.encodeValue(value));  // value to buffer (no header)
		return true;
	}
	async getItem(key: string, conditions: ExecConditions): Promise<unknown> {
		const buffer = <ArrayBuffer><any>await datex_item_storage.getItem(key);
		if (buffer == null) return NOT_EXISTING;
		else return Runtime.decodeValue(buffer, false, conditions);
	}

	async hasItem(key:string) {
		return (await datex_item_storage.getItem(key)) !== null
	}

	async getItemKeys() {
		const indexedDBKeys = await datex_item_storage.keys();
        return (function*(){
			for (const key of indexedDBKeys!) {
				yield key;
			} 
        })()
	}

	async getPointerIds(): Promise<Generator<string,void,unknown>> {
		const indexedDBPointerIds = await datex_pointer_storage.keys();
        return (function*(){
			for (const id of indexedDBPointerIds!) {
				yield id;
			} 
        })()
	}

	async removeItem(key: string): Promise<void> {
		await datex_item_storage.removeItem(key) // delete from db storage
	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer> {
		return <ArrayBuffer><any>await datex_item_storage.getItem(key);
	}
	async setItemValueDXB(key: string, value: ArrayBuffer) {
		await datex_item_storage.setItem(key, value as any);
	}

	async setPointer(pointer: Pointer<any>): Promise<Set<Pointer<any>>> {
		const inserted_ptrs = new Set<Pointer>();
        await datex_pointer_storage.setItem(pointer.id, <any>Compiler.encodeValue(pointer, inserted_ptrs, true, false, true));
        return inserted_ptrs;
	}
	async getPointerValue(pointerId: string, outer_serialized: boolean, conditions: ExecConditions): Promise<unknown> {
		const buffer = <ArrayBuffer><any>await datex_pointer_storage.getItem(pointerId);
		if (buffer == null) return NOT_EXISTING;
		return Runtime.decodeValue(buffer, outer_serialized, conditions);
	}
	async removePointer(pointerId: string): Promise<void> {
		await datex_pointer_storage.removeItem(pointerId);
	}
	async getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null> {
		return <ArrayBuffer><any>await datex_pointer_storage.getItem(pointerId);
	}
	async setPointerValueDXB(pointerId: string, value: ArrayBuffer) {
		await datex_pointer_storage.setItem(pointerId, value as any);
	}

	async hasPointer(pointerId: string): Promise<boolean> {
		return (await datex_pointer_storage.getItem(pointerId)) !== null	
	}

	async clear() {
		await datex_item_storage?.clear();
		await datex_pointer_storage?.clear();
	}

}