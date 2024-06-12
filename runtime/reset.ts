import { Storage } from "../storage/storage.ts";
export const reset = () => {
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
    globalThis.document?.cookie.split(";")
        .forEach((c) => {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
        });
    return Storage.clearAndReload();
}

// @ts-ignore $
globalThis.reset = reset;