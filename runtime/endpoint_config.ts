// store and read endpoint config (name, keys, ...)

import { client_type, cwdURL, Deno, logger } from "../utils/global_values.ts";
import { Endpoint } from "../types/addressing.ts";
import { Crypto } from "./crypto.ts";
import { getLocalFileContent } from "../utils/utils.ts";
import { Runtime } from "./runtime.ts";
import { Tuple } from "../types/tuple.ts";
import { cache_path } from "./cache_path.ts";
import { DatexObject } from "../types/object.ts";
import { Ref } from "./pointers.ts";


type channel_type = 'websocket'|'http'
type node_config = {
	channels: Record<channel_type, unknown>,
	keys: [ArrayBuffer, ArrayBuffer]
}

export interface EndpointConfigData {
	endpoint?:Endpoint
	keys?: Crypto.ExportedKeySet
	connect?:boolean
	nodes?: Map<Endpoint, node_config>,
}


class EndpointConfig implements EndpointConfigData {

	public DX_FILE_NAME = '.dx';

	/* CONFIG VALUES */
	#endpoint?:Endpoint
	public keys?: Crypto.ExportedKeySet
	public connect?:boolean
	public nodes?: Map<Endpoint, node_config>
	/*****************/

	public get endpoint() {
		return Ref.collapseValue(this.#endpoint, true, true)!;
	}
	public set endpoint(endpoint: Endpoint) {
		this.#endpoint = endpoint;
	}


	#nodes_loaded = false;
	// list of available nodes with public keys
	#node_channels_by_type = new Map<string, [Endpoint, unknown][]>();


	async load(path?:URL) {
		let config:EndpointConfigData|null = null;

		if (client_type=="deno") {
			let config_file = new URL('./'+this.DX_FILE_NAME, cache_path);
			// try to open .dx from cache
			try {
				Deno.openSync(config_file);
				// console.log("using endpoint config cache: " + config_file);
			} 
			// use normal dx file
			catch {
				if (!path) path = new URL('./'+this.DX_FILE_NAME, cwdURL)
				config_file = path;
			}
			try {
				config = await datex.get(config_file);
				logger.debug("using endpoint config: " + config_file);
			}
			catch (e){
				// ignore if no .dx file found
				if (e instanceof Deno.errors.NotFound) {}
				else {
					logger.error `Could not read config file ${config_file}: ${e.toString()}`;
					throw "invalid config file"
				}
			}
		}
		else if (client_type == "browser") {
			// get config from cache
			const serialized = globalThis.localStorage?.getItem("endpoint_config::"+(globalThis.location.origin ?? ''));

			if (serialized) {
				config = <EndpointConfigData> await Runtime.executeDatexLocally(serialized, undefined, undefined, globalThis.location?.href ? new URL(globalThis.location.href) : undefined)
			}
			// try to get from .dx url
			else {
				if (!path) path = new URL('/'+this.DX_FILE_NAME, globalThis.location.href)
				try {
					config = await datex.get(path);
					logger.info("loaded endpoint config from " + path);
				}
				catch (e) {
					// ignore if no .dx file found
					if (!(await fetch(path)).ok) {}
					else {
						logger.error `Could not read config file ${path}: ${e.toString()}`;
						throw "invalid config file"
					}
				}
			}
		}
		else {
			logger.debug("Cannot load endpoint config file for client type '" + client_type + "'")
		}

		if (config!=null) {
			this.#endpoint = DatexObject.get(<any>config, 'endpoint')
			this.keys = DatexObject.get(<any>config, 'keys')
			this.connect = DatexObject.get(<any>config, 'connect')
			this.nodes = DatexObject.get(<any>config, 'nodes');
		}

		await this.loadNodes()
	}
   

	save() {
		const serialized = Runtime.valueToDatexString(new Tuple({endpoint:this.#endpoint, connect:this.connect, keys:this.keys, nodes:this.nodes}));

		if (client_type=="deno") {
			try {
				try {
					Deno.openSync(cache_path);
				} catch {
					Deno.mkdirSync(cache_path, {recursive:true});
				}
				const config_file = new URL('./.dx', cache_path);
				Deno.writeTextFileSync(config_file, serialized)
			}
			catch {
				logger.error("Cannot save endpoint config cache file");
			}			
		}
		else if (client_type == "worker") {
			// ignore not saving in worker
		}
		else if (!globalThis.localStorage) {
			logger.warn("Cannot save endpoint config persistently")
		}
		else globalThis.localStorage.setItem("endpoint_config::"+(globalThis.location?.origin ?? ''), serialized);
	}

	clear() {
		this.#endpoint = undefined;
		this.connect = undefined;
		this.keys = undefined;
		this.nodes = undefined;

		if (client_type=="deno") {
			const config_file = new URL('./.dx', cache_path);
			Deno.removeSync(config_file)
		}
		else if (globalThis.localStorage) globalThis.localStorage.removeItem("endpoint_config::"+(globalThis.location?.origin ?? ''));
	}


	// node handling

	private async loadNodes(){
		if (this.#nodes_loaded) return;
		this.#nodes_loaded = true;

		// no nodes provided in .dx config, fall back to default nodes list
		if (!this.nodes) {
			// try to get from cdn.unyt.org
			try {
				this.nodes = await datex.get('https://dev.cdn.unyt.org/unyt_core/dx_data/nodes.dx');
			}
			// otherwise try to get local file (only backend)
			catch {
				this.nodes = await datex.get(new URL('../dx_data/nodes.dx', import.meta.url));
			}
		}
		

		for (const [node, {channels, keys:[verify_key, enc_key]}] of this.nodes.entries()) {
			// save keys
			Crypto.bindKeys(node, verify_key, enc_key);

			// save interface info in node
			node.setInterfaceChannels(channels);
			// save in list
			for (const [channel_name, channel_data] of Object.entries(channels||{})) {
				if (!this.#node_channels_by_type.has(channel_name)) this.#node_channels_by_type.set(channel_name, []);
				this.#node_channels_by_type.get(channel_name)!.push([node, channel_data]);
			}
		}
	}

	// select a node that provides a channel of the requested type
	public getNodeWithChannelType(types:string[], force_use_node?:Endpoint):[Endpoint|null, string|null] {
		for (const type of types) {
			const list = this.#node_channels_by_type.get(type);
			if (list?.length) {
				if (!force_use_node) return [list[0][0], type]; // select first node
				else { // check if the force_use_node is in the list
					for (const [node, _data] of list) {
						if (node == force_use_node) return [node, type];
					}
				}
			}
		}
		return [null, null];       
	}


}

export const endpoint_config = new EndpointConfig();