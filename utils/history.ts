import { Pointer, Ref, RefOrValue } from "../runtime/pointers.ts";

type HistoryStateChange = {
	pointer: Pointer,
	type: Ref.UPDATE_TYPE,
	value: any,
	previous: any,
	key?: any
}

type HistoryOptions = {
	enableKeyboardShortcuts?: boolean
}

export class History {
	
	#options: HistoryOptions = {}
	#changes = new Array<HistoryStateChange>()
	#index = -1;

	#frozenPointers = new Set<Pointer>()

	constructor(options?: HistoryOptions) {
		if (options) this.#options = options

		if (this.#options.enableKeyboardShortcuts) this.enableKeyboardShortcuts()
	}


	include(val: RefOrValue<unknown>) {
		const pointer = Pointer.pointerifyValue(val);
		if (!(pointer instanceof Pointer)) throw new Error("Cannot include non-pointer value in history");

		Ref.observe(pointer, (value, key, type, transform, is_child_update, previous) => {
			// ignore update
			if (this.#frozenPointers.has(pointer)) {
				return;
			}
			console.debug(value,previous,key,type);

			// rewrite history
			if (this.#index !== -1) {
				this.#changes.splice(this.#index);
				this.#index = -1;
			}

			this.#changes.push({
				pointer,
				type,
				value,
				previous,
				key
			})
		})
	}

	back() {
		const lastChange = this.#changes.at(this.#index);
		if (!lastChange) return false;
		this.#index--;

		console.log("<- undo",lastChange)

		this.#silent(lastChange.pointer, () => {
			if (lastChange.type == Pointer.UPDATE_TYPE.INIT) {
				lastChange.pointer.val = lastChange.previous;
			}
			else if (lastChange.type == Pointer.UPDATE_TYPE.SET) {
				console.log("set", lastChange)
				lastChange.pointer.handleSet(lastChange.key, lastChange.previous)
			}
		})
	}

	forward() {
		if (this.#index >= -1) return;
		this.#index++;
		const nextChange = this.#changes.at(this.#index);
		if (!nextChange) return false;

		console.log("-> redo", nextChange)
		this.#silent(nextChange.pointer, () => {
			if (nextChange.type == Pointer.UPDATE_TYPE.INIT) {
				nextChange.pointer.val = nextChange.value;
			}
			else if (nextChange.type == Pointer.UPDATE_TYPE.SET) {
				nextChange.pointer.handleSet(nextChange.key, nextChange.value)
			}
		})

 	}

	#silent(pointer: Pointer, handler: ()=>void) {
		this.#freeze(pointer);
		try {
			handler();
		}
		finally {
			this.#unfreeze(pointer)
		}
	}
	#freeze(pointer: Pointer) {
		this.#frozenPointers.add(pointer)
	}
	#unfreeze(pointer: Pointer) {
		this.#frozenPointers.delete(pointer)
	}
	

	enableKeyboardShortcuts(element = globalThis.window) {
		element.addEventListener("keydown", (e) => {
			if (e.ctrlKey && e.key == "z") this.back()
			else if (e.ctrlKey && e.key == "y") this.forward()
		})
	}

}