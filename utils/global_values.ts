import {Logger} from "./logger.ts";

// node not supported
// @ts-ignore check if node environment
// TODO: fix this check, detect node
// if (!globalThis.Deno) throw new Error("node.js is currently not supported - use deno instead")

export const TypedArray:typeof Uint8Array|typeof Uint16Array|typeof Uint32Array|typeof Int8Array|typeof Int16Array|typeof Int32Array|typeof BigInt64Array|typeof BigUint64Array|typeof Float32Array|typeof Float64Array = Object.getPrototypeOf(Uint8Array);
export type TypedArray = Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|BigInt64Array|BigUint64Array|Float32Array|Float64Array;

// @ts-ignore
const is_worker = (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope);
/**
 * @deprecated, use client_type from utils/constants.ts
 */
export const client_type = is_worker ? 'worker' : ("Deno" in globalThis && !(globalThis.Deno as any).isPolyfill ? 'deno' : 'browser')

export const Deno = globalThis.Deno;

export const logger = new Logger("DATEX");

// never expose those properties to DATEX (constructor, toString, ...)
export const DEFAULT_HIDDEN_OBJECT_PROPERTIES = new Set(Object.getOwnPropertyNames(Object.prototype));



// export async function isPathDirectory(path:string){
// 	if (!lstat) throw new Error("Extended file utilities are not supported");
// 	return (await lstat(path)).isDirectory();
// }

// path of the unyt_core lib, without 'unyt_core/utils' path TODO: default fallback URL?
export const baseURL = new URL('../../', import.meta.url);
// path to lib (@dev or other suffixes included);
export const libURL = new URL('../', import.meta.url);

// path from which the script was executed (same aas baseURL in browsers)
export const cwdURL = client_type  == "deno" ? new URL('file://'+Deno.cwd()+"/") : baseURL;

export let projectRootURL = cwdURL;

/**
 * Modify the project root URL (default is the current working directory)
 * @param url 
 */
export async function _updateProjectRootURL(url:URL) {
	const { _updateCachePaths } = await import("../runtime/cache_path.ts");

	projectRootURL = url;
	await _updateCachePaths();
}
