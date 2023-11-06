import { callWithMetadata, callWithMetadataAsync, getMeta } from "../utils/caller_metadata.ts";
import { RuntimeError } from "./errors.ts";

const EXTRACT_USED_VARS = Symbol("EXTRACT_USED_VARS")

/**
 * Used to declare all variables from the parent scope that are used inside the current function.
 * This is required for functions that are transferred to a different context or restored from eternal pointers.
 * 
 * Example:
 * 
 * ```ts
 * const x = $$(10);
 * 
 * const fn = eternal ?? $$(function() {
 *  use (x)
 *  
 *  x.val++
 *  console.log("x:" + x)
 * })
 * ```
 * @param variables 
 */
export function use(noDatex: 'no-datex', ...variables: unknown[]): true 
/**
 * Used to declare all variables from the parent scope that are used inside the current function.
 * This is required for functions that are transferred to a different context or restored from eternal pointers.
 * 
 * Example:
 * 
 * ```ts
 * const x = $$(10);
 * 
 * const fn = eternal ?? $$(function() {
 *  use (x)
 *  
 *  x.val++
 *  console.log("x:" + x)
 * })
 * ```
 * @param variables 
 */
export function use(...variables: unknown[]): true
export function use(...variables: unknown[]): true {
    if (getMeta()?.[EXTRACT_USED_VARS]) {
        (variables as any)[EXTRACT_USED_VARS] = true;
        throw variables;
    }
    return true;
}

type _use = typeof use;

// @ts-ignore global
globalThis.use = use;
declare global {
    const use: _use
}

function getUsedVars(fn: (...args:unknown[])=>unknown) {
    const source = fn.toString();
    const usedVarsSource = source.match(/^(?:(?:[\w\s*])+\(.*\)\s*{|\(.*\)\s*=>\s*{?|.*\s*=>\s*{?)\s*use\s*\(([\s\S]*?)\)/)?.[1]
    if (!usedVarsSource) return {};

    const usedVars = usedVarsSource.split(",").map(v=>v.trim()).filter(v=>!!v)
    const flags = []
    for (const usedVar of usedVars) {
        if (usedVar == `"no-datex"` || usedVar == `'no-datex'`) flags.push("no-datex");
        else if (!usedVar.match(/^[a-zA-Z_$][0-9a-zA-Z_$\u0080-\uFFFF]*$/)) throw new RuntimeError("Unexpected identifier in 'use' declaration: '" + usedVar+ "' - only variable names are allowed.");
    }
    if (flags.length) usedVars.splice(0, flags.length); // remove flags
    return {usedVars, flags};
}


export function getDeclaredExternalVariables(fn: (...args:unknown[])=>unknown) {
    const {usedVars, flags} = getUsedVars(fn);
    if (!usedVars) return {vars:{}}

    // call the function with EXTRACT_USED_VARS metadata
    try {
        callWithMetadata({[EXTRACT_USED_VARS]: true}, fn as any)
    }
    catch (e) {
        // capture returned variables from use()
        if (e instanceof Array && (e as any)[EXTRACT_USED_VARS]) {
            if (flags.length) e.splice(0, flags.length); // remove flags
            return {vars: Object.fromEntries(usedVars.map((v,i)=>[v, e[i]])), flags}
        }
        // otherwise, throw normal error
        else throw e;
    }
    return {vars:{}};
}

export async function getDeclaredExternalVariablesAsync(fn: (...args:unknown[])=>Promise<unknown>) {
    const {usedVars, flags} = getUsedVars(fn);
    if (!usedVars) return {vars:{}}

    // call the function with EXTRACT_USED_VARS metadata
    try {
        await callWithMetadataAsync({[EXTRACT_USED_VARS]: true}, fn as any)
    }
    catch (e) {
        // capture returned variables from use()
        if (e instanceof Array && (e as any)[EXTRACT_USED_VARS]) {
            if (flags.length) e.splice(0, flags.length); // remove flags
            return {vars: Object.fromEntries(usedVars.map((v,i)=>[v, e[i]])), flags}
        }
        // otherwise, throw normal error
        else throw e;
    }
    return {vars:{}};
}

export function getSourceWithoutUsingDeclaration(fn: (...args:unknown[])=>unknown) {
    return fn
        .toString()
        .replace(/(?<=(?:(?:[\w\s*])+\(.*\)\s*{|\(.*\)\s*=>\s*{?|.*\s*=>\s*{?)\s*)(use\s*\((?:[\s\S]*?)\))/, 'true /*$1*/')
}
 

/**
 * Create a new function from JS source code with injected dependency variables
 * @param source 
 * @param dependencies 
 * @returns 
 */
export function createFunctionWithDependencyInjections(source: string, dependencies: Record<string, unknown>): ((...args:unknown[]) => unknown) {
	const hasThis = Object.keys(dependencies).includes('this');
    const renamedVars = Object.keys(dependencies).filter(d => d!=='this').map(k=>'_'+k);
    const varMapping = renamedVars.map(k=>`const ${k.slice(1)} = createStaticObject(${k});`).join("\n");

    const createStaticFn = `function createStaticObject(val) {
        if (val && typeof val == "object" && !globalThis.Datex?.Ref.isRef(val)) {
            for (const key of Object.keys(val)) val[key] = createStaticObject(val[key]);
            Object.freeze(val);
        }
        return val;
    };`

    let creatorFn = new Function(...renamedVars, `"use strict";${varMapping?createStaticFn:''}${varMapping}; return (${source})`)
    if (hasThis) creatorFn = creatorFn.bind(dependencies['this'])
    return creatorFn(...Object.values(dependencies));
}

export class ExtensibleFunction {
    constructor(f:globalThis.Function) {
        return Object.setPrototypeOf(f, new.target.prototype);
    }
}

export interface Callable<args extends any[], return_type> {
    (...args:args): return_type;
}