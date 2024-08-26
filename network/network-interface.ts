/** Publicly exposed network interface (#public.network) */

import { Crypto } from "../runtime/crypto.ts";
import { Endpoint } from "../types/addressing.ts";
import { endpoint, property } from "../js_adapter/decorators.ts"

@endpoint export abstract class network {
	/** get sign and encryption keys for an alias */
    @property static async get_keys(endpoint: Endpoint) {
        // console.log("GET keys for " +endpoint)
        const keys = await Crypto.getExportedKeysForEndpoint(endpoint);
        return keys;
    }
}