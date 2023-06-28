// deno-lint-ignore-file no-namespace
import { Runtime } from "../runtime/runtime.ts";

import type { PointerSource } from "../utils/global_types.ts";
import { logger } from "../utils/global_values.ts";
import { NOT_EXISTING } from "./constants.ts";
import { Pointer, type MinimalJSRef } from "./pointers.ts";
import { localStorage } from "./storage-locations/local-storage-compat.ts";
import { MessageLogger } from "../utils/message_logger.ts";
import { displayFatalError, displayInit} from "./display.ts"
import { Type } from "../types/type.ts";


displayInit();

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



export interface StorageLocation<SupportedModes extends Storage.Mode = Storage.Mode> {
    name: string
    isAsync: boolean

    isSupported(): boolean
    onAfterExit?(): void

    setItem(key:string, value:unknown): Promise<boolean>|boolean
    getItem(key:string): Promise<unknown>|unknown
    hasItem(key:string):Promise<boolean>|boolean
    removeItem(key:string): Promise<void>|void
    getItemValueDXB(key:string): Promise<ArrayBuffer|null>|ArrayBuffer|null
    setItemValueDXB(key:string, value: ArrayBuffer):Promise<void>|void
    getItemKeys(): Promise<Generator<string, void, unknown>> | Generator<string, void, unknown>

    setPointer(pointer:Pointer): Promise<Set<Pointer>>|Set<Pointer>
    getPointerValue(pointerId:string, outer_serialized:boolean):Promise<unknown>|unknown
    removePointer(pointerId:string):Promise<void>|void
    hasPointer(pointerId:string):Promise<boolean>|boolean
    getPointerIds(): Promise<Generator<string, void, unknown>> | Generator<string, void, unknown>
    getPointerValueDXB(pointerId:string): Promise<ArrayBuffer|null>|ArrayBuffer|null
    setPointerValueDXB(pointerId:string, value: ArrayBuffer):Promise<void>|void
    clear(): Promise<void>|void
    
}
export abstract class SyncStorageLocation implements StorageLocation<Storage.Mode.SAVE_ON_CHANGE|Storage.Mode.SAVE_PERIODICALLY|Storage.Mode.SAVE_ON_EXIT> {

    abstract name: string;
    readonly isAsync = false;

    abstract isSupported(): boolean
    onAfterExit() {}

    abstract setItem(key: string,value: unknown): boolean
    abstract getItem(key:string): Promise<unknown>|unknown
    abstract hasItem(key:string): boolean
    abstract getItemKeys(): Generator<string, void, unknown>

    abstract removeItem(key: string): void
    abstract getItemValueDXB(key: string): ArrayBuffer|null
    abstract setItemValueDXB(key:string, value: ArrayBuffer):void

    abstract setPointer(pointer: Pointer<any>): Set<Pointer<any>>
    abstract getPointerValue(pointerId: string, outer_serialized:boolean): unknown
    abstract getPointerIds(): Generator<string, void, unknown>

    abstract removePointer(pointerId: string): void
    abstract getPointerValueDXB(pointerId: string): ArrayBuffer|null
    abstract setPointerValueDXB(pointerId:string, value: ArrayBuffer):void
    abstract hasPointer(pointerId: string): boolean

    abstract clear(): void
}

export abstract class AsyncStorageLocation implements StorageLocation<Storage.Mode.SAVE_ON_CHANGE|Storage.Mode.SAVE_PERIODICALLY> {
    abstract name: string;
    readonly isAsync = true;

    abstract isSupported(): boolean
    onAfterExit() {}

    abstract setItem(key: string,value: unknown): Promise<boolean>
    abstract getItem(key:string): Promise<unknown>
    abstract hasItem(key:string): Promise<boolean>
    abstract getItemKeys(): Promise<Generator<string, void, unknown>>

    abstract removeItem(key: string): Promise<void>
    abstract getItemValueDXB(key: string): Promise<ArrayBuffer|null> 
    abstract setItemValueDXB(key:string, value: ArrayBuffer):Promise<void>

    abstract setPointer(pointer: Pointer<any>): Promise<Set<Pointer<any>>>
    abstract getPointerValue(pointerId: string, outer_serialized:boolean): Promise<unknown>
    abstract getPointerIds(): Promise<Generator<string, void, unknown>>

    abstract removePointer(pointerId: string): Promise<void>
    abstract getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null>
    abstract setPointerValueDXB(pointerId:string, value: ArrayBuffer):Promise<void>
    abstract hasPointer(pointerId: string): Promise<boolean>

    abstract clear(): Promise<void>
}

type storage_options<M extends Storage.Mode> = {
    modes: M[]
    primary?: boolean // indicates if this storage should be used as the primary storage location
    interval?: number
}

type storage_location_options<L extends StorageLocation> = 
    L extends StorageLocation<infer T> ? storage_options<T> : never


export class Storage {
    
    static cache:Map<string,any> = new Map(); // save stored values in a Map, return when calling getItem


    static state_prefix = "dxstate::"

    static pointer_prefix = "dxptr::"+site_suffix+"::"
    static item_prefix = "dxitem::"+site_suffix+"::"

    static meta_prefix = "dxmeta::"+site_suffix+"::"


    static #storage_active_pointers = new Set<Pointer>();
    static #storage_active_pointer_ids = new Set<string>();

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
        if (this.#trusted_location == undefined) this.trusted_location = this.#primary_location; // use as trusted location
    }
    static get primary_location () {return this.#primary_location}

    static #locations = new Map<StorageLocation, storage_location_options<StorageLocation>>()
    static #auto_sync_enabled = false;

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
        
        this.saveDirtyState();
        for (const [loc,options] of this.#locations) {
            if (options.modes.includes(<any>Storage.Mode.SAVE_ON_EXIT)) Storage.saveCurrentState(loc);
            loc.onAfterExit?.();
        }
        logger.debug("exit - state saved in cache");
    }


    // call to reload page without saving any data (for resetting)
    static #exit_without_save = false;
    public static allowExitWithoutSave(){
        this.#exit_without_save = true;
    }

    private static saveCurrentState(location:StorageLocation){
        if (this.#exit_without_save) {
            console.log(`exiting without save`);
            return;
        }

        try {
            // update items
            let c = 0;
            for (const [key, val] of Storage.cache) {
                try {
                    c++;
                    this.setItem(key, val, true, location);
                } catch (e) {console.error(e)}
            }

            // update pointers
            for (const ptr of this.#storage_active_pointers) {
                try {
                    c++;
                    this.setPointer(ptr, true, location);
                } catch (e) {console.error(e)}
            }
            for (const id of this.#storage_active_pointer_ids) {
                try {
                    c++;
                    const ptr = Pointer.get(id);
                    if (ptr?.value_initialized) this.setPointer(ptr, true, location);
                } catch (e) {console.error(e)}
            }

            this.updateSaveTime(location); // last full backup to this storage location
            logger.debug(`current state saved to ${location.name} (${c} items)`);
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

    static #dirty_locations = new Set<StorageLocation>()

    // handle dirty states for async storage operations:

    // called when a full backup to this storage location was made
    public static setDirty(location:StorageLocation, dirty = true) {
        if (dirty) this.#dirty_locations.add(location);
        else this.#dirty_locations.delete(location);
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
        for (const location of this.#dirty_locations) {
            localStorage.setItem(this.meta_prefix+'__dirty__' + location.name, new Date().getTime().toString());
        }
    }

    /**
     * clear the dirty state in localstorage
     */
    private static clearDirtyState(location: StorageLocation){
        localStorage.removeItem(this.meta_prefix+'__dirty__' + location.name);
    }
    

    private static getLastUpdatedStorage(fromLocations: StorageLocation[]) {
        let last:StorageLocation|undefined;
        let last_time = 0;
        for (const location of fromLocations) {
			const time = Number(localStorage.getItem(this.meta_prefix+'__saved__' + location.name));
			if (time > last_time) {
				last_time = time;
				last = location
			}
			this.deleteSaveTime(location); // no longer valid after this session
        }
        return last;
    }

    static determineTrustedLocation(fromLocations: StorageLocation[]){
        this.trusted_location = this.getLastUpdatedStorage(fromLocations) ?? this.primary_location;
    }

    static setItem(key:string, value:any, listen_for_pointer_changes = true, location:StorageLocation|null|undefined = this.#primary_location):Promise<boolean>|boolean {
        Storage.cache.set(key, value); // save in cache
        // cache deletion does not work, problems with storage item backup
        // setTimeout(()=>Storage.cache.delete(key), 10000);
        const pointer = value instanceof Pointer ? value : Pointer.getByValue(value);

		if (location)  {
			if (location.isAsync) return this.setItemAsync(location as AsyncStorageLocation, key, value, pointer, listen_for_pointer_changes);
			else return this.setItemSync(location as SyncStorageLocation, key, value, pointer, listen_for_pointer_changes);
		}
        else return false;
    }

	static async setItemAsync(location:AsyncStorageLocation, key: string,value: unknown,pointer: Pointer<any>|undefined,listen_for_pointer_changes: boolean): Promise<boolean> {
		this.setDirty(location, true)
        // also store pointer
        if (pointer) {
            const res = await Storage.setPointer(pointer, listen_for_pointer_changes, location);
            if (!res) return false;
        }
        this.setDirty(location, true)
        // store value (might be pointer reference)
        const res = await location.setItem(key, value);
        this.setDirty(location, false)
        return res;
	}

	static setItemSync(location:SyncStorageLocation, key: string,value: unknown,pointer: Pointer<any>|undefined,listen_for_pointer_changes: boolean): boolean {
		// also store pointer
        if (pointer) {
            const res = Storage.setPointer(pointer, listen_for_pointer_changes, location);
            if (!res) return false;
        }

        return location.setItem(key, value);
	}

    public static setPointer(pointer:Pointer, listen_for_changes = true, location:StorageLocation|undefined = this.#primary_location): Promise<boolean>|boolean {

        if (!pointer.value_initialized) {
            logger.warn("pointer value " + pointer.idString() + " not available, cannot save in storage");
            return false
        }
        
		if (location)  {
			if (location.isAsync) return this.initPointerAsync(location as AsyncStorageLocation, pointer, listen_for_changes);
			else return this.initPointerSync(location as SyncStorageLocation, pointer, listen_for_changes);
		}
		else return false;
    }

    private static initPointerSync(location: SyncStorageLocation, pointer:Pointer, listen_for_changes = true):boolean {
        // if (pointer.transform_scope && this.hasPointer(pointer)) return true; // ignore transform pointer, initial transform scope already stored, does not change

        const dependencies = this.updatePointerSync(location, pointer);

        // add required pointers for this pointer (only same-origin pointers)
        for (const ptr of dependencies) {
            // add if not yet in storage
            if (ptr != pointer && /*ptr.is_origin &&*/ !localStorage.getItem(this.pointer_prefix+ptr.id)) this.setPointer(ptr, listen_for_changes, location)
        }

        // listen for changes
        if (listen_for_changes) this.syncPointer(pointer, location);

        this.#storage_active_pointers.add(pointer);
    
        return true;
    }

    private static updatePointerSync(location: SyncStorageLocation, pointer:Pointer): Set<Pointer>{
		return location.setPointer(pointer);
    }

    private static async initPointerAsync(location: AsyncStorageLocation, pointer:Pointer, listen_for_changes = true):Promise<boolean>{
        // if (pointer.transform_scope && await this.hasPointer(pointer)) return true; // ignore transform pointer, initial transform scope already stored, does not change

        const dependencies = await this.updatePointerAsync(location, pointer);

        // add required pointers for this pointer (only same-origin pointers)
        for (const ptr of dependencies) {
            // add if not yet in storage
            if (ptr != pointer && /*ptr.is_origin &&*/ !await this.hasPointer(ptr)) await this.setPointer(ptr, listen_for_changes, location)
        }

        // listen for changes
        if (listen_for_changes) this.syncPointer(pointer, location);

        this.#storage_active_pointers.add(pointer);

        return true;
    }

    private static async updatePointerAsync(location: AsyncStorageLocation, pointer:Pointer): Promise<Set<Pointer>> {
        this.setDirty(location, true)
		const res = await location.setPointer(pointer);
		this.setDirty(location, false)
		return res;
    }


    private static synced_pointers = new Set<Pointer>();

    static syncPointer(pointer: Pointer, location?: StorageLocation) {
        if (!this.#auto_sync_enabled) return;


        if (!pointer) {
            logger.error("tried to sync non-existing pointer with storage")
            return;
        }

        // already syncing?
        if (this.synced_pointers.has(pointer)) return;
        this.synced_pointers.add(pointer)

        // any value change
        let saving = false;
        pointer.observe(()=>{
            if (saving) return;
            saving = true;
            setTimeout(()=>{
                saving = false;
                // set pointer (async)
                logger.debug("Update " + pointer.idString() + " in storage");
                this.setPointer(pointer, false, location); // update value and add new dependencies recursively
            }, 2000);
        }, undefined, undefined, {ignore_transforms:true, recursive:false})
        
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

    private static initPrimaryFromTrustedLocation(pointer_id:string, maybe_trusted_location:StorageLocation) {
        if (this.#primary_location == undefined) return;
        if (this.#primary_location == this.#trusted_location) return;

        // wait until pointer loaded
        setTimeout(async ()=>{
            if (this.#trusted_location == maybe_trusted_location) {
                const pointer = Pointer.get(pointer_id);
                if (pointer?.value_initialized) {
                    await this.setPointer(pointer, true, this.#primary_location)
                    this.#trusted_pointers.add(pointer_id)
                }
                else {
                    console.log("cannot init pointer " +pointer_id)
                }
            }
        }, 3000);

    }

    private static async restoreDirtyState(){
        if (this.#primary_location != undefined && this.isInDirtyState(this.#primary_location) && this.#trusted_location != undefined && this.#trusted_location!=this.#primary_location) {
            await this.copyStorage(this.#trusted_location, this.#primary_location)
            logger.warn `restored dirty state of ${this.#primary_location.name} from trusted location ${this.#trusted_location.name}`
            this.setDirty(this.#primary_location, false) // remove from dirty set
            this.clearDirtyState(this.#primary_location) // remove from localstorage
            this.#dirty = false;
            // primary location is now trusted
            this.trusted_location = this.#primary_location
        }
    }

    /**
     * gets the value of a pointer from storage
     * @param pointer_id id string
     * @param pointerify creates DATEX Pointer if true, otherwise just returns the value
     * @param outer_serialized if true, the outer value type is not evaluated and only the serialized value is returned
     * @returns value from pointer storage
     */
    public static async getPointer(pointer_id:string, pointerify?:boolean, bind?:any, location?:StorageLocation):Promise<any> {

        if (this.#dirty) {
            displayFatalError('storage-unrecoverable');
            throw new Error(`cannot restore dirty state of ${this.#primary_location!.name}, no trusted secondary storage location found`)
        }

        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(pointer_id))) {
            if (loc==undefined) continue;
            const val = await this.getPointerFromLocation(pointer_id, pointerify, bind, loc);
            if (val !== NOT_EXISTING) return val;
        }
        
        return NOT_EXISTING
    }

    private static async getPointerFromLocation(pointer_id:string, pointerify: boolean|undefined, bind:any|undefined, location:StorageLocation) {
        const val = await this.getPointerAsync(location, pointer_id, pointerify, bind);
		if (val == NOT_EXISTING) return NOT_EXISTING;
        
		await this.initPrimaryFromTrustedLocation(pointer_id, location)
        return val;
    }

    private static async getPointerAsync(location:StorageLocation, pointer_id:string, pointerify?:boolean, bind?:any) {

        let pointer:Pointer|undefined;
		if (pointerify && (pointer = Pointer.get(pointer_id))?.value_initialized) {
            return pointer.val; // pointer still exists in runtime
        }

        // load from storage
		let val = location.getPointerValue(pointer_id, !!bind);
		if (val == NOT_EXISTING) return NOT_EXISTING;

        // bind serialized val to existing value
        if (bind) {
            Type.ofValue(bind).updateValue(bind, val);
            val = bind;
        }

        // create pointer with saved id and value + start syncing, if pointer not already created in DATEX
        if (pointerify) {
            let pointer: Pointer;

            // if the value is a pointer with a tranform scope, copy the transform, not the value (TODO still just a workaround to preserve transforms in storage, maybe better solution?)
            if (val instanceof Pointer && val.transform_scope) {
                console.log("init value",val);
                pointer = await Pointer.createTransformAsync(val.transform_scope.internal_vars, val.transform_scope);
            }
            // normal pointer from value
            else pointer = Pointer.create(pointer_id, val, false, Runtime.endpoint);

            this.syncPointer(pointer);
            this.#storage_active_pointers.add(pointer);
            if (pointer.is_js_primitive) return pointer;
            else return pointer.val;
        }

        else {
            this.#storage_active_pointer_ids.add(pointer_id);
            return val;
        }
    }

    private static async removePointer(pointer_id:string, location?:StorageLocation) {
		// remove from specific location
		if (location) return location.removePointer(pointer_id);
		// remove from all
		else {

			for (const location of this.#locations.keys()) {
				await location.removePointer(pointer_id);
			}
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

    public static async getItemKeys(location?:StorageLocation){

		// for specific location
		if (location) return location.getItemKeys();

		// ... iterate over keys from all locations

		const generators = [];
		for (const location of this.#locations.keys()) {
			generators.push(await location.getItemKeys())
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
        const keyIterator = await Storage.getItemKeys(location);
        return (function*(){
            for (const key of keyIterator) {
                if (key.startsWith(prefix)) yield key;
            }
        })()
    }

    public static async getPointerKeys(location?:StorageLocation){

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
        
        for (const pointer_id of await this.getPointerKeys(from)) {
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

    public static async getItem(key:string, location?:StorageLocation|undefined/* = this.#primary_location*/):Promise<any> {

        if (this.#dirty) {
            displayFatalError('storage-unrecoverable');
            throw new Error(`cannot restore dirty state of ${this.#primary_location!.name}, no trusted secondary storage location found`)
        }

        // get from cache
        if (Storage.cache.has(key)) return Storage.cache.get(key);

        // try to find item at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(key))) {
            if (loc==undefined) continue;
            const val = await this.getItemFromLocation(key, loc);
            if (val!==NOT_EXISTING) return val;
        }

        return undefined;
    }


    public static async getItemFromLocation(key:string, location:StorageLocation/* = this.#primary_location*/):Promise<any> {

		const val = await location.getItem(key);
		if (val == NOT_EXISTING) return NOT_EXISTING;

		Storage.cache.set(key, val);
		await this.initPrimaryFromTrustedLocation(key, location)
		return val;
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

    public static async removeItem(key:string, location?:StorageLocation):Promise<void> {
        if (Storage.cache.has(key)) Storage.cache.delete(key); // delete from cache

		// remove from specific location
		if (location) return location.removeItem(key);
		// remove from all
		else {
			for (const location of this.#locations.keys()) {
				await location.removeItem(key);
			}
		}
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
        if (globalThis.window) window.location.reload();
        else if (globalThis.Deno) Deno.exit(1);
        else logger.error("Could not reload in non-browser or Deno context")
    }

    // load saved state
    public static async loadOrCreate<T>(id:string|number, create?:()=>Promise<T>|T):Promise<MinimalJSRef<T>> {
        const state_name = this.state_prefix+id.toString();

        // already has a saved state
        if (await this.hasItem(state_name)) {
            return await this.getItem(state_name)
        }
        // create state
        else if (create){
            const state = Pointer.createOrGet(await create()).js_value;
            await this.setItem(state_name, state, true);
            return <any>state;
        }
        else throw new Error("Cannot find or create the state '" + id + "'")
    }

}

export namespace Storage {

	export enum Mode {
        SAVE_ON_EXIT, // save pointers on program exit / tab close
        SAVE_ON_CHANGE, // save a pointer immediately when the value changes
        SAVE_PERIODICALLY // save in fix interval
    }
}


// TODO: convert to static block (saFrari) --------------------------------------
// @ts-ignore NO_INIT
if (!globalThis.NO_INIT) {
    Storage.determineTrustedLocation([]);
}

addEventListener("unload", ()=>Storage.handleExit(), {capture: true});
// @ts-ignore document
if (globalThis.document) addEventListener("visibilitychange", ()=>{
    // @ts-ignore document
    if (document.visibilityState === 'hidden') Storage.handleExit()
});
if (globalThis.Deno) Deno.addSignalListener("SIGINT", ()=>Deno.exit())
// ------------------------------------------------------------------------------

// @ts-ignore storage reset
globalThis.reset = Storage.clearAndReload

// proxy for Storage
class DatexStoragePointerSource implements PointerSource {
    getPointer(pointer_id:string, pointerify?:boolean) {
        return Storage.getPointer(pointer_id, pointerify)
    }
    syncPointer(pointer:Pointer) {
        return Storage.syncPointer(pointer)
    }
} 

// register DatexStorage as pointer source
Pointer.registerPointerSource(new DatexStoragePointerSource());