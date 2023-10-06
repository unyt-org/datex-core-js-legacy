// @ts-ignore
const is_worker = (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope);
export const client_type = is_worker ? 'worker' : ("Deno" in globalThis && !(globalThis.Deno as any).isPolyfill ? 'deno' : 'browser')