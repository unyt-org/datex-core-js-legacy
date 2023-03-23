
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

import {client_type} from "../utils/global_values.ts";
import { Endpoint, filter_target_name_id, Target } from "../types/addressing.ts";


import { Logger } from "../utils/logger.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { buffer2hex } from "../utils/utils.ts";
import { endpoint_config } from "../runtime/endpoint_config.ts";
import { endpoint_name, UnresolvedEndpointProperty } from "../datex_all.ts";
const logger = new Logger("DATEX Supranet");

// entry point to connect to the datex network
export class Supranet {

    static NODES_LIST_URL =  '/unyt_core/dx_data/nodes.dx' //'https://docs.unyt.org/unyt_web/unyt_core/dx_data/nodes.dx';

    static available_channel_types:string[] = []; // all available interface channel types, sorted by preference

    static #connected = false;

    static get connected(){return this.#connected}

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
    public static async connect(endpoint?:Endpoint|UnresolvedEndpointProperty, local_cache = true, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], via_node?:Endpoint) {

        if (this.#connected && (!endpoint || endpoint === Runtime.endpoint)) {
            logger.info("already connected as", Runtime.endpoint);
            return true;
        }

        // load runtime, own endpoint, nodes
        this.#connected = false;
        endpoint = await this.init(endpoint, local_cache, sign_keys, enc_keys)

        // already connected to endpoint during init
        if (this.#connected && endpoint === Runtime.endpoint) {
            logger.success("Connected to the supranet as " + endpoint)
            for (const i of InterfaceManager.active_interfaces) {
                if (i.type != "local") this.sayHello(i.endpoint)
            }
            return true;
        } 

        return this._connect(via_node);
    }

    private static async _connect(via_node?:Endpoint) {
        // find node for available channel
        const [node, channel_type] = await this.getNode(via_node)

        await InterfaceManager.disconnect() // first disconnect completely
        const connected = await InterfaceManager.connect(channel_type, node)

        Runtime.setMainNode(node);

        if (!connected) logger.error("connectionn failed")
        else if (this.onConnect) this.onConnect();

        this.#connected = connected;

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

    // @override
    public static onConnect = ()=>{
        logger.success("Connected as **"+Runtime.endpoint+"** to the Supranet via **" +  CommonInterface.default_interface.endpoint + "** (" + CommonInterface.default_interface.type + ")" )
    }

    // only init, don't (re)connect
    public static async init(endpoint?:Endpoint|UnresolvedEndpointProperty|endpoint_name, local_cache = true, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey]):Promise<Endpoint>  {

        if (typeof endpoint == "string") endpoint = await Endpoint.fromStringAsync(endpoint);

        await endpoint_config.load(); // load config from storage/file

        let keys:Crypto.ExportedKeySet|undefined;

        // load/create endpoint from cache?
        if (!endpoint) {
            if (local_cache) {
                [endpoint, keys] = await this.getLocalEndpointAndKeys();
                sign_keys = keys.sign;
                enc_keys = keys.encrypt;
            }
            else endpoint = <Endpoint>Target.get(this.createEndpointId());
        }
        // first resolve endpoint, connect anonymous
        if (endpoint instanceof UnresolvedEndpointProperty) {
            const tmp_endpoint = <Endpoint> Endpoint.get(Endpoint.createNewID());
            await this._init(tmp_endpoint, true, sign_keys, enc_keys, keys);
            await this._connect();
            const res = await endpoint.resolve(); 
            // use fallback tmp_endpoint if endpoint property is void
            if (res === undefined) {
                logger.success `
    Created a new endpoint (${tmp_endpoint}) intended to be used as ${endpoint.parent}.${endpoint.property}.
    If you have write access to ${endpoint.parent}, you can set ${endpoint.parent}.${endpoint.property} = ${tmp_endpoint}.
    If you are the owner of ${endpoint.parent}, you can create a certificate for ${tmp_endpoint} with the public keys:
    
    🔑 VERIFY: ${Crypto.getOwnPublicKeysExported()[0]}
    🔑 ENCRYPT: ${Crypto.getOwnPublicKeysExported()[1]}
    `
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

    private static async _init(endpoint:Endpoint, local_cache = true, sign_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], enc_keys?:[ArrayBuffer|CryptoKey,ArrayBuffer|CryptoKey], keys?:Crypto.ExportedKeySet) {
       
        // load/create keys, even if endpoint was provided?
        if (!sign_keys || !enc_keys) {
            keys = await this.getKeysOrGenerateNew();
            sign_keys = keys.sign;
            enc_keys = keys.encrypt;
        }
        else if (local_cache) { // new keys were provided, save in storage
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

        if (local_cache) {
            endpoint_config.endpoint = endpoint;
            endpoint_config.keys = keys;
            endpoint_config.save();
        }

        // start runtime + set endpoint
        await Runtime.init(endpoint);

        // save own keys
        await Crypto.loadOwnKeys(...sign_keys, ...enc_keys);
     
        // setup interface manager
        if (!this.#interfaces_initialized) {
            this.#interfaces_initialized = true;
            await InterfaceManager.init()
            this.setListeners();    
        }

        return endpoint;
    }


    // load stuff ...

    // 8 bytes timestamp + 8 bytes random number
    private static createEndpointId():filter_target_name_id{
        const id = new DataView(new ArrayBuffer(16));
        const timestamp = Math.round((new Date().getTime() - Compiler.BIG_BANG_TIME));
        id.setBigUint64(0, BigInt(timestamp), true); // timestamp
        id.setBigUint64(8, BigInt(Math.floor(Math.random() * (2**64))), true); // random number
        return `@@${buffer2hex(new Uint8Array(id.buffer))}`;
    }

    public static async getLocalEndpointAndKeys():Promise<[Endpoint|UnresolvedEndpointProperty, Crypto.ExportedKeySet]> {
        let endpoint: Endpoint|UnresolvedEndpointProperty;

        // create new endpoint
        if (!endpoint_config.endpoint) endpoint = await this.createAndSaveNewEndpoint();
        // existing endpoint already in cache
        else {
            try {endpoint = endpoint_config.endpoint;}
            catch {
                logger.error("Error getting Config Value 'endpoint'");
                endpoint = await this.createAndSaveNewEndpoint();
            }
        }

        if (!(endpoint instanceof Endpoint || endpoint instanceof UnresolvedEndpointProperty)) {
            logger.error("Config Value 'endpoint' is not of type <Endpoint>");
            endpoint = await this.createAndSaveNewEndpoint();
        } 
   
        // return endpoint + keys
        return [endpoint, await this.getKeysOrGenerateNew()];
    }

    private static createAndSaveNewEndpoint(){
        const endpoint = <Endpoint> Endpoint.get(this.createEndpointId());
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

    // important network methods

    public static sayHello(node:Endpoint = Runtime.main_node){
        // TODO REPLACE, only temporary as placeholder to inform router about own public keys
        const keys = Crypto.getOwnPublicKeysExported();
        Runtime.datexOut(['?', [keys], {type:ProtocolDataType.HELLO, sign:false, flood:true, __routing_ttl:1}], undefined, undefined, false, false)
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