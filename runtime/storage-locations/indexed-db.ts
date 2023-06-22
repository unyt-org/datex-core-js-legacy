import { Pointer } from "../../datex_all.ts";
import { Storage } from "../storage.ts";

export class IndexedDBStorageLocation implements Storage.AsyncLocationImpl {
	setItem(key: string,value: unknown,pointer: Pointer<any>|undefined,listen_for_pointer_changes: boolean): Promise<boolean> {
		throw new Error("Method not implemented.");
	}
	removeItem(key: string): Promise<void> {
		throw new Error("Method not implemented.");
	}
	getItemValueDXB(key: string): Promise<ArrayBuffer> {
		throw new Error("Method not implemented.");
	}
	initPointer(pointer: Pointer<any>,listen_for_changes: boolean): Promise<boolean> {
		throw new Error("Method not implemented.");
	}
	updatePointer(pointer: Pointer<any>): Promise<Set<Pointer<any>>> {
		throw new Error("Method not implemented.");
	}
	getPointer(pointerId: string,pointerify?: boolean|undefined,bind?: unknown): Promise<unknown> {
		throw new Error("Method not implemented.");
	}
	removePointer(pointerId: string): Promise<void> {
		throw new Error("Method not implemented.");
	}
	getPointerValueDXB(pointerId: string): Promise<ArrayBuffer> {
		throw new Error("Method not implemented.");
	}

}