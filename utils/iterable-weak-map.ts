/**
 * A WeakMap with iterable entries
 */
export class IterableWeakMap<K extends WeakKey, V> extends Map<any, V> {

	// additional internal WeakSet for faster lookups
	#weakMap = new WeakMap<K,V>()

	set(key: K, value: V): this {
		// already added
		if (this.#weakMap.has(key)) return this;
		this.#weakMap.set(key, value);
		return super.set(new WeakRef(key), value);
	}

	delete(key: K): boolean {
		if (!this.#weakMap.has(key)) return false;
		this.#weakMap.delete(key);

		const deleting = new Set<WeakRef<K>>()
		try {
			for (const keyRef of super.keys() as Iterable<WeakRef<K>>) {
				const unwrappedKey = keyRef.deref()
				if (unwrappedKey == undefined) {
					deleting.add(keyRef);
					continue;
				} 
				if (unwrappedKey === key) {
					deleting.add(keyRef)
					for (const keyRef of deleting) super.delete(keyRef);
					return true;
				}
			}
			return false;
		}
		finally {
			for (const keyRef of deleting) super.delete(keyRef);
		}
	}

	has(key: K): boolean {
		return this.#weakMap.has(key);
	}

	*keys(): IterableIterator<K> {
		const deleting = new Set<WeakRef<K>>()
		try {
			for (const keyRef of super.keys() as Iterable<WeakRef<K>>) {
				const unwrappedKey = keyRef.deref()
				if (unwrappedKey == undefined) {
					deleting.add(keyRef)
					continue;
				} 
				yield unwrappedKey;
			}
		}
		finally {
			for (const keyRef of deleting) super.delete(keyRef);
		}
	}

	get(key: K): V|undefined {
		return this.#weakMap.get(key);
	}

	clear() {
		this.#weakMap = new WeakMap()
		super.clear()
	}

	*values(): IterableIterator<V> {
		for (const [key, val] of this.entries()) {
			yield val
		}
	}

	*entries(): IterableIterator<[K, V]> {
		const deleting = new Set<WeakRef<K>>()
		try {
			for (const [keyRef, val] of super.entries() as Iterable<[WeakRef<K>, V]>) {
				const unwrappedKey = keyRef.deref()
				if (unwrappedKey == undefined) {
					deleting.add(keyRef)
					continue;
				} 
				yield [unwrappedKey, val];
			}
		}
		finally {
			for (const keyRef of deleting) super.delete(keyRef);
		}
	}

	[Symbol.iterator]() {
		return this.entries()
	}
}