import { NOT_EXISTING } from "../runtime/constants.ts";
import { Pointer, ReactiveValue, RefOrValue } from "../runtime/pointers.ts";
import { logger } from "./global_values.ts";

type HistoryStateChange = {
	pointer: Pointer,
	type: ReactiveValue.UPDATE_TYPE,
	value: unknown,
	previous: unknown,
	key?: unknown,
	atomicId?: symbol
}

type HistoryOptions = {
	enableKeyboardShortcuts?: boolean,
	explicitSavePoints?: boolean
}

export class History {
	
	#options: HistoryOptions = {}
	#changes = new Array<HistoryStateChange|HistoryStateChange[]>()
	#index = -1;
	#lastSavePoint = 0;
	#currentSavePoint = 0;

	#frozenPointers = new Set<Pointer>()

	get forwardSteps() {
		return -this.#index - 1
	}

	get backSteps() {
		const range = this.#changes.length + this.#index + 1;
		if (this.#options.explicitSavePoints) {
			return this.#currentSavePoint + (
				this.#changes.length !== this.#lastSavePoint ? 1 : 0 // additional step back that is not yet a save point
			)
		}
		else return range
	}

	constructor(options?: HistoryOptions) {
		if (options) this.#options = options
		if (this.#options.enableKeyboardShortcuts) this.enableKeyboardShortcuts()
	}

	add(val: RefOrValue<unknown>) {
		const pointer = Pointer.pointerifyValue(val);
		if (!(pointer instanceof Pointer)) throw new Error("Cannot include non-pointer value in history");

		ReactiveValue.observe(pointer, (value, key, type, _transform, _isChildUpdate, previous, atomicId) => {

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

			const change = {
				pointer,
				type,
				value,
				previous,
				key,
				atomicId
			};

			// group atomic changes
			if (atomicId && this.#changes.at(-1) instanceof Array && (this.#changes.at(-1) as HistoryStateChange[])[0]?.atomicId === atomicId) {
				(this.#changes.at(-1) as HistoryStateChange[]).push(change)
			}
			else if (atomicId && (this.#changes.at(-1) as HistoryStateChange)?.atomicId === atomicId) {
				const lastChange = this.#changes.at(-1) as HistoryStateChange;
				this.#changes[this.#changes.length-1] = [lastChange, change]
			}
			
			// single change
			else {
				this.#changes.push(change)
			}
		})
	}

	/**
	 * Go back one state change, or back to the last save point if save points are enabled
	 * @returns false if already at the first state
	 */
	back() {
		// create save point for current state
		if (this.#options.explicitSavePoints && this.#changes.length !== this.#lastSavePoint) this.setSavePoint()

		const lastChanges = this.#changes.at(this.#index);
		if (!lastChanges) return false;

		this.#index--;
		if (this.#options.explicitSavePoints) this.#currentSavePoint--;

		console.log("<- undo",lastChanges)

		for (const lastChange of (lastChanges instanceof Array ? lastChanges.toReversed() : [lastChanges])) {
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
				else if (lastChange.type == Pointer.UPDATE_TYPE.ADD) {
					lastChange.pointer.handleRemove(lastChange.value)
				}
				else if (lastChange.type == Pointer.UPDATE_TYPE.REMOVE) {
					lastChange.pointer.handleAdd(lastChange.value)
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
		if (this.#index >= -1) return false;
		this.#index++;
		if (this.#options.explicitSavePoints) this.#currentSavePoint++;

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
				else if (nextChange.type == Pointer.UPDATE_TYPE.ADD) {
					nextChange.pointer.handleAdd(nextChange.value)
				}
				else if (nextChange.type == Pointer.UPDATE_TYPE.REMOVE) {
					nextChange.pointer.handleRemove(nextChange.value)
				}
			})
		}

		
		return true;
 	}

	setSavePoint() {
		if (!this.#options.explicitSavePoints) throw new Error("Explicit save points are not enabled");

		const historyChunk = this.#changes.splice(this.#lastSavePoint, this.#changes.length-this.#lastSavePoint).flat()
		if (historyChunk.length) this.#changes.push(historyChunk);
		this.#lastSavePoint = this.#changes.length;
		this.#currentSavePoint = this.#lastSavePoint;
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