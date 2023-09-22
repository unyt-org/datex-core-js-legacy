import type { MessageToWorker } from "./threads.ts";
import type { Datex as DatexType } from "../datex.ts";

const isServiceWorker = 'registration' in globalThis && (globalThis as any).registration instanceof ServiceWorkerRegistration;

console.log("initialized thread worker", {isServiceWorker})

if (isServiceWorker) {
	// https://developer.mozilla.org/en-US/docs/Web/API/Clients/claim
	self.addEventListener("activate", (event) => {
		console.log("service worker activated")
		event.waitUntil(clients.claim());
	});
}

let Datex: typeof DatexType;
let generateTSModuleForRemoteAccess: typeof import("../utils/interface-generator.ts").generateTSModuleForRemoteAccess;


async function initDatex(url: string) {
	({Datex} = await import(url));
	await Datex.Supranet.connect();
}

async function initTsInterfaceGenerator(url: string) {
	({generateTSModuleForRemoteAccess} = await import(url));
}

async function initWorkerComInterface(url: string) {
	await import(url) as typeof import("./worker-com-interface.ts");
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
			await initDatex(data.datexURL);
			await initWorkerComInterface(data.comInterfaceURL);
			await initTsInterfaceGenerator(data.tsInterfaceGeneratorURL);
			const remoteModule = data.moduleURL ? await loadModule(data.moduleURL) : null;
			
			// connect via worker com interface
			const endpoint = Datex.Target.get(data.endpoint as any) as DatexType.Endpoint;
			await Datex.InterfaceManager.connect("worker", endpoint, [self])
			messageTarget.postMessage({type: "INITIALIZED", remoteModule, endpoint: Datex.Runtime.endpoint.toString()});
		}
		
	}
	catch (e) {
		console.log("error",e)
		messageTarget.postMessage({type: "ERROR", error: e.stack??e})
	}
	
})