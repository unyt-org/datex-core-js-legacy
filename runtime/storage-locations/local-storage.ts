import { Compiler } from "../../compiler/compiler.ts";
import { Storage, SyncStorageLocation } from "../storage.ts";
import { Pointer } from "../pointers.ts";
import { Runtime } from "../../runtime/runtime.ts";
import { NOT_EXISTING } from "../constants.ts";
import { base64ToArrayBuffer } from "../../utils/utils.ts";
import { arrayBufferToBase64 } from "../../datex_all.ts";
import { localStorage } from "./local-storage-compat.ts";

export class LocalStorageLocation extends SyncStorageLocation {
	name = "LOCAL_STORAGE"


	isSupported() {
		return !!localStorage;
	}

	onAfterSnapshot(isExit: boolean) {
		// exit snapshot is always saved independantly
		if (!isExit && localStorage.saveFile) localStorage.saveFile(); // deno local storage, save file afer save on exit or interval
	}

	setItem(key: string, value: unknown): boolean {
        localStorage.setItem(Storage.item_prefix+key, Compiler.encodeValueBase64(value))
        return true;
	}

	getItem(key: string) {
		const base64 = localStorage.getItem(Storage.item_prefix+key);
		if (base64==null) return NOT_EXISTING;
		else return Runtime.decodeValueBase64(base64);
	}

	*getItemKeys() {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(Storage.item_prefix)) {
				yield key.replace(Storage.item_prefix,"");
			}
		}
	}

	*getPointerIds() {
		for (const key of Object.keys(localStorage)) {
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
	}
	getItemValueDXB(key: string): ArrayBuffer|null {
		const base64 = localStorage.getItem(Storage.item_prefix+key);
        if (base64!=null) return base64ToArrayBuffer(base64);
		return null;
	}
	setItemValueDXB(key: string, value: ArrayBuffer) {
		localStorage.setItem(Storage.item_prefix+key, arrayBufferToBase64(value));
	}
	
	setPointer(pointer: Pointer<any>): Set<Pointer<any>> {
		const inserted_ptrs = new Set<Pointer>();
        localStorage.setItem(Storage.pointer_prefix+pointer.id, Compiler.encodeValueBase64(pointer, inserted_ptrs, true, false, true));  // serialized pointer
        return inserted_ptrs;
	}
	async getPointerValue(pointerId: string, outer_serialized: boolean): Promise<unknown> {
		const base64 = localStorage.getItem(Storage.pointer_prefix+pointerId);
        if (base64 == null) return NOT_EXISTING;
        return await Runtime.decodeValueBase64(base64, outer_serialized);
	}
	removePointer(pointerId: string): void {
		localStorage.removeItem(Storage.pointer_prefix+pointerId);
	}
	getPointerValueDXB(pointerId: string): ArrayBuffer|null {
		const base64 = localStorage.getItem(Storage.pointer_prefix+pointerId);
        if (base64!=null) return base64ToArrayBuffer(base64);
		return null;
	}
	setPointerValueDXB(pointerId: string, value: ArrayBuffer) {
		localStorage.setItem(Storage.pointer_prefix+pointerId, arrayBufferToBase64(value));
	}

	hasPointer(pointerId: string): boolean {
		return !!localStorage.getItem(Storage.pointer_prefix+pointerId)
	}

	clear() {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(Storage.item_prefix) || key.startsWith(Storage.pointer_prefix)) localStorage.removeItem(key);
		}
	}

}