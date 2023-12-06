import { NOT_EXISTING } from "../runtime/constants.ts";
import { Pointer, Ref, RefOrValue } from "../runtime/pointers.ts";
import { logger } from "./global_values.ts";

type HistoryStateChange = {
	pointer: Pointer,
	type: Ref.UPDATE_TYPE,
	value: any,
	previous: any,
	key?: any
}

type HistoryOptions = {
	enableKeyboardShortcuts?: boolean,
	explicitSavePoints?: boolean
}

export class History {
	
	#options: HistoryOptions = {}
	#changes = new Array<HistoryStateChange|HistoryStateChange[]>()
	#index = -1;

	#frozenPointers = new Set<Pointer>()

	constructor(options?: HistoryOptions) {
		if (options) this.#options = options
		if (this.#options.enableKeyboardShortcuts) this.enableKeyboardShortcuts()
	}

	add(val: RefOrValue<unknown>) {
		const pointer = Pointer.pointerifyValue(val);
		if (!(pointer instanceof Pointer)) throw new Error("Cannot include non-pointer value in history");

		Ref.observe(pointer, (value, key, type, transform, is_child_update, previous) => {

			// TODO: group atomic state changes (e.g. splice)

			if (type == Pointer.UPDATE_TYPE.BEFORE_DELETE) return; // ignore
			if (type == Pointer.UPDATE_TYPE.BEFORE_REMOVE) return; // ignore

			// ignore update
			if (this.#frozenPointers.has(pointer)) {
				return;
			}

			if (type==undefined) {
				logger.warn("Invalid update, missing type");
				return;
			}

			// rewrite history
			if (this.#index < -1) {
				this.#changes.splice(this.#index+1);
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

	/**
	 * Go back one state change, or back to the last save point if save points are enabled
	 * @returns false if already at the first state
	 */
	back() {
		const lastChanges = this.#changes.at(this.#index);
		if (!lastChanges) return false;
		this.#index--;

		console.log("<- undo",lastChanges)

		for (const lastChange of (lastChanges instanceof Array ? lastChanges : [lastChanges])) {
			this.#silent(lastChange.pointer, () => {
				if (lastChange.type == Pointer.UPDATE_TYPE.INIT) {
					lastChange.pointer.val = lastChange.previous;
				}
				else if (lastChange.type == Pointer.UPDATE_TYPE.DELETE) {
					lastChange.pointer.handleSet(lastChange.key, lastChange.previous, true, true)
				}
				else if (lastChange.type == Pointer.UPDATE_TYPE.SET) {
					if (lastChange.previous == NOT_EXISTING) lastChange.pointer.handleDelete(lastChange.key, true)
					else lastChange.pointer.handleSet(lastChange.key, lastChange.previous, true, true)
				}
			})
		}		

		return true;
	}

	/**
	 * Go forward one state change, or forward to the last save point if save points are enabled
	 * @returns false if already at the last state
	 */
	forward() {
		if (this.#index >= -1) return;
		this.#index++;
		const nextChanges = this.#changes.at(this.#index);
		if (!nextChanges) return false;

		console.log("-> redo", nextChanges)

		for (const nextChange of (nextChanges instanceof Array ? nextChanges : [nextChanges])) {
			this.#silent(nextChange.pointer, () => {
				if (nextChange.type == Pointer.UPDATE_TYPE.INIT) {
					nextChange.pointer.val = nextChange.value;
				}
				else if (nextChange.type == Pointer.UPDATE_TYPE.DELETE) {
					nextChange.pointer.handleDelete(nextChange.key, true)
				}
				else if (nextChange.type == Pointer.UPDATE_TYPE.SET) {
					if (nextChange.value == NOT_EXISTING) nextChange.pointer.handleDelete(nextChange.key, true)
					else nextChange.pointer.handleSet(nextChange.key, nextChange.value, true, true)
				}
			})
		}

		
		return true;
 	}

	createSavePoint() {
		if (!this.#options.explicitSavePoints) throw new Error("Explicit save points are not enabled");

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