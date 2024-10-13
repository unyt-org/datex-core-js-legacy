import { DX_NOT_TRANSFERABLE } from "../runtime/constants.ts";
import { LazyPointer } from "../runtime/lazy-pointer.ts";
import { callWithMetadata, callWithMetadataAsync, getMeta } from "../utils/caller_metadata.ts";
import { Type } from "./type.ts";

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
 * @param flags - optional flags:
 *  - 'standalone': indicates that the function can run standalone without the datex runtime
 *  - 'silent-errors': suppresses errors when global variables are used
 *  - 'allow-globals': allows transffering global variables in the function. This only works if the variables are never actually transferred between scopes.
 * @param variables 
 */
export function use(flags: 'standalone'|'silent-errors'|'allow-globals', ...variables: unknown[]): true 
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

type Flag = 'standalone'|'silent-errors'|'allow-globals'

function getUsedVars(fn: (...args:unknown[])=>unknown) {
    const source = fn.toString();
    const usedVarsSource = source.match(/^(?:(?:[\w\s*])+\(.*?\)\s*{|\(.*?\)\s*=>\s*[{(]?|.*?\s*=>\s*[{(]?)\s*(?:return *)?use\s*\(([\s\S]*?)\)/)?.[1]
    if (!usedVarsSource) return {};

    const _usedVars = usedVarsSource.split(",").map(v=>v.trim()).filter(v=>!!v)
    const flags:Flag[] = []
    const usedVars = []
    let ignoreVarCounter = 0;
    for (const usedVar of _usedVars) {
        // TODO: support multiple flags at once
        if (usedVar == `"standalone"` || usedVar == `'standalone'`) flags.push("standalone");
        else if (usedVar == `"silent-errors"` || usedVar == `'silent-errors'`) flags.push("silent-errors");
        else if (usedVar == `"allow-globals"` || usedVar == `'allow-globals'`) flags.push("allow-globals");
        else if (!usedVar.match(/^[a-zA-Z_$][0-9a-zA-Z_$\u0080-\uFFFF]*$/)) {
            usedVars.push("#" + (ignoreVarCounter++)); // ignore variables start with #
            // TODO: only warn if not artifact from minification
            // console.warn("Unexpected identifier in 'use' declaration: '" + usedVar+ "' - only variable names are allowed.");
        }
        else usedVars.push(usedVar);
    }

    return {usedVars, flags};
}


export function getDeclaredExternalVariables(fn: (...args:unknown[])=>unknown) {
    const {usedVars, flags} = getUsedVars(fn);
    if (!usedVars) return {vars:{}}

    // call the function with EXTRACT_USED_VARS metadata
    try {
        callWithMetadata({[EXTRACT_USED_VARS]: true}, fn as any, [{}]) // TODO: provide call arguments that don't lead to a {}/[] destructuring error
    }
    catch (e) {
        return captureVariables(e, usedVars, flags);
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
        return captureVariables(e, usedVars, flags);
    }
    return {vars:{}};
}

/**
 * Whiteliste for global variables that are allowed to be
 * transferred to a different context per default.
 */
const allowedGlobalVars = new Set([
    "console",
    "alert",
    "confirm",
    "prompt",
])


function captureVariables(e: unknown, usedVars: string[], flags: Flag[]) {
    // capture returned variables from use()
    if (e instanceof Array && (e as any)[EXTRACT_USED_VARS]) {
        if (flags.length) e.splice(0, flags.length); // remove flags
        const vars = Object.fromEntries(usedVars.map((v,i)=>[v, e[i]]));

        // for each variable: remove if global variable
        if (!flags.includes("allow-globals")) {
            for (const [key, value] of Object.entries(vars)) {
                if (((key in globalThis && (globalThis as any)[key] === value) || value?.[DX_NOT_TRANSFERABLE] || value instanceof Type) && !allowedGlobalVars.has(key)) {
                    if (!flags.includes("silent-errors")) {
                        throw new Error("The global variable '"+key+"' cannot be transferred to a different context. Remove the 'use("+key+")' declaration.")
                    }
                    delete vars[key];
                }
            }
        }
        
        return {vars, flags}
    }
    // otherwise, throw normal error
    else throw e;
}


export function getSourceWithoutUsingDeclaration(fn: (...args:unknown[])=>unknown) {
    let fnSource = fn.toString();
	// object methods check if 'this' context is component context;
	if (!isNormalFunction(fnSource) && !isArrowFunction(fnSource) && isObjectMethod(fnSource)) {
        if (fnSource.startsWith("async")) fnSource = fnSource.replace("async", "async function") 
		else fnSource = "function " + fnSource
	}

    return fnSource
        .replace(/(?<=(?:(?:[\w\s*])+\(.*\)\s*{|\(.*\)\s*=>\s*{?|.*\s*=>\s*{?)\s*)(?:return *)?(use\s*\((?:[\s\S]*?)\))/, 'true /*$1*/')
}

const isObjectMethod = (fnSrc:string) => {
	return !!fnSrc.match(/^(async\s+)?[^\s(]+ *(\(|\*)/)
}
const isNormalFunction = (fnSrc:string) => {
	return !!fnSrc.match(/^(async\s+)?function(\(| |\*)/)
}
const isArrowFunction = (fnSrc:string) => {
	return !!fnSrc.match(/^(async\s*)?(\([^)]*\)|\w+)\s*=>/)
}

const isNativeFunction = (fnSrc:string) => {
    return !!fnSrc.match(/\{\s*\[native code\]\s*\}$/)
}


function resolveLazyDependencies(deps:Record<string,unknown>, resolve?: ()=>void) {
    let resolved = false;
    for (const [key, value] of Object.entries(deps)) {
        if (value instanceof LazyPointer) value.onLoad((v) => {
            deps[key] = v;
            if (!resolved && resolve && !hasUnresolvedLazyDependencies(deps)) {
                resolved = true;
                resolve();
            }
        });
    }
}

function assertLazyDependenciesResolved(deps:Record<string,unknown>) {
    for (const [key, value] of Object.entries(deps)) {
        // TODO non js-Function specific error
        if (value instanceof LazyPointer) throw new Error("Cannot call <js:Function>, dependency variable '"+key+"' is not yet initialized")
    }
}

export function hasUnresolvedLazyDependencies(deps:Record<string,unknown>) {
    for (const value of Object.values(deps)) {
        if (value instanceof LazyPointer) return true;
    }
    return false;
}

/**
 * Create a new function from JS source code with injected dependency variables
 * Also resolves LazyPointer dependencies
 * @param source 
 * @param dependencies 
 * @returns 
 */
export function createFunctionWithDependencyInjectionsResolveLazyPointers(source: string, dependencies: Record<string, unknown>, allowValueMutations = true): {intermediateFn: ((...args:unknown[]) => unknown), lazyResolved: Promise<void>} {
    let fn: Function|undefined;

    const {promise: lazyResolved, resolve} = Promise.withResolvers<void>()

    const intermediateFn = (...args:any[]) => {
        if (!fn) {
            assertLazyDependenciesResolved(dependencies);
            fn = createFunctionWithDependencyInjections(source, dependencies, allowValueMutations)
        }
        return fn(...args)
    }

    if (!hasUnresolvedLazyDependencies(dependencies)) resolve()
    else resolveLazyDependencies(dependencies, resolve);
    return {intermediateFn, lazyResolved};
}

/**
 * Create a new function from JS source code with injected dependency variables
 * @param source 
 * @param dependencies 
 * @returns 
 * @deprecated use createFunctionWithDependencyInjectionsResolveLazyPointers
 */
export function createFunctionWithDependencyInjections(source: string, dependencies: Record<string, unknown>, allowValueMutations = true): ((...args:unknown[]) => unknown) {
    const hasThis = Object.keys(dependencies).includes('this');
    let ignoreVarCounter = 0;
    const renamedVars = Object.keys(dependencies).filter(d => d!=='this').map(k => k.startsWith("#") ? '_ignore_'+(ignoreVarCounter++) : '_'+k);
    const varMapping = renamedVars.filter(v=>!v.startsWith("_ignore_")).map(k=>`const ${k.slice(1)} = ${allowValueMutations ? 'createStaticObject' : ''}(${k});`).join("\n");
    const isArrow = isArrowFunction(source);

    if (isNativeFunction(source)) {
        throw new Error("Cannot create transferable function from native function: " + source);
    }

    const createStaticFn = `
    const freezedObjects = new WeakSet();
    function createStaticObject(val) {
        if (val && typeof val == "object" && !globalThis.Datex?.ReactiveValue.isRef(val)) {
            if (freezedObjects.has(val)) return val;
            freezedObjects.add(val);    
            for (const key of Object.keys(val)) val[key] = createStaticObject(val[key]);
            Object.freeze(val);
        }
        return val;
    };`

    const creatorSource = `"use strict";\n${(varMapping&&allowValueMutations)?createStaticFn:''}\n${varMapping};\nreturn (${source})`;

    try {
        let creatorFn = new Function(...renamedVars, creatorSource)
        // arrow function without own this context - bind creatorFn to this
        if (hasThis && isArrow) creatorFn = creatorFn.bind(dependencies['this']) 
        const fn = creatorFn(...Object.entries(dependencies).filter(([d]) => d!=='this').map(([_,v]) => v));
        // normal function - bind directly to this
        if (hasThis && !isArrow) return fn.bind(dependencies['this'])
        else return fn;
    }
    catch (e) {
        console.error(creatorSource)
        throw e;
    }
    
}

export class ExtensibleFunction {
    constructor(f?:globalThis.Function) {
        if (f) return Object.setPrototypeOf(f, new.target.prototype);
    }
}

export interface Callable<args extends any[], return_type> {
    (...args:args): return_type;
}