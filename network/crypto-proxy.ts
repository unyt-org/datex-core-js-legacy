import { Datex } from "../mod.ts";
import {Endpoint, endpoint, endpoint_default, logger, property} from "../datex_all.ts";
import { Disjunction } from "../types/logic.ts";


@endpoint class ProxyAPI {

	@property static requestProxy(proxiedEndpoint: Endpoint, secret: string) {
		// @ts-ignore access private method
		return CryptoProxy.handleProxyRequest(datex.meta!.sender, proxiedEndpoint, secret)
	}


}

export class CryptoProxy {
	
	/**
     * Request signing + encryption handling from another endpoint.
     * The proxy endpoint must allow proxy requests from a specific endpoint by calling getProxySecret().
     * This secret must be passed on to the requesting endpoint.
     * It is not defined how the requesting endpoint retrieves the secret, but it should happen over a
     * secure channel.
     * 
     * Finally, the requesting endpoint must call requestProxy() with the proxy endpoint,
     * desired proxied endpoint, and the secret.
     * 
     */
	public static requestProxy(proxyEndpoint: Endpoint, proxiedEndpoint: Endpoint, secret: string) {
		return datex('#public.ProxyAPI.requestProxy(?,?)', [proxiedEndpoint, secret], proxyEndpoint);
    }

    static #proxySecrets = new Set<string>()
    static #proxyRequestHandler?: (requestingEndpoint: Endpoint, proxiedEndpoint: Endpoint) => [signKey:CryptoKey, decKey:CryptoKey]|null

	static #generateSecret(length = 100) {
		let result = '';
		const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		const charactersLength = characters.length;
		let counter = 0;
		while (counter < length) {
		  result += characters.charAt(Math.floor(Math.random() * charactersLength));
		  counter += 1;
		}
		return result;
	}

    public static getProxySecret() {
        const secret = this.#generateSecret();
        this.#proxySecrets.add(secret);
        return secret;
    }

	private static handleProxyRequest(requestingEndpoint: Endpoint, proxiedEndpoint: Endpoint, secret: string) {
		logger.debug("proxy request from " + requestingEndpoint + ": " + proxiedEndpoint)
		if (this.#proxySecrets.has(secret)) {
			this.#proxySecrets.delete(secret);
			if (!this.#proxyRequestHandler) {
				logger.error("You must set a proxy request handler with CryptoProxy.onProxyRequest");
				return false;
			}
			const keys = this.#proxyRequestHandler(requestingEndpoint, proxiedEndpoint)
			if (keys) {
				Datex.Runtime.enableCryptoProxy(proxiedEndpoint, keys);
				return true;
			}
			return false;
		}
		else return false;
	}

    public static onProxyRequest(handler:(requestingEndpoint: Endpoint, proxiedEndpoint: Endpoint) => [signKey:CryptoKey, decKey:CryptoKey]|null) {
        this.#proxyRequestHandler = handler;
    }
}