/* tslint:disable */
/* eslint-disable */
/**
*/
export function init_runtime(): void;
/**
* @param {string} datex_script
* @returns {string}
*/
export function compile(datex_script: string): string;
/**
* @param {Uint8Array} dxb
* @param {boolean} formatted
* @param {boolean} colorized
* @param {boolean} resolve_slots
* @returns {string}
*/
export function decompile(dxb: Uint8Array, formatted: boolean, colorized: boolean, resolve_slots: boolean): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly init_runtime: () => void;
  readonly compile: (a: number, b: number, c: number) => void;
  readonly decompile: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_malloc: (a: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number) => number;
  readonly __wbindgen_free: (a: number, b: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {SyncInitInput} module
*
* @returns {InitOutput}
*/
export function initSync(module: SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {InitInput | Promise<InitInput>} module_or_path
*
* @returns {Promise<InitOutput>}
*/
export default function init (module_or_path?: InitInput | Promise<InitInput>): Promise<InitOutput>;
