/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  Datex Client                                                                        ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Default JS client for datex protocol (support WebSockets, Get Requests)             ║
 ║  Visit https://docs.unyt.cc/datex for more information                               ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2020 unyt.org                        ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */

import { Logger } from "../utils/logger.ts";
import { Runtime } from "../runtime/runtime.ts";

import { Compiler } from "../compiler/compiler.ts";
import { Endpoint, LOCAL_ENDPOINT, Target } from "../types/addressing.ts";
import { NetworkError } from "../types/errors.ts";
import type { dxb_header } from "../utils/global_types.ts";
import { client_type } from "../utils/global_values.ts";
import { Disjunction } from "../types/logic.ts";
import { Pointer } from "../runtime/pointers.ts";




// general interface for all "datex interfaces" (client or server/router)
export interface ComInterface {
    type: string
    persistent?: boolean // can be disconnected?
    endpoint?: Endpoint // connected directly to a single endpoint
    endpoints?: Set<Endpoint> // multiple endpoints
    in: boolean // can receive data
    out: boolean // can send data
    global?: boolean // has a connection to the global network, use as a default interface if possible
    send: (datex:ArrayBuffer, to?: Target)=>Promise<void>|void
    disconnect: ()=>void|Promise<void>
}


/** common class for all client interfaces (WebSockets, TCP Sockets, GET Requests, ...)*/
export abstract class CommonInterface implements ComInterface {

    // endpoint interface mapping
    protected static endpoint_connection_points = new Map<Target, Set<ComInterface>>();
    protected static indirect_endpoint_connection_points = new Map<Target, Set<ComInterface>>();
    protected static virtual_endpoint_connection_points = new Map<Target, Set<ComInterface>>();

    // DIRECT (direct end-to-end connection)

    public static addInterfaceForEndpoint(endpoint:Target, com_interface:ComInterface) {
        if (!this.endpoint_connection_points.has(endpoint)) this.endpoint_connection_points.set(endpoint, new Set());
        this.endpoint_connection_points.get(endpoint).add(com_interface);
    }
    // does an endpoint have an explicit (direct) interface on this endpoint
    public static hasDirectInterfaceForEndpoint(endpoint:Target):boolean {
        return this.endpoint_connection_points.has(endpoint) && this.endpoint_connection_points.get(endpoint)?.size != 0;
    }
    // get a list of all currently available direct interfaces for an endpoint
    public static getInterfacesForEndpoint(endpoint:Target, interface_type?:string) {
        return this.endpoint_connection_points.get(endpoint) || new Set();
    }


    // INDIRECT (connected via a node)

    public static addIndirectInterfaceForEndpoint(endpoint:Target, com_interface:ComInterface) {
        if (!this.indirect_endpoint_connection_points.has(endpoint)) this.indirect_endpoint_connection_points.set(endpoint, new Set());
        this.indirect_endpoint_connection_points.get(endpoint).add(com_interface);
    }
    // is an endpoint reachable via a specific endpoint (indirectly)
    public static isEndpointReachableViaInterface(endpoint:Target):boolean {
        return this.indirect_endpoint_connection_points.has(endpoint) && this.indirect_endpoint_connection_points.get(endpoint)?.size != 0;
    }
    // get a list of all currently available indirect interfaces for an endpoint
    public static getIndirectInterfacesForEndpoint(endpoint:Target, interface_type?:string) {
        return this.indirect_endpoint_connection_points.get(endpoint) || new Set();
    }



    // VIRTUAL (just a relay connection, ignore for rooting)

    public static addVirtualInterfaceForEndpoint(endpoint:Target, com_interface:ComInterface) {
        if (!this.virtual_endpoint_connection_points.has(endpoint)) this.virtual_endpoint_connection_points.set(endpoint, new Set());
        this.virtual_endpoint_connection_points.get(endpoint).add(com_interface);
    }
    // get a list of all currently available virtual interfaces for an endpoint
    public static getVirtualInterfacesForEndpoint(endpoint:Target, interface_type?:string) {
        return this.virtual_endpoint_connection_points.get(endpoint) || new Set();
    }




    // get a list of all currently available direct interfaces
    public static getDirectInterfaces(): Set<ComInterface>{
        let all = new Set<ComInterface>();
        for (let e of this.endpoint_connection_points) {
            for (let interf of e[1]) {
                all.add(interf);
            }
        }
        return all;
    }

    public static resetEndpointConnectionPoints(){
        this.endpoint_connection_points.clear();
        this.indirect_endpoint_connection_points.clear()
    }

    protected logger:Logger;

    // use this per default for all outgoing datex requests
    public static default_interface:ComInterface;

    public type = "local"
    public persistent = false; // interface can be disconnected (per default)
    public authorization_required = true; // connect with public keys per default
    public endpoint:Endpoint;
    public endpoints = new Set<Endpoint>();
    public virtual = false; // only a relayed connection, don't use for DATEX rooting

    public in = true
    public out = true
    public global = true

    protected initial_arguments:any[];

    constructor(endpoint:Endpoint) {
        this.logger = new Logger(this.constructor.name);
        this.endpoint = endpoint;
    }

    // initialize
    async init(...args:any[]):Promise<boolean> {
        this.initial_arguments = args;

        this.connected = await this.connect();
        if (this.connected && this.endpoint) {
            if (this.virtual) CommonInterface.addVirtualInterfaceForEndpoint(this.endpoint, this);
            else CommonInterface.addInterfaceForEndpoint(this.endpoint, this);
        }
        return this.connected;
    }
    
    // create 'connection'
    protected abstract connect():Promise<boolean>|boolean

    // handle connection changes
    static CONNECTED = Symbol("connected")

    set connected(connected:boolean) {
        if (this.connected === connected) return;
        this[CommonInterface.CONNECTED] = connected
        if (!connected) InterfaceManager.handleInterfaceDisconnect(this);
        else InterfaceManager.handleInterfaceConnect(this);
    }
    get connected() {return this[CommonInterface.CONNECTED]?true:false}

    protected connecting = false;
    protected reconnecting = false;

    protected reconnect():Promise<boolean>{
        if (this.connected) this.connected = false; // (still) not connected
        
        if (this.reconnecting) return false;
        this.reconnecting = true;
        this.logger.info("trying to reconnnect...")
        return new Promise<boolean>(resolve=>{
            setTimeout(async ()=>{
                this.reconnecting = false;
                const connected = await this.connect();
                this.connected = connected;
                resolve(connected);
            }, 3000);
        })
    }

    public disconnect(){
        this.logger.info("Disconnecting interface: " + this.type)
    }

    protected async onConnected(){
    }

    /** implement how to send a message to the server*/
    protected abstract sendBlock(datex:ArrayBuffer)


    protected addEndpoint(endpoint:Endpoint) {
    this.endpoints.add(endpoint);
    CommonInterface.addInterfaceForEndpoint(endpoint, this);
    }

    //private datex_generators = new Set<AsyncGenerator<ArrayBuffer, ArrayBuffer>>();


    /** called from outside for requests */
    public async send(datex:ArrayBuffer):Promise<any> {
        await this.sendBlock(datex);   
    }
}


/** HTTP interface */
class HttpClientInterface extends CommonInterface {

    override type = "http"
    override authorization_required = false; // don't connect with public keys
    override in = false
    override out = true
    override global = false

    async connect() {
        return true;
    }

    async sendBlock(datex:ArrayBuffer){
        let res = await (await fetch("https://"+this.endpoint+"/http/"+fixedEncodeURIComponent("...todo..."))).text();
    }
}


/** 'Local' interface */
export class LocalClientInterface extends CommonInterface {

    override type = "local"
    override persistent = true; // cannot be disconnected
    override authorization_required = false; // don't connect with public keys
    override in = true
    override out = true
    override global = false

    async connect(){
        return true;
    }

    datex_in_handler = Runtime.getDatexInputHandler();

    async sendBlock(datex:ArrayBuffer){
        this.datex_in_handler(datex, Runtime.endpoint);
    }
}

/** 'Relayed' interface */
export class RelayedClientInterface extends CommonInterface {

    override type = "relayed"
    override authorization_required = false; // don't connect with public keys
    override in = true
    override out = true
    override global = false
    override virtual = true

    async connect(){
        return true;
    }

    async sendBlock(datex:ArrayBuffer){
        this.logger.error("invalid")
    }

    public override async send(datex:ArrayBuffer):Promise<any> {
        InterfaceManager.send(datex, this.endpoint);
    }
}


/** 'Bluetooth' interface */
export class BluetoothClientInterface extends CommonInterface {

    override type = "bluetooth"
    override authorization_required = false; // don't connect with public keys
    override in = true
    override out = true
    override global = false

    async connect(){
        console.log("connecting to bluetooth", this.initial_arguments);



        return true;
    }

    async sendBlock(datex:ArrayBuffer){
        console.log("bluetooth send block", datex)
    }
}

/** 'Serial' interface (USB, ...) */
export class SerialClientInterface extends CommonInterface {

    override type = "serial"
    override authorization_required = false; // don't connect with public keys
    override in = true
    override out = true
    override global = false

    private baudRate = 9600;
    private bufferSize = 255;

    private port: any
    private writer: any


    async connect(){

        if (!this.initial_arguments[0]) return false; // no port provided

        if (this.initial_arguments[0]) this.port = this.initial_arguments[0]
        if (this.initial_arguments[1]) this.baudRate = this.initial_arguments[1]
        if (this.initial_arguments[2]) this.bufferSize = this.initial_arguments[2]

        await this.port.open({ baudRate: this.baudRate, bufferSize:this.bufferSize});

        this.in = this.port.readable;
        this.in = this.port.writable;


        (async ()=>{
            while (this.port.readable) {
                const reader = this.port.readable.getReader();
            
                await InterfaceManager.handleReceiveContinuosStream(reader, this.endpoint);
            }
        })()

        if (this.port.writable) {
            this.writer = this.port.writable.getWriter();
        }

        return true;
    }

    public override async disconnect() {
        super.disconnect();
        await this.port.close()
    }

    async sendBlock(datex:ArrayBuffer){
        return this.writer.write(datex);
    }
}




/** Websocket stream interface */
class WebsocketStreamClientInterface extends CommonInterface {

    override type = "websocketstream"
    override in = true
    override out = true
    
    override global = true

    public host:string
    private stream_writer
    private wss

    closed = false;

    private is_node_js

    override async init() {

        this.host = this.endpoint.getInterfaceChannelInfo("websocketstream");
        if (!this.host) return false;

        return super.init();
    }
    

    protected async connect():Promise<boolean> {
        if (this.closed) return false;
        if (this.connecting) return false;


        if (!WebSocketStream) return false;

        this.connecting = true;

        try {
            this.wss = new WebSocketStream("wss://"+this.host, {protocols: ['datex']});
            
            (async ()=>{
                try {
                    const {code, reason} = await this.wss.closed;
                    this.logger.error("connection closed");
                    this.connecting = false;
                    this.reconnect();
                } catch(e) { }
            })();

            // connect, get reader and writer
            let x = await this.wss.connection;
            const {readable, writable} = x;
            const reader = readable.getReader();
            this.stream_writer = writable.getWriter();

            (async ()=>{
                try {
                    while (true) {
                        const {value, done} = await reader.read();        
                        if (done) {
                            this.logger.error("stream done")
                            break;
                        } 
                        InterfaceManager.handleReceiveBlock(value, this.endpoint);
                    }
                } catch (e) {
                    this.logger.error("connection error: " + "wss://"+this.host);
                    this.connecting = false;
                    this.reconnect();
                }
            })();

            this.connecting = false;
            return true
        }
        
        catch (e) {
            this.logger.error("connection error:" + "wss://"+this.host);
            this.connecting = false;
            return this.reconnect();
        }
    
    }

    async sendBlock(block:ArrayBuffer) {
        try {
            if (this.is_node_js) this.stream_writer.write(new Uint8Array(block));
            else await this.stream_writer.write(block);
        } catch(e) {
            console.log(e);
            throw new NetworkError("No connection");
        }
    }

    public override disconnect(){
        super.disconnect();
        this.wss.close()
        this.closed = true;
    }
}

/** Websocket interface */
class WebsocketClientInterface extends CommonInterface {

    public host:string

    private socket?:WebSocket;

    override in = true
    override out = true
    override type = "websocket"

    private protocol:'ws'|'wss' = 'wss'; // use wss or ws
    private is_first_try = true


    closed = false;

    override async init() {

        const host = this.endpoint.getInterfaceChannelInfo("websocket");
        if (host instanceof URL) {
            if (host.protocol == "http:") this.protocol = "ws"; // assume ws as websocket protocol, if host is http
            this.host = host.hostname; // convert https://xy -> xy
        }
        else this.host = host;

        if (!this.host) return false;

        return super.init();
    }

    protected connect():Promise<boolean>|boolean {

        // @ts-ignore navigator api, no internet connection
        if (client_type == "browser" && !navigator.onLine) {
            this.logger.error("No connected interface for supranet connection available")
            return false;
        }

        if (this.closed) return false;
        if (this.connecting) return false;
        this.connecting = true;

        try {
            this.socket = new WebSocket(`${this.protocol}://${this.host}`);    
            this.socket.binaryType = 'arraybuffer';

            return new Promise(resolve=>{
                // Connection opened
                this.socket!.addEventListener('open', () => {
                    this.connecting = false;
                    if (this.protocol == 'ws') this.logger.warn(`unsecure websocket connection to ${this.host}`)
                    resolve(true);
                });


                // this.socket.addEventListener('close', (event) => {
                //     this.connecting = false;
                //     this.logger.error("connection closed");
                //     this.reconnect();
                // });
                this.socket!.addEventListener('error', async (event) => {
                    this.connecting = false;
                    if (this.is_first_try && !globalThis.location?.href.startsWith("https://")) this.protocol = 'ws'
                    else {
                        this.protocol = 'wss'
                        this.logger.error("connection error:" + `${this.protocol}://${this.host}`);
                    }

                    this.is_first_try = false;
                    resolve(await this.reconnect());
                });

                this.socket!.addEventListener('message', (event:any) => {
                    InterfaceManager.handleReceiveBlock(event.data, this.endpoint);
                });

            })
        }
        
        catch (e) {
            this.logger.error("connection error:" + "wss://"+this.host);
            this.connecting = false;
            return this.reconnect();
        }
    
    }

    async sendBlock(block:ArrayBuffer) {
        if (!this.socket) throw "no socket connected";
        // web socket not connected, try reconnect
        if (this.socket.readyState != 1) {
            await this.reconnect()
        }
        try {
            this.socket.send(block);
        } catch {
            throw new NetworkError("No connection");
        }
    }

    public override disconnect(){
        super.disconnect();
        this.socket.close()
        this.closed = true;
    }
}



export class InterfaceManager {

    static logger = new Logger("DATEX Interface Manager");

    static datex_in_handler: (dxb: ArrayBuffer|ReadableStreamDefaultReader<Uint8Array> | {dxb: ArrayBuffer|ReadableStreamDefaultReader<Uint8Array>; variables?: any; header_callback?: (header: dxb_header) => void, new_endpoint_callback?: (endpoint: Endpoint) => void}, last_endpoint:Endpoint) => Promise<dxb_header|void>

    static local_interface:LocalClientInterface;

    static interfaces = new Map<string, typeof CommonInterface>();

    // register new DatexCommonInterface
    static registerInterface(channel_type:string, interf:typeof CommonInterface) {
        this.interfaces.set(channel_type,interf);
    }

    static receive_listeners = new Set<Function>();
    static new_interface_listeners = new Set<Function>();
    static interface_connected_listeners = new Set<Function>();
    static interface_disconnected_listeners = new Set<Function>();

    static active_interfaces: Set<ComInterface>


    static handleReceiveBlock(dxb:ArrayBuffer, last_endpoint?:Endpoint, header_callback?: (header: dxb_header) => void, new_endpoint_callback?: (endpoint: Endpoint) => void){
        if (header_callback || new_endpoint_callback) this.datex_in_handler({dxb, header_callback, new_endpoint_callback}, last_endpoint);
        else this.datex_in_handler(dxb, last_endpoint);
    }

    static handleReceiveContinuosStream(reader:ReadableStreamDefaultReader<Uint8Array>, last_endpoint, header_callback?: (header: dxb_header) => void, new_endpoint_callback?: (endpoint: Endpoint) => void) {
        if (header_callback || new_endpoint_callback) return this.datex_in_handler({dxb:reader, header_callback, new_endpoint_callback}, last_endpoint);
        else return this.datex_in_handler(reader, last_endpoint);
    }

    static addReceiveListener(listen:(datex:ArrayBuffer)=>void){
        this.receive_listeners.add(listen);
    }

    // connect to datex runtime (in/out)
    private static initialized = false;
    private static enabled = false;

    public static async init() {
        if (this.initialized) return;

        this.initialized = true;
        this.datex_in_handler = Runtime.getDatexInputHandler((sid, scope)=>{
            for (let p of this.receive_listeners) p(scope);
        });

        if (!this.active_interfaces) this.active_interfaces = Pointer.createOrGet(new Set<ComInterface>()).js_value;
    }


    // datex out is now redirected to this interface
    public static enable(){
        if (this.enabled) return;
        Runtime.setDatexOut(InterfaceManager.send);
        this.enabled = true;
    }


    static onNewInterface(listener:(interf:ComInterface)=>void) {
        this.new_interface_listeners.add(listener);
    }

    static onInterfaceConnected(listener:(interf:ComInterface)=>void) {
        this.interface_connected_listeners.add(listener);
    }
    static onInterfaceDisconnected(listener:(interf:ComInterface)=>void) {
        this.interface_disconnected_listeners.add(listener);
    }

    static async enableLocalInterface(endpoint:Endpoint=Runtime.endpoint):Promise<LocalClientInterface> {
        if (this.local_interface) return;
        this.local_interface = new LocalClientInterface(endpoint);
        // init requested interface
        let res = await this.local_interface.init();
        if (res) this.addInterface(this.local_interface);
        return this.local_interface
    }

    static async disconnect(){
    CommonInterface.default_interface = null;
    CommonInterface.resetEndpointConnectionPoints();

    for (const interf of this.active_interfaces || []) {
        await interf.disconnect()
        this.active_interfaces.delete(interf);
    } 
    }

    // create a new connection with a interface type (e.g. websocket, relayed...)
    static async connect(channel_type:string, endpoint?:Endpoint, init_args?:any[], set_as_default_interface = true):Promise<boolean> {
        this.logger.debug("connecting via interface: " + channel_type);

        await this.init();

        // get requested interface
        const interface_class = (<any>InterfaceManager.interfaces.get(channel_type));
        if (!interface_class) throw "Channel type not found: " + channel_type;
        const c_interface:CommonInterface = new interface_class(endpoint);
        // this.logger.success("new interface: " + channel_type)
        // init requested interface
        const res = await c_interface.init(...(init_args||[]));
        if (res) this.addInterface(c_interface);

        // set as new default interface? - local or relayed create a feedback loop, dont use webrtc as default interface
        if (set_as_default_interface && c_interface.global) CommonInterface.default_interface = c_interface

        this.enable();

        return res
    }

    // add an existing interface to the interface list
    static addInterface(i: ComInterface) {
        if (!this.active_interfaces) this.active_interfaces = Pointer.createOrGet(new Set<ComInterface>()).js_value;
        for (let l of this.new_interface_listeners) l(i)
        this.active_interfaces.add(i)
    }
    // remove an interface from the list
    static removeInterface(i: ComInterface) {
        if (!this.active_interfaces) this.active_interfaces = Pointer.createOrGet(new Set<ComInterface>()).js_value;
        this.active_interfaces.delete(i)
    }

    // disconnected
    static handleInterfaceDisconnect(i: ComInterface){
        for (let l of this.interface_disconnected_listeners) l(i)
    }
    // (re)connected
    static handleInterfaceConnect(i: ComInterface){
        for (let l of this.interface_connected_listeners) l(i)
    }

    /** main method to call send */
    // TODO: replace to with Disjunction<Endpoint>
    static async send(datex:ArrayBuffer, to:Endpoint, flood = false) {
        if (!InterfaceManager.checkRedirectPermission(to)) return;

        // flooding instead of sending to a receiver
        if (flood) {
            return InterfaceManager.flood(datex, to);
        }

        // currently only sending to one target at a time here! TODO: improve
        let addressed_datex = Compiler.updateHeaderReceiver(datex, new Disjunction(to)); // set right receiver

        // is self
        if (to instanceof Endpoint && (Runtime.endpoint.equals(to) || to === LOCAL_ENDPOINT)) {
            await InterfaceManager.datex_in_handler(addressed_datex, Runtime.endpoint);
            return;
        }
        // send via direct connection
        if (CommonInterface.hasDirectInterfaceForEndpoint(to)) {
            let i = [...CommonInterface.getInterfacesForEndpoint(to)][0];
            return await i.send(addressed_datex, to);  // send to first available interface (todo)
        }
        // send via indirect connection
        if (CommonInterface.isEndpointReachableViaInterface(to)) {
            let i = [...CommonInterface.getIndirectInterfacesForEndpoint(to)][0];
            return await i.send(addressed_datex, to); // send to first available interface (todo)
        }

        // indirect connection - send per default interface
        if (!CommonInterface.default_interface) {
            return InterfaceManager.handleNoRedirectFound(to);
        }

        //console.warn("sending to " + receiver + " via ", DatexCommonInterface.default_interface.type);
        return await CommonInterface.default_interface.send(addressed_datex, to);
    }

    // flood to all currently directly connected nodes (only nodes!)
    static flood(datex: ArrayBuffer, exclude: Target) {
        let exclude_endpoints = new Set([exclude]);

        // iterate over all active endpoints
        for (let interf of this.active_interfaces) {
            if (interf.endpoint && !exclude_endpoints.has(interf.endpoint) && !interf.endpoint.equals(Runtime.endpoint)) {
            exclude_endpoints.add(interf.endpoint);
            //console.log("FLOOD > " + interf.endpoint)
            interf.send(datex, interf.endpoint);
            }
            for (let endpoint of interf.endpoints??[]){
                if (!exclude_endpoints.has(endpoint)  && !interf.endpoint.equals(Runtime.endpoint)) {
                exclude_endpoints.add(endpoint);
                //console.log("FLOOD > " + endpoint)
                interf.send(datex, endpoint);
                }
            }
        }
    }

    // can be overwritten for clients
    static checkRedirectPermission(receiver: Target){
        return true; // allow all redirects per default
    }

    static handleNoRedirectFound(receiver:Target){
        throw new NetworkError("no active client interface found");
    }
}


// register interfaces
InterfaceManager.registerInterface("websocketstream", WebsocketStreamClientInterface);
InterfaceManager.registerInterface("websocket", WebsocketClientInterface);
InterfaceManager.registerInterface("local", LocalClientInterface);
InterfaceManager.registerInterface("relayed", RelayedClientInterface);
InterfaceManager.registerInterface("bluetooth", BluetoothClientInterface);
InterfaceManager.registerInterface("serial", SerialClientInterface);

globalThis.DatexInterfaceManager = InterfaceManager;
globalThis.DatexCommonInterface = CommonInterface;

export default InterfaceManager;

function fixedEncodeURIComponent(str) {
    return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
        return '%' + c.charCodeAt(0).toString(16);
    });
}

