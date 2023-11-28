/**
 * A WeakMap with iterable entries
 */
export class IterableWeakMap<K extends WeakKey, V> extends Map<any, V> {

	set(key: K, value: V): this {
		return super.set(new WeakRef(key), value);
	}

	delete(key: K): boolean {
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
		for (const unwrappedKey of this.keys()) {
			if (unwrappedKey === key) return true;
		}
		return false;
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
		for (const [unwrappedKey, val] of this.entries()) {
			if (unwrappedKey === key) return val;
		}
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