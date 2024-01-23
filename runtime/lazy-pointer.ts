import { Pointer, MinimalJSRef } from "./pointers.ts";

export class LazyPointer<T> {
	constructor(public id: string) {}

	toString() {
		return "Unresolved Pointer ($" + this.id + ")"
	}

	onLoad(callback:(val:MinimalJSRef<T>, ref: Pointer<T>)=>void) {
		Pointer.onPointerForIdAdded(this.id, p => callback(Pointer.collapseValue(p) as MinimalJSRef<T>, p))
	}

	static withVal(val:any, callback:(val:MinimalJSRef<unknown>)=>void) {
		if (val instanceof LazyPointer) val.onLoad(callback);
		else callback(val, val);
	}
}