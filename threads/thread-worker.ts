import type { MessageToWorker } from "./threads.ts";
import type { Datex as DatexType } from "../mod.ts";
import type { EndpointConfigData } from "../runtime/endpoint_config.ts";

const isServiceWorker = 'registration' in globalThis && (globalThis as any).registration instanceof ServiceWorkerRegistration;

console.log("spawned new thread worker")

if (isServiceWorker) {
	// https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
	self.addEventListener("activate", (event) => {
		console.log("service worker activated")
		// @ts-ignore
		event.waitUntil(clients.claim());
	});
}


// for import maps (TODO: fix import shim)
declare const importShim: any;

let Datex: typeof DatexType;
let generateTSModuleForRemoteAccess: typeof import("../utils/interface-generator.ts").generateTSModuleForRemoteAccess;


async function initDatex(url: string, datexConfig?: EndpointConfigData) {
	({Datex} = await import(url));
	const {endpoint_config} = await import(new URL("./runtime/endpoint_config.ts", url).toString());
	if (datexConfig) {
		Datex.Runtime.OPTIONS.USE_DX_CONFIG = false;
		Datex.Runtime.OPTIONS.USE_PUBLIC_NODES = false;
		endpoint_config.set(datexConfig)
	}
	await Datex.Supranet.start();
}

async function initTsInterfaceGenerator(url: string) {
	({generateTSModuleForRemoteAccess} = await import(url));
}

async function getWorkerComInterface(url: string) {
	return await import(url) as typeof import("../network/communication-interfaces/worker-interface.ts");
}

async function getCommunicationHub(url: string) {
	return await import(url) as typeof import("../network/communication-hub.ts");
}


async function loadModule(url: string) {
	const module = await import(url)
	const remoteModule = await generateTSModuleForRemoteAccess(new URL(url), undefined, false)
	Datex.Runtime.endpoint_entrypoint = module;
	return remoteModule;
}

let messageTarget:{postMessage:(data:any)=>void} = self

addEventListener("message", async function (event) {

	const data = event.data as MessageToWorker;

	try {
		// init message port (only for service workers)
		if (data.type == "INIT_PORT") {
			messageTarget = event.ports[0];
		}
		else if (data.type == "INIT") {
			// TODO:
			// await import("https://ga.jspm.io/npm:es-module-shims@1.8.0/dist/es-module-shims.wasm.js");
			// if (data.importMap) importShim.addImportMap(data.importMap);

			// inherit theme from parent
			(globalThis as any)._override_console_theme = data.theme;

			await initDatex(data.datexURL, data.datexConfig);
			const {WorkerInterface} = await getWorkerComInterface(data.workerInterfaceURL);
			const {communicationHub} = await getCommunicationHub(data.communicationHubURL);

			await initTsInterfaceGenerator(data.tsInterfaceGeneratorURL);
			const remoteModule = data.moduleURL ? await loadModule(data.moduleURL) : null;
			
			// connect via worker com interface
			const endpoint = Datex.Target.get(data.endpoint as any) as DatexType.Endpoint;

			// TODO: Worker type?
			await communicationHub.addInterface(new WorkerInterface(self as unknown as Worker, endpoint));

			messageTarget.postMessage({type: "INITIALIZED", remoteModule, endpoint: Datex.Runtime.endpoint.toString()});
			// trust parent endpoint
			Datex.Runtime.addTrustedEndpoint(endpoint, ["remote-js-execution"]);
		}
		
	}
	catch (e) {
		console.log("error",e)
		messageTarget.postMessage({type: "ERROR", error: e.stack??e})
	}
	
})