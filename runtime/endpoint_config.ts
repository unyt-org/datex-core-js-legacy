// store and read endpoint config (name, keys, ...)

import { client_type, cwdURL, Deno, logger } from "../utils/global_values.ts";
import { Endpoint, IdEndpoint } from "../types/addressing.ts";
import { Crypto } from "./crypto.ts";
import { getLocalFileContent } from "../utils/utils.ts";
import { Runtime } from "./runtime.ts";
import { Tuple } from "../types/tuple.ts";
import { DatexObject } from "../datex_all.ts";
import { cache_path } from "./cache_path.ts";

class EndpointConfig {

	public DX_FILE_NAME = '.dx';

	/* CONFIG VALUES */
	public endpoint?:Endpoint
	public id_endpoint?:IdEndpoint
	public keys?: Crypto.ExportedKeySet
	/*****************/

	async load(path?:URL) {
		let serialized:string|null = null;

		if (client_type=="deno") {
			let config_file = new URL('./'+this.DX_FILE_NAME, cache_path);
			// try to open .dx from cache
			try {
				Deno.openSync(config_file);
			} 
			// use normal dx file
			catch {
				if (!path) path = new URL('./'+this.DX_FILE_NAME, cwdURL)
				config_file = path;
			}
			serialized = <string> await getLocalFileContent(config_file, false)
		}
		else {
			// get config from cache
			serialized = globalThis.localStorage?.getItem("endpoint_config::"+(globalThis.location?.href ?? ''));
			// try to get from .dx url
			if (!serialized) {
				if (!path) path = new URL('./'+this.DX_FILE_NAME, window.location.href)
				try {
					const res = await fetch(path.toString());
					if (res.ok) serialized = await res.text();
					logger.info("Loaded endpoint config from " + path);
				}
				catch {
					// ignore if no .dx file found
				}
				
			}
		}

		if (serialized!=null) {
			const data = await Runtime.parseDatexData(serialized);
			this.endpoint = DatexObject.get(data, 'endpoint')
			this.id_endpoint = DatexObject.get(data, 'id_endpoint')
			this.keys = DatexObject.get(data, 'keys')
		}
	}
   

	save() {
		const serialized = Runtime.valueToDatexString(new Tuple({endpoint:this.endpoint, id_endpoint:this.id_endpoint, keys:this.keys}));

		if (client_type=="deno") {
			try {
				Deno.openSync(cache_path);
			} catch {
				Deno.mkdirSync(cache_path, {recursive:true});
			}
			const config_file = new URL('./.dx', cache_path);
			Deno.writeTextFileSync(config_file, serialized)
		}
		else if (!globalThis.localStorage) logger.warn("Cannot save endpoint config persistently")
		else globalThis.localStorage.setItem("endpoint_config::"+(globalThis.location?.href ?? ''), serialized);
	}

	clear() {
		this.endpoint = undefined;
		this.id_endpoint = undefined;
		this.keys = undefined;

		if (client_type=="deno") {
			const config_file = new URL('./.dx', cache_path);
			Deno.removeSync(config_file)
		}
		else if (globalThis.localStorage) globalThis.localStorage.removeItem("endpoint_config::"+(globalThis.location?.href ?? ''));
	}
}

export const endpoint_config = new EndpointConfig();