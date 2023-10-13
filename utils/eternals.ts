import { NOT_EXISTING } from "../runtime/constants.ts";
import { Storage } from "../runtime/storage.ts";
import { getCallerInfo } from "./caller_metadata.ts";
import { logger } from "./global_values.ts";

export let eternals:Map<string,unknown>;
export const waitingEternals = new Map<string,string>();
export const waitingLazyEternals = new Map<string,string>();

export async function loadEternalValues(){
    eternals = await Storage.loadOrCreate("eternals", ()=>new Map<string,unknown>());
    // console.log("eternal",eternals,Pointer.getByValue(eternals)?.idString())
}

export async function clearEternalValues() {
    eternals.clear();
    await Storage.clearAll();
}


// get a stored eternal value from a caller location
export function getEternal(info?:ReturnType<typeof getCallerInfo>, customIdentifier?:string, return_not_existing = false) {
    info ??= getCallerInfo();
    if (!info) throw new Error("eternal values are not supported in this runtime environment");
    const line = info[0]

    if (!line.file) logger.error("eternal values are only supported inside module files");

    const unique_row = `${line.file}:${line.row}`;
    const key = customIdentifier!=undefined ? `${line.file}#${customIdentifier}` : `${unique_row}:${line.col}`; // use file location or customIdentifier as key

    if (!eternals.has(key)) {
        waitingEternals.set(unique_row, key); // assign next pointer to this eternal
        setTimeout(()=>{
            if (waitingEternals.has(unique_row)) logger.error(`uncaptured eternal value at ${unique_row}: please surround the value with $$(), otherwise it cannot be restored correctly`)
        }, 6000)
        if (return_not_existing) return NOT_EXISTING
    }
    else return eternals.get(key)
}

export async function getLazyEternal(info?:ReturnType<typeof getCallerInfo>, customIdentifier?:string, return_not_existing = false) {
    info ??= getCallerInfo();
    if (!info) throw new Error("eternal values are not supported in this runtime environment");
    const line = info[0]

    if (!line.file) logger.error("eternal values are only supported inside module files");

    const unique_row = `${line.file}:${line.row}`;
    const key = customIdentifier!=undefined ? `${line.file}#${customIdentifier}` : `${unique_row}:${line.col}`; // use file location or customIdentifier as key
    
    if (!await Storage.hasItem(key)) {
        waitingLazyEternals.set(unique_row, key); // assign next pointer to this eternal
        setTimeout(()=>{
            if (waitingLazyEternals.has(unique_row)) logger.error(`uncaptured lazy_eternal value at ${unique_row}: please surround the value with $$(), otherwise it cannot be restored correctly`)
        }, 6000)
        if (return_not_existing) return NOT_EXISTING
    }
    else return Storage.getItem(key);
}


// TODO: remove eternal
Object.defineProperty(globalThis, 'eternal', {get:getEternal, configurable:false})

Object.defineProperty(globalThis, 'lazyEternal', {get:getLazyEternal, configurable:false})

Object.defineProperty(globalThis, 'eternalVar', {value:(customIdentifier:string)=>getEternal(getCallerInfo(), customIdentifier), configurable:false})
Object.defineProperty(globalThis, 'lazyEternalVar', {value:(customIdentifier:string)=>getLazyEternal(getCallerInfo(), customIdentifier), configurable:false})