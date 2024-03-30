// store and read endpoint config (name, keys, ...)

import { cwdURL, Deno, logger } from "../utils/global_values.ts";
import { client_type } from "../utils/constants.ts";
import { Endpoint } from "../types/addressing.ts";
import { Crypto } from "./crypto.ts";
import { Runtime } from "./runtime.ts";
import { Tuple } from "../types/tuple.ts";
import { cache_path } from "./cache_path.ts";
import { DatexObject } from "../types/object.ts";
import { Ref } from "./pointers.ts";
import { normalizePath } from "../utils/normalize-path.ts";
import { ESCAPE_SEQUENCES } from "../datex_all.ts";

type channel_type = 'websocket'|'http'
type node_config = {
	channels: Record<channel_type, unknown>,
	keys: [ArrayBuffer, ArrayBuffer]
}

export interface EndpointConfigData {
	endpoint?:Endpoint
	keys?: Crypto.ExportedKeySet
	connect?:boolean // default true
	ws_relay?: boolean // create ws relay on backend server (default: true)
	temporary?:boolean // default false
	nodes?: Map<Endpoint, node_config>,
	blockchain_relay?: Endpoint // custom blockchain relay endpoint (default: @+unyt2)
}


class EndpointConfig implements EndpointConfigData {

	public DX_FILE_NAME = '.dx';

	/* CONFIG VALUES */
	#endpoint?:Endpoint
	public keys?: Crypto.ExportedKeySet
	public connect?:boolean
	public temporary?:boolean
	public ws_relay?:boolean
	public nodes?: Map<Endpoint, node_config>
	public blockchain_relay?: Endpoint
	/*****************/

	public usingHTTPoverDATEX = false;

	// not saved in endpoint config, loaded from https://unyt.cc/nodes.dx
	public publicNodes?: Map<Endpoint, node_config>

	public get endpoint() {
		return Ref.collapseValue(this.#endpoint, true, true)!;
	}
	public set endpoint(endpoint: Endpoint) {
		this.#endpoint = endpoint;
	}



	#nodesInitialized = false;
	// list of available nodes with public keys
	#node_channels_by_type = new Map<string, [Endpoint, unknown][]>();


	async load(path?:URL) {
		let config:EndpointConfigData|null = null;

		if (!Runtime.OPTIONS.USE_DX_CONFIG) {
			console.log("Skipping endpoint config file");
			return;
		}
		else if (client_type=="deno") {
			let config_file = new URL('./'+this.DX_FILE_NAME, cache_path);
			// try to open .dx from cache
			try {
				const file = Deno.openSync(normalizePath(config_file));
				file.close()
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
			const serialized = this.storage?.getItem(this.storageId);
			if (serialized) {
				config = <EndpointConfigData> await Runtime.executeDatexLocally(serialized, undefined, undefined, globalThis.location?.href ? new URL(globalThis.location.href) : undefined)
			}
			// try to get from .dx url
			if (!path) path = new URL('/'+this.DX_FILE_NAME, globalThis.location.href)
			try {

				const dxResponse = await fetch(path);

				// check headers for http-over-datex
				if (dxResponse.headers.get("x-http-over-datex") == "yes") this.usingHTTPoverDATEX = true;

				if (dxResponse.ok) {
					const content = await dxResponse.text();
					const configUpdate = await Runtime.executeDatexLocally(content, undefined, undefined, path) as EndpointConfigData;
					if (!config) {
						config = configUpdate;
						logger.info("loaded endpoint config from " + path);
					}
					else {
						for (const [key, value] of DatexObject.entries(configUpdate as Record<string|symbol,unknown>)) {
							DatexObject.set(config as Record<string|symbol,unknown>, key as string, value);
						}
						logger.debug("updated endpoint config from " + path);
					}
				}
				// ignore if no .dx file found

			}
			catch (e) {
				logger.error `Could not read config file ${path}: ${e.toString()}`;
				throw "invalid config file"
			}
			
		}
		else {
			logger.debug("Cannot load endpoint config file for client type '" + client_type + "'")
		}

		if (config!=null) {
			this.#endpoint = DatexObject.get(<any>config, 'endpoint')
			this.keys = DatexObject.get(<any>config, 'keys')
			this.connect = DatexObject.get(<any>config, 'connect')
			this.temporary = DatexObject.get(<any>config, 'temporary')
			this.ws_relay = DatexObject.get(<any>config, 'ws_relay')
			this.blockchain_relay = DatexObject.get(<any>config, 'blockchain_relay')
			this.nodes = DatexObject.get(<any>config, 'nodes')
		}

		if (this.storage) {
			if (this.storage === localStorage)
				sessionStorage.removeItem(this.storageId);
			else
				localStorage.removeItem(this.storageId);
		}

		// set custom blockchain relay
		if (this.blockchain_relay) {
			if (!Runtime.Blockchain) throw new Error("Runtime.Blockchain not initialized");
			if (this.blockchain_relay instanceof Endpoint) Runtime.Blockchain.setRelayNode(this.blockchain_relay);
			else throw new Error("blockchain_relay must be an Endpoint")
		}

		// load public nodes from unyt.org
		await this.loadPublicNodes();
		await this.initNodes()
	}
	
	get storageId() {
		return "endpoint_config::"+(globalThis.location?.origin ?? '');
	}
	get locationId() {
		return "endpoint_config_location::"+(globalThis.location?.origin ?? '');
	}

	save() {
		const serialized = Runtime.valueToDatexString(new Tuple({endpoint:this.#endpoint, connect:this.connect, ws_relay:this.ws_relay, temporary:this.temporary, keys:this.keys, nodes:this.nodes, blockchain_relay:this.blockchain_relay}));

		if (client_type=="deno") {
			try {
				try {
					Deno.openSync(normalizePath(cache_path));
				} catch {
					Deno.mkdirSync(normalizePath(cache_path), {recursive:true});
				}
				const config_file = new URL('./' + this.DX_FILE_NAME, cache_path);
				// make writable if file already exists
				try {
					Deno.chmodSync(normalizePath(config_file), 0o700);
				} catch {}
				Deno.writeTextFileSync(normalizePath(config_file), serialized)
				// make readonly
				try {
					// not supported by windows
					Deno.chmodSync(normalizePath(config_file), 0o444);
				} catch {}
			}
			catch (e) {
				console.log(e)
				logger.error("Cannot save endpoint config cache file");
			}			
		}
		else if (client_type == "worker") {
			// ignore not saving in worker
		}
		else if (!this.storage)
			logger.warn("Cannot save endpoint config");
		else {
			// remove endpoint config from previous storage
			if (this.storage == globalThis.localStorage) globalThis.sessionStorage.removeItem(this.storageId)
			else globalThis.localStorage.removeItem(this.storageId)

			localStorage.setItem(this.locationId, this.temporary ? "session" : "persistent");
			this.storage.setItem(this.storageId, serialized);
		}
	}

	get storage() {
		return (this.temporary ?? globalThis.localStorage?.getItem(this.locationId) === "session") ?
			globalThis.sessionStorage :
			globalThis.localStorage;
	}

	clear() {
		this.#endpoint = undefined;
		this.connect = undefined;
		this.temporary = undefined;
		this.ws_relay = undefined;
		this.keys = undefined;
		this.nodes = undefined;
		this.blockchain_relay = undefined;

		if (client_type=="deno") {
			const config_file = new URL('./' + this.DX_FILE_NAME, cache_path);
			Deno.removeSync(config_file)
		}
		else if (this.storage) this.storage.removeItem(this.storageId);
	}

	/**
	 * get public node keys + connection points from unyt.cc/nodes.dx
	 */
	private async loadPublicNodes() {
		// get public nodes
		if (!this.publicNodes) {
			// try to get from unyt.cc
			try {
				this.publicNodes = await datex.get('https://unyt.cc/nodes.dx');
			}
			// otherwise try to get local file (only backend)
			catch {
				this.publicNodes = await datex.get(new URL('../dx_data/nodes.dx', import.meta.url));
			}
		}
	}

	/**
	 * register custom + public nodes as interface channels
	 */
	private initNodes(){
		if (this.#nodesInitialized) return;
		this.#nodesInitialized = true;

		for (const [node, {channels, keys:[verify_key, enc_key]}] of [...(this.nodes??new Map()).entries(), ...(this.publicNodes??new Map()).entries()]) {
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
	public getNodeWithInterfaceType(types:string[], force_use_node?:Endpoint):[Endpoint|null, string|null] {
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