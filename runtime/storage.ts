// deno-lint-ignore-file no-namespace
import { Runtime } from "../runtime/runtime.ts";

import type { PointerSource } from "../utils/global_types.ts";
import { client_type, logger } from "../utils/global_values.ts";
import { Compiler } from "../compiler/compiler.ts";
import { NOT_EXISTING } from "./constants.ts";
import { Pointer, type MinimalJSRef } from "./pointers.ts";
import { base64ToArrayBuffer } from "../utils/utils.ts";
import { localStorage } from "./local_storage.ts";
import { MessageLogger } from "../utils/message_logger.ts";
import { displayFatalError, displayInit} from "./display.ts"
import { Type } from "../types/type.ts";

displayInit();

/***** imports and definitions with top-level await - node.js / browser interoperability *******************************/
const site_suffix = (()=>{
    // remove hash from url
    if (globalThis.location?.origin) {
        // const url = new URL(globalThis.location.href)
        // url.hash = "";
        // return url.toString();
        return globalThis.location.origin
    }
    else return ""
})();



if (client_type === "deno") await import ("./deno_indexeddb.ts");

// db based storage for DATEX value caching (IndexDB in the browser)
const localforage = (await import("../lib/localforage/localforage.js")).default;
const datex_item_storage = <globalThis.Storage><unknown> localforage.createInstance({name: "dxitem::"+site_suffix});
const datex_pointer_storage = <globalThis.Storage><unknown> localforage.createInstance({name: "dxptr::"+site_suffix});


type storage_options<M extends Storage.Mode> = {
    modes: M[]
    primary?: boolean // indicates if this storage should be used as the primary storage location
    interval?: number
}

type storage_location_options<L extends Storage.Location> = 
    L extends Storage.Location.FILESYSTEM_OR_LOCALSTORAGE ? 
        storage_options<Storage.Mode.SAVE_ON_CHANGE|Storage.Mode.SAVE_PERIODICALLY|Storage.Mode.SAVE_ON_EXIT> : 
        storage_options<Storage.Mode.SAVE_ON_CHANGE|Storage.Mode.SAVE_PERIODICALLY>


export class Storage {
    
    static cache:Map<string,any> = new Map(); // save stored values in a Map, return when calling getItem


    static state_prefix = "dxstate::"

    static pointer_prefix = "dxptr::"+site_suffix+"::"
    static item_prefix = "dxitem::"+site_suffix+"::"

    static meta_prefix = "dxmeta::"+site_suffix+"::"


    static #storage_active_pointers = new Set<Pointer>();
    static #storage_active_pointer_ids = new Set<string>();

    static DEFAULT_INTERVAL = 60; // 60s

    static #primary_location?: Storage.Location;
    static #trusted_location?: Storage.Location;
    static #trusted_pointers = new Set<string>()

    // location which did that last complete backup in the last session, if none found, use the current primary location
    static set trusted_location(location: Storage.Location | undefined) {
        this.#trusted_location = location;
        if (location != undefined) {
            logger.debug `trusted storage location: #bold${Storage.Location[location]}`
        }
    }
    static get trusted_location () {return this.#trusted_location}

    // default location for saving pointers/items
    static set primary_location(location: Storage.Location | undefined) {
        this.#primary_location = location;
        if (this.#trusted_location == undefined) this.trusted_location = this.#primary_location; // use as trusted location
    }
    static get primary_location () {return this.#primary_location}

    static #locations = new Map<Storage.Location, storage_location_options<Storage.Location.FILESYSTEM_OR_LOCALSTORAGE>|storage_location_options<Storage.Location.INDEXED_DB>>()
    static #auto_sync_enabled = false;

    // set options for storage location and enable
    public static addLocation<L extends Storage.Location>(location:L, options:storage_location_options<L>) {
        this.#locations.set(location, options);

        if (options.interval && !options.modes.includes(Storage.Mode.SAVE_PERIODICALLY)) {
            throw new Error("The 'interval' option can only be used for the storage mode SAVE_PERIODICALLY");
        }

        for (const mode of options.modes) {
            // asynchronous saving on exit not possible
            if (mode == Storage.Mode.SAVE_ON_EXIT && location == Storage.Location.INDEXED_DB) throw new Error("Invalid DATEX Storage location: INDEXED_DB is not compatible with SAVE_ON_EXIT mode");
            // localStorage undefined (e.g. in web worker)
            if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE && !localStorage) throw new Error("Invalid DATEX Storage location: FILESYSTEM_OR_LOCALSTORAGE, localStorage not available");
        
            if (mode == Storage.Mode.SAVE_PERIODICALLY) {
                this.addSaveInterval(location, options.interval ?? this.DEFAULT_INTERVAL)
            }
        }

        // update auto_sync_enabled
        this.#auto_sync_enabled = false
        for (const [_loc,options] of this.#locations) {
            if (options.modes.includes(Storage.Mode.SAVE_ON_CHANGE)) this.#auto_sync_enabled = true;
        }

        logger.debug `using ${options.primary?'primary':'secondary'} storage location #bold${Storage.Location[location]}:#color(grey) ${options.modes.map(m=>Storage.Mode[m]).join(', ')}`

        if (options.primary) {
            this.primary_location = location;
        }

        return this.restoreDirtyState()
    }

    // disable storage location
    public static removeLocation(location:Storage.Location) {
        const options = this.#locations.get(location);
        this.#locations.delete(location);
        if (options?.primary) this.primary_location = undefined;
        if (options?.interval != undefined) clearInterval(this.#save_interval_refs.get(location))
    }


    static #save_interval_refs = new Map<Storage.Location, number>()

    /**
     * set the interval (in s) in which the current pointer should be saved in a storage storage
     */
    private static addSaveInterval(location:Storage.Location, interval:number) {
        if (this.#save_interval_refs.has(location)) clearInterval(this.#save_interval_refs.get(location))
        if (interval != 0) {
            this.#save_interval_refs.set(location, setInterval(()=>this.saveCurrentState(location), interval * 1000))
        }
    }

    static #exiting = false

    static handleExit(){
        if (this.#exiting) return;
        this.#exiting = true
        if (globalThis.Deno) setTimeout(()=>{Deno.exit(1)},20_000)
        
        this.saveDirtyState();
        for (const [loc,options] of this.#locations) {
            if (options.modes.includes(<any>Storage.Mode.SAVE_ON_EXIT)) Storage.saveCurrentState(loc);
            if (loc == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE && localStorage.saveFile) localStorage.saveFile(); // deno local storage, save file
        }
        logger.debug("exit - state saved in cache");
    }


    // call to reload page without saving any data (for resetting)
    static #exit_without_save = false;
    public static allowExitWithoutSave(){
        this.#exit_without_save = true;
    }

    private static saveCurrentState(location:Storage.Location){
        if (this.#exit_without_save) {
            console.log(`exiting without save`);
            return;
        }

        try {
            // update items
            for (const [key, val] of Storage.cache) {
                try {
                    this.setItem(key, val, true, location);
                } catch (e) {console.error(e)}
            }

            // update pointers
            for (const ptr of this.#storage_active_pointers) {
                try {
                    this.setPointer(ptr, true, location);
                } catch (e) {console.error(e)}
            }
            for (const id of this.#storage_active_pointer_ids) {
                try {
                    const ptr = Pointer.get(id);
                    if (ptr?.value_initialized) this.setPointer(ptr, true, location);
                } catch (e) {console.error(e)}
            }

            this.updateSaveTime(location); // last full backup to this storage location
            logger.debug(`current state saved to ${Storage.Location[location]}`);
        }
        catch (e) {
            console.error(e)
        }
     
    }
    
    // called when a full backup to this storage location was made
    private static updateSaveTime(location:Storage.Location) {
        if (this.#exit_without_save) return; // currently exiting
        localStorage.setItem(this.meta_prefix+'__saved__' + Storage.Location[location], new Date().getTime().toString());
    }

    private static deleteSaveTime(location:Storage.Location) {
        localStorage.removeItem(this.meta_prefix+'__saved__' + Storage.Location[location]);
    }

    static #dirty_locations = new Set<Storage.Location>()

    // handle dirty states for async storage operations:

    // called when a full backup to this storage location was made
    private static setDirty(location:Storage.Location, dirty = true) {
        if (dirty) this.#dirty_locations.add(location);
        else this.#dirty_locations.delete(location);
    }

    static #dirty = false;
    private static isInDirtyState(location:Storage.Location) {
        this.#dirty = !!localStorage.getItem(this.meta_prefix+'__dirty__' + Storage.Location[location])
        return this.#dirty;
    }

    /**
     * save current dirty states in localstorage
     */
    private static saveDirtyState(){
        if (this.#exit_without_save) return; // currently exiting
        for (const location of this.#dirty_locations) {
            localStorage.setItem(this.meta_prefix+'__dirty__' + Storage.Location[location], new Date().getTime().toString());
        }
    }

    /**
     * clear the dirty state in localstorage
     */
    private static clearDirtyState(location: Storage.Location){
        localStorage.removeItem(this.meta_prefix+'__dirty__' + Storage.Location[location]);
    }
    

    private static getLastUpdatedStorage() {
        let last:Storage.Location|undefined;
        let last_time = 0;
        for (const _loc in Storage.Location) {
            const location = <Storage.Location> Number(_loc)
            if (!isNaN(location)) {
                const time = Number(localStorage.getItem(this.meta_prefix+'__saved__' + Storage.Location[location]));
                if (time > last_time) {
                    last_time = time;
                    last = location
                }
                this.deleteSaveTime(location); // no longer valid after this session
            }
        }
        return last;
    }

    static determineTrustedLocation(){
        this.trusted_location = this.getLastUpdatedStorage() ?? this.primary_location;
    }

    static setItem(key:string, value:any, listen_for_pointer_changes = true, location:Storage.Location|null|undefined = this.#primary_location):Promise<boolean>|boolean {
        Storage.cache.set(key, value); // save in cache
        // cache deletion does not work, problems with storage item backup
        // setTimeout(()=>Storage.cache.delete(key), 10000);
        const pointer = value instanceof Pointer ? value : Pointer.getByValue(value);

        if (location==undefined || location == Storage.Location.INDEXED_DB) return this.setItemDB(key, value, pointer, listen_for_pointer_changes);
        if (location==undefined || location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) return this.setItemLocalStorage(key, value, pointer, listen_for_pointer_changes);
        else return false;
    }

    private static setItemLocalStorage(key:string, value:any, pointer?:Pointer, listen_for_pointer_changes = true):boolean {
        // also store pointer
        if (pointer) {
            const res = this.setPointer(pointer, listen_for_pointer_changes, Storage.Location.FILESYSTEM_OR_LOCALSTORAGE);
            if (!res) return false;
        }

        localStorage.setItem(this.item_prefix+key, Compiler.encodeValueBase64(value))
        return true;
    }

    private static async setItemDB(key:string, value:any, pointer?:Pointer, listen_for_pointer_changes = true):Promise<boolean> {
        this.setDirty(Storage.Location.INDEXED_DB)
        // also store pointer
        if (pointer) {
            const res = await this.setPointer(pointer, listen_for_pointer_changes, Storage.Location.INDEXED_DB);
            if (!res) return false;
        }
        this.setDirty(Storage.Location.INDEXED_DB, true)
        // store value (might be pointer reference)
        await datex_item_storage.setItem(key, <any>Compiler.encodeValue(value));  // value to buffer (no header)
        this.setDirty(Storage.Location.INDEXED_DB, false)
        return true;
    }

    private static setPointer(pointer:Pointer, listen_for_changes = true, location:Storage.Location|undefined = this.#primary_location): Promise<boolean>|boolean {

        if (!pointer.value_initialized) {
            logger.warn("pointer value " + pointer.idString() + " not available, cannot save in storage");
            return false
        }
        
        if (location==undefined || location == Storage.Location.INDEXED_DB) return this.initPointerDB(pointer, listen_for_changes);
        if (location==undefined || location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) return this.initPointerLocalStorage(pointer, listen_for_changes);
        return false;
    }

    private static initPointerLocalStorage(pointer:Pointer, listen_for_changes = true):boolean {
        // if (pointer.transform_scope && this.hasPointer(pointer)) return true; // ignore transform pointer, initial transform scope already stored, does not change

        const dependencies = this.updatePointerLocalStorage(pointer);

        // add required pointers for this pointer (only same-origin pointers)
        for (const ptr of dependencies) {
            // add if not yet in storage
            if (ptr != pointer && /*ptr.is_origin &&*/ !localStorage.getItem(this.pointer_prefix+ptr.id)) this.setPointer(ptr, listen_for_changes, Storage.Location.FILESYSTEM_OR_LOCALSTORAGE)
        }

        // listen for changes
        if (listen_for_changes) this.syncPointer(pointer, Storage.Location.INDEXED_DB);

        this.#storage_active_pointers.add(pointer);
    
        return true;
    }

    private static updatePointerLocalStorage(pointer:Pointer): Set<Pointer>{
        const inserted_ptrs = new Set<Pointer>();
        localStorage.setItem(this.pointer_prefix+pointer.id, Compiler.encodeValueBase64(pointer, inserted_ptrs, true, false, true));  // serialized pointer
        return inserted_ptrs;
    }

    private static async initPointerDB(pointer:Pointer, listen_for_changes = true):Promise<boolean>{
        // if (pointer.transform_scope && await this.hasPointer(pointer)) return true; // ignore transform pointer, initial transform scope already stored, does not change

        const dependencies = await this.updatePointerDB(pointer);

        // add required pointers for this pointer (only same-origin pointers)
        for (const ptr of dependencies) {
            // add if not yet in storage
            if (ptr != pointer && /*ptr.is_origin &&*/ !await this.hasPointer(ptr)) await this.setPointer(ptr, listen_for_changes, Storage.Location.INDEXED_DB)
        }

        // listen for changes
        if (listen_for_changes) this.syncPointer(pointer, Storage.Location.INDEXED_DB);

        this.#storage_active_pointers.add(pointer);

        return true;
    }

    private static async updatePointerDB(pointer:Pointer): Promise<Set<Pointer>> {
        this.setDirty(Storage.Location.INDEXED_DB)
        const inserted_ptrs = new Set<Pointer>();
        await datex_pointer_storage.setItem(pointer.id, <any>Compiler.encodeValue(pointer, inserted_ptrs, true, false, true));
        this.setDirty(Storage.Location.INDEXED_DB, false)
        return inserted_ptrs;
    }


    private static synced_pointers = new Set<Pointer>();

    static syncPointer(pointer: Pointer, location?: Storage.Location) {
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
        pointer.observe((v,k,t)=>{
            if (saving) return;
            saving = true;
            setTimeout(()=>{
                saving = false;
                // set pointer (async)
                this.setPointer(pointer, false, location); // update value and add new dependencies recursively
            }, 2000);
        }, undefined, undefined, {ignore_transforms:true, recursive:false})
        
    }

    public static async hasPointer(pointer:Pointer, location:Storage.Location|undefined = this.#trusted_location) {
        if (location == undefined || location == Storage.Location.INDEXED_DB && (await datex_pointer_storage.getItem(pointer.id)) !== null) return true;
        if (location == undefined || location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE && localStorage.getItem(this.pointer_prefix+pointer.id)) return true;
        return false;
    }

    private static getLocationPriorityOrder(pointer_id:string) {
        if (this.#trusted_pointers.has(pointer_id)) return [this.#primary_location, this.#trusted_location]; // value already loaded from trusted location, use primary location now
        else return [this.#trusted_location, this.#primary_location] // first try to get from trusted location
    }

    private static initPrimaryFromTrustedLocation(pointer_id:string, maybe_trusted_location:Storage.Location) {
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
            logger.warn `restored dirty state of ${Storage.Location[this.#primary_location]} from trusted location ${Storage.Location[this.#trusted_location]}`
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
    public static async getPointer(pointer_id:string, pointerify?:boolean, bind?:any, location?:Storage.Location):Promise<any> {

        if (this.#dirty) {
            displayFatalError('storage-unrecoverable');
            throw new Error(`cannot restore dirty state of ${Storage.Location[this.#primary_location!]}, no trusted secondary storage location found`)
        }

        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(pointer_id))) {
            if (loc==undefined) continue;
            const val = await this.getPointerFromLocation(pointer_id, pointerify, bind, loc);
            if (val !== NOT_EXISTING) return val;
        }
        
        return NOT_EXISTING
    }

    private static async getPointerFromLocation(pointer_id:string, pointerify: boolean|undefined, bind:any|undefined, location:Storage.Location) {
        if (location == Storage.Location.INDEXED_DB) {
            const val = await this.getPointerDB(pointer_id, pointerify, bind);
            if (val !== NOT_EXISTING){ 
                await this.initPrimaryFromTrustedLocation(pointer_id, Storage.Location.INDEXED_DB)
                return val;
            }
        }

        else if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) {
            const val = await this.getPointerLocalStorage(pointer_id, pointerify, bind);
            if (val !== NOT_EXISTING){
                await this.initPrimaryFromTrustedLocation(pointer_id, Storage.Location.FILESYSTEM_OR_LOCALSTORAGE)
                return val;
            }
        }
        return NOT_EXISTING
    }

    private static async getPointerLocalStorage(pointer_id:string, pointerify?:boolean, bind?:any) {

        let pointer:Pointer|undefined;
        if (pointerify && (pointer = Pointer.get(pointer_id))?.value_initialized) {
            return pointer.val; // pointer still exists in runtime
        }

        // load from storage
        const base64 = localStorage.getItem(this.pointer_prefix+pointer_id);
        if (base64 == null) return NOT_EXISTING;

        let val = await Runtime.decodeValueBase64(base64, !!bind);

        // bind serialized val to existing value
        if (bind) {
            Type.ofValue(bind).updateValue(bind, val);
            val = bind;
        }
        
        // create pointer with saved id and value + start syncing, if pointer not already created in DATEX
        if (pointerify) {
            let pointer:Pointer;

            // if the value is a pointer with a tranform scope, copy the transform, not the value (TODO still just a workaround to preserve transforms in storage, maybe better solution?)
            if (val instanceof Pointer && val.transform_scope) {
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

    private static async getPointerDB(pointer_id:string, pointerify?:boolean, bind?:any) {

        let pointer:Pointer|undefined;
        if (pointerify && (pointer = Pointer.get(pointer_id))) return pointer.val; // pointer still exists in runtime

        // load from storage
        const buffer = <ArrayBuffer><any>await datex_pointer_storage.getItem(pointer_id);
        if (buffer == null) return NOT_EXISTING;

        let val = await Runtime.decodeValue(buffer, !!bind);

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


    private static async removePointer(pointer_id:string) {
        if (this.#primary_location == Storage.Location.INDEXED_DB) { 
            await datex_pointer_storage.removeItem(pointer_id);
        }

        else if (this.#primary_location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            localStorage.removeItem(this.pointer_prefix+pointer_id);
        }
    }

    public static async getPointerDecompiled(pointer_id:string, colorized = false, location?:Storage.Location):Promise<string|undefined|typeof NOT_EXISTING> {
        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(pointer_id))) {
            if (loc==undefined) continue;
            const val = await this.getPointerDecompiledFromLocation(pointer_id, colorized, loc);
            if (val !== NOT_EXISTING) return val;
        }
        return NOT_EXISTING;
    }


    private static async getPointerDecompiledFromLocation(pointer_id:string, colorized = false, location:Storage.Location) {

        // get from datex_storage
        if (location == Storage.Location.INDEXED_DB) { 
            const buffer = <ArrayBuffer><any>await datex_pointer_storage.getItem(pointer_id);
            if (buffer != null) return MessageLogger.decompile(buffer, false, colorized);
        }

        // get from local storage
        else if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            const base64 = localStorage.getItem(this.pointer_prefix+pointer_id);
            if (base64!=null) return MessageLogger.decompile(base64ToArrayBuffer(base64), false, colorized);
        }

        return NOT_EXISTING;
    }

    public static async getItemDecompiled(key:string, colorized = false, location?:Storage.Location) {
        // try to find pointer at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(key))) {
            if (loc==undefined) continue;
            const val = await this.getItemDecompiledFromLocation(key, colorized, loc);
            if (val !== NOT_EXISTING) return val;
        }
        return NOT_EXISTING;
    }

    public static async getItemDecompiledFromLocation(key:string, colorized = false, location:Storage.Location) {
        // get from datex_storage
        if (location == Storage.Location.INDEXED_DB) { 
            const buffer = <ArrayBuffer><any>await datex_item_storage.getItem(key);
            if (buffer != null) return MessageLogger.decompile(buffer, false, colorized);
        }

        // get from local storage
        else if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            const base64 = localStorage.getItem(this.item_prefix+key);
            if (base64!=null) return MessageLogger.decompile(base64ToArrayBuffer(base64), false, colorized);
        }
        return NOT_EXISTING;
    }

    public static async getItemKeys(location?:Storage.Location){

        const indexedDBKeys = (location == undefined || location == Storage.Location.INDEXED_DB) ? await datex_item_storage.keys() : null;

        return (function*(){
            const used = new Set<string>();
        
            // INDEXED_DB
            if (location == undefined || location == Storage.Location.INDEXED_DB) {
                for (const key of indexedDBKeys!) {
                    if (used.has(key)) continue;
                    used.add(key);
                    yield key;
                } 
            }
    
            // FILESYSTEM_OR_LOCALSTORAGE
            if (location == undefined || location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) {
                for (const _key of Object.keys(localStorage)) {
                    if (_key.startsWith(Storage.item_prefix)) {
                        const key = _key.replace(Storage.item_prefix,"");
                        if (used.has(key)) continue;
                        used.add(key);
                        yield key;
                    }
                }
            }
        
        })()
    }


    public static async getItemKeysStartingWith(prefix:string, location?:Storage.Location) {
        const keyIterator = await Storage.getItemKeys(location);
        return (function*(){
            for (const key of keyIterator) {
                if (key.startsWith(prefix)) yield key;
            }
        })()
    }

    public static async getPointerKeys(location?:Storage.Location){

        // TODO: return which keys, if location undefined?
        if (location == undefined || location == Storage.Location.INDEXED_DB) return await datex_pointer_storage.keys();

        if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            const keys = []
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith(this.pointer_prefix)) keys.push(key.replace(this.pointer_prefix,""))
            }
            return keys;
        }
         
    }

    private static async copyStorage(from:Storage.Location, to:Storage.Location) {

        await this.clear(to);

        const promises = [];
        
        for (const pointer_id of await this.getPointerKeys(from)) {
            if (from == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE && to == Storage.Location.INDEXED_DB) {
                const base64 = <string>localStorage.getItem(this.pointer_prefix+pointer_id);
                promises.push(datex_pointer_storage.setItem(pointer_id, <any>base64ToArrayBuffer(base64)))
            }
            else {
                logger.error("TODO storage copy")
            }
        }

        for (const key of await this.getItemKeys(from)) {
            if (from == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE && to == Storage.Location.INDEXED_DB) {
                const base64 = <string>localStorage.getItem(this.item_prefix+key);
                promises.push(datex_item_storage.setItem(key, <any>base64ToArrayBuffer(base64)))
            }
            else {
                logger.error("TODO storage copy")
            }
        }

        await Promise.all(promises);
    }

    public static async getItem(key:string, location?:Storage.Location|undefined/* = this.#primary_location*/):Promise<any> {

        if (this.#dirty) {
            displayFatalError('storage-unrecoverable');
            throw new Error(`cannot restore dirty state of ${Storage.Location[this.#primary_location!]}, no trusted secondary storage location found`)
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


    public static async getItemFromLocation(key:string, location:Storage.Location/* = this.#primary_location*/):Promise<any> {

        // get from db storage
        if (location == Storage.Location.INDEXED_DB) { 
            const buffer = <ArrayBuffer><any>await datex_item_storage.getItem(key);
            if (buffer != null) {
                const val = await Runtime.decodeValue(buffer);
                Storage.cache.set(key, val);
                await this.initPrimaryFromTrustedLocation(key, Storage.Location.INDEXED_DB)
                return val;
            }
        }

        // get from local storage
        else if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            const base64 = localStorage.getItem(this.item_prefix+key);
            if (base64!=null) {
                const val = await Runtime.decodeValueBase64(base64);
                Storage.cache.set(key, val);
                await this.initPrimaryFromTrustedLocation(key, Storage.Location.INDEXED_DB)
                return val;
            }
        }

        return NOT_EXISTING;
    }

    
    public static async hasItem(key:string, location?:Storage.Location):Promise<boolean> {

        if (Storage.cache.has(key)) return true; // get from cache
 
        // try to find item at a storage location
        for (const loc of (location!=undefined ? [location] : this.getLocationPriorityOrder(key))) {
            if (loc==undefined) continue;
            const val = await this.hasItemFromLocation(key, loc);
            if (val) return true;
        }

        return false;
    }

    public static async hasItemFromLocation(key:string, location:Storage.Location):Promise<boolean> {
        // get from datex_storage
        if (location == Storage.Location.INDEXED_DB) { 
            return (await datex_item_storage.getItem(key) != null)
        }

        // get from local storage
        else if (location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            return localStorage.getItem(this.item_prefix+key) != null
        }

        return false;
    }

    public static async removeItem(key:string, location?:Storage.Location):Promise<void> {
        if (Storage.cache.has(key)) Storage.cache.delete(key); // delete from cache

        if (location == undefined || location == Storage.Location.INDEXED_DB) { 
            await datex_item_storage.removeItem(key) // delete from db storage
        }

        if (location == undefined || location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            await localStorage.removeItem(this.item_prefix+key) // delete from local storage
        }
        
    }

    public static clearAll(){
        return this.clear()
    }

    // clear all storages
    public static async clear(location?:Storage.Location):Promise<void> {

        if (location == undefined || location == Storage.Location.INDEXED_DB) {
            this.deleteSaveTime(Storage.Location.INDEXED_DB);
            this.clearDirtyState(Storage.Location.INDEXED_DB)
            await datex_item_storage?.clear();
            await datex_pointer_storage?.clear();
        }

        if (location == undefined || location == Storage.Location.FILESYSTEM_OR_LOCALSTORAGE) { 
            this.deleteSaveTime(Storage.Location.FILESYSTEM_OR_LOCALSTORAGE);
            this.clearDirtyState(Storage.Location.FILESYSTEM_OR_LOCALSTORAGE)
            for (const key of Object.keys(localStorage)) {
                if (key.startsWith(this.item_prefix) || key.startsWith(this.pointer_prefix)) localStorage.removeItem(key);
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

    export enum Location {
        INDEXED_DB, // use IndexedDb, async
        FILESYSTEM_OR_LOCALSTORAGE // use localStorage, filesystem, sync
    }
}

// TODO: convert to static block (saFrari) --------------------------------------
// @ts-ignore NO_INIT
if (!globalThis.NO_INIT) {
    Storage.determineTrustedLocation();
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


// default storage config:

// @ts-ignore NO_INIT
if (!globalThis.NO_INIT) {
    await Storage.addLocation(Storage.Location.INDEXED_DB, {
        modes: [Storage.Mode.SAVE_ON_CHANGE, Storage.Mode.SAVE_PERIODICALLY],
        primary: true
    })
    
    await Storage.addLocation(Storage.Location.FILESYSTEM_OR_LOCALSTORAGE, {
        modes: [Storage.Mode.SAVE_ON_EXIT],
    })
}