/**
 * A map that automatically removes entries after a defined time period
 * or when the map size limit is reached
 */
export class VolatileMap<K,V> extends Map<K,V> {

	static readonly MAX_MAP_ENTRIES = 2**24
	static readonly MAP_ENTRIES_CLEANUP_CHUNK = 1000
	static readonly DEFAULT_ENTRYPOINT_LIFETIME = 30*60 // 30min

	#options: VolatileMapOptions
	#liftimeStartTimes = new Map<K, number>()
	#customLifetimes = new Map<K, number>()

	constructor(iterable?: Iterable<readonly [K, V]> | null, options: Partial<VolatileMapOptions> = {}) {
		super(iterable)
		this.#options = options as VolatileMapOptions;
		this.#options.entryLifetime ??= VolatileMap.DEFAULT_ENTRYPOINT_LIFETIME
		this.#options.preventMapOverflow ??= true

		this.#startInterval()
	}

	/**
	 * Resets the lifetime of the entry.
	 * @param key
	 * @param overrideLifetime optionally specify a lifetime for this entry that differs from options.entryLifetime
	 * @returns the current value for the key
	 */
	keepalive(key: K, overrideLifetime?: number) {
		if (!this.has(key)) {
			console.warn("key does not exist in VolatileMap")
			return;
		}
		this.#setTimeout(key, overrideLifetime);
		return this.get(key)
	}

	set(key: K, value: V): this {
		// create new lifetime timeout
		this.#setTimeout(key)
		// maximum map size reached?
		if (this.#options.preventMapOverflow && this.size >= VolatileMap.MAX_MAP_ENTRIES) {
			console.log("VolatileMap size limit ("+VolatileMap.MAX_MAP_ENTRIES+") reached. Force removing "+VolatileMap.MAP_ENTRIES_CLEANUP_CHUNK+" entries.")
			let i = 0;
			for (const key of this.keys()) {
				if (i == VolatileMap.MAP_ENTRIES_CLEANUP_CHUNK) break;
				this.delete(key)
				i++;
			}
		}
		return super.set(key, value)
	}

	delete(key: K): boolean {
		this.#clearTimeout(key);
		return super.delete(key)
	}

	clear(): void {
		for (const key of this.keys()) this.#clearTimeout(key);
		return super.clear();
	}

	#startInterval() {
		setInterval(
			() => {
				const currentTime = new Date().getTime();
				for (const [key, time] of this.#liftimeStartTimes) {
					const lifetime = 1000 * (this.#customLifetimes.get(key) ?? this.#options.entryLifetime);
					if (currentTime-time > lifetime) {
						this.delete(key);
					}
				}
			}, 
			Math.min(this.#options.entryLifetime, (VolatileMap.DEFAULT_ENTRYPOINT_LIFETIME)) * 1000 / 5
		)
	}

	#clearTimeout(key: K) {
		this.#liftimeStartTimes.delete(key);
	}

	#setTimeout(key: K, overrideLifetime?: number) {
		// reset previous timeout
		this.#clearTimeout(key);
		// store custom lifetime
		if (overrideLifetime != undefined) this.#customLifetimes.set(key, overrideLifetime)
		const lifetime = overrideLifetime ?? this.#options.entryLifetime;
		if (Number.isFinite(lifetime)) {
			this.#liftimeStartTimes.set(key, new Date().getTime())
		}
	}
}

export type VolatileMapOptions = {
	/**
	 * Entry lifetime in seconds. If set to Infinity,
	 * entries are only automatically removed if the map size limit
	 * is reached and preventMapOverflow is set to true.
	 * Default value: 1800 (30min)
	 */
	entryLifetime: number,
	/**
	 * Automatically deletes the oldest entries if the number of map entries
	 * exceeds the maximum allowed number (2^24), even if their lifetime
	 * is not yet expired.
	 * Default value: true
	 */
	preventMapOverflow: boolean
}