import { Endpoint } from "../types/addressing.ts";
import { getProxyFunction } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";

// NetworkUtils: get public keys for endpoints + register push notifiction channels
export abstract class NetworkUtils {
    /** get public keys for endpoint [unsigned dxb] */
    static _get_keys:globalThis.Function
    static get_keys (endpoint:Endpoint):Promise<[ArrayBuffer, ArrayBuffer]> {  
        if (!this._get_keys) this._get_keys = getProxyFunction("get_keys", {scope_name:"network", sign:false, filter:Runtime.main_node});
        return this._get_keys(endpoint)
    }

    /** add push notification channel connection data */
    static _add_push_channel:globalThis.Function
    static add_push_channel (channel:string, data:object):Promise<any> {
        if (!this._add_push_channel) this._add_push_channel = getProxyFunction("add_push_channel", {scope_name:"network", sign:false, filter:Runtime.main_node});
        return this._add_push_channel(channel, data)
    }
}