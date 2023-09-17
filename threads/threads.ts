import { Logger } from "../utils/logger.ts";
import "./worker-com-interface.ts";

const logger = new Logger("thread-runner");

import { Datex, f } from "../datex.ts";
import { blobifyFile, blobifyScript } from "../utils/blobify.ts";
import { RuntimeError } from "unyt_core/types/errors.ts";

type Promisify<imports extends Record<string, unknown>> = {
	[key in keyof imports]: imports[key] extends ((...args: infer args) => infer returnType) ? ((...args: args) => Promise<returnType>) : imports[key]
}

export type MessageToWorker = 
	{type: "INIT", datexURL: string, comInterfaceURL: string, moduleURL: string, tsInterfaceGeneratorURL:string, endpoint: URL}

export type MessageFromWorker = 
	{type: "INITIALIZED", endpoint: string, remoteModule: string} |
	{type: "ERROR", error: string}

export type ThreadModule = Record<string, unknown>

class IdleThread {}
const workerBlobUrl = await blobifyFile(new URL("./thread-worker.ts", import.meta.url))
const threadWorkers = new WeakMap<ThreadModule, Worker|null>()

/**
 * Dispose a thread by terminating the worker
 * @param threads 
 */
export function disposeThread(...threads:ThreadModule[]) {
	for (const thread of threads) {
		if (!threadWorkers.has(thread)) throw new Error("Not a thread module");
		const worker = threadWorkers.get(thread);
		if (!worker) {
			throw new Error("Thread has already been disposed")
		}
		else {
			worker.terminate();
			threadWorkers.set(thread, null);
		}
	}
}

/**
 * Spawn multiple worker threads
 * @param modulePath JS/TS module path to load in the thread
 * @param count number of threads
 * @returns module exports from the thread
 */
export function spawnThreads<imports extends ThreadModule>(modulePath: string|URL, count = 1): Promise<Promisify<imports>[]> {
	const promises:Promise<Promisify<imports>>[] = new Array(count).fill(null).map(() => spawnThread(modulePath));
	return Promise.all(promises)
}


/**
 * Spawn a new worker thread.
 * 
 * Example:
 * ```ts
 * /// file: thread.ts
 * export function exportedFunction(x: number, y:nuumber) {
 * 	return x + y
 * }
 * export const exportedValue = $$([1,2,3]);
 * 
 * /// file: main.ts
 * using thread = await spawnThread<typeof import('./thread.ts')>('./thread.ts');
 * // access exported values:
 * const res = await thread.exportedFunction(1,2);
 * thread.exportedValue.push(4);
 * ```
 * 
 * @param modulePath JS/TS module path to load in the thread
 * @returns module exports from the thread
 */
export async function spawnThread<imports extends ThreadModule>(modulePath: string|URL): Promise<Promisify<imports>>
/**
 * Spawn a new idle worker thread
 * @returns an empty thread object
 */
export async function spawnThread<imports extends ThreadModule>(modulePath: string|URL): Promise<Record<string,never>>
export async function spawnThread<imports extends ThreadModule>(modulePath?: string|URL): Promise<Promisify<imports>> {
	if (modulePath) logger.debug("spawning new thread: " + modulePath)
	else logger.debug("spawning new empty thread")

	// make sure supranet is initialized (not connected)
	if (!Datex.Supranet.initialized) await Datex.Supranet.init()
	

	const worker: Worker & {postMessage:(message:MessageToWorker)=>void} = new Worker(workerBlobUrl, {type: "module"});
	worker.onerror = (e)=>console.error(e)


	// init worker endpoint
	worker.postMessage({
		type: "INIT",
		datexURL: import.meta.resolve("../datex.ts"),
		comInterfaceURL: import.meta.resolve("./worker-com-interface.ts"),
		tsInterfaceGeneratorURL: import.meta.resolve("../utils/interface-generator.ts"),
		moduleURL: modulePath ? import.meta.resolve(modulePath.toString()): null,
		endpoint: Datex.Runtime.endpoint.toString()
	});

	let resolve: Function;
	let reject: Function
	const promise = new Promise<any>((res, rej)=>{
		resolve = res;
		reject = rej;
	})

	worker.addEventListener("message", async (event) => {
		const data = event.data as MessageFromWorker;

		if (data.type == "ERROR") {
			logger.error("thread worker error:", data.error);
			reject(data.error);
		}
		else if (data.type == "INITIALIZED") {
			const endpoint = f(data.endpoint as any)

			// connect directly via worker com interface
			logger.debug("connecting via worker com interface to " + data.endpoint);
			const connected = await Datex.InterfaceManager.connect("worker", endpoint, [worker])
			if (!connected) {
				reject(new Error("Could not connect via worker com interface"));
				return;
			} 

			// load remote module (pointers)
			if (data.remoteModule) {
				const remoteModuleURL = blobifyScript(data.remoteModule);
				const remoteModule = await import(remoteModuleURL);
				const moduleProxy = new Proxy(remoteModule, {
					get(target, p) {
						if (!threadWorkers.get(moduleProxy))
							throw new Error("Thread has already been disposed")
						// @ts-ignore TODO: remove when Symbol.dispose is supported
						else if (p == (Symbol.dispose??{})) {
							return () => disposeThread(moduleProxy)
						}
						else return target[p];
					},
				})
	
				threadWorkers.set(moduleProxy, worker)
				resolve(moduleProxy)
			}
			// just return an empty thread
			else {
				const idleThread = Object.freeze(new IdleThread());
				threadWorkers.set(idleThread, worker)
				resolve(idleThread)
			}
			
		}
	});
	return promise;
}


/**
 * Run a function in a separate thread and return the result.
 * 
 * Example:
 * ```ts
 * const token = "sm34ihncsdfn23kndovae";
 * const sharedArray = $$([1,2,3]);
 * const res = await runInThread(() => {
 *   sharedArray.push(4);
 *   return btoa(token);
 * }, {token, sharedArray})
 * ```
 * 
 * @param task function that is executed on the thread
 * @param args input arguments for the function that are passed on to the execution thread
 * @param thread optional existing thread to use for execution
 * @returns 
 */
export async function runInThread<ReturnType, Args extends unknown[]>(task: () => ReturnType, args?:Record<string,unknown>, thread?: ThreadModule): Promise<ReturnType>
/**
 * Run a DATEX script in a separate thread and return the result.
 * 
 * Example:
 * ```ts
 * const number = 10;
 * const sharedArray = $$([1,2,3]);
 * const res = await runInThread `
 * 	${sharedArray} += 4;
 * 	number * 10;
 * `
 * ```
 * 
 * @param task DATEX script that is executed on the thread
 * @returns 
 */
export async function runInThread<ReturnType=unknown>(task:TemplateStringsArray, ...args:unknown[]):Promise<ReturnType>

export async function runInThread<ReturnType, Args extends unknown[]>(task: ((...args:Args[]) => ReturnType)|TemplateStringsArray, args:any, thread?: any, ...rest:any): Promise<ReturnType> {
	
	if (thread) throw "TODO: handle existing thread"

	let moduleSource = ""

	// DATEX Script
	if (task instanceof Array) {
		const args = [...arguments].slice(1);
		for (const [name, val] of Object.entries(args)) {
			moduleSource += `const x${name} = await datex(\`${Datex.Runtime.valueToDatexStringExperimental(val)}\`)\n`;	
		}
		moduleSource += 'export const task = () => datex' + ' `'
		let i = 0;
		for (const section of task) {
			moduleSource += section;
			if (i in args) moduleSource += '${x'+i+'}'
			i++;
		}
		moduleSource += '`;'
		
	}

	// JS Function
	else if (task instanceof Function) {
		for (const [name, val] of Object.entries(args??{})) {
			moduleSource += `const ${name} = await datex(\`${Datex.Runtime.valueToDatexStringExperimental(val)}\`)\n`;	
		}
		moduleSource += 'export const task = ' + task.toString() + ';\n';
	}

	else throw new Error("task must be a function or template string");
	
	const functionScriptURL = blobifyScript(moduleSource);
	thread ??= await spawnThread(functionScriptURL);

	try {
		const task = (thread["task"] as (...args:unknown[]) => Promise<ReturnType>);
		(task as any).datex_timeout = Infinity;
		const res = await task(...(args instanceof Array ? args : []));
		return res;
	}
	catch (e) {
		if (e.message == "TypeError - Assignment to constant variable.") {
			throw new RuntimeError("runInThread: Variables from the parent scope cannot be reassigned. Use pointers if you want to update values.")
		}
		else if (e.message == "ReferenceError - token is not defined") {
			const variableName = e.message.match(/ReferenceError - (\S*)/)[1];
			throw new RuntimeError("runInThread: Variable '"+variableName+"' from the parent scope is not included in the dependencies object.")
		}
		else if (e instanceof Error) {
			throw new Error(e.message);
		}
		else throw e;
	}
	finally {
		disposeThread(thread);
		if (functionScriptURL) URL.revokeObjectURL(functionScriptURL)
	}
}