import { Pointer } from "../../runtime/pointers.ts";
import { filter, map } from "../../functions.ts";

export class ReactiveArrayMethods<T=unknown> {

	constructor(private pointer: Pointer) {}

	map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] {
		return map(this.pointer.val, thisArg ? callbackfn.bind(thisArg) : callbackfn as any)
	}

	filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): S[] {
		return filter(this.pointer.val, thisArg ? predicate.bind(thisArg) : predicate as any)
	}
}