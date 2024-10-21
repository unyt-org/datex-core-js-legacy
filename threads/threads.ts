import { Logger, console_theme } from "../utils/logger.ts";
import type { Equals } from "../utils/global_types.ts";

const logger = new Logger("thread-runner");

import { Datex, f } from "../datex.ts";
import { blobifyFile, blobifyScript } from "../utils/blobify.ts";
import { RuntimeError } from "../types/errors.ts";
import { Path } from "../utils/path.ts";
import { getCallerDir, getCallerFile } from "../utils/caller_metadata.ts";
import { PromiseMapReturnType, PromiseMappingFn } from "./promise-fn-types.ts";
import { JSTransferableFunction } from "../types/js-function.ts";
import { INSERT_MARK } from "../compiler/compiler.ts";
import { ComputeCluster } from "./compute-clusters.ts";
import { communicationHub } from "../network/communication-hub.ts";
import { WorkerInterface } from "../network/communication-interfaces/worker-interface.ts";
import { EndpointConfigData } from "../runtime/endpoint_config.ts";

export type ThreadModule<imports extends Record<string, unknown> = Record<string, unknown>> = {
	[key in keyof imports]: imports[key] extends ((...args: infer args) => infer returnType) ? ((...args: args) => Promise<returnType>) : imports[key]
} & {readonly __tag: unique symbol} & {[Symbol.dispose]: ()=>void}


export type ThreadPool<imports extends Record<string, unknown> = Record<string, unknown>> = ThreadModule<imports>[] 
	& {readonly __tag: unique symbol} & {[Symbol.dispose]: ()=>void}

export type MessageToWorker = 
	{type: "INIT", datexURL: string, workerInterfaceURL: string, communicationHubURL: string, moduleURL: string, tsInterfaceGeneratorURL:string, endpoint: string, importMap:Record<string,any>, datexConfig?: EndpointConfigData, theme:"dark"|"light"} |
	{type: "INIT_PORT"}

export type MessageFromWorker = 
	{type: "INITIALIZED", endpoint: string, remoteModule: string} |
	{type: "ERROR", error: string}

type ThreadOptions = {signal?: AbortSignal, datexConfig?: EndpointConfigData}


const ServiceWorkerRegistration = globalThis.ServiceWorkerRegistration ?? class MockServiceWorkerRegistration {} as typeof globalThis.ServiceWorkerRegistration

/**
 * Object representing an idle thread without an associated module
 * Idle threads are used for run() and runConcurrent() calls and 
 * are disposed after some time if not used
 */
class IdleWorkerThread {

	#interval?: number;

	constructor() {
		this.checkForDispose();
	}
	
	/**
	 * remove idle thread after some time if not used
	 */
	checkForDispose() {
		if (configuration.minIdleThreadLifetime == Infinity) return;
		this.#interval = setInterval(() => {
			if (availableThreads.get(this as ThreadModule) === 0) {
				clearInterval(this.#interval);
				availableThreads.delete(this  as ThreadModule);
				disposeThread(this as ThreadModule);
			}
		}, configuration.minIdleThreadLifetime * 1000)
	}

	/**
	 * reset the dispose timeout
	 */
	resetDisposeTimeout() {
		clearInterval(this.#interval);
		this.checkForDispose();
	}
}

/**
 * Object representing an idle thread without an associated module on a remote endpoint.
 * Remote threads are only available when using a ComputeCluster. 
 */
class IdleRemoteThread {

	/**
	 * Map of all active idle remote threads
	 */
	static #threads = new Map<Datex.Endpoint, IdleRemoteThread>();

	private constructor(public readonly endpoint: Datex.Endpoint) {
		IdleRemoteThread.#threads.set(endpoint, this);
	}

	// TODO
	public dispose() {
		IdleRemoteThread.#threads.delete(this.endpoint);
	}

	/**
	 * Tries to get a new remote endpoint thread from the cluster
	 * @param cluster 
	 */
	static getFromCluster(cluster: ComputeCluster): IdleRemoteThread & ThreadModule {
		// get endpoint with minimum usage
		let minUsage = Infinity;
		let preferredEndpoint: Datex.Endpoint|undefined;
		for (const [endpoint] of cluster.endpoints) {
			// get existing IdleRemoteThread for endpoint
			const existingThread = IdleRemoteThread.#threads.get(endpoint) as IdleRemoteThread & ThreadModule;
			const usage = existingThread ? (availableThreads.get(existingThread) ?? 0) : 0;
			if (usage < minUsage) {
				minUsage = usage;
				preferredEndpoint = endpoint;
			}
		}
		// create new thread if endpoint available
		if (preferredEndpoint) {
			if (IdleRemoteThread.#threads.has(preferredEndpoint)) return IdleRemoteThread.#threads.get(preferredEndpoint) as IdleRemoteThread & ThreadModule
			else return new IdleRemoteThread(preferredEndpoint) as IdleRemoteThread & ThreadModule;
		}
		else throw new Error("No endpoint available in cluster");
	}
}



const workerBlobUrl = await blobifyFile(new URL("./thread-worker.ts", import.meta.url))
const threadWorkers = new WeakMap<ThreadModule, Worker|ServiceWorkerRegistration|null>()
const threadEndpoints = new WeakMap<ThreadModule, Datex.Endpoint>()

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

export type ThreadingConfiguration = {
	/**
	 * Maximum number of threads that can run tasks concurrently
	 * Module threads are excluded from this limit
	 * Default: Infinity
	 */
	maxConcurrentThreads: number,
	/**
	 * Minimum lifetime of an idle thread in seconds
	 * Default: 60
	 */
	minIdleThreadLifetime: number,
	/**
	 * Cluster used for remote execution
	 */
	cluster?: ComputeCluster
}

const configuration: ThreadingConfiguration = {
	maxConcurrentThreads: Infinity,
	minIdleThreadLifetime: 60
}

/**
 * Override default threading options
 */
export function configure(config: Partial<ThreadingConfiguration>) {
	Object.assign(configuration, config);
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
			threadEndpoints.delete(thread);
		}
	}
}

function getNormalizedPath(path: string|URL, callerDir: string) {
	if (path && !(path instanceof URL) && !Path.pathIsURL(path)) {
		if (path.startsWith("./") || path.startsWith("../")) {
			return new Path(path, callerDir);
		}
		else {
			return import.meta.resolve(path)
		}
	}
	else return path;
}

/**
 * Spawn multiple worker threads
 * @param modulePath JS/TS module path to load in the thread
 * @param count number of threads
 * @returns module exports from the thread
 */
export async function spawnThreads<imports extends Record<string,unknown>>(modulePath: string|URL, count = 1): Promise<ThreadPool<imports>> {
	// normalize module path
	modulePath = getNormalizedPath(modulePath, getCallerDir());

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
 * using thread = await getServiceWorkerThread<typeof import('./thread-worker.ts')>('./thread-worker.ts');
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
	const callerDir = getCallerDir();
	if (modulePath) modulePath = getNormalizedPath(modulePath, callerDir);
	if (serviceWorkerInitUrl) serviceWorkerInitUrl = getNormalizedPath(serviceWorkerInitUrl, callerDir);

	// make sure supranet is initialized (not connected)
	if (!Datex.Supranet.initialized) await Datex.Supranet.init()
	
	if (modulePath) logger.debug("spawning new service worker thread: " + modulePath)
	else logger.debug("spawning new empty service worker thread")

	// create service worker (cannot use workerBlobURL because auf service worker restrictions)
	const swRegistration = await registerServiceWorker(serviceWorkerInitUrl);
	if (!swRegistration) throw new Error("Could not get service worker");

	return _initWorker(swRegistration, modulePath);
}


// active threads -> number of tasks that are currently running on the thread
const availableThreads = new Map<ThreadModule, number>();
let spawningThreads = 0;

/**
 * spawns a new thread or returns an existing thread from the pool
 */
async function getThread(): Promise<ThreadModule> {
	// find an existing thread that is not used
	for (const [thread, tasks] of availableThreads) {
		if (tasks == 0) {
			availableThreads.set(thread, 1);
			// reset dispose timeout
			if (thread instanceof IdleWorkerThread) thread.resetDisposeTimeout();
			return thread;
		}
	}

	// max concurrent thread limit reached
	const activeThreads = Array.from(availableThreads.values()).filter(v => v > 0).length;
	if ((spawningThreads + activeThreads) >= configuration.maxConcurrentThreads) {

		// wait until the currently spawning threads are all spawned
		await new Promise<void>(resolve => {
			const interval = setInterval(() => {
				if (spawningThreads == 0) {
					clearInterval(interval);
					resolve();
				}
			}, 100)
		});

		// return thread with least tasks
		let minTasks = Infinity;
		let thread: ThreadModule|undefined;
		for (const [availableThread, tasks] of availableThreads) {
			if (tasks < minTasks) {
				minTasks = tasks;
				thread = availableThread;
			}
		}
		if (thread) {
			availableThreads.set(thread, minTasks+1);
			// reset dispose timeout
			if (thread instanceof IdleWorkerThread) thread.resetDisposeTimeout();
			return thread;
		}
		else {
			throw new Error("Max concurrent thread limit reached, but no thread available");
		}
	}

	// get remote thread if cluster available
	if (configuration.cluster) {
		try {
			const thread = IdleRemoteThread.getFromCluster(configuration.cluster);
			threadEndpoints.set(thread, thread.endpoint);
			availableThreads.set(thread, (availableThreads.get(thread)??0) + 1);
			return thread;
		}
		catch (e) {
			console.debug(e);
			logger.error("Cannot get remote thread from cluster, falling back to local thread");
		}
	}

	// create a new thread
	const thread = await spawnThread(null);
	availableThreads.set(thread, 1);

	return thread;
	
}

function removeThreadEndpoint(thread: ThreadModule) {
	const endpoint = threadEndpoints.get(thread);
	if (endpoint) {
		availableThreads.set(thread, 0);
		threadEndpoints.delete(thread);
		if (configuration.cluster) {
			configuration.cluster.endpoints.delete(endpoint);
		}
	}
	else {
		throw new Error("Thread is not a remote thread")
	}
}

function freeThread(thread: ThreadModule) {
	if (!availableThreads.has(thread)) return;
	availableThreads.set(thread, availableThreads.get(thread)! - 1); 
	// restart dispose timeout after thread is no longer used
	if (thread instanceof IdleWorkerThread) thread.resetDisposeTimeout();
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
 * using thread = await spawnThread<typeof import('./threads.ts')>('./threads.ts');
 * // access exported values:
 * const res = await thread.exportedFunction(1,2);
 * thread.exportedValue.push(4);
 * ```
 * 
 * @param modulePath JS/TS module path to load in the thread
 * @returns module exports from the thread
 */
export async function spawnThread<imports extends Record<string,unknown>>(modulePath: string|URL, options?: ThreadOptions): Promise<ThreadModule<imports>>
/**
 * Spawn a new idle worker thread
 * @returns an empty thread object
 */
export async function spawnThread<imports extends Record<string,unknown>>(modulePath?:null, options?: ThreadOptions): Promise<ThreadModule<Record<string,never>>>
export async function spawnThread<imports extends Record<string,unknown>>(modulePath?: string|URL|null, options?: ThreadOptions): Promise<ThreadModule<imports>> {

	try {
		spawningThreads++;

		// normalize module path
		if (modulePath) modulePath = getNormalizedPath(modulePath, getCallerDir());
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

	finally {
		spawningThreads--;
	}
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
export async function _initWorker(worker: Worker|ServiceWorkerRegistration, modulePath?: string|URL|null, options?: ThreadOptions) {

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


	workerTarget.postMessage({
		type: "INIT",
		importMap: importMap,
		datexURL: import.meta.resolve("../datex.ts"),
		workerInterfaceURL: import.meta.resolve("../network/communication-interfaces/worker-interface.ts"),
		communicationHubURL: import.meta.resolve("../network/communication-hub.ts"),
		tsInterfaceGeneratorURL: import.meta.resolve("../utils/interface-generator.ts"),
		moduleURL: modulePath ? import.meta.resolve(modulePath.toString()): null,
		endpoint: Datex.Runtime.endpoint.toString(),
		theme: console_theme,
		datexConfig: options?.datexConfig
	} as MessageToWorker);

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

		const data = (event as any).data as MessageFromWorker;

		if (data.type == "ERROR") {
			logger.error("thread worker error:", data.error);
			reject(data.error);
		}
		else if (data.type == "INITIALIZED") {
			const endpoint = f(data.endpoint as "@")
			endpoint.setOnline(true); // always assumed to be online, without ping
			if (worker instanceof ServiceWorkerRegistration) throw new Error("Expected worker, got service worker");

			// connect directly via worker com interface
			logger.debug("connecting via worker com interface to " + data.endpoint);
			const connected = await communicationHub.addInterface(new WorkerInterface(worker, endpoint), false, 5000)
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
				threadEndpoints.set(moduleProxy, endpoint)
				resolve(moduleProxy)
			}
			// just return an empty thread
			else {
				const idleThread = Object.freeze(new IdleWorkerThread() as unknown as ThreadModule);
				threadWorkers.set(idleThread, worker)
				threadEndpoints.set(idleThread, endpoint)
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
export async function run<ReturnType, Args extends unknown[]>(task: () => ReturnType, options?: ThreadOptions, _meta?: {taskIndex?: number}): Promise<ReturnType>
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
export async function run<ReturnType=unknown>(task:TemplateStringsArray, ...args:any[]):Promise<ReturnType>

export async function run<ReturnType>(task: (() => ReturnType)|JSTransferableFunction|TemplateStringsArray, options?: ThreadOptions, _meta?: {taskIndex?: number }, ..._rest:unknown[]): Promise<ReturnType> {
	
	const contextURL = new URL(getCallerFile());

	let datexSource: string;
	let datexArgs: unknown[];

	// DATEX Script
	if (task instanceof Array) {
		datexSource = task.raw.join(INSERT_MARK);
		datexArgs = [...arguments].slice(1);
	}

	// JS Function (might already be a JSTransferableFunction)
	else if (task instanceof Function || task instanceof JSTransferableFunction) {
		const transferableTaskFn = task instanceof JSTransferableFunction ? task : (
			JSTransferableFunction.functionIsAsync(task) ? 
				await JSTransferableFunction.createAsync(task, {contextURL}) :
				JSTransferableFunction.create(task, {contextURL})
		)
		datexSource = '?(?)';
		datexArgs = [$$(transferableTaskFn), _meta?.taskIndex??0];
	}

	else throw new Error("task must be a function or template string");
	
	const thread = options?.datexConfig ? await spawnThread(null, options) : await getThread();
	const endpoint = threadEndpoints.get(thread);	

	try {
		if (options?.signal?.aborted) {
			throw new Error("aborted");
		}
		return await datex(datexSource, datexArgs, endpoint, false, false, undefined, undefined, Infinity);
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
		else if (e instanceof Error && e.message.endsWith("is offline")) {
			console.log("cluster endpoint " + endpoint + " is offline");
			removeThreadEndpoint(thread);
			// template string array
			if (task instanceof Array) return run(task);
			// function
			else return run(task as () => ReturnType, options, _meta);
		}
		else if (e instanceof Error) {
			throw new Error(e.message);
		}
		else throw e;
	}
	finally {
		freeThread(thread);
	}
}


type runInThreadsReturn<ReturnType, Mapping extends PromiseMappingFn = never> = Equals<Mapping, never> extends true ? Promise<ReturnType>[] : PromiseMapReturnType<ReturnType, Mapping>

/**
 * Run a function in a multiple threads in parallel and return the result of each thread.
 * 
 * Example:
 * ```ts
 * const sharedSet = $$ (new Set());
 * const res = await runConcurrent(i => {
 *   use (sharedSet);
 *   sharedSet.add(i);
 *   return i;
 * }, 10, Promise.all)
 * ```
 * 
 * @param task function that is executed on one or more threads
 * @param instances number of threads running the task concurrently
 * @param outputMapping optional Promise function (e.g. Promise.all) to apply to the resulting promises
 * @returns 
 */
export async function runConcurrent<ReturnType, Mapping extends PromiseMappingFn = never>(task: (taskIndex?: number) => ReturnType, instances = 1, outputMapping?: Mapping): Promise<runInThreadsReturn<ReturnType, Mapping>> {
	const abortController = new AbortController()
	const result = new Array(instances).fill(null).map((_, i) => run(task, {signal:abortController.signal}, {taskIndex: i}));

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