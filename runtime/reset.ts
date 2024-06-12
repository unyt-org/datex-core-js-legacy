import type { Storage } from "../storage/storage.ts";


/**
 * called from Storage.ts to inject Storage (prevent circular dependency)
 * TODO: better solution
 */
let _Storage: typeof Storage|undefined = undefined;
export function setStorage(storage: typeof Storage) {
    _Storage = storage;
}


export const reset = () => {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.document?.cookie.split(";")
        .forEach((c) => {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
    return _Storage!.clearAndReload();
}

// @ts-ignore $
globalThis.reset = reset;