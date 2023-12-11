import { Datex } from "../mod.ts";
import { ValueError } from "../datex_all.ts";
import { weakAction } from "./weak-action.ts";


function workaroundGetHandler(iterableHandler: WeakRef<IterableHandler<any>>) {
	return (v:any, k:any, t:any) => {
		const deref = iterableHandler.deref();
		if (!deref) {
			console.warn("Undetected garbage collection (datex-w0001)");
			return;
		}
		deref.onValueChanged(v, k, t)
	}
}

export class IterableHandler<T, U = T> {

	private map: ((value: T, index: number, array: Iterable<T>) => U) | undefined
	private filter: ((value: T, index: number, array: Iterable<T>) => value is T&U) | undefined

	private onNewEntry: (entry:U, key:number,) => void
	private onEntryRemoved: (entry:U, key:number,) => void
	private onEmpty?: () => void

	
	constructor(private iterable: Datex.RefOrValue<Iterable<T>>, callbacks: {
		map?: (value: T, index: number, array: Iterable<T>) => U,
		// TODO:
		// filter?: (value: T, index: number, array: Iterable<T>) => value is T&U,
		onNewEntry: (this: IterableHandler<T, U>, entry:U, key:number) => void
		onEntryRemoved: (entry: U, key:number) => void,
		onEmpty?: () => void
	}) {
		this.map = callbacks.map;
		// this.filter = callbacks.filter;
		this.onNewEntry = callbacks.onNewEntry;
		this.onEntryRemoved = callbacks.onEntryRemoved;
		this.onEmpty = callbacks.onEmpty;

		this.checkEmpty();
		this.observe()
	}

	observe() {
		// deno-lint-ignore no-this-alias
		const self = this;
		const iterableRef = new WeakRef(this.iterable);

		// const handler = this.workaroundGetHandler(self)
		// Datex.Ref.observeAndInit(iterable, handler);

		weakAction(
			{self}, 
			({self}) => {
				use (iterableRef, Datex);

				const iterable = iterableRef.deref()! // only here to fix closure scope bug, should always exist at this point
				const callback = (v:any, k:any, t:any) => {
					const deref = self.deref();
					if (!deref) {
						console.warn("Undetected garbage collection (datex-w0001)");
						return;
					}
					deref.onValueChanged(v, k, t)
				}
				Datex.Ref.observeAndInit(iterable, callback);
				return callback;
			},
			(callback) => {
				use (iterableRef, Datex);

				const deref = iterableRef.deref()
				if (deref) Datex.Ref.unobserve(deref, callback);
			}
		);
	}

	[Symbol.dispose]() {
		// TODO: unobserve
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

	protected onValueChanged(value: Iterable<T>|T, key: number|undefined, type:Datex.Ref.UPDATE_TYPE) {
		if (type == Datex.Ref.UPDATE_TYPE.DELETE) return; // ignore DELETE event, only use BEFORE_DELETE event
		if (type == Datex.Ref.UPDATE_TYPE.REMOVE) return; // ignore REMOVE event, only use BEFORE_REMOVE event

		// compatibility with key-value iterables
		// Map or Object
		if (type != Datex.Ref.UPDATE_TYPE.INIT && type != Datex.Ref.UPDATE_TYPE.CLEAR && (this.iterable instanceof Map || !(this.iterable instanceof Set || this.iterable instanceof Array))) {
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
		if (type == Datex.Ref.UPDATE_TYPE.SET) this.handleNewEntry(<T>value, key)
		else if (type == Datex.Ref.UPDATE_TYPE.ADD) this.handleNewEntry(<T>value, this.getPseudoIndex(key, <T>value));
		// clear all
		else if (type == Datex.Ref.UPDATE_TYPE.CLEAR) {
			// handle onEmpty
			if (this.onEmpty) {
				this.onEmpty.call ? this.onEmpty.call(this) : this.onEmpty();
			}
			// alternative: delete all entries individually
			else {
				for (const [key,] of [...this.#entries??[]].toReversed()) {
					this.handleRemoveEntry(key);
				}
			}
		}
		else if (type == Datex.Ref.UPDATE_TYPE.BEFORE_DELETE) this.handleRemoveEntry(key);
		else if (type == Datex.Ref.UPDATE_TYPE.BEFORE_REMOVE) this.handleRemoveEntry(this.getPseudoIndex(key, <T>value));
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

		// TODO: remove entries inbetween
		// if (this.filter && !this.filter(value, key, val(this.iterable))) {
		// 	return;
		// }

		if (key != undefined) {
			// TODO: is this correct
			if (!this.isPseudoIndex() && this.entries.has(key)) this.handleRemoveEntry(key) // entry is overridden
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
		if (this.onEmpty && this.#entries?.size == 0) this.onEmpty.call ? this.onEmpty.call(this) : this.onEmpty();
	}

}