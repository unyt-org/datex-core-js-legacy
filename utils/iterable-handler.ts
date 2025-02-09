import { Datex } from "../mod.ts";
import { ValueError } from "../datex_all.ts";
import { weakAction } from "./weak-action.ts";


export class IterableHandler<T, U = T> {
	private map: ((value: T, index: number, array: Iterable<T>) => U) | undefined
	private filter: ((value: T, index: number, array: Iterable<T>) => value is T&U) | undefined

	private onNewEntry: (entry:U, key:number,) => void
	private onEntryRemoved: (entry:U, key:number,) => void
	private onEmpty?: () => void
	private onSplice?: (start: number, deleteCount: number, ...items: U[]) => void

	
	constructor(private iterable: Datex.RefOrValue<Iterable<T>>, callbacks: {
		map?: (value: T, index: number, array: Iterable<T>) => U,
		// TODO:
		filter?: (value: T, index: number, array: Iterable<T>) => value is T&U,
		onNewEntry: (this: IterableHandler<T, U>, entry:U, key:number) => void
		onEntryRemoved: (entry: U, key:number) => void,
		onEmpty?: () => void,
		onSplice?: (start: number, deleteCount: number, ...items: U[]) => void
	}) {
		this.map = callbacks.map;
		this.filter = callbacks.filter;
		this.onNewEntry = callbacks.onNewEntry;
		this.onEntryRemoved = callbacks.onEntryRemoved;
		this.onEmpty = callbacks.onEmpty;
		this.onSplice = callbacks.onSplice;

		this.checkEmpty();
		this.observe()
	}

	observe() {
		// deno-lint-ignore no-this-alias
		const self = this;
		const iterableRef = new WeakRef(this.iterable);

		weakAction(
			{self}, 
			({self}) => {
				use ("allow-globals", iterableRef, Datex);

				const iterable = iterableRef.deref()! // only here to fix closure scope bug, should always exist at this point
				const callback = (v:any, k:any, t:any) => {
					const deref = self.deref();
					if (!deref) {
						console.warn("Undetected garbage collection (datex-w0001)");
						return;
					}
					deref.onValueChanged(v, k, t)
				}
				Datex.ReactiveValue.observeAndInit(iterable, callback);
				return callback;
			},
			(callback) => {
				use ("allow-globals", iterableRef, Datex);

				const deref = iterableRef.deref()
				if (deref) Datex.ReactiveValue.unobserve(deref, callback);
			}
		);
	}

	[Symbol.dispose]() {
		// TODO: unobserve
	}

	/**
	 * maps all keys of the iterable to the keys of the filtered iterable
	 * (only relevant if a filter is set)
	 */
	#filterKeyMap = new Map<number, number>();
	private setEntryWithMappedFilterKey(key: number, entry: U) {
		const originalKey = key;
		let mappedKey = -1;
		// append at the end if last item
		const maxFilterMapKey = [...this.#filterKeyMap.keys()].reduce((a, b) => Math.max(a, b), 0);
		if (key >= maxFilterMapKey) {
			mappedKey = this.#filterKeyMap.size;
			this.#filterKeyMap.set(originalKey, mappedKey);
		}
		// get mapped key
		else if (this.#filterKeyMap.has(key)) {
			mappedKey = this.#filterKeyMap.get(key)!;
		}
		// insert key at position
		else {
			// shift entries to the right to make space for new entry at key
			const mappedKey = this.findFilterMapKey(key);
			this.shiftEntriesForNewEntry(mappedKey, entry);
			// shift all following keys to the right in filterKeyMap
			for (const [k, v] of this.#filterKeyMap) {
				if (v >= mappedKey) {
					this.#filterKeyMap.set(k, v + 1);
				}
			}
			this.#filterKeyMap.set(originalKey, mappedKey);
			return -1;
		}
		return mappedKey;
	}

	/**
	 * Removes a key from the filterKeyMap
	 * and shifts all following keys to the left
	 * @param key 
	 */
	private deleteFilterKey(key: number) {
		// remove key from filterKeyMap
		const mappedKey = this.#filterKeyMap.get(key) ?? Infinity; 

		this.#filterKeyMap.delete(key);

		// shift all following keys to the left in filterKeyMap
		for (const [k, v] of this.#filterKeyMap) {
			if (v > mappedKey) {
				this.#filterKeyMap.set(k, v - 1);
				const entryKey = v-1;
				const entry = this.entries.get(entryKey+1)!;
				this.entries.set(entryKey, entry);
				this.onNewEntry.call ? 
					this.onNewEntry.call(this, entry, entryKey) :
					this.onNewEntry(entry, entryKey); // new entry handler
			}
		}

		// remove last key if not out of bounds
		if (mappedKey < this.entries.size) this.handleRemoveEntry(this.entries.size-1);		
	}


	#entries?: Map<number, U>;
	public get entries() {
		if (!this.#entries)
			this.#entries = new Map<number, U>();
		return this.#entries;
	}

	private isPseudoIndex(){
		return !(this.iterable instanceof Array)
	}

	// for map etc. shift entries to fill from start
	//    1=>x 3=>y 4=>z
	// to 1=>x 2=>y 3=>z
	private shiftEntries(key:number){
		const max = [...this.entries.keys()].at(-1) || 0;
		if (key > max) return;
		for (let k = key; k<max; k++) {
			this.entries.set(k, this.entries.get(k+1)!)
		}
		this.entries.delete(max);
	}

	// find the filter map key of an item that is not in #filterKeyMap
	private findFilterMapKey(key: number) {
		// check all nearby filter map keys
		// TODO: make this more performant
		let nextUpperKey = Infinity;
		let nextUpperIndex = 0;
		for (const [k, v] of this.#filterKeyMap) {
			if (k > key && k < nextUpperKey) {
				nextUpperKey = k;
				nextUpperIndex = v;
			}
		}
		return nextUpperIndex;
	}

	// shift entries to the right make space for new entry at key
	private shiftEntriesForNewEntry(key:number, entry: U){
		for (let k = this.entries.size-1; k>=key; k--) {
			this.entries.set(k+1, this.entries.get(k)!)
		}
		this.entries.set(key, entry);
		if (!this.onSplice) throw new Error("onSplice is required when using filters with IterableHandler")
		this.onSplice?.(key, 0, entry);
	}

	private deleteEntry(key:number) {
		if (this.isPseudoIndex()) this.shiftEntries(key); // for map etc. shift entries to fill from start
		else this.entries.delete(key)
	}

	// pseudo keys for Sets, Maps and Objects which have no index
	private getPseudoIndex(key: unknown, value:T): number {
		if (this.iterable instanceof Set) return this.findIndex(this.iterable, value)
		if (this.iterable instanceof Map) return this.findIndex(this.iterable.keys(), key);
		if (this.iterable instanceof Object) return this.findIndex(Object.keys(this.iterable), key);
		return -1;
	}

	private findIndex<T>(iterable: Iterable<T>, value: T) {
		let i = 0;
		for (const entry of iterable) {
			if (entry === value) return i;
			i++;
		}
		return -1;
	}

	// pseudo keys for Sets which have no index
	protected iterator(iterable:Set<any>|Map<any,any>|Object|Array<any>) {
		if (iterable instanceof Set) return iterable;
		if (iterable instanceof Array) return iterable;
		if (iterable instanceof Map) return iterable.entries();
		if (iterable instanceof Object) return Object.values(iterable);
	}

	protected onValueChanged(value: Iterable<T>|T, key: number|undefined, type:Datex.ReactiveValue.UPDATE_TYPE) {
		if (type == Datex.ReactiveValue.UPDATE_TYPE.DELETE) return; // ignore DELETE event, only use BEFORE_DELETE event
		if (type == Datex.ReactiveValue.UPDATE_TYPE.REMOVE) return; // ignore REMOVE event, only use BEFORE_REMOVE event

		// compatibility with key-value iterables
		// Map or Object
		if (type != Datex.ReactiveValue.UPDATE_TYPE.INIT && type != Datex.ReactiveValue.UPDATE_TYPE.CLEAR && (this.iterable instanceof Map || !(this.iterable instanceof Set || this.iterable instanceof Array))) {
			const original_value = value;
			// TODO: required?
			if (this.iterable instanceof Map) value = <Iterable<T>>[key, value]
			key = this.getPseudoIndex(key, <T>original_value)
			if (key == -1) {
				console.log(original_value,value,key,type)
				throw new ValueError("IterableValue: value not found in iterable")
			}
		}

		// single property update
		if (type == Datex.ReactiveValue.UPDATE_TYPE.SET)
			this.handleNewEntry(<T>value, key)
		else if (type == Datex.ReactiveValue.UPDATE_TYPE.ADD)
			this.handleNewEntry(<T>value, this.getPseudoIndex(key, <T>value));
		// clear all
		else if (type == Datex.ReactiveValue.UPDATE_TYPE.CLEAR) {
			// handle onEmpty
			if (this.onEmpty) {
				// clear filterKeyMap
				this.#filterKeyMap.clear();
				// clear entries
				this.#entries?.clear();
				this.onEmpty.call ?
					this.onEmpty.call(this) :
					this.onEmpty();
			}
			// alternative: delete all entries individually
			else {
				for (const [key,] of [...this.#entries??[]].toReversed()) {
					this.handleRemoveEntry(key);
				}
			}
		}
		else if (type == Datex.ReactiveValue.UPDATE_TYPE.BEFORE_DELETE)
			this.handleRemoveEntry(key);
		else if (type == Datex.ReactiveValue.UPDATE_TYPE.BEFORE_REMOVE)
			this.handleRemoveEntry(this.getPseudoIndex(key, <T>value));
		// completely new value
		else if (type == Datex.ReactiveValue.UPDATE_TYPE.INIT) {
			for (const e of this.entries.keys())
				this.handleRemoveEntry(e); // clear all entries

			const it = <Iterable<T>>this.iterator(value??[]);
			const initValue: T[] = [];

			for (const child of it) {
				initValue.push(child);
			}

			let key = 0;
			for (const child of initValue)
				this.handleNewEntry(child, key++);
		}
	}

	// can be overriden
	protected valueToEntry(value:T, key?: number):U {
		key = Number(key);
		return this.map ? 
			this.map(value, key??0, val(this.iterable)) :
			value as unknown as U;
	}

	// call valueToEntry and save entry in this.#entries
	handleNewEntry(value:T, key:number, filterResult?:boolean) {
		key = Number(key);
		const entry = this.valueToEntry(value, key)

		if (this.filter || filterResult != undefined) {
			const filteredOut = ! (
				filterResult != undefined ? filterResult : this.filter!(value, key, val(this.iterable))
			);
			// is filtered out
			if (filteredOut) {
				this.deleteFilterKey(key);
				return;
			}

			// get mapped filter key
			else {
				key = this.setEntryWithMappedFilterKey(key, value);
				// update already handled, continue
				if (key == -1) return;
			}
		}

		if (key != undefined) {
			// // TODO: is this correct
			// if (!this.isPseudoIndex() && this.entries.has(key))
			// 	this.handleRemoveEntry(key) // entry is overridden
			this.entries.set(key, entry);
		}
		this.onNewEntry.call ? 
			this.onNewEntry.call(this, entry, Number(key)) :
			this.onNewEntry(entry, Number(key)); // new entry handler
		this.checkEmpty();
	}

	private handleRemoveEntry(key:number) {
		key = Number(key)
		const entry = this.entries.get(key)!;
		this.deleteEntry(key);
		this.onEntryRemoved.call ? 
			this.onEntryRemoved.call(this, entry, key) :
			this.onEntryRemoved(entry, key);
		this.checkEmpty();
	}

	private checkEmpty() {
		if (this.onEmpty && this.#entries?.size == 0) {
			// clear filterKeyMap
			this.#filterKeyMap.clear();
			this.onEmpty.call ? 
				this.onEmpty.call(this) :
				this.onEmpty();
		}
			
	}

}