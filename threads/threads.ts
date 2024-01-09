import { Logger } from "../utils/logger.ts";
import "./worker-com-interface.ts";
import { Equals } from "../utils/global_types.ts";

const logger = new Logger("thread-runner");

import { Datex, f } from "../mod.ts";
import { blobifyFile, blobifyScript } from "../utils/blobify.ts";
import { RuntimeError } from "../types/errors.ts";
import { Path } from "https://dev.cdn.unyt.org/uix/utils/path.ts";
import { getCallerDir } from "../utils/caller_metadata.ts";
import { PromiseMapReturnType, PromiseMappingFn } from "./promise-fn-types.ts";
import { JSTransferableFunction } from "../types/js-function.ts";

export type ThreadModule<imports extends Record<string, unknown> = Record<string, unknown>> = {
	[key in keyof imports]: imports[key] extends ((...args: infer args) => infer returnType) ? ((...args: args) => Promise<returnType>) : imports[key]
} & {readonly __tag: unique symbol} & {[Symbol.dispose]: ()=>void}


export type ThreadPool<imports extends Record<string, unknown> = Record<string, unknown>> = ThreadModule<imports>[] 
	& {readonly __tag: unique symbol} & {[Symbol.dispose]: ()=>void}

export type MessageToWorker = 
	{type: "INIT", datexURL: string, comInterfaceURL: string, moduleURL: string, tsInterfaceGeneratorURL:string, endpoint: string, importMap:Record<string,any>} |
	{type: "INIT_PORT"}

export type MessageFromWorker = 
	{type: "INITIALIZED", endpoint: string, remoteModule: string} |
	{type: "ERROR", error: string}


class IdleThread {}
const workerBlobUrl = await blobifyFile(new URL("./thread-worker.ts", import.meta.url))
const threadWorkers = new WeakMap<ThreadModule, Worker|ServiceWorkerRegistration|null>()

type threadOptions = {signal?: AbortSignal}

// default import map
let importMap:{"imports":Record<string,string>} = {
    "imports": {
        "unyt/": "https://dev.cdn.unyt.org/",
        "unyt_core": "https://dev.cdn.unyt.org/unyt_core/datex.ts",
        "uix": "./uix.ts",
        "unyt_core/": "https://dev.cdn.unyt.org/unyt_core/",
        "datex-core-legacy/": "https://dev.cdn.unyt.org/unyt_core/",
        "uix/": "./",
        "uix_std/": "./uix_std/",
        "unyt_tests/": "https://dev.cdn.unyt.org/unyt_tests/",
        "unyt_web/": "https://dev.cdn.unyt.org/unyt_web/",
        "unyt_node/": "https://dev.cdn.unyt.org/unyt_node/",
        "unyt_cli/": "https://dev.cdn.unyt.org/unyt_cli/",
        "uix/jsx-runtime": "./jsx-runtime/jsx.ts"
    }
};

export function setImportMap(json: {"imports":Record<string,string>}) {
	logger.debug("updated default thread import map", json)
	importMap = json;
}

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
			// service worker
			if ('active' in worker) worker.unregister()
			else worker.terminate();
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
export async function spawnThreads<imports extends Record<string,unknown>>(modulePath: string|URL, count = 1): Promise<ThreadPool<imports>> {
	// normalize module path
	if (modulePath && !Path.pathIsURL(modulePath)) modulePath = new Path(modulePath, getCallerDir());

	const promises:Promise<ThreadModule<imports>>[] = new Array(count).fill(null).map(() => spawnThread(modulePath));
	const pool = await Promise.all(promises) as unknown as ThreadPool<imports>;
	pool[Symbol.dispose||Symbol.for("Symbol.dispose")] = () => disposeThread(...pool)
	return pool;
}


async function registerServiceWorker(path:string|URL) {
	if ('serviceWorker' in navigator) {
		// find existing registration
		const registrations = await navigator.serviceWorker.getRegistrations();

		for (const registration of registrations) {
			if (registration.active?.scriptURL.toString() === path.toString()) {
				logger.debug("Service Worker for "+ path +" already registered");
				return registration
			}
		}

		// register new
		try {
			const registration = await navigator.serviceWorker.register(path);
			logger.success("Service Worker registered");
			return registration;
		}
		catch (e) {
			logger.error("Error installing Service Worker: ?"+  e)
			return null;
		}
	}
	else return null;
}


/**
 * TODO: does not work yet because import() is not allowed in sw
 * Get a service worker thread - creates a new service worker if not yet registered.
 * 
 * Example:
 * ```ts
 * /// file: sw.ts
 * export function exportedFunction(x: number, y:nuumber) {
 * 	return x + y
 * }
 * export const exportedValue = $$([1,2,3]);
 * 
 * /// file: main.ts
 * using thread = await getServiceWorkerThread<typeof import('./sw.ts')>('./sw.ts');
 * // access exported values:
 * const res = await thread.exportedFunction(1,2);
 * thread.exportedValue.push(4);
 * ```
 * 
 * @param serviceWorkerInitUrl JS/TS module path used to start the service worker - must contain the content of ./thread-worker.ts and must be accessible by the origin
 * @param modulePath JS/TS module path to load in the service worker thread
 * @returns module exports from the thread
 */
export async function getServiceWorkerThread<imports extends Record<string,unknown>>(modulePath: string|URL, serviceWorkerInitUrl: string|URL): Promise<ThreadModule<imports>>
/**
 * Get the service worker thread (idle)
 * @returns an empty thread object
 */
export async function getServiceWorkerThread<imports extends Record<string,unknown>>(modulePath: null, serviceWorkerInitUrl: string|URL): Promise<ThreadModule<Record<string,never>>>
export async function getServiceWorkerThread<imports extends Record<string,unknown>>(modulePath: string|URL|null|undefined, serviceWorkerInitUrl: string|URL): Promise<ThreadModule<imports>> {
	// normalize module path
	if (modulePath && !Path.pathIsURL(modulePath)) modulePath = new Path(modulePath, getCallerDir());
	if (serviceWorkerInitUrl && !Path.pathIsURL(serviceWorkerInitUrl)) serviceWorkerInitUrl = new Path(serviceWorkerInitUrl, getCallerDir());

	// make sure supranet is initialized (not connected)
	if (!Datex.Supranet.initialized) await Datex.Supranet.init()
	
	if (modulePath) logger.debug("spawning new service worker thread: " + modulePath)
	else logger.debug("spawning new empty service worker thread")

	// create service worker (cannot use workerBlobURL because auf service worker restrictions)
	const swRegistration = await registerServiceWorker(serviceWorkerInitUrl);
	if (!swRegistration) throw new Error("Could not get service worker");

	return _initWorker(swRegistration, modulePath);
}


const availableThreads = new Set<ThreadModule>()
// TODO: use for run()
/**
 * spawns a new thread or returns an existing thread from the pool
 */
async function getThread() {
	if (!availableThreads.size) {
		const thread = await spawnThread(null);
		availableThreads.add(thread);
		return thread;
	}
	console.log("using existing thread",availableThreads.values().next().value)
	return availableThreads.values().next().value;
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
export async function spawnThread<imports extends Record<string,unknown>>(modulePath: string|URL, options?: threadOptions): Promise<ThreadModule<imports>>
/**
 * Spawn a new idle worker thread
 * @returns an empty thread object
 */
export async function spawnThread<imports extends Record<string,unknown>>(modulePath?:null, options?: threadOptions): Promise<ThreadModule<Record<string,never>>>
export async function spawnThread<imports extends Record<string,unknown>>(modulePath?: string|URL|null, options?: threadOptions): Promise<ThreadModule<imports>> {

	// normalize module path
	if (modulePath && !Path.pathIsURL(modulePath)) modulePath = new Path(modulePath, getCallerDir());
	// make sure supranet is initialized (not connected)
	if (!Datex.Supranet.initialized) await Datex.Supranet.init()

	if (options?.signal?.aborted) throw new Error("aborted");
	
	if (modulePath) logger.debug("spawning new thread: " + modulePath)
	else logger.debug("spawning new empty thread")

	// create worker
	const worker: Worker & {postMessage:(message:MessageToWorker)=>void} = new Worker(workerBlobUrl, {type: "module"});
	worker.onerror = (e)=>console.error(e)

	const thread = await _initWorker(worker, modulePath, options);

	options?.signal?.addEventListener("abort", () => {
		// only dispose if not already finished
		if (threadWorkers.get(thread)) disposeThread(thread);
	})

	return thread;
}


function awaitServiceWorkerActive(registration: ServiceWorkerRegistration) {
	// already active
	if (registration.active) return;
	// wait until active
	return new Promise<void>(resolve => {
		if (registration.waiting) 
			registration.waiting.addEventListener('statechange', () => {if (registration.active) resolve()});
		  
		if (registration.installing)
			registration.installing.addEventListener('statechange', () => {if (registration.active) resolve()});
		  
		if (registration.active)
			registration.active.addEventListener('statechange', () => {if (registration.active) resolve()});
		  
	})
}
  


/**
 * Initializes a worker/service worker with a custom module
 * TODO: service worker does not work yet because import() is not allowed in sw
 * Important: The worker/service worker must have been initialized with the content of ./thread-worker.ts
 * @param worker 
 * @param modulePath 
 * @returns 
 */
export async function _initWorker(worker: Worker|ServiceWorkerRegistration, modulePath?: string|URL|null, options?: threadOptions) {

	const isServiceWorker = worker instanceof ServiceWorkerRegistration

	// wait until sw active
	if (isServiceWorker) {
		await awaitServiceWorkerActive(worker)
		if (options?.signal?.aborted) throw new Error("aborted");
	}

	const workerTarget = isServiceWorker ? worker.active! : worker;
	if (workerTarget == null) throw new Error("Worker is null");

	let messageSource:EventTarget = worker;


	// for sw: use message channel
	if (isServiceWorker) {
		const messageChannel = new MessageChannel();
		messageSource = messageChannel.port1;
		workerTarget.postMessage({type: 'INIT_PORT'}, [messageChannel.port2]);
	}


	workerTarget.postMessage(<MessageToWorker>{
		type: "INIT",
		importMap: importMap,
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

	const checkAborted = () => {
		if (options?.signal?.aborted) {
			if (worker instanceof Worker) worker.terminate();
			reject(new Error("aborted"));
		}
	}

	messageSource.addEventListener("message", async (event) => {

		checkAborted();

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
			checkAborted();
			if (!connected) {
				reject(new Error("Could not connect via worker com interface"));
				return;
			} 

			// load remote module (pointers)
			if (data.remoteModule) {
				const remoteModuleURL = blobifyScript(data.remoteModule);
				const remoteModule = await import(remoteModuleURL);
				checkAborted();

				// make sure function calls don't time out
				for (const value of Object.values(remoteModule)) {
					if (typeof value == "function") {
						(value as any).datex_timeout = Infinity;
					}
				}

				const moduleProxy = new Proxy(remoteModule, {
					get(target, p) {
						if (!threadWorkers.get(moduleProxy))
							throw new Error("Thread has already been disposed")
						// @ts-ignore TODO: remove when Symbol.dispose is supported
						else if (p == Symbol.dispose || p == Symbol.for("Symbol.dispose")) {
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
				const idleThread = Object.freeze(new IdleThread() as ThreadModule);
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
 * 
 * const res = await run(() => {
 *   use (token, sharedArray);
 *   sharedArray.push(4);
 *   return btoa(token);
 * })
 * ```
 * 
 * @param task function that is executed on the thread
 * @param args input arguments for the function that are passed on to the execution thread
 * @returns 
 */
export async function run<ReturnType, Args extends unknown[]>(task: () => ReturnType, options?: {signal?:AbortSignal}): Promise<ReturnType>
/**
 * Run a DATEX script in a separate thread and return the result.
 * 
 * Example:
 * ```ts
 * const number = 10;
 * const sharedArray = $$([1,2,3]);
 * 
 * const res = await run `
 * 	${sharedArray} += 4;
 * 	number * 10;
 * `
 * ```
 * 
 * @param task DATEX script that is executed on the thread
 * @returns 
 */
export async function run<ReturnType=unknown>(task:TemplateStringsArray, ...args:unknown[]):Promise<ReturnType>

export async function run<ReturnType>(task: (() => ReturnType)|JSTransferableFunction|TemplateStringsArray, options?: {signal?:AbortSignal}, ..._rest:any): Promise<ReturnType> {
	let moduleSource = ""
	// DATEX Script
	if (task instanceof Array) {
		const args = [...arguments].slice(1);
		for (const [name, val] of Object.entries(args)) {
			moduleSource += `const x${name} = await datex(\`${Datex.Runtime.valueToDatexStringExperimental(val).replaceAll("\\","\\\\")}\`)}\`)\n`;	
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

	// JS Function (might already be a JSTransferableFunction)
	else if (task instanceof Function || task instanceof JSTransferableFunction) {
		const transferableTaskFn = task instanceof JSTransferableFunction ? task : (
			JSTransferableFunction.functionIsAsync(task) ? 
				await JSTransferableFunction.createAsync(task) :
				JSTransferableFunction.create(task)
		)
		moduleSource += `const taskFn = $$(await datex(\`${Datex.Runtime.valueToDatexStringExperimental(transferableTaskFn).replaceAll("\\","\\\\")}\`))\n`
		moduleSource += `export const task = () => taskFn(${('_taskIndex' in options as any) ? (options as any)?._taskIndex : ''})\n`;	
	}

	else throw new Error("task must be a function or template string");
	
	const functionScriptURL = blobifyScript(moduleSource);
	const thread = await spawnThread(functionScriptURL, options);

	try {
		if (options?.signal?.aborted) {
			throw new Error("aborted");
		}
		const task = (thread["task"] as (...args:unknown[]) => Promise<ReturnType>);
		(task as any).datex_timeout = Infinity;
		const res = await task();
		return res;
	}
	catch (e) {
		if (options?.signal?.aborted) throw new Error("aborted");
 		if (e instanceof Error && e.message == "TypeError - Assignment to constant variable.") {
			throw new RuntimeError("Variables from the parent scope cannot be reassigned. Use pointers if you want to update values.")
		}
		else if (e instanceof Error && e.message.match(/ReferenceError - \S* is not defined/)) {
			const variableName = e.message.match(/ReferenceError - (\S*)/)![1];
			throw new RuntimeError("Variable '"+variableName+"' from the parent scope must be explicitly declared at the beginning of the function body with 'use ("+variableName+")'.")
		}
		else if (e instanceof Error) {
			throw new Error(e.message);
		}
		else throw e;
	}
	finally {
		// if (threadWorkers.get(thread)) disposeThread(thread);
		// if (functionScriptURL) URL.revokeObjectURL(functionScriptURL);
	}
}


type runInThreadsReturn<ReturnType, Mapping extends PromiseMappingFn = never> = Equals<Mapping, never> extends true ? Promise<ReturnType>[] : PromiseMapReturnType<ReturnType, Mapping>

/**
 * Run a function in a multiple threads in parallel and return the result of each thread.
 * 
 * Example:
 * ```ts
 * const sharedArray = $$ ([]);
 * const res = await runConcurrent(i => {
 *   use (sharedArray);
 *   sharedArray.push(i);
 *   return i;
 * }, 10)
 * ```
 * 
 * @param task function that is executed on one or more threads
 * @param instances number of threads running the task concurrently
 * @param outputMapping optional Promise function (e.g. Promise.all) to apply to the resulting promises
 * @returns 
 */
export async function runConcurrent<ReturnType, Mapping extends PromiseMappingFn = never>(task: (taskIndex?: number) => ReturnType, instances = 1, outputMapping?: Mapping): Promise<runInThreadsReturn<ReturnType, Mapping>> {
	const abortController = new AbortController()
	const result = new Array(instances).fill(null).map((_, i) => run(task, {signal:abortController.signal, _taskIndex: i}));

	if (outputMapping) {
		try {
			const res = await (outputMapping as (...args:unknown[])=>unknown).bind(Promise)(result) as runInThreadsReturn<ReturnType, Mapping>;
			return res;
		}
		finally {
			abortController.abort();
		}
	}
	else return result as runInThreadsReturn<ReturnType, Mapping>;
}