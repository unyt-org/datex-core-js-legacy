
/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  unyt.org Supranet connection handler                                                ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Visit https://docs.unyt.org/manual/datex/supranet-networking for more information   ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2024 unyt.org                        ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */

import { Runtime } from "../runtime/runtime.ts";
import { Crypto } from "../runtime/crypto.ts";

import {client_type} from "../utils/constants.ts";
import { Endpoint } from "../types/addressing.ts";
import { Logger } from "../utils/logger.ts";
import { endpoint_config } from "../runtime/endpoint_config.ts";
import { endpoint_name, UnresolvedEndpointProperty } from "../datex_all.ts";
import { Datex } from "../mod.ts";
import { Storage } from "../storage/storage.ts";
import { WebSocketClientInterface } from "./communication-interfaces/websocket-client-interface.ts";
import { communicationHub } from "./communication-hub.ts";
import { deleteCookie, getCookie } from "../utils/cookies.ts";
import { f } from "../datex_short.ts";
import { reset } from "../runtime/reset.ts";

const logger = new Logger("DATEX Supranet");

export class Supranet {

    static available_channel_types:string[] = []; // all available interface channel types, sorted by preference

    static #connected = false;
    static get connected(){return this.#connected}

    static #initialized = false;
    static get initialized(){return this.#initialized}


    // connect without cache and random endpoint id
    public static connectAnonymous(){
        return this.connect(undefined, false);
    }

    // connect without cache
    public static connectTemporary(endpoint?:Endpoint){
        return this.connect(endpoint, false);
    }

    // connect to Supranet
    // if local_cache=false, a new endpoint is created and not saved in the cache, even if an endpoint is stored in the cache
    // TODO problem: using same keys as stored endpoint!
    public static async connect(endpoint?:Endpoint|UnresolvedEndpointProperty, local_cache?: boolean, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], via_node?:Endpoint) {

        if (this.#connected && (!endpoint || endpoint === Runtime.endpoint)) {
            // logger.info("already connected as", Runtime.endpoint);
            return true;
        }

        const alreadyConnected = this.#connected;

        // load runtime, own endpoint, nodes
        this.#connected = false;
        endpoint = await this.init(endpoint, local_cache, sign_keys, enc_keys)

        const shouldSwitchInstance = this.shouldSwitchInstance(endpoint);

        // switching from potentially instance to another instance, make sure current endpoint is not an already active instance
        if (shouldSwitchInstance && endpoint !== endpoint.main) Runtime.init(endpoint.main);

        // already connected to endpoint during init
        if (alreadyConnected && endpoint === Runtime.endpoint) {
            if (shouldSwitchInstance) await this.handleSwitchToInstance()
            logger.success("Connected to the supranet as " + endpoint)
            return true;
        }

        if (alreadyConnected) {
            if (shouldSwitchInstance) await this.handleSwitchToInstance();
            return true;
        }
        else {
            const connected = await this._connect(via_node, !shouldSwitchInstance);
            if (shouldSwitchInstance) await this.handleSwitchToInstance()
            return connected;
        }

    }


    private static shouldSwitchInstance(endpoint: Endpoint) {
        // return false;
        return (endpoint.main === endpoint || Runtime.getActiveLocalStorageEndpoints().includes(endpoint)) && (!!Runtime.Blockchain)
    }

    /**
     * Finds an available instance and switches endpoint
     * @returns true if switched to new instance (and hello sent)
     */
    private static async handleSwitchToInstance() {
        if (!Runtime.Blockchain) {
            logger.error("Cannot determine endpoint instance, blockchain not available")
        }
        else {
            // existing locally available endpoint instances -> hashes
            const hashes = await Storage.loadOrCreate("Datex.Supranet.ENDPOINT_INSTANCE_HASHES", () => new Map<Endpoint, string>())

            try {
                logger.debug("available cached instances: " + [...hashes.keys()].map(e=>e.toString()).join(", "))
            }
            catch (e) {
                console.error("invalid hashes", hashes)
                throw e;
            }

            const activeEndpoints = Runtime.getActiveLocalStorageEndpoints();
            let hash: string|undefined = undefined;
            let endpoint = Runtime.endpoint;
            for (const [storedEndpoint, storedHash] of hashes) {
                if (Runtime.endpoint.main == storedEndpoint.main && !activeEndpoints.includes(storedEndpoint)) {
                    hash = storedHash;
                    endpoint = storedEndpoint;
                    break;
                }
            }
            if (!hash) hash = Math.random().toString(36).substring(2,18);

            try {
                const instance = (await Runtime.Blockchain.getEndpointInstance(endpoint, hash))!;
                // makes sure hash is set in cache
                hashes.set(instance, hash);
                // set endpoint to instace
                Runtime.init(instance);
                endpoint_config.endpoint = instance;
                endpoint_config.save();
                logger.success("Switched to endpoint instance " + instance)
                this.handleConnect();
                return true;
            }
            catch {
                logger.error("Could not determine endpoint instance (request error)");
                this.handleConnect();
            }
        }
        
        return false;
    }

    private static async _connect(via_node?:Endpoint, handleOnConnect = true) {
        // find node for available channel
        const [node, channel_type] = this.getNode(via_node)
        const connected = await this.connectToEndpoint(node, channel_type)

        if (!connected) logger.error("connection failed")
        else if (handleOnConnect) await this.handleConnect();

        // validate current keys against official public keys in network 
        // TODO: (does not work because response never reaches endpoint if valid endpoint already exists in network)
        // Crypto.validateOwnKeysAgainstNetwork();

        this.#connected = connected;

        return connected;
    }

    // update Supranet.connected state
    static _setConnected(connected:boolean) {
        this.#connected = connected;    
    }


    static getNode(use_node?:Endpoint) {
        // channel types?
        if (globalThis.WebSocketStream || client_type!="browser") this.available_channel_types.push("websocketstream")
        this.available_channel_types.push("websocket");

        // find node for available channel
        const [node, channel_type] = endpoint_config.getNodeWithInterfaceType(this.available_channel_types, use_node);
        if (!node) throw ("Cannot find a node that support any channel type of: " + this.available_channel_types + (use_node ? " via " + use_node : ''));
        if (!channel_type) throw("No channel type for node: " + node);
        return [node, channel_type] as const;
    }



	/**
	 * Connects to a endpoint via an available interface if a known
	 * interface exists for the endpoint
	 * @param endpoint endpoint to connect to
	 * @param interfaceType optional interface type to connect with 
	 * @returns true if a connection could be established
	 */
	public static async connectToEndpoint(endpoint: Endpoint, interfaceType?: string, setAsDefault = true): Promise<boolean> {
		
        // check if interface is available
        const info = endpoint.getInterfaceChannelInfo(interfaceType);
        if (info) {
            // websocket
            if (interfaceType == "websocket") {
                if (!(info instanceof URL || typeof info === "string")) {
                    logger.error("Invalid data for websocket interface, expected string or URL");
                    return false;
                }
                const webSocketInterface = new WebSocketClientInterface(info instanceof URL ? info.origin : info, endpoint)
                await communicationHub.addInterface(webSocketInterface, setAsDefault);
                return true;
            }
            // TODO: more interfaces
            else {
                logger.error("Interface type not supported: " + interfaceType);
                return false;
            }
        }
        else {
            return false;
        }

	}



    private static handleConnect() {
        for (const listener of this.#connectListeners) listener();
        if (this.onConnect) this.onConnect()
    }

    // @override
    public static onConnect = ()=>{
        logger.success("Connected as **"+Runtime.endpoint+"** to the Supranet via **" + communicationHub.handler.defaultSocket?.endpoint + "** (" + communicationHub.handler.defaultSocket?.toString() + ")" )
    }

    static #connectListeners = new Set<()=>void>()
    public static onConnected(listener: ()=>void) {
        this.#connectListeners.add(listener);
    }

    // only init, don't (re)connect
    public static async init(endpoint?:Endpoint|UnresolvedEndpointProperty|endpoint_name, local_cache?: boolean, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey]):Promise<Endpoint>  {
        if (typeof endpoint == "string") endpoint = await Endpoint.fromStringAsync(endpoint);

        await endpoint_config.load(); // load config from storage/file

        let keys:Crypto.ExportedKeySet|undefined;

        // load/create endpoint from cache?
        if (!endpoint) {
            [endpoint, keys] = await this.getLocalEndpointAndKeys();
            sign_keys = keys.sign;
            enc_keys = keys.encrypt;
        }
        // first resolve endpoint, connect anonymous
        if (endpoint instanceof UnresolvedEndpointProperty) {
            const tmp_endpoint = <Endpoint> Endpoint.get(Endpoint.createNewID());
            await this._init(tmp_endpoint, true, sign_keys, enc_keys, keys);
            await this._connect();
            const res = await endpoint.resolve(); 
            // use fallback tmp_endpoint if endpoint property is void

            const verificationCode = "macjiosdfohnfeioaDSgdb" // TODO: generate
            const unytAuthURL = `https://auth.unyt.org/register-sub-endpoint?id=${tmp_endpoint}&code=${verificationCode}`

            if (res === undefined) {
                logger.success `
    Creating new endpoint ${endpoint.parent}.${endpoint.property} (${tmp_endpoint}).
    If you have write access to ${endpoint.parent}, you can set ${endpoint.parent}.${endpoint.property} = ${tmp_endpoint}.
    If you are the owner of ${endpoint.parent}, you can create a certificate for ${tmp_endpoint}.
    
    🔑 Register with unyt Auth: #color(white)${unytAuthURL}
    `
    // 🔑 VERIFY: ${Crypto.getOwnPublicKeysExported()[0]}
    // 🔑 ENCRYPT: ${Crypto.getOwnPublicKeysExported()[1]}

                return tmp_endpoint; // already connected to tmp_endpoint
            }
            else if (!(res instanceof Endpoint)) {
                throw new Error(`could not resolve ${endpoint} to an <endpoint> value`);
            }
            logger.info(`resolved ${endpoint} to ${res}`);
            endpoint = res;
        }

        return this._init(endpoint, local_cache, sign_keys, enc_keys, keys);
    }

    private static async _init(endpoint:Endpoint, local_cache = !endpoint_config.temporary, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], keys?:Crypto.ExportedKeySet) {
       
        // load/create keys, even if endpoint was provided?
        if (!sign_keys || !enc_keys) {
            keys = await this.getKeysOrGenerateNew();
            sign_keys = keys.sign;
            enc_keys = keys.encrypt;
        }
        else { // new keys were provided, save in storage
            keys = {
                sign: [
                    sign_keys[0] instanceof ArrayBuffer ? sign_keys[0] : await Crypto.exportPublicKey(sign_keys[0]),
                    sign_keys[1] instanceof ArrayBuffer ? sign_keys[1] : await Crypto.exportPrivateKey(sign_keys[1]),
                ],
                encrypt: [
                    enc_keys[0] instanceof ArrayBuffer ? enc_keys[0] : await Crypto.exportPublicKey(enc_keys[0]),
                    enc_keys[1] instanceof ArrayBuffer ? enc_keys[1] : await Crypto.exportPrivateKey(enc_keys[1]),
                ]
            }    
        }

        if (local_cache == false) endpoint_config.temporary = true;

        endpoint_config.endpoint = endpoint;
        endpoint_config.keys = keys;
        endpoint_config.save();

        // save own keys
        await Crypto.loadOwnKeys(...sign_keys, ...enc_keys);

        // start runtime + set endpoint
        Runtime.init(endpoint);

        // bind keys to initialized endpoint (already done for @@local in Crypto.loadOwnKeys)
        Crypto.saveOwnPublicKeysInEndpointKeyMap()

        this.#initialized = true;

        return endpoint;
    }


    // load stuff ...


    public static async getLocalEndpointAndKeys():Promise<[Endpoint, Crypto.ExportedKeySet]> {
        let endpoint: Endpoint|undefined;

        if (client_type != "deno") {
            // if endpoint cookie does not match the local endpoint, we clear the config and create a new one
            const didEndpointChange = endpoint_config?.endpoint?.main && Endpoint.getFromCookie()?.main !== endpoint_config.endpoint.main;
            
            // if endpoint has already had a session or validation but lost the keys due to localStorage.clear we also request a new endpoint & key pairs
            // We have to purge everything in this case to avoid duplicate endpoint creation due to existing session
            const hasLostKeys = getCookie("datex-endpoint-validation") && !endpoint_config.keys;
            if (hasLostKeys)
                reset();
            else if (didEndpointChange)
                endpoint_config.clear();

        }

        // create new endpoint
        if (!endpoint_config.endpoint) endpoint = await this.createAndSaveNewEndpoint();
        // existing endpoint already in cache
        else {
            try {endpoint = val(endpoint_config.endpoint);}
            catch {
                logger.error("Error getting Config Value 'endpoint'");
                endpoint = await this.createAndSaveNewEndpoint();
            }
        }

        // implicitly create new anonymous endpoint, if set to @@local
        if (endpoint == Datex.LOCAL_ENDPOINT) endpoint = undefined;

        if (!(endpoint instanceof Endpoint)) {
            if (endpoint !== undefined) logger.error("Config Value 'endpoint' is not of type <Endpoint>", endpoint);
            endpoint = await this.createAndSaveNewEndpoint();
        } 
   
        // return endpoint + keys
        return [endpoint, await this.getKeysOrGenerateNew()];
    }

    /**
     * Create new anonymous endpoint or load from "datex-endpoint" cookie + "new_keys" entry
     */
    private static createAndSaveNewEndpoint() {
        const endpoint = Endpoint.getFromCookie() ?? Endpoint.getNewEndpoint();
        endpoint_config.endpoint = endpoint;
        endpoint_config.save();
        return endpoint;
    }

    private static async getKeysOrGenerateNew(): Promise<Crypto.ExportedKeySet>{
        // get existing sign + enc keys
        let keys = endpoint_config.keys;
        // invalid, create new
        if (!keys || !keys.sign?.[0] || !keys.sign?.[1] || !keys.encrypt?.[0] || !keys.encrypt?.[1]) {
            // logger.info("creating new keys");
            keys = await Crypto.createOwnKeys();
        }

        return keys;
    }
    
}