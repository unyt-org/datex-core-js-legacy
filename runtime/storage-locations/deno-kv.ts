import { Runtime } from "../../runtime/runtime.ts";
import { Compiler } from "../../compiler/compiler.ts";
import { Pointer } from "../../runtime/pointers.ts";

import { NOT_EXISTING } from "../constants.ts";
import { AsyncStorageLocation } from "../storage.ts";
import { ptr_cache_path } from "../cache_path.ts";
import { client_type } from "../../utils/constants.ts";
import { normalizePath } from "../../utils/normalize-path.ts";
import { ExecConditions } from "../../utils/global_types.ts";

const denoKvDir = new URL("./deno-kv/", ptr_cache_path);
// @ts-ignore global Deno
if (client_type == "deno") Deno.mkdirSync(normalizePath(denoKvDir), {recursive: true});

let pointerDB: Deno.Kv|null = null
let itemDB: Deno.Kv|null = null

async function initKv() {
	if (client_type === "deno" && globalThis.Deno.openKv as any) {
		pointerDB = await Deno.openKv(normalizePath(new URL("./pointers", denoKvDir)));
		itemDB =  await Deno.openKv(normalizePath(new URL("./items", denoKvDir)));
	}
}

if (client_type == "deno") await initKv();

export class DenoKVStorageLocation extends AsyncStorageLocation {
	name = "DENO_KV"

	private MAX_SIZE = 65_500; // 65_536

	isSupported() {
		return client_type == "deno" && !!globalThis.Deno?.openKv;
	}

	async setItem(key: string, value: unknown) {
		const inserted_ptrs = new Set<Pointer>();
		await this.set(itemDB!, key, Compiler.encodeValue(value, inserted_ptrs));
        return inserted_ptrs;
	}
	async getItem(key: string, conditions?: ExecConditions): Promise<unknown> {
		const result = await this.get(itemDB!, key);
		if (result == null) return NOT_EXISTING;
		else return Runtime.decodeValue(result, false, conditions);
	}

	hasItem(key:string) {
		return this.has(itemDB!, key)
	}

	async getItemKeys() {
		const entries = itemDB!.list({prefix: []});
		const keys = [];
		for await (const entry of entries) {
			keys.push(entry.key[0]);
		}
		return keys.values() as Generator<string>
	}

	async getPointerIds(): Promise<Generator<string,void,unknown>> {
		const entries = pointerDB!.list({prefix: []});
		const keys = [];
		for await (const entry of entries) {
			keys.push(entry.key[0]);
		}
		return keys.values() as Generator<string>
	}

	async removeItem(key: string): Promise<void> {
		await itemDB!.delete([key]);
	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer|null> {
		const result = await this.get(itemDB!, key);
		return result;
	}
	async setItemValueDXB(key: string, value: ArrayBuffer) {
		await this.set(itemDB!, key, value);
	}

	async setPointer(pointer: Pointer<any>): Promise<Set<Pointer<any>>> {
		const inserted_ptrs = new Set<Pointer>();
		await this.set(pointerDB!, pointer.id, Compiler.encodeValue(pointer, inserted_ptrs, true, false, true));
        return inserted_ptrs;
	}
	async getPointerValue(pointerId: string, outer_serialized: boolean, conditions?: ExecConditions): Promise<unknown> {
		const result = await this.get(pointerDB!, pointerId);
		if (result == null) return NOT_EXISTING;
		else return Runtime.decodeValue(result, outer_serialized, conditions);
	}
	async removePointer(pointerId: string): Promise<void> {
		await pointerDB!.delete([pointerId]);
	}
	async getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null> {
		const result = await this.get(pointerDB!, pointerId);
		return result;
	}
	async setPointerValueDXB(pointerId: string, value: ArrayBuffer) {
		await this.set(pointerDB!, pointerId, value);
	}

	hasPointer(pointerId: string): Promise<boolean> {
		return this.has(pointerDB!, pointerId);
	}

	async clear() {
		await Deno.remove(denoKvDir.pathname, {recursive: true});
		await initKv()
	}


	async set(kv: Deno.Kv, key: string, value: ArrayBuffer) {
		// single value
		if (value.byteLength <= this.MAX_SIZE) await kv.set([key], value);
		// chunked value
		else {
			// first delete all previous chunks
			await this.delete(kv, key);
			const promises = [];
			const chunks = this.makeChunks(value);
			promises.push(kv.set([key], chunks.length));
			for (let i=0; i<chunks.length; i++) {
				promises.push(kv.set([key, i], chunks[i]));
			}
			await Promise.all(promises)
		}
	}

	async get(kv: Deno.Kv, key: string) {
		const data = await kv.get<number|ArrayBuffer>([key]);
		if (data.versionstamp == null) return null;

		// chunked value
		if (typeof data.value == "number") {
			const chunksCount = data.value;
			const chunks:Promise<Deno.KvEntryMaybe<ArrayBuffer>>[] = []
			for (let i=0; i<chunksCount; i++) {
				chunks.push(kv.get<ArrayBuffer>([key, i]));
			}
			return this.concatArrayBuffers((await Promise.all(chunks)).map(v=>{
				if (!v.value) throw "missing chunk for " + key
				else return v.value;
			}))
		}
		else return data.value;
	}

	async has(kv: Deno.Kv, key: string) {
		const result = await kv.get<number|ArrayBuffer>([key]);
		return (result.versionstamp != null)
	}

	async delete(kv: Deno.Kv, key: string) {
		const entries = kv.list({prefix:[key]})
		for await (const entry of entries) {
			kv.delete(entry.key)
		}
	}

	/**
	 * Convert an ArrayBuffer into chunks of MAX_SIZE or smaller
	 * @param buffer
	 * @returns 
	 */
	makeChunks(buffer: ArrayBuffer) {
		const chunkSize = this.MAX_SIZE;
		const chunks = []
		for (let i = 0; i < buffer.byteLength; i += chunkSize) {
			chunks.push(buffer.slice(i, i + chunkSize));
		}
		return chunks;
	}

	concatArrayBuffers(arrayOfBuffers: ArrayBuffer[]) {
		const totalLength = arrayOfBuffers.reduce((total, buffer) => total + buffer.byteLength, 0);
	  	const combinedBuffer = new ArrayBuffer(totalLength);
	  	const combinedView = new Uint8Array(combinedBuffer);
	  
		let offset = 0;
	  
		// Copy data from each buffer into the combined buffer
		for (const buffer of arrayOfBuffers) {
		  	combinedView.set(new Uint8Array(buffer), offset);
		  	offset += buffer.byteLength;
		}
	  
		return combinedBuffer;
	  }

}