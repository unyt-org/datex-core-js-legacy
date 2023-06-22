import { Runtime } from "../../runtime/runtime.ts";
import { Compiler } from "../../compiler/compiler.ts";
import { Pointer } from "../../runtime/pointers.ts";

import { NOT_EXISTING } from "../constants.ts";
import { AsyncStorageLocation } from "../storage.ts";

const pointerDB = globalThis.Deno.openKv ? await Deno.openKv() : null;
const itemDB = globalThis.Deno.openKv ? await Deno.openKv() : null;

export class DenoKVStorageLocation extends AsyncStorageLocation {
	name = "DENO_KV"

	isSupported() {
		return !!globalThis.Deno.openKv;
	}

	async setItem(key: string,value: unknown): Promise<boolean> {
		await itemDB.set([key], <any>Compiler.encodeValue(value));
		return true;
	}
	async getItem(key: string): Promise<unknown> {
		const result = await itemDB.get([key]);
		if (result.versionstamp == null) return NOT_EXISTING;
		else return Runtime.decodeValue(result.value);
	}

	async hasItem(key:string) {
		const result = await itemDB.get([key]);
		return (result.versionstamp != null)
	}

	async getItemKeys() {
		const entries = itemDB.list();
		const keys = [];
		for await (const entry of entries) {
			keys.push(entry.value);
		}
		return keys.values() as Generator<string>
	}

	async getPointerIds(): Promise<Generator<string,void,unknown>> {
		const entries = pointerDB.list();
		const keys = [];
		for await (const entry of entries) {
			keys.push(entry.value);
		}
		return keys.values() as Generator<string>
	}

	async removeItem(key: string): Promise<void> {
		await itemDB.delete([key]);
	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer|null> {
		const result = await itemDB.get([key]);
		if (result.versionstamp == null) return null;
		else return result.value;
	}
	async setItemValueDXB(key: string, value: ArrayBuffer) {
		await itemDB.set([key], value);
	}

	async setPointer(pointer: Pointer<any>): Promise<Set<Pointer<any>>> {
		const inserted_ptrs = new Set<Pointer>();
		await pointerDB.set([pointer.id], Compiler.encodeValue(pointer, inserted_ptrs, true, false, true));
        return inserted_ptrs;
	}
	async getPointerValue(pointerId: string, outer_serialized: boolean): Promise<unknown> {
		const result = await pointerDB.get([pointerId]);
		if (result.versionstamp == null) return NOT_EXISTING;
		else return Runtime.decodeValue(result.value, outer_serialized);
	}
	async removePointer(pointerId: string): Promise<void> {
		await pointerDB.delete([pointerId]);
	}
	async getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null> {
		const result = await pointerDB.get([pointerId]);
		if (result.versionstamp == null) return null;
		else return result.value;
	}
	async setPointerValueDXB(pointerId: string, value: ArrayBuffer) {
		await pointerDB.set([pointerId], value);
	}

	async hasPointer(pointerId: string): Promise<boolean> {
		const result = await pointerDB.get([pointerId]);
		return (result.versionstamp != null)
	}

	async clear() {
		// TODO!
	}

}