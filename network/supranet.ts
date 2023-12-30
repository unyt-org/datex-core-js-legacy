
/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  Datex Cloud - Entrypoint                                                            ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Visit https://docs.unyt.org/datex for more information                              ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2021 unyt.org                        ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */

import InterfaceManager, { CommonInterface } from "./client.ts"
import { Compiler } from "../compiler/compiler.ts";
import { Runtime } from "../runtime/runtime.ts";
import { Crypto } from "../runtime/crypto.ts";

import {client_type} from "../utils/constants.ts";
import { Endpoint, filter_target_name_id, Target } from "../types/addressing.ts";


import { Logger } from "../utils/logger.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { buffer2hex } from "../utils/utils.ts";
import { endpoint_config } from "../runtime/endpoint_config.ts";
import { endpoint_name, UnresolvedEndpointProperty } from "../datex_all.ts";
import { Datex } from "../mod.ts";
import { Storage } from "../runtime/storage.ts";
import { sendDatexViaHTTPChannel } from "./datex-http-channel.ts";
const logger = new Logger("DATEX Supranet");

// entry point to connect to the datex network
export class Supranet {

    static available_channel_types:string[] = []; // all available interface channel types, sorted by preference

    static #connected = false;
    static get connected(){return this.#connected}

    static #initialized = false;
    static get initialized(){return this.#initialized}

    // add listeners for interface changes
    private static listeners_set = false;
    private static setListeners(){
        if (this.listeners_set) return;
        this.listeners_set = true;
        // say hello when (re)connected
        InterfaceManager.onInterfaceConnected((i)=>{
            logger.debug("interface connected: "+ i.endpoint + " - " + i.type);
            if (i.type != "local") this.sayHello(i.endpoint)
        })
        InterfaceManager.onInterfaceDisconnected((i)=>{
            logger.debug("interface disconnected: "+ i.endpoint + " - " + i.type);
            // TODO: validate this
            if (!InterfaceManager.active_interfaces.size) this.#connected = false;
        })
    }

    // connect without cache and random endpoint id
    public static connectAnonymous(){
        return this.connect(undefined, false);
    }

    // connect without cache
    public static connectTemporary(endpoint?:Endpoint){
        return this.connect(endpoint, false);
    }

    // connect to cloud, say hello with public key
    // if local_cache=false, a new endpoint is created and not saved in the cache, even if an endpoint is stored in the cache
    // TODO problem: using same keys as stored endpoint!
    public static async connect(endpoint?:Endpoint|UnresolvedEndpointProperty, local_cache?: boolean, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], via_node?:Endpoint) {

        if (this.#connected && (!endpoint || endpoint === Runtime.endpoint)) {
            // logger.info("already connected as", Runtime.endpoint);
            return true;
        }

        // load runtime, own endpoint, nodes
        this.#connected = false;
        endpoint = await this.init(endpoint, local_cache, sign_keys, enc_keys)

        const shouldSwitchInstance = this.shouldSwitchInstance(endpoint);

        // switching from potentially instance to another instance, make sure current endpoint is not an already active instance
        if (shouldSwitchInstance && endpoint !== endpoint.main) Runtime.init(endpoint.main);

        // already connected to endpoint during init
        if (this.#connected && endpoint === Runtime.endpoint) {
            const switched = shouldSwitchInstance ? await this.handleSwitchToInstance() : false;
            logger.success("Connected to the supranet as " + endpoint)
            if (!switched) this.sayHelloToAllInterfaces();
            return true;
        }

        const connected = await this._connect(via_node, !shouldSwitchInstance);
        if (shouldSwitchInstance) await this.handleSwitchToInstance()

        return connected;
    }

    private static sayHelloToAllInterfaces() {
        for (const i of InterfaceManager.active_interfaces) {
            if (i.type != "local") this.sayHello(i.endpoint)
        }
    }

    private static shouldSwitchInstance(endpoint: Endpoint) {
        // return false;
        return (endpoint.main === endpoint || Runtime.getActiveLocalStorageEndpoints().includes(endpoint)) && Runtime.Blockchain
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
                this.sayHelloToAllInterfaces();
                logger.success("Switched to endpoint instance " + instance)
                this.handleConnect();
                return true;
            }
            catch {
                logger.error("Could not determine endpoint instance (request error)");
                this.sayHelloToAllInterfaces();
                this.handleConnect();
            }
        }
        
        return false;
    }

    private static async _connect(via_node?:Endpoint, handleOnConnect = true) {
        // find node for available channel
        const [node, channel_type] = await this.getNode(via_node)

        await InterfaceManager.disconnect() // first disconnect completely
        const connected = await InterfaceManager.connect(channel_type, node)

        Runtime.setMainNode(node);

        if (!connected) logger.error("connection failed")
        else if (handleOnConnect) this.handleConnect();

        this.#connected = connected;

        // validate current keys against official public keys in network 
        // TODO: (does not work because response never reaches endpoint if valid endpoint already exists in network)
        // Crypto.validateOwnKeysAgainstNetwork();

        // send goodbye on process close
        Runtime.goodbyeMessage = <ArrayBuffer> await Datex.Compiler.compile("", [], {type:Datex.ProtocolDataType.GOODBYE, sign:true, flood:true, __routing_ttl:10})

        return connected;
    }


    static getNode(use_node?:Endpoint) {
        // channel types?
        // @ts-ignore
        if (globalThis.WebSocketStream || client_type!="browser") this.available_channel_types.push("websocketstream")
        this.available_channel_types.push("websocket");

        // find node for available channel
        const [node, channel_type] = endpoint_config.getNodeWithChannelType(this.available_channel_types, use_node);
        if (!node) throw ("Cannot find a node that support any channel type of: " + this.available_channel_types + (use_node ? " via " + use_node : ''));
        if (!channel_type) throw("No channel type for node: " + node);
        return <[Endpoint,string]> [node, channel_type]
    }

    private static handleConnect() {
        for (const listener of this.#connectListeners) listener();
        if (this.onConnect) this.onConnect()
    }

    // @override
    public static onConnect = ()=>{
        logger.success("Connected as **"+Runtime.endpoint+"** to the Supranet via **" +  CommonInterface.default_interface.endpoint + "** (" + CommonInterface.default_interface.type + ")" )
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

    static #interfaces_initialized = false

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

        // setup interface manager
        if (!this.#interfaces_initialized) {
            this.#interfaces_initialized = true;
            await InterfaceManager.init()
            this.setListeners();    
        }

        this.#initialized = true;

        return endpoint;
    }


    // load stuff ...


    public static async getLocalEndpointAndKeys():Promise<[Endpoint|UnresolvedEndpointProperty, Crypto.ExportedKeySet]> {
        let endpoint: Endpoint|UnresolvedEndpointProperty;

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

        if (!(endpoint instanceof Endpoint || endpoint instanceof UnresolvedEndpointProperty)) {
            if (endpoint !== undefined) logger.error("Config Value 'endpoint' is not of type <Endpoint>", endpoint);
            endpoint = await this.createAndSaveNewEndpoint();
        } 
   
        // return endpoint + keys
        return [endpoint, await this.getKeysOrGenerateNew()];
    }

    /**
     * Create new anonymous endpoint or load from "datex-endpoint" cookie + "new_keys" entry
     */
    private static createAndSaveNewEndpoint(){
        const {endpoint, keys} = Endpoint.getFromCookie() ?? {endpoint: <Endpoint> Endpoint.get(Endpoint.createNewID())};
        endpoint_config.endpoint = endpoint;
        if (keys) endpoint_config.keys = keys;
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

    // important network methods

    public static sayHello(node:Endpoint = Runtime.main_node){
        // TODO REPLACE, only temporary as placeholder to inform router about own public keys
        const keys = Crypto.getOwnPublicKeysExported();
        logger.debug("saying hello as " + Runtime.endpoint)
        Runtime.datexOut(['?', [keys], {type:ProtocolDataType.HELLO, sign:false, flood:true, __routing_ttl:10}], undefined, undefined, false, false)
        // send with plain endpoint id as sender
        // if (Runtime.endpoint.id_endpoint !== Runtime.endpoint) Runtime.datexOut(['?', [keys], {type:ProtocolDataType.HELLO, sign:false, flood:true, force_id:true, __routing_ttl:1}], undefined, undefined, false, false)
    }

    // ping all endpoints with same base (@endpoint/*) 
    public static async findOnlineEndpoints(endpoint:Endpoint){
        // TODO
        //await this.pingEndpoint(Target.get(<Endpoint_name>endpoint.toString()))
    }


    // get DATEX roundtime/ping for endpoint
    public static async pingEndpoint(endpoint_or_string:string|Endpoint, sign=false, encrypt=false) {
        let endpoint = endpoint_or_string instanceof Endpoint ? endpoint_or_string : Endpoint.get(endpoint_or_string);
        const start_time = new Date().getTime();
        const half_time = (await Runtime.datexOut(['<time>()', undefined, {sign, encrypt}], endpoint)).getTime()
        const roundtrip_time = new Date().getTime();
        logger.success(`

    Endpoint:       ${endpoint}
    Roundtrip time: ${roundtrip_time-start_time } ms
        `);
        /*
            ---> ${half_time-start_time} ms
            <--- ${roundtrip_time-half_time} ms
        */
    }
    
}