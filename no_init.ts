/**
 * Special entrypoint that initializes Runtime with minimal
 * initalization by setting the global NO_INIT flag.
 * Does not work when bundling.
 * (TODO: refactor)
 */

globalThis.NO_INIT = true;
const dx = await import("./mod.ts");
export const Datex = dx.Datex;
export const datex = dx.datex;

await dx.init()