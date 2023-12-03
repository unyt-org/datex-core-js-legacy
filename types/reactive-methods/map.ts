import { Pointer, PointerProperty } from "../../runtime/pointers.ts";

export class ReactiveMapMethods<K=unknown, V=unknown> {
	
	constructor(private pointer: Pointer) {}

	get(k: any) {
		return PointerProperty.get(this.pointer, <keyof typeof this.pointer>k);
	}
}