import { Pointer } from "../../datex_all.ts";
import { Storage } from "../storage.ts";

export class LocalStorageLocation implements Storage.LocationImpl {

	setItem(key: string,value: unknown,pointer: Pointer<any>|undefined,listen_for_pointer_changes: boolean): boolean {
		throw new Error("Method not implemented.");
	}
	removeItem(key: string): void {
		throw new Error("Method not implemented.");
	}
	getItemValueDXB(key: string): ArrayBuffer {
		throw new Error("Method not implemented.");
	}
	initPointer(pointer: Pointer<any>,listen_for_changes: boolean): boolean {
		throw new Error("Method not implemented.");
	}
	updatePointer(pointer: Pointer<any>): Set<Pointer<any>> {
		throw new Error("Method not implemented.");
	}
	getPointer(pointerId: string,pointerify?: boolean|undefined,bind?: unknown): unknown {
		throw new Error("Method not implemented.");
	}
	removePointer(pointerId: string): void {
		throw new Error("Method not implemented.");
	}
	getPointerValueDXB(pointerId: string): ArrayBuffer {
		throw new Error("Method not implemented.");
	}
	
}