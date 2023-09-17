import type { MessageToWorker } from "./threads.ts";
import type { Datex as DatexType } from "../datex.ts";

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

self.onmessage = async function (event) {

	const data = event.data as MessageToWorker;

	try {
		if (data.type == "INIT") {
			await initDatex(data.datexURL);
			await initWorkerComInterface(data.comInterfaceURL);
			await initTsInterfaceGenerator(data.tsInterfaceGeneratorURL);
			const remoteModule = data.moduleURL ? await loadModule(data.moduleURL) : null;

			// connect via worker com interface
			const endpoint = Datex.Target.get(data.endpoint as any) as DatexType.Endpoint;
			await Datex.InterfaceManager.connect("worker", endpoint, [self])
			postMessage({type: "INITIALIZED", remoteModule, endpoint: Datex.Runtime.endpoint.toString()});
		}
		
	}
	catch (e) {
		postMessage({type: "ERROR", error: e.stack??e})
	}
	
}