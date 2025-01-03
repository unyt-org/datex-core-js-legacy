// deno-lint-ignore-file no-namespace
import { Runtime } from "../runtime/runtime.ts";

import type { ExecConditions, PointerSource } from "../utils/global_types.ts";
import { logger } from "../utils/global_values.ts";
import { client_type } from "../utils/constants.ts";
import { NOT_EXISTING } from "../runtime/constants.ts";
import { Pointer, type MinimalJSRef, ReactiveValue } from "../runtime/pointers.ts";
import { localStorage } from "./storage-locations/local-storage-compat.ts";
import { MessageLogger } from "../utils/message_logger.ts";
import { Type } from "../types/type.ts";
import { addPersistentListener } from "../utils/persistent-listeners.ts";
import { Endpoint, LOCAL_ENDPOINT } from "../types/addressing.ts";
import { ESCAPE_SEQUENCES, verboseArg } from "../utils/logger.ts";
import { StorageMap } from "../types/storage-map.ts";
import { StorageSet } from "../types/storage-set.ts";
import { IterableWeakSet } from "../utils/iterable-weak-set.ts";
import { LazyPointer } from "../runtime/lazy-pointer.ts";
import { AutoMap } from "../utils/auto_map.ts";
import { hasDebugCookie } from "../utils/debug-cookie.ts";
import { setStorage } from "../runtime/reset.ts";
import { KnownError, handleError } from "../utils/error-handling.ts";


// displayInit();

/***** imports and definitions with top-level await - node.js / browser interoperability *******************************/
export const site_suffix = (()=>{
    // remove hash from url
    if (globalThis.location?.origin) {
        // const url = new URL(globalThis.location.href)
        // url.hash = "";
        // return url.toString();
        return globalThis.location.origin
    }
    else return ""
})();


type AtomicMatchInput<T> = T |
    (
        T extends string ? 
            RegExp :
            never
    )

type _MatchInput<T> = 
    MatchCondition<MatchConditionType, T> |
    (
        T extends object ? 
        {
            [K in Exclude<keyof T,"$"|"$$">]?: MatchInputValue<T[K]>
        } :
        AtomicMatchInput<T>|AtomicMatchInput<T>[]
    )
type MatchInputValue<T> = 
	_MatchInput<T>| // exact match
	_MatchInput<T>[] // or match

export type MatchInput<T extends object> = MatchInputValue<T>

type ObjectKeyPaths<T> = 
    T extends object ?
        (
            ObjectKeyPaths<T[keyof T]> extends never ? 
            `${string & Exclude<keyof T, "$"|"$$">}` :
            `${string & Exclude<keyof T, "$"|"$$">}`|`${string & Exclude<keyof T, "$"|"$$">}.${ObjectKeyPaths<T[Exclude<keyof T, "$"|"$$">]>}`
        ):
        never

export type MatchOptions<T = unknown> = {
    /**
     * Maximum number of matches to return
     */
    limit?: number,
    /**
     * Sort by key (e.g. address.street)
     */
    sortBy?: string // TODO: T extends object ? ObjectKeyPaths<T> : string,
    /**
     * Sort in descending order (only if sortBy is set)
     */
    sortDesc?: boolean,
    /**
     * Offset for match results
     */
    offset?: number,
    /**
     * Return advanced match results (e.g. total count of matches)
     */
    returnAdvanced?: boolean,
    /**
     * Provide a list of properties that should be returned as raw values. If provided, only the raw properties are returned
     * and pointers are not loaded
     */
    returnRaw?: string[]
    /**
     * Return pointer ids of matched items
     */
    returnPointerIds?: boolean,
    /**
     * Return map keys (only works with StorageMaps)
     */
    returnKeys?: boolean,
    /**
     * Custom computed properties for match query
     */
    computedProperties?: Record<string, ComputedProperty<ComputedPropertyType>>
}

export type MatchResult<T, Options extends MatchOptions> = Options["returnAdvanced"] extends true ?
    AdvancedMatchResult<T> & (
        Options["returnPointerIds"] extends true ?
            {
                pointerIds: Set<string>
            } :
            unknown
    ) :
    Set<T>

export type AdvancedMatchResult<T> = {
    total: number,
    pointerIds?: Set<string>,
    matches: Set<T>
}

export enum MatchConditionType {
    BETWEEN = "BETWEEN",
    LESS_THAN = "LESS_THAN",
    GREATER_THAN = "GREATER_THAN",
    LESS_OR_EQUAL = "LESS_OR_EQUAL",
    GREATER_OR_EQUAL = "GREATER_OR_EQUAL",
    NOT_EQUAL = "NOT_EQUAL",
    CONTAINS = "CONTAINS",
    POINTER_ID = "POINTER_ID",
}
export type MatchConditionData<T extends MatchConditionType, V> = 
    T extends MatchConditionType.BETWEEN ? 
        [V, V] :
    T extends MatchConditionType.LESS_THAN|MatchConditionType.GREATER_THAN|MatchConditionType.LESS_OR_EQUAL|MatchConditionType.GREATER_OR_EQUAL|MatchConditionType.NOT_EQUAL ?
        V :
    T extends MatchConditionType.CONTAINS ?
        V :
    T extends MatchConditionType.POINTER_ID ?
        string[] :
    never

export class MatchCondition<Type extends MatchConditionType, V> {
    
    private constructor(
        public type: Type, 
        public data: MatchConditionData<Type, V>
    ) {}

    static between<V>(lower: V, upper: V) {
        return new MatchCondition(MatchConditionType.BETWEEN, [lower, upper])
    }

    static lessThan<V>(value: V) {
        return new MatchCondition(MatchConditionType.LESS_THAN, value)
    }

    static greaterThan<V>(value: V) {
        return new MatchCondition(MatchConditionType.GREATER_THAN, value)
    }

    static lessOrEqual<V>(value: V) {
        return new MatchCondition(MatchConditionType.LESS_OR_EQUAL, value)
    }

    static greaterOrEqual<V>(value: V) {
        return new MatchCondition(MatchConditionType.GREATER_OR_EQUAL, value)
    }

    static notEqual<V>(value: V) {
        return new MatchCondition(MatchConditionType.NOT_EQUAL, value)
    }

    static contains<V>(...values: V[]) {
        return new MatchCondition(MatchConditionType.CONTAINS, new Set(values))
    }

    static pointerId(id: string): MatchCondition<MatchConditionType.POINTER_ID, string>
    static pointerId(ids: string[]): MatchCondition<MatchConditionType.POINTER_ID, string>
    static pointerId(id: string|string[]) {
        return new MatchCondition(MatchConditionType.POINTER_ID, id instanceof Array ? id : [id])
    }
}

export enum ComputedPropertyType {
    GEOGRAPHIC_DISTANCE = "GEOGRAPHIC_DISTANCE",
    SUM = "SUM",
}

export type ComputedPropertyData<Type extends ComputedPropertyType> =
    Type extends ComputedPropertyType.GEOGRAPHIC_DISTANCE ?
        {pointA: {lat: number|string, lon: number|string}, pointB: {lat: number|string, lon: number|string}} :
    Type extends ComputedPropertyType.SUM ?
        (number|string)[] :
    never

export class ComputedProperty<Type extends ComputedPropertyType> {

    private constructor(
        public type: Type,
        public data: ComputedPropertyData<Type>
    ) {}

    static geographicDistance(pointA: {lat: number|string, lon: number|string}, pointB: {lat: number|string, lon: number|string}) {
        return new ComputedProperty(ComputedPropertyType.GEOGRAPHIC_DISTANCE, {pointA, pointB})
    }

    static sum(...values: (number|string)[]) {
        return new ComputedProperty(ComputedPropertyType.SUM, values)
    }
}


export interface StorageLocation<SupportedModes extends Storage.Mode = Storage.Mode> {
    name: string
    isAsync: boolean
    /**
     * This storage location supports exec conditions for get operations
     */
    supportsExecConditions?: boolean
    /**
     * This storage location supports prefix selection for get operations
     */
    supportsPrefixSelection?: boolean
    /**
     * This storage location supports match selection for get operations
     * Must implement supportsMatchForType if true
     */
    supportsMatchSelection?: boolean
    /**
     * This storage location supports partial updates for setPointer operations
     */
    supportsPartialUpdates?: boolean

    isSupported(): boolean
    onAfterExit?(): void // called when deno process exits
    onAfterSnapshot?(isExit: boolean): void // called after a snapshot was saved to the storage (e.g. triggered by interval or exit event)

    setItem(key:string, value:unknown): Promise<Set<Pointer>>|Set<Pointer>
    getItem(key:string, conditions?:ExecConditions): Promise<unknown>|unknown
    hasItem(key:string):Promise<boolean>|boolean
    removeItem(key:string): Promise<void>|void
    getItemValueDXB(key:string): Promise<ArrayBuffer|null>|ArrayBuffer|null
    setItemValueDXB(key:string, value: ArrayBuffer):Promise<void>|void
    getItemKeys(prefix?:string): Promise<Generator<string, void, unknown>> | Generator<string, void, unknown>
    getItemKey?(value: unknown): Promise<string|undefined>|string|undefined

    setPointer(pointer:Pointer, partialUpdateKey: unknown|typeof NOT_EXISTING): Promise<Set<Pointer>>|Set<Pointer>
    getPointerValue(pointerId:string, outer_serialized:boolean, conditions?:ExecConditions):Promise<unknown>|unknown
    removePointer(pointerId:string):Promise<void>|void
    hasPointer(pointerId:string):Promise<boolean>|boolean
    getPointerIds(): Promise<Generator<string, void, unknown>> | Generator<string, void, unknown>
    getPointerValueDXB(pointerId:string): Promise<ArrayBuffer|null>|ArrayBuffer|null
    setPointerValueDXB(pointerId:string, value: ArrayBuffer):Promise<void>|void

    supportsMatchForType?(type: Type): Promise<boolean>|boolean
    matchQuery?<T extends object, Options extends MatchOptions<T>>(itemPrefix: string, valueType: Type<T>, match: MatchInput<T>, options:Options): Promise<MatchResult<T, Options>>|MatchResult<T, Options>
    clear(): Promise<void>|void
    
}
export abstract class SyncStorageLocation implements StorageLocation<Storage.Mode.SAVE_ON_CHANGE|Storage.Mode.SAVE_PERIODICALLY|Storage.Mode.SAVE_ON_EXIT> {

    abstract name: string;
    readonly isAsync = false;

    abstract isSupported(): boolean
    onAfterExit() {}

    abstract setItem(key: string,value: unknown): Set<Pointer>
    abstract getItem(key:string, conditions?:ExecConditions): Promise<unknown>|unknown
    abstract hasItem(key:string): boolean
    abstract getItemKeys(prefix?:string): Generator<string, void, unknown>
    abstract getItemKey?(value: unknown): string|undefined

    abstract removeItem(key: string): void
    abstract getItemValueDXB(key: string): ArrayBuffer|null
    abstract setItemValueDXB(key:string, value: ArrayBuffer):void

    abstract setPointer(pointer: Pointer, partialUpdateKey: unknown|typeof NOT_EXISTING): Set<Pointer>
    abstract getPointerValue(pointerId: string, outer_serialized:boolean, conditions?:ExecConditions): unknown
    abstract getPointerIds(): Generator<string, void, unknown>

    abstract removePointer(pointerId: string): void
    abstract getPointerValueDXB(pointerId: string): ArrayBuffer|null
    abstract setPointerValueDXB(pointerId:string, value: ArrayBuffer):void
    abstract hasPointer(pointerId: string): boolean

    supportsMatchForType?(type: Type): boolean
    matchQuery?<T extends object, Options extends MatchOptions<T>>(itemPrefix: string, valueType: Type<T>, match: MatchInput<T>, options:Options): MatchResult<T, Options>

    abstract clear(): void
}

export abstract class AsyncStorageLocation implements StorageLocation<Storage.Mode.SAVE_ON_CHANGE|Storage.Mode.SAVE_PERIODICALLY> {
    abstract name: string;
    readonly isAsync = true;

    abstract isSupported(): boolean
    onAfterExit() {}

    abstract setItem(key: string,value: unknown): Promise<Set<Pointer>>
    abstract getItem(key:string, conditions?:ExecConditions): Promise<unknown>
    abstract hasItem(key:string): Promise<boolean>
    abstract getItemKeys(prefix?:string): Promise<Generator<string, void, unknown>>
    abstract getItemKey?(value: unknown): Promise<string|undefined>

    abstract removeItem(key: string): Promise<void>
    abstract getItemValueDXB(key: string): Promise<ArrayBuffer|null> 
    abstract setItemValueDXB(key:string, value: ArrayBuffer):Promise<void>

    abstract setPointer(pointer: Pointer, partialUpdateKey: unknown|typeof NOT_EXISTING): Promise<Set<Pointer>>
    abstract getPointerValue(pointerId: string, outer_serialized:boolean, conditions?:ExecConditions): Promise<unknown>
    abstract getPointerIds(): Promise<Generator<string, void, unknown>>

    abstract removePointer(pointerId: string): Promise<void>
    abstract getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null>
    abstract setPointerValueDXB(pointerId:string, value: ArrayBuffer):Promise<void>
    abstract hasPointer(pointerId: string): Promise<boolean>

    supportsMatchForType?(type: Type): Promise<boolean>|boolean
    matchQuery?<T extends object, Options extends MatchOptions<T>>(itemPrefix: string, valueType: Type<T>, match: MatchInput<T>, options:Options): Promise<MatchResult<T, Options>>

    abstract clear(): Promise<void>
}

type storage_options<M extends Storage.Mode> = {
    modes: M[]
    primary?: boolean // indicates if this storage should be used as the primary storage location
    interval?: number
}

type storage_location_options<L extends StorageLocation> = 
    L extends StorageLocation<infer T> ? storage_options<T> : never

type StorageSnapshotOptions = {
    /**
     * Display all internally used items (e.g. for garbage collection)
     */
    internalItems: boolean,
    /**
     * List all items and pointers of storage maps and sets
     */
    expandStorageMapsAndSets: boolean,
    /**
     * Only display items (and related pointers) that contain the given string in their key
     */
    itemFilter?: string,
    /**
     * Only display general information about storage data, no items or pointers
     */
    onlyHeaders?: boolean
}

export class Storage {
    
    static cache:Map<string,any> = new Map(); // save stored values in a Map, return when calling getItem


    static state_prefix = "dxstate::"

    static pointer_prefix = "dxptr::"+site_suffix+"::"
    static item_prefix = "dxitem::"+site_suffix+"::"

    static meta_prefix = "dxmeta::"+site_suffix+"::"
    static rc_prefix = "rc::"
    static pointer_deps_prefix = "deps::dxptr::"
    static item_deps_prefix = "deps::dxitem::"
    static subscriber_cache_prefix = "subscribers::"

    static #storage_active_pointers = new IterableWeakSet<Pointer>();
    static #storage_active_pointer_ids = new Set<string>();
    static #scheduledUpdates = new Set<()=>void|Promise<void>>();

    /**
     * Try to cache the actual pointer if it is stored in storage.
     * Called from pointer once the value is initialized.
     * @returns true if the pointer is stored in storage
     */
    static providePointer(ptr: Pointer) {
        if (this.#storage_active_pointer_ids.has(ptr.id)) {
            this.#storage_active_pointers.add(ptr);
            this.#storage_active_pointer_ids.delete(ptr.id);
            ptr.isStored = true;
            return true;
        }
        return false;
    }

    static DEFAULT_INTERVAL = 60; // 60s

    static #primary_location?: StorageLocation;
    static #trusted_location?: StorageLocation;
    static #trusted_pointers = new Set<string>()

    // location which did that last complete backup in the last session, if none found, use the current primary location
    static set trusted_location(location: StorageLocation | undefined) {
        this.#trusted_location = location;
        if (location != undefined) {
            logger.debug `trusted storage location: #bold${location.name}`
        }
    }
    static get trusted_location () {return this.#trusted_location}

    // default location for saving pointers/items
    static set primary_location(location: StorageLocation | undefined) {
        this.#primary_location = location;
    }
    static get primary_location () {return this.#primary_location}

    static #locations = new Map<StorageLocation, storage_location_options<StorageLocation>>()
    static #auto_sync_enabled = false;

    public static get locations() {
        return this.#locations;
    }

    // set options for storage location and enable
    public static addLocation<L extends StorageLocation>(location:L, options:storage_location_options<L>) {
        this.#locations.set(location, options);

        if (options.interval && !options.modes.includes(Storage.Mode.SAVE_PERIODICALLY)) {
            throw new Error("The 'interval' option can only be used for the storage mode SAVE_PERIODICALLY");
        }

        for (const mode of options.modes) {
            // asynchronous saving on exit not possible
            if (mode == Storage.Mode.SAVE_ON_EXIT && location.isAsync) throw new Error("Invalid DATEX Storage location: "+location.name+" is async and not compatible with SAVE_ON_EXIT mode");
            // supported? e.g. localStorage undefined in web worker
            if (!location.isSupported()) {
                throw new Error("Invalid DATEX Storage location: "+location.name+", not supported in this context");
            }
        
            if (mode == Storage.Mode.SAVE_PERIODICALLY) {
                this.addSaveInterval(location, options.interval ?? this.DEFAULT_INTERVAL)
            }
        }

        // update auto_sync_enabled
        this.#auto_sync_enabled = false
        for (const [_loc,options] of this.#locations) {
            if (options.modes.includes(Storage.Mode.SAVE_ON_CHANGE)) this.#auto_sync_enabled = true;
        }

        logger.debug `using ${options.primary?'primary':'secondary'} storage location #bold${location.name}:#color(grey) ${options.modes.map(m=>Storage.Mode[m]).join(', ')}`

        if (options.primary) {
            this.primary_location = location;
        }

        this.determineTrustedLocation();

        return this.restoreDirtyState()
    }

    // disable storage location
    public static removeLocation(location:StorageLocation) {
        const options = this.#locations.get(location);
        this.#locations.delete(location);
        if (options?.primary) this.primary_location = undefined;
        if (options?.interval != undefined) clearInterval(this.#save_interval_refs.get(location))
    }


    static #save_interval_refs = new Map<StorageLocation, number>()

    /**
     * set the interval (in s) in which the current pointer should be saved in a storage storage
     */
    private static addSaveInterval(location:StorageLocation, interval:number) {
        if (this.#save_interval_refs.has(location)) clearInterval(this.#save_interval_refs.get(location))
        if (interval != 0) {
            this.#save_interval_refs.set(location, setInterval(()=>this.saveCurrentState(location), interval * 1000))
        }
    }

    static #exiting = false

    static handleExit(){
        if (this.#exiting) return;
        this.#exiting = true
        // TODO: add race promise with timeout to return if cache takes too long
        // if (globalThis.Deno) setTimeout(()=>{Deno.exit(1)},20_000)

        // first run remaining scheduled updates (only sync supported)
        for (const update of this.#scheduledUpdates) {
            const res = update()
            if (res instanceof Promise) logger.error("Cannot store state in async storage location on exit");
        }

        this.saveDirtyState();
        
        if (this.#dirty || this.dirtyValues.size) {
            logger.debug("Storage has dirty flag set, following values could not be stored", this.dirtyValues);
        }
        
        for (const [loc,options] of this.#locations) {
            if (options.modes.includes(<any>Storage.Mode.SAVE_ON_EXIT)) Storage.saveCurrentState(loc, true);
            loc.onAfterExit?.();
        }

        // also save deno localstorage file, also if no local storage location set, metadata must stil be stored
        if (localStorage.saveFile) localStorage.saveFile();

        logger.debug("\nexit - state saved in cache");
    }


    // call to reload page without saving any data (for resetting)
    static #exit_without_save = false;
    public static allowExitWithoutSave(){
        this.#exit_without_save = true;
    }

    private static saveCurrentState(location:StorageLocation, isExit = false){
        if (this.#exit_without_save) {
            // console.log(`exiting without save`);
            return;
        }

        try {
            // update items
            let c = 0;
            for (const [key, val] of Storage.cache) {
                try {
                    c++;
                    const res = this.setItem(key, val, true, location);
                    if (res instanceof Promise) res.catch(()=>{})
                } catch (e) {}
            }

            // update pointers
            for (const ptr of [...this.#storage_active_pointers]) {
                try {
                    c++;
                    const res = this.setPointer(ptr, true, location);
                    if (res instanceof Promise) res.catch(()=>{})
                } catch (e) {}
            }
            for (const id of [...this.#storage_active_pointer_ids]) {
                try {
                    c++;
                    const ptr = Pointer.get(id);
                    if (ptr?.value_initialized) this.setPointer(ptr, true, location);
                } catch (e) {}
            }

            this.updateSaveTime(location); // last full backup to this storage location
            logger.debug(`current state saved to ${location.name} (${c} items)`);
            location.onAfterSnapshot?.(isExit);
        }
        catch (e) {
            console.error(e)
        }
     
    }
    
    // called when a full backup to this storage location was made
    private static updateSaveTime(location:StorageLocation) {
        if (this.#exit_without_save) return; // currently exiting
        localStorage.setItem(this.meta_prefix+'__saved__' + location.name, new Date().getTime().toString());
    }

    private static deleteSaveTime(location:StorageLocation) {
        localStorage.removeItem(this.meta_prefix+'__saved__' + location.name);
    }

    private static getSaveTime(location:StorageLocation) {
        return Number(localStorage.getItem(this.meta_prefix+'__saved__' + location.name) ?? 0);
    }

    // handle dirty states for async storage operations:
    static #dirty_locations = new Map<StorageLocation, number>()

    static dirtyValues = new Set<string>();
    // called when a full backup to this storage location was made
    public static setDirty(location:StorageLocation, dirty = true, metadata = '') {
        // update counter
        if (dirty) {
            this.dirtyValues.add(metadata);
            const currentCount = this.#dirty_locations.get(location)??0;
            this.#dirty_locations.set(location, currentCount + 1);
        }
        else {
            if (!this.#dirty_locations.has(location)) {
                logger.warn("Invalid dirty state reset for location '"+location.name + "', dirty state was not set", metadata);
            }
            else {
                const newCount = this.#dirty_locations.get(location)! - 1;
                if (newCount <= 0) {
                    this.#dirty_locations.delete(location);
                }
                else this.#dirty_locations.set(location, newCount);
                this.dirtyValues.delete(metadata);
            }
        }
    }

    static #dirty = false;
    private static isInDirtyState(location:StorageLocation) {
        this.#dirty = !!localStorage.getItem(this.meta_prefix+'__dirty__' + location.name)
        return this.#dirty;
    }

    /**
     * save current dirty states in localstorage
     */
    private static saveDirtyState(){
        if (this.#exit_without_save) return; // currently exiting
        for (const [location] of this.#dirty_locations) {
            localStorage.setItem(this.meta_prefix+'__dirty__' + location.name, new Date().getTime().toString());
        }
    }

    /**
     * clear the dirty state in localstorage
     */
    private static clearDirtyState(location: StorageLocation){
        localStorage.removeItem(this.meta_prefix+'__dirty__' + location.name);
    }
    

    private static determineTrustedLocation(fromLocations: StorageLocation[] = [...this.#locations.keys()]) {
        // primary is already trusted, use this
        if (this.trusted_location === this.primary_location) return this.trusted_location;

        let last:StorageLocation|undefined = this.trusted_location;
        let last_time = last ? this.getSaveTime(last) : 0;

        for (const location of fromLocations) {
            if (this.isInDirtyState(location)) continue;
            // found trusted primary location, use this
            if (location === this.primary_location) {
                last = location
                break;
            }

            // find location with latest update
			const time = this.getSaveTime(location)
            if (time > last_time) {
				last_time = time;
				last = location
			}
			this.deleteSaveTime(location); // no longer valid after this session
        }
        if (this.trusted_location !== last) this.trusted_location = last
        return this.trusted_location;
    }

    static #unresolvedLocalItems = new Map<string, unknown>()
    static #unresolvedLocalPointers = new IterableWeakSet<Pointer>()


    static setItem(key:string, value:any, listen_for_pointer_changes = true, location:StorageLocation|null|undefined = this.#primary_location):Promise<boolean>|boolean {
        Storage.cache.set(key, value); // save in cache

        // cache deletion does not work, problems with storage item backup
        // setTimeout(()=>Storage.cache.delete(key), 10000);

		if (location)  {
			if (location.isAsync) return this.setItemAsync(location as AsyncStorageLocation, key, value, listen_for_pointer_changes);
			else return this.setItemSync(location as SyncStorageLocation, key, value, listen_for_pointer_changes);
		}
        else return false;
    }

	static async setItemAsync(location:AsyncStorageLocation, key: string, value: unknown,listen_for_pointer_changes: boolean) {
        const metadata = this.isDebugMode ? (key + ": " +Runtime.valueToDatexString(value)) : undefined;
        this.setDirty(location, true, metadata);
        const itemExisted = await location.hasItem(key);
        // store value (might be pointer reference)
        const dependencies = await location.setItem(key, value);
        if (Pointer.is_local) this.checkUnresolvedLocalDependenciesForItem(key, value, dependencies);
        await this.updateItemDependencies(key, [...dependencies].map(p=>p.id));
        await this.saveDependencyPointersAsync(dependencies, listen_for_pointer_changes, location);
        this.setDirty(location, false, metadata);
        return itemExisted;
	}

	static setItemSync(location:SyncStorageLocation, key: string, value: unknown,listen_for_pointer_changes: boolean) {
        const itemExisted = location.hasItem(key);
        const dependencies = location.setItem(key, value);
        if (Pointer.is_local) this.checkUnresolvedLocalDependenciesForItem(key, value, dependencies);
        this.updateItemDependencies(key, [...dependencies].map(p=>p.id)).catch(e=>console.error(e));
        this.saveDependencyPointersSync(dependencies, listen_for_pointer_changes, location);
        return itemExisted;
	}

    /**
     * Collects all pointer dependencies of an itemr entry with a @@local origin.
     * Once the endpoint is initialized, the entry is updated with the correct pointer ids.
     */
    private static checkUnresolvedLocalDependenciesForItem(key: string, value:unknown, dependencies: Set<Pointer>) {
        const hasUnresolvedLocalDependency = [...dependencies].some(p=>p.origin == LOCAL_ENDPOINT);
        if (hasUnresolvedLocalDependency) this.#unresolvedLocalItems.set(key, value);
    }

    /**
     * Collects all pointer dependencies of a pointer entry with a @@local origin.
     * Once the endpoint is initialized, the entry is updated with the correct pointer ids.
     */
    private static checkUnresolvedLocalDependenciesForPointer(pointer: Pointer, dependencies: Set<Pointer>) {
        const hasUnresolvedLocalDependency = [...dependencies].some(p=>p.origin == LOCAL_ENDPOINT);
        if (hasUnresolvedLocalDependency) this.#unresolvedLocalPointers.add(pointer);
    }

    /**
     * Updates all item/pointer entries in storage that still are stored with unresolved @@local pointers
     */
    static updateEntriesWithUnresolvedLocalDependencies() {
        for (const [key, value] of this.#unresolvedLocalItems) {
            logger.debug("update item containing pointers with @@local origin: " +  key)
            this.setItem(key, value)
        }
        this.#unresolvedLocalItems.clear()

        for (const ptr of this.#unresolvedLocalPointers) {
            logger.debug("update pointer containing pointers with @@local origin: " + ptr.idString())
            this.setPointer(ptr as Pointer)
        }
        this.#unresolvedLocalPointers.clear()
    }


    public static setPointer(pointer:Pointer, listen_for_changes = true, location:StorageLocation|undefined = this.#primary_location, partialUpdateKey: unknown = NOT_EXISTING): Promise<boolean>|boolean {
        if (!pointer.value_initialized) {
            // logger.warn("pointer value " + pointer.idString() + " not available, cannot save in storage");
            this.#storage_active_pointers.delete(pointer);
            this.#storage_active_pointer_ids.delete(pointer.id);
            return false
        }
        
		if (location)  {
			if (location.isAsync) return this.initPointerAsync(location as AsyncStorageLocation, pointer, listen_for_changes, partialUpdateKey);
			else return this.initPointerSync(location as SyncStorageLocation, pointer, listen_for_changes, partialUpdateKey);
		}
		else return false;
    }

    private static initPointerSync(location: SyncStorageLocation, pointer:Pointer, listen_for_changes = true, partialUpdateKey: unknown = NOT_EXISTING):boolean {
        // if (pointer.transform_scope && this.hasPointer(pointer)) return true; // ignore transform pointer, initial transform scope already stored, does not change
        // was garbage collected in the meantime
        if (pointer.garbage_collected) {
            return false
        }

        const dependencies = this.updatePointerSync(location, pointer, partialUpdateKey);
        dependencies.delete(pointer);
        if (Pointer.is_local) this.checkUnresolvedLocalDependenciesForPointer(pointer, dependencies);
        this.updatePointerDependencies(pointer.id, [...dependencies].map(p=>p.id)).catch(e=>console.error(e));
        this.saveDependencyPointersSync(dependencies, listen_for_changes, location);

        // listen for changes
        if (listen_for_changes) this.syncPointer(pointer, location);

        this.#storage_active_pointers.add(pointer);
        // remember that this pointer is stored in storage
        pointer.isStored = true;

        return true;
    }

    private static updatePointerSync(location: SyncStorageLocation, pointer:Pointer, partialUpdateKey: unknown = NOT_EXISTING): Set<Pointer>{
        // was garbage collected in the meantime
        if (pointer.garbage_collected) {
            return new Set();
        }
		return location.setPointer(pointer, partialUpdateKey);
    }

    private static async initPointerAsync(location: AsyncStorageLocation, pointer:Pointer, listen_for_changes = true, partialUpdateKey: unknown = NOT_EXISTING):Promise<boolean>{
        // if (pointer.transform_scope && await this.hasPointer(pointer)) return true; // ignore transform pointer, initial transform scope already stored, does not change
        // was garbage collected in the meantime
        if (pointer.garbage_collected) {
            return false
        }

        const dependencies = await this.updatePointerAsync(location, pointer, partialUpdateKey);
        dependencies.delete(pointer);
        if (Pointer.is_local) this.checkUnresolvedLocalDependenciesForPointer(pointer, dependencies);
        await this.updatePointerDependencies(pointer.id, [...dependencies].map(p=>p.id));
        await this.saveDependencyPointersAsync(dependencies, listen_for_changes, location);

        // listen for changes
        if (listen_for_changes) this.syncPointer(pointer, location);

        this.#storage_active_pointers.add(pointer);
        // remember that this pointer is stored in storage
        pointer.isStored = true;

        return true;
    }

    private static get isDebugMode(): boolean {
        return (verboseArg || hasDebugCookie());
    }

    private static async updatePointerAsync(location: AsyncStorageLocation, pointer:Pointer, partialUpdateKey: unknown = NOT_EXISTING): Promise<Set<Pointer>> {
        // was garbage collected in the meantime
        if (pointer.garbage_collected) {
            return new Set();
        }
        const metadata = this.isDebugMode ? `${pointer.id}: ${Runtime.valueToDatexString(pointer.val)}` : undefined;
        this.setDirty(location, true, metadata);
        const res = await location.setPointer(pointer, partialUpdateKey);
        this.setDirty(location, false, metadata);
        return res;
    }

    /**
     * Save dependency pointers to storage (SyncStorageLocation)
     * Not all pointers in the set are saved, only those which are not yet in storage or not accessible in other ways
     * @param dependencies List of dependency pointers
     * @param listen_for_changes should update pointers in storage when value changes
     * @param location storage location
     */
    private static saveDependencyPointersSync(dependencies: Set<Pointer>, listen_for_changes = true, location: SyncStorageLocation) {
        for (const ptr of dependencies) {
            // add if not yet in storage
            if (!location.hasPointer(ptr.id)) this.setPointer(ptr, listen_for_changes, location)
        }
    }

    /**
     * Save dependency pointers to storage (AsyncStorageLocation)
     * Not all pointers in the set are saved, only those which are not yet in storage or not accessible in other ways
     * @param dependencies List of dependency pointers
     * @param listen_for_changes should update pointers in storage when value changes
     * @param location storage location
     */
    private static async saveDependencyPointersAsync(dependencies: Set<Pointer>, listen_for_changes = true, location: AsyncStorageLocation) {
        await Promise.all([...dependencies].map(async ptr=>{
            // add if not yet in storage
            if (!await location.hasPointer(ptr.id)) await this.setPointer(ptr, listen_for_changes, location)
        }));
    }


    private static synced_pointers = new WeakSet<Pointer>();

    static syncPointer(pointer: Pointer, location: StorageLocation|undefined = this.#primary_location) {
        if (!this.#auto_sync_enabled) return;

        if (!pointer) {
            logger.error("tried to sync non-existing pointer with storage")
            return;
        }
        if (!location) {
            logger.error("location required for syncPointer")
            return;
        }

        // already syncing?
        if (this.synced_pointers.has(pointer)) return;
        this.synced_pointers.add(pointer)

        // any value change
        let saving = false;


        const handler = (v:unknown,key:unknown,t?:ReactiveValue.UPDATE_TYPE)=>{
            if (saving) return;

            // don't block saving if only partial update
            if (!(location.supportsPartialUpdates && key !== NOT_EXISTING)) saving = true;
            const metadata = this.isDebugMode ? `${pointer.id}: ${Runtime.valueToDatexString(pointer.val)}` : undefined;

            this.scheduleStorageUpdate(()=>{
                // set pointer (async)
                saving = false;
                const res = this.setPointer(pointer, false, location, key); // update value and add new dependencies recursively
                if (res instanceof Promise) {
                    return res.then((couldSave)=>{
                        if (couldSave) {
                            logger.debug("updated " + pointer.idString() + " in storage");
                        }
                        else {
                            pointer.unobserve(handler);
                        }
                    });
                }
                else {
                    const couldSave = res; 
                    if (couldSave) {
                        logger.debug("updated " + pointer.idString() + " in storage");
                    }
                    else {
                        pointer.unobserve(handler);
                    }
                }
            }, location, metadata);
        };

        pointer.observe(handler, undefined, undefined, {ignore_transforms:true, recursive:false});   
    }


    /**
     * Run a pointer update after 1s or on process exit and keep the dirty state until the update is finished
     */
    private static scheduleStorageUpdate(update:()=>void|Promise<void>, location: StorageLocation, metadata?: string) {
        
        this.setDirty(location, true, metadata);
        const updateFn = () => {
            clearTimeout(timeout);
            const res = update();
            if (res instanceof Promise) {
                return res.then(()=>{
                    this.setDirty(location, false, metadata);
                    this.#scheduledUpdates.delete(updateFn);
                }).catch(e => console.error(e));
            }
            else {
                this.#scheduledUpdates.delete(updateFn);
                this.setDirty(location, false, metadata);
            }
        }

        this.#scheduledUpdates.add(updateFn);
        const timeout = setTimeout(updateFn, 1000);
    }
 
    public static hasPointer(pointer:Pointer, location:StorageLocation|undefined = this.#trusted_location) {
		if (location)  {
			return location.hasPointer(pointer.id);
		}
		else return false;
    }

    private static getLocationPriorityOrder(pointer_id:string) {
        if (this.#trusted_pointers.has(pointer_id)) return [this.#primary_location, this.#trusted_location]; // value already loaded from trusted location, use primary location now
        else return [this.#trusted_location, this.#primary_location] // first try to get from trusted location
    }

    private static initPointerFromTrustedLocation(id:string, maybe_trusted_location:StorageLocation) {
        if (this.#primary_location == undefined) return;
        if (this.#primary_location == this.#trusted_location) return;

        // wait until pointer loaded, TODO: timeout or return promise?
        setTimeout(async ()=>{
            if (this.#primary_location == maybe_trusted_location) {
                const pointer = Pointer.get(id);
                if (pointer?.value_initialized) {
                    await this.setPointer(pointer, true, this.#primary_location)
                    this.#trusted_pointers.add(id)
                }
                else {
                    console.log("cannot init pointer " +id)
                }
            }
        }, 3000);

    }

    private static async initItemFromTrustedLocation(key: string, value:any, maybe_trusted_location:StorageLocation) {
        if (this.#primary_location == undefined) return;
        if (this.#primary_location == this.#trusted_location) return;

        if (this.#primary_location == maybe_trusted_location) {
            await this.setItem(key, value, true, this.#primary_location)
        }

    }


    private static async restoreDirtyState() {
        if (this.#primary_location != undefined && this.isInDirtyState(this.#primary_location) && this.#trusted_location != undefined && this.#trusted_location!=this.#primary_location) {
            await this.copyStorage(this.#trusted_location, this.#primary_location)
            logger.warn `restored dirty state of ${this.#primary_location.name} from trusted location ${this.#trusted_location.name}`
            if (this.#dirty_locations.has(this.#primary_location)) this.setDirty(this.#primary_location, false) // remove from dirty set
            this.clearDirtyState(this.#primary_location) // remove from localstorage
            this.#dirty = false;
            // primary location is now trusted, update
            this.determineTrustedLocation()
            // this.trusted_location = this.#primary_location
        }
    }

    private static handleDirtyStateError() {
        handleError(new KnownError(
            `Cannot restore dirty eternal state (location: ${this.#primary_location!.name})`,
            [],
            [
                {
                    description: "Do you want to reset the current application state? (THIS IS IRREVERSIBLE)",
                    fix: () => {
                        this.clearAndReload();
                    }
                }
            ]
        ))
    }


    /**
     * Maps pointer ids to existing subscriber caches that were preloaded from storage
     */
    public static subscriberCaches = new Map<string, Set<Endpoint>>()

    /**
     * gets the value of a pointer from storage
     * @param pointer_id id string
     * @param pointerify creates DATEX Pointer if true, otherwise just returns the value
     * @param outer_serialized if true, the outer value type is not evaluated and only the serialized value is returned
     * @returns value from pointer storage
     */
    public static async getPointer(pointer_id:string, pointerify?:boolean, bind?:any, location?:StorageLocation, conditions?: ExecConditions):Promise<any> {

        if (this.#dirty) {
            this.handleDirtyStateError();
        }

        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(pointer_id))) {
            if (loc==undefined) continue;
            const val = await this.getPointerFromLocation(pointer_id, pointerify, bind, loc, conditions);
            if (val !== NOT_EXISTING) return val;
        }
        
        return NOT_EXISTING
    }

    private static async getPointerFromLocation(pointer_id:string, pointerify: boolean|undefined, bind:any|undefined, location:StorageLocation, conditions?: ExecConditions) {
        const val = await this.getPointerAsync(location, pointer_id, pointerify, bind, conditions);
		if (val == NOT_EXISTING) return NOT_EXISTING;
        
		await this.initPointerFromTrustedLocation(pointer_id, location)
        return val;
    }

    private static async getPointerAsync(location:StorageLocation, pointer_id:string, pointerify?:boolean, bind?:any, conditions?: ExecConditions) {

        let pointer:Pointer|undefined;
		if (pointerify && (pointer = Pointer.get(pointer_id))?.value_initialized) {
            return pointer.val; // pointer exists in runtime
        }


        // load from storage
		let val = await location.getPointerValue(pointer_id, !!bind, conditions);

        if (val == NOT_EXISTING) return NOT_EXISTING;

        // bind serialized val to existing value
        if (bind) {
            Type.ofValue(bind).updateValue(bind, val);
            val = bind;
        }

        // create pointer with saved id and value + start syncing, if pointer not already created in DATEX
        if (pointerify) {
            let pointer = Pointer.get(pointer_id)

            // if the value is a pointer with a tranform scope, copy the transform, not the value (TODO still just a workaround to preserve transforms in storage, maybe better solution?)
            if (val instanceof Pointer && val.transform_scope) {
                console.log("init value",val);
                pointer = await Pointer.createTransformAsync(val.transform_scope.internal_vars, val.transform_scope);
            }
            // set value of existing pointer
            else if (pointer) {
                if (pointer.value_initialized) logger.warn("pointer value " + pointer.idString() + " already initialized, setting new value from storage");
                pointer = pointer.setValue(val);
            }
            // create new pointer from value
            else {
                pointer = Pointer.create(pointer_id, val, false, Runtime.endpoint);
            }

            this.syncPointer(pointer);
            this.#storage_active_pointers.add(pointer);
            pointer.isStored = true;
            if (pointer.is_js_primitive) return pointer;
            else return pointer.val;
        }

        else {
            this.#storage_active_pointer_ids.add(pointer_id);
            return val;
        }
    }

    private static async removePointer(pointer_id:string, location?:StorageLocation, force_remove = false) {
        const count = await this.getReferenceCount(pointer_id);
        if (count == -1) {
            console.error("Cannot remove pointer"  + pointer_id + ", reference count not available");
            return;
        }
        if (!force_remove && count > 0) {
            logger.warn("Cannot remove pointer $" + pointer_id + ", still referenced");
            return;
        }
        logger.debug("Removing pointer $" + pointer_id + " from storage" + (location ? " (" + location.name  + ")" : ""));

        // remove from specific location
		if (location) return location.removePointer(pointer_id);
		// remove from all
		else {

            const ptr = Pointer.get(pointer_id)
            if (ptr) {
                this.#storage_active_pointers.delete(ptr);
                // remember that this pointer is not stored in storage             
                ptr.isStored = false;
            }
            this.#storage_active_pointer_ids.delete(pointer_id);

            const promises = []

            // remove pointer from all locations
			for (const location of this.#locations.keys()) {
				promises.push(location.removePointer(pointer_id));
			}

            // remove subscriber cache
            promises.push(this.removePointerSubscriberCache(pointer_id));

            await Promise.all(promises);

            // clear dependencies
            await this.updatePointerDependencies(pointer_id, [])
		}
    }

    public static async getPointerDecompiled(pointer_id:string, colorized = false, location?:StorageLocation):Promise<string|undefined|typeof NOT_EXISTING> {
        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(pointer_id))) {
            if (loc==undefined) continue;
            const val = await this.getPointerDecompiledFromLocation(pointer_id, colorized, loc);
            if (val !== NOT_EXISTING) return val;
        }
        return NOT_EXISTING;
    }


    private static async getPointerDecompiledFromLocation(pointer_id:string, colorized = false, location:StorageLocation) {
		const buffer = await location.getPointerValueDXB(pointer_id);
		if (buffer != null) return MessageLogger.decompile(buffer, false, colorized);
        return NOT_EXISTING;
    }

    /**
     * Gets a subscriber cache for a pointer if it exists
     */
    public static async getPointerSubscriberCache(pointer_id:string) {
        // return existing cache from memory
        if (this.subscriberCaches.has(pointer_id)) return this.subscriberCaches.get(pointer_id);
        // load from storage
        const id = this.subscriber_cache_prefix + pointer_id;
        const subscribers = await this.getItem(id) as Set<Endpoint>|undefined;
        if (subscribers) this.subscriberCaches.set(pointer_id, subscribers);
        return subscribers;
    }

    /**
     * Removes the subscriber cache from memory and storage
     * @returns 
     */
    private static removePointerSubscriberCache(pointer_id:string) {
        const id = this.subscriber_cache_prefix + pointer_id;
        this.subscriberCaches.delete(pointer_id);
        return this.removeItem(id);
    }

    /**
     * Gets or creates a new subscriber cache for a pointer and
     * puts it into the subscriberCaches map
     * @returns 
     */
    public static async requestSubscriberCache(pointer_id:string) {
        // return existing cache
        const existingCache = await this.getPointerSubscriberCache(pointer_id);
        if (existingCache) return existingCache;
        // create new cache
        const id = this.subscriber_cache_prefix + pointer_id;
        const subscribers = Pointer.createOrGet(new Set<Endpoint>()).val;
        this.subscriberCaches.set(pointer_id, subscribers);
        await this.setItem(id, subscribers);
        return subscribers;
    }

    public static async getItemDecompiled(key:string, colorized = false, location?:StorageLocation) {
        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(key))) {
            if (loc==undefined) continue;
            const val = await this.getItemDecompiledFromLocation(key, colorized, loc);
            if (val !== NOT_EXISTING) return val;
        }
        return NOT_EXISTING;
    }

    public static async getItemDecompiledFromLocation(key:string, colorized = false, location:StorageLocation) {
		const buffer = await location.getItemValueDXB(key);
		if (buffer != null) return MessageLogger.decompile(buffer, false, colorized);
        return NOT_EXISTING;
    }

    public static async getItemKeys(location?:StorageLocation, prefix?: string){

		// for specific location
		if (location) return location.getItemKeys(prefix);

		// ... iterate over keys from all locations

		const generators = [];
		for (const location of this.#locations.keys()) {
			generators.push(await location.getItemKeys(prefix))
		}

        return (function*(){
            const used = new Set<string>();

			for (const generator of generators) {
				for (const key of generator) {
                    if (used.has(key)) continue;
                    used.add(key);
                    yield key;
                } 
			}
        })()
    }


    public static async getItemKeysStartingWith(prefix:string, location?:StorageLocation) {
        const keyIterator = await Storage.getItemKeys(location, prefix);
        return (function*(){
            for (const key of keyIterator) {
                if (key.startsWith(prefix)) yield key;
            }
        })()
    }

    public static async getItemCountStartingWith(prefix:string, location?:StorageLocation) {
        const keyIterator = await Storage.getItemKeys(location, prefix);
        let count = 0;
        for (const key of keyIterator) {
            if (key.startsWith(prefix)) count++;
        }
        return count
    }

    public static async supportsMatchQueries(type: Type) {
        return (this.#primary_location?.supportsMatchSelection && await this.#primary_location?.supportsMatchForType!(type)) ?? false;
    }

    public static itemMatchQuery<T extends object, Options extends MatchOptions<T>>(itemPrefix: string, valueType:Type<T>, match: MatchInput<T>, options?:Options) {
        options ??= {} as Options;
        if (!this.#primary_location?.supportsMatchSelection) throw new Error("Primary storage location does not support match queries");
        return this.#primary_location!.matchQuery!(itemPrefix, valueType, match, options);
    }


    public static async getPointerIds(location?:StorageLocation){

		// for specific location
		if (location) return location.getPointerIds();

		// ... iterate over keys from all locations

		const generators = [];
		for (const location of this.#locations.keys()) {
			generators.push(await location.getPointerIds())
		}

        return (function*(){
            const used = new Set<string>();

			for (const generator of generators) {
				for (const id of generator) {
                    if (used.has(id)) continue;
                    used.add(id);
                    yield id;
                } 
			}
        })()         
    }

    private static async copyStorage(from:StorageLocation, to:StorageLocation) {

        await this.clear(to);

        const promises = [];
        
        for (const pointer_id of await this.getPointerIds(from)) {
			const buffer = await from.getPointerValueDXB(pointer_id);
			if (!buffer) logger.error("could not copy empty pointer value: " + pointer_id)
			else promises.push(to.setPointerValueDXB(pointer_id, buffer))
        }

        for (const key of await this.getItemKeys(from)) {
            const buffer = await from.getItemValueDXB(key);
			if (!buffer) logger.error("could not copy empty item value: " + key)
			else promises.push(to.setItemValueDXB(key, buffer))
        }

        await Promise.all(promises);
    }

    public static async getItem(key:string, location?:StorageLocation|undefined/* = this.#primary_location*/, conditions?: ExecConditions):Promise<any> {

        if (this.#dirty) {
            this.handleDirtyStateError();
        }

        // get from cache
        if (Storage.cache.has(key)) return Storage.cache.get(key);

        // try to find item at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(key))) {
            if (loc==undefined) continue;
            const val = await this.getItemFromLocation(key, loc, conditions);
            if (val!==NOT_EXISTING) return val;
        }

        return undefined;
    }


    public static async getItemFromLocation(key:string, location:StorageLocation/* = this.#primary_location*/, conditions?: ExecConditions):Promise<any> {

        if (!location.supportsExecConditions && conditions) throw new Error(`Storage Location ${location.name} does not support exec conditions`);

		const val = await location.getItem(key, conditions);
		if (val == NOT_EXISTING) return NOT_EXISTING;

		Storage.cache.set(key, val);
		await this.initItemFromTrustedLocation(key, val, location)

		return val;
    }

    public static async getItemKey(value: any, location?:StorageLocation|undefined):Promise<string|undefined> {
        // try to find item at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(""))) {
            if (loc==undefined) continue;
            const val = await this.getItemKeyFromLocation(value, loc);
            if (val !== undefined) return val;
        }
        return undefined;
    }

    public static getItemKeyFromLocation(value: any, location:StorageLocation):Promise<string|undefined>|string|undefined {
        if (!location.supportsMatchSelection) throw new Error(`Storage Location ${location.name} does not support match queries (getItemKey)`);
        return location.getItemKey?.(value);
    }

    
    public static async hasItem(key:string, location?:StorageLocation):Promise<boolean> {
        
        if (Storage.cache.has(key)) return true; // get from cache
 
        // try to find item at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(key))) {
            if (loc==undefined) continue;
            const val = await this.hasItemFromLocation(key, loc);
            if (val) return true;
        }

        return false;
    }

    public static hasItemFromLocation(key:string, location:StorageLocation):Promise<boolean>|boolean {
		if (location)  {
			return location.hasItem(key);
		}
		else return false;
    }

    /**
     * Remove an item from storage, returns true if the item existed
     */
    public static async removeItem(key:string, location?:StorageLocation):Promise<boolean> {

        logger.debug("Removing item '" + key + "' from storage" + (location ? " (" + location.name + ")" : ""))

		// remove from specific location
		if (location) {
            // TODO: handle hasItem() internally in storage locations
            const itemExists = await location.hasItem(key);
            await location.removeItem(key);
            return itemExists;
        }
		// remove from all
		else {
            Storage.cache.delete(key); // delete from cache
            
            let itemExists = false;
			for (const location of this.#locations.keys()) {
                // TODO: handle hasItem() internally in storage locations
                if (!itemExists) itemExists = await location.hasItem(key);
				await location.removeItem(key);
			}

            // clear dependencies
            await this.updateItemDependencies(key, [])

            return itemExists;
		}
    }

    /**
     * Increase the reference count of a pointer in storage
     */
    private static async increaseReferenceCount(ptrId:string) {
        const count = await this.getReferenceCount(ptrId);
        if (count == -1) {
            console.log("Cannot increment unknown rc for pointer " + ptrId);
            return;
        }
        await this.setItem(this.rc_prefix+ptrId, (count + 1).toString());
    }
    /**
     * Decrease the reference count of a pointer in storage
     */
    private static async decreaseReferenceCount(ptrId:string) {
        const count = await this.getReferenceCount(ptrId);
        if (count == -1) {
            console.log("Cannot decrement unknown rc for pointer " + ptrId);
            return;
        }
        const newCount = count - 1;
        // RC is 0, delete pointer from storage
        if (newCount <= 0) {
            this.removeItem(this.rc_prefix+ptrId)
                .catch(e=>console.error(e));
            this.removePointer(ptrId, undefined, true)
                .catch(e=>console.error(e))
        }
        // decrease RC
        else await this.setItem(this.rc_prefix+ptrId, newCount.toString())
    }
    /**
     * Get the current reference count of a pointer (number of entries that have a reference to this pointer)
     * @returns 
     */
    private static async getReferenceCount(ptrId:string) {
        const entry = await this.getItem(this.rc_prefix+ptrId);
        return entry ? Number(entry) : 0;
    }

    private static async setDependencies(key:string, depPtrIds:string[], prefix:string) {
        const uniqueKey = prefix+key;
        if (!depPtrIds.length) await this.removeItem(uniqueKey);
        else await this.setItem(uniqueKey, depPtrIds.join(","));
    }

    private static setItemDependencies(key:string, depPtrIds:string[]) {
        return this.setDependencies(key, depPtrIds, this.item_deps_prefix);
    }
    private static setPointerDependencies(key:string, depPtrIds:string[]) {
        return this.setDependencies(key, depPtrIds, this.pointer_deps_prefix);
    }
    private static async getItemDependencies(key:string): Promise<string[]> {
        const uniqueKey = this.item_deps_prefix+key;
        return ((await this.getItem(uniqueKey))?.split(",")) ?? [];
    }
    private static async getPointerDependencies(key:string): Promise<string[]> {
        const uniqueKey = this.pointer_deps_prefix+key;
        return ((await this.getItem(uniqueKey))?.split(",")) ?? [];
    }

    private static async updateItemDependencies(key:string, newDeps:string[]) {
        // ignore if rc:: or deps:: key
        if (key.startsWith(this.rc_prefix) || key.startsWith(this.item_deps_prefix) || key.startsWith(this.pointer_deps_prefix)) return;
        const oldDeps = await this.getItemDependencies(key);
        const added = newDeps.filter(p=>!oldDeps.includes(p));
        const removed = oldDeps.filter(p=>!newDeps.includes(p));
        for (const ptrId of added) this.increaseReferenceCount(ptrId).catch(e=>console.error(e));
        for (const ptrId of removed) this.decreaseReferenceCount(ptrId).catch(e=>console.error(e));
        this.setItemDependencies(key, newDeps).catch(e=>console.error(e));
    }
    private static async updatePointerDependencies(key:string, newDeps:string[]) {
        // ignore if rc:: or deps:: key
        if (key.startsWith(this.rc_prefix) || key.startsWith(this.item_deps_prefix) || key.startsWith(this.pointer_deps_prefix)) return;
        const oldDeps = await this.getPointerDependencies(key);
        const added = newDeps.filter(p=>!oldDeps.includes(p));
        const removed = oldDeps.filter(p=>!newDeps.includes(p));
        for (const ptrId of added) this.increaseReferenceCount(ptrId).catch(e=>console.error(e));
        for (const ptrId of removed) this.decreaseReferenceCount(ptrId).catch(e=>console.error(e));
        this.setPointerDependencies(key, newDeps).catch(e=>console.error(e));
    }
    

    public static clearAll(){
        return this.clear()
    }

    // clear all storages
    public static async clear(onlyLocation?:StorageLocation):Promise<void> {

		for (const location of this.#locations.keys()) {
			if (onlyLocation == undefined || location === onlyLocation) {
				this.deleteSaveTime(location);
				this.clearDirtyState(location)
				await location.clear()
			}
		}
        
    }

    /**
     * reset state, 
     */
    public static async clearAndReload() {
        await Storage.clearAll();
        Storage.allowExitWithoutSave();
        if (client_type === "deno") Deno.exit(1);
        else if (globalThis.window?.location) {
            globalThis.location.reload();
        }
        else logger.error("Could not reload in non-browser or Deno context")
    }

    // load saved state
    public static async loadOrCreate<T>(id:string|number, create?:()=>Promise<T>|T, conditions?: ExecConditions, override = false):Promise<MinimalJSRef<T>> {
        const state_name = this.state_prefix+id.toString();

        // already has a saved state
        if (!override && await this.hasItem(state_name)) {
            return await this.getItem(state_name, undefined, conditions)
        }
        // create state
        else if (create){
            const state = Pointer.createOrGet(await create());

            // workaround: update item as soon as pointer id is changed with actual endpoint id (e.g. for Datex.Runtime.ENV)
            if (Runtime.endpoint === LOCAL_ENDPOINT) {
                Runtime.onEndpointChanged(() => {
                    this.setItem(state_name, state.js_value, true);
                })
            }

            await this.setItem(state_name, state.js_value, true);
            return <any>state.js_value;
        }
        else throw new Error("Cannot find or create the state '" + id + "'")
    }


    public static async printSnapshot(options: StorageSnapshotOptions = {internalItems: false, expandStorageMapsAndSets: true, onlyHeaders: false}) {
        const {items, pointers} = await this.getSnapshot(options);

        const COLOR_PTR = `\x1b[38;2;${[65,102,238].join(';')}m`
        const COLOR_NUMBER = `\x1b[38;2;${[253,139,25].join(';')}m`

        let string = ESCAPE_SEQUENCES.BOLD+"Storage Locations\n\n"+ESCAPE_SEQUENCES.RESET
        string += `${ESCAPE_SEQUENCES.ITALIC}A list of all currently used storage locations and their corresponding store strategies.\n${ESCAPE_SEQUENCES.RESET}`

        for (const [location, options] of this.#locations) {
            string += `\n  • ${location.name} ${ESCAPE_SEQUENCES.GREY}(${options.modes.map(m=>Storage.Mode[m]).join(', ')})${ESCAPE_SEQUENCES.RESET}`
        }

        string += `\n\n${ESCAPE_SEQUENCES.BOLD}Trusted Location:${ESCAPE_SEQUENCES.RESET} ${this.#trusted_location?.name ?? "none"}`
        string += `\n${ESCAPE_SEQUENCES.BOLD}Primary Location:${ESCAPE_SEQUENCES.RESET} ${this.#primary_location?.name ?? "none"}`

        console.log(string+"\n\n");

        // pointers
        string = ESCAPE_SEQUENCES.BOLD+"Pointers\n\n"+ESCAPE_SEQUENCES.RESET
        string += `${ESCAPE_SEQUENCES.ITALIC}A list of all pointers stored in any storage location. Pointers are only stored as long as they are referenced somewhere else in the storage.\n\n${ESCAPE_SEQUENCES.RESET}`

        const pointersInMemory = [...pointers.snapshot.keys()].filter(id => Pointer.get(id)).length;
        string += `\nTotal:     ${ESCAPE_SEQUENCES.BOLD}${pointers.snapshot.size}${ESCAPE_SEQUENCES.RESET} pointers`
        string += `\nIn memory: ${ESCAPE_SEQUENCES.BOLD}${pointersInMemory}${ESCAPE_SEQUENCES.RESET} pointers\n\n`

        if (!options.onlyHeaders) {
            for (const [key, storageMap] of pointers.snapshot) {
                // check if stored in all locations, otherwise print in which location it is stored (functional programming)
                const locations = [...storageMap.keys()]
                const storedInAll = [...this.#locations.keys()].every(l => locations.includes(l));
                
                const value = [...storageMap.values()][0];
                string += `  • ${COLOR_PTR}$${key}${ESCAPE_SEQUENCES.GREY}${storedInAll ? "" : (` (only in ${locations.map(l=>l.name).join(",")})`)} = ${value.replaceAll("\n", "\n    ")}\n`
            }
        }
        console.log(string+"\n");

        // items
        string = ESCAPE_SEQUENCES.BOLD+"Items\n\n"+ESCAPE_SEQUENCES.RESET
        string += `${ESCAPE_SEQUENCES.ITALIC}A list of all named items stored in any storage location.\n\n${ESCAPE_SEQUENCES.RESET}`

        if (!options.onlyHeaders) {
            for (const [key, storageMap] of items.snapshot) {
                
                // skip rc:: and deps:: items
                if (key.startsWith(this.rc_prefix) || key.startsWith(this.item_deps_prefix) || key.startsWith(this.pointer_deps_prefix)) continue;

                // check if stored in all locations, otherwise print in which location it is stored (functional programming)
                const locations = [...storageMap.keys()]
                const storedInAll = [...this.#locations.keys()].every(l => locations.includes(l));
                
                const value = [...storageMap.values()][0];
                string += `  • ${key}${ESCAPE_SEQUENCES.GREY}${storedInAll ? "" : (` (only in ${locations.map(l=>l.name).join(",")})`)} = ${value}\n`
            }
        }
        console.log(string+"\n");

        // memory management
        if (options?.internalItems) {
            string = ESCAPE_SEQUENCES.BOLD+"Memory Management\n\n"+ESCAPE_SEQUENCES.RESET
            string += `${ESCAPE_SEQUENCES.ITALIC}This section shows the reference count (rc::) of pointers and the dependencies (deps::) of items and pointers. The reference count of a pointer tracks the number of items and pointers that reference this pointer.\n\n${ESCAPE_SEQUENCES.RESET}`
            let rc_string = ""
            let item_deps_string = ""
            let pointer_deps_string = ""
            if (!options.onlyHeaders) {
                for (const key of await this.getItemKeysStartingWith(this.rc_prefix)) {
                    const ptrId = key.substring(this.rc_prefix.length);
                    const count = await this.getReferenceCount(ptrId);
                    rc_string += `\x1b[0m  • ${key} = ${COLOR_NUMBER}${count}\n`
                }

                for (const key of await this.getItemKeysStartingWith(this.item_deps_prefix)) {
                    const depsRaw = await this.getItem(key);
                    // single entry
                    if (!depsRaw?.includes(",")) {
                        item_deps_string += `\x1b[0m  • ${key} = (${COLOR_PTR}${depsRaw}\x1b[0m)\n`
                    }
                    // multiple entries
                    else {
                        let deps = (await this.getItem(key))!.split(",").join(`\x1b[0m,\n      ${COLOR_PTR}$`)
                        if (deps) deps = `      ${COLOR_PTR}$`+deps
                        item_deps_string += `\x1b[0m  • ${key} = (\n${COLOR_PTR}${deps}\x1b[0m\n    )\n`
                    }
                }

                for (const key of await this.getItemKeysStartingWith(this.pointer_deps_prefix)) {
                    const depsRaw = await this.getItem(key);
                    // single entry
                    if (!depsRaw?.includes(",")) {
                        pointer_deps_string += `\x1b[0m  • ${key} = (${COLOR_PTR}${depsRaw}\x1b[0m)\n`
                    }
                    // multiple entries
                    else {
                        let deps = (await this.getItem(key))!.split(",").join(`\x1b[0m,\n      ${COLOR_PTR}$`)
                        if (deps) deps = `      ${COLOR_PTR}$`+deps
                        pointer_deps_string += `\x1b[0m  • ${key} = (\n${COLOR_PTR}${deps}\x1b[0m\n    )\n`
                    }
                }

            }

            string += rc_string + "\n" + item_deps_string + "\n" + pointer_deps_string;
            console.log(string+"\n");
        }

        // inconsistencies
        if (pointers.inconsistencies.size > 0 || items.inconsistencies.size > 0) {
            string = ESCAPE_SEQUENCES.BOLD+"Inconsistencies\n\n"+ESCAPE_SEQUENCES.RESET
            string += `${ESCAPE_SEQUENCES.ITALIC}Inconsistencies between storage locations don't necessarily indicate that something is wrong. They can occur when a storage location is not updated immediately (e.g. when only using SAVE_ON_EXIT).\n\n${ESCAPE_SEQUENCES.RESET}`
            
            
            if (!options.onlyHeaders) {
                for (const [key, storageMap] of pointers.inconsistencies) {
                    for (const [location, value] of storageMap) {
                        string += `  • ${COLOR_PTR}$${key}${ESCAPE_SEQUENCES.GREY} (${(location.name+")").padEnd(15, " ")} = ${value.replaceAll("\n", "\n    ")}\n`
                    }
                    string += `\n`
                }
                for (const [key, storageMap] of items.inconsistencies) {
                    for (const [location, value] of storageMap) {
                        string += `  • ${key}${ESCAPE_SEQUENCES.GREY} (${(location.name+")").padEnd(15, " ")} = ${value}\n`
                    }
                    string += `\n`
                }
            }

            console.info(string+"\n");
        }
        

    }

    public static removeTrailingSemicolon(str:string) {
        // replace ; and reset sequences with nothing
        return str.replace(/;(\x1b\[0m)?$/g, "")
    }

    public static async getSnapshot(options: StorageSnapshotOptions = {internalItems: false, expandStorageMapsAndSets: true}) {
        const allowedPointerIds = options.itemFilter ? new Set<string>() : undefined;
        const items = await this.createSnapshot(this.getItemKeys.bind(this), this.getItemDecompiled.bind(this), options.itemFilter, allowedPointerIds);
        const pointers = await this.createSnapshot(this.getPointerIds.bind(this), this.getPointerDecompiledFromLocation.bind(this), options.itemFilter, allowedPointerIds);

        // remove keys items that are unrelated to normal storage
        for (const [key] of items.snapshot) {
            if (key.startsWith("keys_") || key.startsWith("hash_keys_")) {
                if (options.internalItems) {
                    for (const [location, _value] of items.snapshot.get(key)!) {
                        items.snapshot.get(key)!.set(location, "..." + ESCAPE_SEQUENCES.RESET);
                    }
                }
                else items.snapshot.delete(key);
            }
        }

        // additional pointer entries from storage maps/sets
        const additionalEntries = new Set<string>();

        // iterate over storage maps and sets and render all entries
        if (options.expandStorageMapsAndSets) {
            for (const [ptrId, storageMap] of pointers.snapshot) {
                // display entry from first storage
                const [location, value] = [...storageMap.entries()][0];

                if (value.startsWith("\x1b[38;2;50;153;220m<StorageMap>") || value.startsWith("\x1b[38;2;50;153;220m<StorageSet>")) {
                    const ptr = await Pointer.load(ptrId, undefined, true);
                    if (ptr instanceof LazyPointer) {
                        console.error("LazyPointer in StorageMap/StorageSet");
                        continue;
                    }
                    if (ptr.val instanceof StorageMap) {
                        const map = ptr.val;
                        const keyIterator = await this.getItemKeysStartingWith((map as any)._prefix)
                        const pointerIds = new Set<string>();
                        let inner = "";
                        for await (const key of keyIterator) {
                            const valString = await this.getItemDecompiled(key, true, location);
                            if (valString === NOT_EXISTING) {
                                logger.error("Invalid entry in storage (" + location.name + "): " + key);
                                continue;
                            }
                            const keyString = await this.getItemDecompiled('key.' + key, true, location);
                            if (keyString === NOT_EXISTING) {
                                logger.error("Invalid key in storage (" + location.name + "): " + key);
                                continue;
                            }
                            inner += `   ${this.removeTrailingSemicolon(keyString)}\x1b[0m => ${this.removeTrailingSemicolon(valString)}\n`

                            // additional pointer ids included in value or key
                            if (allowedPointerIds) {
                                const valMatches = valString.match(/\$[a-zA-Z0-9]+/g)??[]
                                const keyMatches = keyString.match(/\$[a-zA-Z0-9]+/g)??[];

                                for (const match of valMatches) {
                                    const id = match.substring(1);
                                    pointerIds.add(id)
                                    if (!allowedPointerIds.has(id)) additionalEntries.add(id);
                                }
                                for (const match of keyMatches) {
                                    const id = match.substring(1);
                                    if (!allowedPointerIds.has(id)) additionalEntries.add(id);
                                
                                }
                            }
                        }

                        // size in memory / total size
                        const totalSize = await (ptr.val as StorageMap<unknown,unknown>).getSize();
                        const totalDirectPointerSize = pointerIds.size;
                        const inMemoryPointersSize= [...pointerIds].filter(id => Pointer.get(id)).length;
                        const sizeInfo = `   ${ESCAPE_SEQUENCES.GREY}total size: ${totalSize}, in memory: ${inMemoryPointersSize}/${totalDirectPointerSize} pointers${ESCAPE_SEQUENCES.RESET}\n`

                        // substring: remove last \n
                        if (inner) storageMap.set(location, "\x1b[38;2;50;153;220m<StorageMap> \x1b[0m{\n"+sizeInfo+inner.substring(0, inner.length-1)+"\x1b[0m\n}")
                    }
                    else if (ptr.val instanceof StorageSet) {
                        const set = ptr.val;
                        const keyIterator = await this.getItemKeysStartingWith((set as any)._prefix)
                        const pointerIds = new Set<string>();

                        let inner = "";
                        for await (const key of keyIterator) {
                            const valString = await this.getItemDecompiled(key, true, location);
                            if (valString === NOT_EXISTING) {
                                logger.error("Invalid entry in storage (" + location.name + "): " + key);
                                continue;
                            }
                            inner += `   ${this.removeTrailingSemicolon(valString)},\n`

                            // additional pointer ids included in value
                            if (allowedPointerIds) {
                                const matches = valString.match(/\$[a-zA-Z0-9]+/g)??[];
                                for (const match of matches) {
                                    const id = match.substring(1);
                                    pointerIds.add(id)
                                    if (!allowedPointerIds.has(id)) additionalEntries.add(id);
                                }
                            }
                        }

                        // size in memory / total size
                        const totalSize = await (ptr.val as StorageSet<unknown>).getSize();
                        const totalDirectPointerSize = pointerIds.size;
                        const inMemoryPointersSize= [...pointerIds].filter(id => Pointer.get(id)).length;
                        const sizeInfo = `   ${ESCAPE_SEQUENCES.GREY}total size: ${totalSize}, in memory: ${inMemoryPointersSize}/${totalDirectPointerSize} pointers${ESCAPE_SEQUENCES.RESET}\n`

                        // substring: remove last \n
                        if (inner) storageMap.set(location, "\x1b[38;2;50;153;220m<StorageSet> \x1b[0m{\n"+sizeInfo+inner.substring(0, inner.length-1)+"\x1b[0m\n}")
                    }
                }
            }
        }

        if (additionalEntries.size > 0) {
            await this.createSnapshot(this.getPointerIds.bind(this), this.getPointerDecompiledFromLocation.bind(this), options.itemFilter, additionalEntries, {
                snapshot: pointers.snapshot,
                inconsistencies: pointers.inconsistencies
            });
        }

        return {items, pointers}
    }

    private static async createSnapshot(
        keyGenerator: (location?: StorageLocation<Storage.Mode> | undefined) => Promise<Generator<string, void, unknown>>,
        itemGetter: (key: string, colorized: boolean, location: StorageLocation<Storage.Mode>) => Promise<string|symbol>,
        filter?: string,
        allowedPointerIds?: Set<string>,
        baseSnapshot?: {
            snapshot: AutoMap<string, Map<StorageLocation<Storage.Mode>, string>>;
            inconsistencies: AutoMap<string, Map<StorageLocation<Storage.Mode>, string>>;
        }
    ) {
        const snapshot = baseSnapshot?.snapshot ?? new Map<string, Map<StorageLocation, string>>().setAutoDefault(Map);
        const inconsistencies = baseSnapshot?.inconsistencies ?? new Map<string, Map<StorageLocation, string>>().setAutoDefault(Map);

        const skippedEntries = new Set<string>();
        const additionalEntries = new Set<string>();

        for (const location of new Set([this.#primary_location!, ...this.#locations.keys()].filter(l=>!!l))) {
            for (const key of await keyGenerator(location)) {
                if (filter && !key.includes(filter) && !allowedPointerIds?.has(key)) {
                    if (allowedPointerIds) skippedEntries.add(key); // remember skipped entries that might be added later
                    continue;
                }
                const decompiled = await itemGetter(key, true, location);

                if (typeof decompiled !== "string") {
                    console.error("Invalid entry in storage (" + location.name + "): " + key);
                    continue;
                }

                // collect referenced pointer ids
                if (allowedPointerIds) {
                    const matches = decompiled.match(/\$[a-zA-Z0-9]+/g);
                    if (matches) {
                        for (const match of matches) {
                            const id = match.substring(1);
                            if (skippedEntries.has(id)) additionalEntries.add(id);
                            allowedPointerIds.add(id);
                        }
                    }
                }
                snapshot.getAuto(key).set(location, this.removeTrailingSemicolon(decompiled));
            }
        }
        
        // run again with additional entries
        if (additionalEntries.size > 0) {
            await this.createSnapshot(keyGenerator, itemGetter, filter, additionalEntries, {
                snapshot,
                inconsistencies
            });
        }

        // find inconsistencies
        for (const [key, storageMap] of snapshot) {
            const [location, value] = [...storageMap.entries()][0];
            // compare with first entry
            for (const [location2, value2] of storageMap) {
                if (value !== value2) {
                    inconsistencies.getAuto(key).set(location, value);
                    inconsistencies.getAuto(key).set(location2, value2);
                }
            }
        }

        return {snapshot, inconsistencies};
    }

}

setStorage(Storage);

export namespace Storage {

	export enum Mode {
        SAVE_ON_EXIT, // save pointers on program exit / tab close
        SAVE_ON_CHANGE, // save a pointer immediately when the value changes
        SAVE_PERIODICALLY // save in fix interval
    }
}


// TODO: convert to static block (saFrari) --------------------------------------
// // @ts-ignore NO_INIT
// if (!globalThis.NO_INIT) {
//     Storage.determineTrustedLocation([]);
// }

// @ts-ignore NO_INIT
if (!globalThis.NO_INIT) {
    if (client_type == "deno") addEventListener("unload", ()=>Storage.handleExit(), {capture: true});
    addPersistentListener(globalThis, "beforeunload", ()=>Storage.handleExit(), {capture: true})
    // @ts-ignore document
    if (globalThis.document) addEventListener("visibilitychange", ()=>{
        // @ts-ignore document
        if (document.visibilityState === 'hidden') Storage.handleExit()
    });
    if (client_type == "deno") {
        Deno.addSignalListener("SIGINT", ()=>Deno.exit())
        try {
            // not supported by WiNdoWs
            await Deno.addSignalListener("SIGTERM", ()=>Deno.exit(1))
            await Deno.addSignalListener("SIGQUIT", ()=>Deno.exit())
        }
        catch {}
    }
}
// ------------------------------------------------------------------------------

// proxy for Storage
class DatexStoragePointerSource implements PointerSource {
    getPointer(pointer_id:string, pointerify?:boolean, localOnly?: boolean) {
        return Storage.getPointer(pointer_id, pointerify, undefined, undefined, localOnly ? {onlyLocalPointers: true} : undefined)
    }
    syncPointer(pointer:Pointer) {
        return Storage.syncPointer(pointer)
    }
}

export function registerStorageAsPointerSource() {
	Pointer.registerPointerSource(new DatexStoragePointerSource());
}

