import { Datex } from "unyt_core/datex.ts";
import { ValueError } from "unyt_core/datex_all.ts";

export class IterableHandler<T, U = T> {

	private map: ((value: T, index: number, array: Iterable<T>) => U) | undefined
	private onNewEntry: (entry:U, key:number,) => void
	private onEntryRemoved: (entry:U, key:number,) => void
	private onEmpty: () => void

	
	constructor(private iterable: Datex.RefOrValue<Iterable<T>>, callbacks: {
		map?: (value: T, index: number, array: Iterable<T>) => U,
		onNewEntry: (entry:U, key:number) => void
		onEntryRemoved: (entry: U, key:number) => void,
		onEmpty: () => void
	}) {
		this.map = callbacks.map;
		this.onNewEntry = callbacks.onNewEntry;
		this.onEntryRemoved = callbacks.onEntryRemoved;
		this.onEmpty = callbacks.onEmpty;

		this.checkEmpty();
		this.observe()
	}

	observe() {
		Datex.Ref.observeAndInit(this.iterable, (v, k, t)=>{
			this.onValueChanged(v, k, t)
		});
	}

	#entries?: Map<number, U>;
	public get entries() {
		if (!this.#entries) this.#entries = new Map<number, U>();
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

	private deleteEntry(key:number) {
		if (this.isPseudoIndex()) this.shiftEntries(key); // for map etc. shift entries to fill from start
		else this.entries.delete(key)
	}

	// pseudo keys for Sets, Maps and Objects which have no index
	private getPseudoIndex(value:T): number {
		if (this.iterable instanceof Set) return [...this.iterable].indexOf(value);
		if (this.iterable instanceof Map) return [...this.iterable.values()].indexOf(value);
		if (this.iterable instanceof Object) return [...Object.values(this.iterable)].indexOf(value);
		return -1;
	}

	// pseudo keys for Sets which have no index
	protected iterator(iterable:Set<any>|Map<any,any>|Object|Array<any>) {
		if (iterable instanceof Set) return iterable;
		if (iterable instanceof Array) return iterable;
		if (iterable instanceof Map) return iterable.entries();
		if (iterable instanceof Object) return Object.values(iterable);
	}

	protected onValueChanged(value: Iterable<T>|T, key: number|undefined, type:Datex.Ref.UPDATE_TYPE) {
		if (type == Datex.Ref.UPDATE_TYPE.DELETE) return; // ignore DELETE event, only use BEFORE_DELETE event
		if (type == Datex.Ref.UPDATE_TYPE.REMOVE) return; // ignore REMOVE event, only use BEFORE_REMOVE event

		// compatibility with key-value iterables
		// Map or Object
		if (type != Datex.Ref.UPDATE_TYPE.INIT && type != Datex.Ref.UPDATE_TYPE.CLEAR && (this.iterable instanceof Map || !(this.iterable instanceof Set || this.iterable instanceof Array))) {
			const original_value = value;
			// TODO: required?
			if (this.iterable instanceof Map) value = <Iterable<T>>[key, value]
			key = this.getPseudoIndex(<T>original_value)
			if (key == -1) throw new ValueError("IterableValue: value not found in iterable")
		}

		// single property update
		if (type == Datex.Ref.UPDATE_TYPE.SET) this.handleNewEntry(<T>value, key)
		else if (type == Datex.Ref.UPDATE_TYPE.ADD) this.handleNewEntry(<T>value, this.getPseudoIndex(<T>value));
		// property removed
		else if (type == Datex.Ref.UPDATE_TYPE.CLEAR) {
			for (const [key,] of this.#entries??[]) {
				this.handleRemoveEntry(key);
			}
		}
		else if (type == Datex.Ref.UPDATE_TYPE.BEFORE_DELETE) this.handleRemoveEntry(key);
		else if (type == Datex.Ref.UPDATE_TYPE.BEFORE_REMOVE) this.handleRemoveEntry(this.getPseudoIndex(<T>value));
		// completely new value
		else if (type == Datex.Ref.UPDATE_TYPE.INIT) {
			for (const e of this.entries.keys()) this.handleRemoveEntry(e); // clear all entries
			let key = 0;
			for (const child of <Iterable<T>>this.iterator(value??[])) this.handleNewEntry(child, key++);
		}
	}

	// can be overriden
	protected valueToEntry(value:T, key?: number):U {
		key = Number(key);
		return this.map ? this.map(value, key??0, val(this.iterable)) : value as unknown as U;
	}

	// call valueToEntry and save entry in this.#entries
	private handleNewEntry(value:T, key:number) {
		key = Number(key);
		const entry = this.valueToEntry(value, key)

		if (key != undefined) {
			if (this.entries.has(key)) this.handleRemoveEntry(key) // entry is overridden
			this.entries.set(key, entry);
		}
		this.onNewEntry.call ? this.onNewEntry.call(this, entry, Number(key)) : this.onNewEntry(entry, Number(key)); // new entry handler
		this.checkEmpty();
	}

	private handleRemoveEntry(key:number) {
		key = Number(key)
		const entry = this.entries.get(key)!;
		this.deleteEntry(key);
		this.onEntryRemoved.call ? this.onEntryRemoved.call(this, entry, key) : this.onEntryRemoved(entry, key);
		this.checkEmpty();
	}

	private checkEmpty() {
		if (this.#entries?.size == 0) this.onEmpty.call ? this.onEmpty.call(this) : this.onEmpty();
	}

}