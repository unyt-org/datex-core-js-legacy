/**
 * A WeakSet with iterable entries
 */
export class IterableWeakSet<T extends WeakKey> extends Set {

	// additional internal WeakSet for faster lookups
	#weakSet = new WeakSet<T>()

	add(value: T): this {
		// already added
		if (this.#weakSet.has(value)) return this;
		this.#weakSet.add(value);
		return super.add(new WeakRef(value));
	}

	delete(value: T): boolean {
		if (!this.#weakSet.has(value)) return false;
		this.#weakSet.delete(value);
		
		const deleting = new Set<WeakRef<T>>()
		try {
			for (const valRef of super.values() as Iterable<WeakRef<T>>) {
				const val = valRef.deref()
				if (val == undefined) {
					deleting.add(valRef)
					continue;
				} 
				if (val === value) {
					deleting.add(valRef)
					return true;
				}
			}
			return false;
		}
		finally {
			for (const valRef of deleting) super.delete(valRef);
		}
	}

	has(value: T): boolean {
		return this.#weakSet.has(value);
	}

	*values(): IterableIterator<T> {
		const deleting = new Set<WeakRef<T>>()
		try {
			for (const valRef of super.values() as Iterable<WeakRef<T>>) {
				const val = valRef.deref()
				if (val == undefined) {
					deleting.add(valRef);
					continue;
				} 
				yield val;
			}
		}
		finally {
			for (const valRef of deleting) super.delete(valRef);
		}
	}

	clear() {
		this.#weakSet = new WeakSet()
		super.clear()
	}

	keys(): IterableIterator<T> {
		return this.values()
	}

	*entries(): IterableIterator<[T, T]> {
		for (const val of this.values()) {
			yield [val, val]
		}
	}

	[Symbol.iterator]() {
		return this.values()
	}
}