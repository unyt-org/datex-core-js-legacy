import type { dxb_header } from "../utils/global_types.ts";
import { Endpoint, BROADCAST, LOCAL_ENDPOINT } from "../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, ConnectedCommunicationInterfaceSocket } from "./communication-interface.ts";
import { Disjunction } from "../types/logic.ts";
import "../utils/auto_map.ts";
import { InterfaceDirection } from "./communication-interface.ts";
import { ESCAPE_SEQUENCES, Logger } from "../utils/logger.ts";
import { NetworkError } from "../types/errors.ts";
import { Compiler } from "../compiler/compiler.ts";
import { Runtime } from "../runtime/runtime.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { Crypto } from "../runtime/crypto.ts";
import { IOHandler } from "../runtime/io_handler.ts";
import { DATEX_ERROR } from "../types/error_codes.ts";
import { LocalLoopbackInterface, LocalLoopbackInterfaceSocket } from  "./communication-interfaces/local-loopback-interface.ts";
import { WindowInterface } from  "./communication-interfaces/window-interface.ts";

import { Datex } from "../mod.ts";
import { Supranet } from "./supranet.ts";

export type DatexInData = {
    dxb: ArrayBuffer|ReadableStreamDefaultReader<Uint8Array>,
    socket: CommunicationInterfaceSocket
}

export type DatexOutData = {
    dxb: ArrayBuffer,
    receivers: Endpoint|Disjunction<Endpoint>, // @@any for broadcasts
    socket: CommunicationInterfaceSocket
}

/**
 * Callback for handling incoming datex blocks
 */
export type DatexInHandler = (data: DatexInData) => Promise<dxb_header>

/**
 * Public communication access point for managing
 * CommunicationInterfaces
 */
export class CommunicationHub {

    // singleton
    private constructor() {}
    static #instance?: CommunicationHub
    static get() {
        if (!this.#instance) this.#instance = new CommunicationHub()
        return this.#instance;
    }

    get connected() {
        return this.handler.connected;
    }

    get defaultSocket() {
        return this.handler.defaultSocket;
    }

    public clear() {
        return this.handler.clear();
    }

    /**
     * Registers a new CommunicationInterface and initializes it
     * @param comInterface - CommunicationInterface to add
     * @param setAsDefault - set as default interface for sending DATEX messages
     * @param timeout - timeout in ms for interface initialization (default: no timeout)
     * @returns true if the interface was successfully initialized, false if connection could not be established after timeout if specified
     */
    public addInterface(comInterface: CommunicationInterface, setAsDefault = false, timeout?: number) {
        return this.handler.addInterface(comInterface, setAsDefault, timeout);
    }

    public removeInterface(comInterface: CommunicationInterface) {
        return this.handler.removeInterface(comInterface);
    }

    /**
     * Prints the status of all connected interfaces and attached sockets
     */
    public printStatus() {
        return this.handler.printStatus();
    }

    /**
     * Lists all available sockets for an endpoint, ordered by relevance
     */
    public printEndpointSockets(endpoint: Endpoint) {
        return this.handler.printEndpointSockets(endpoint);
    }


    /**
     * @private
     */
    handler = new CommunicationHubHandler()

}


export const COM_HUB_SECRET = Symbol("COM_HUB_SECRET")

type DynamicProperties = {
    knownSince: number,
    distance: number
}

/**
 * Internal handler for managing CommunicationInterfaces
 */
export class CommunicationHubHandler {

    /**
     * Interval for checking online status for indirect/direct socket endpoints
     */
    readonly CLEANUP_INTERVAL = 10 * 60 * 1000; // 10min
    #connected = false;
    get connected() {
        return this.#connected;
    }
    private updateConnectionStatus() {
        const isConnected = this.isConnected();
        if (isConnected !== this.connected) {
            this.#connected = isConnected;
            Supranet._setConnected(this.#connected);
            this.#logger.debug(`Connection status was changed. This endpoint (${Datex.Runtime.endpoint}) is ${isConnected ? "online" : "offline"}!`);
            if (this.#connected)
                this.onlineEvents.forEach(e => e());
        }
    }
    public async clear() {
        for (const iterf of this.#interfaces) {
            if (!(iterf instanceof LocalLoopbackInterface)) {
                await this.removeInterface(iterf);
                this.#logger.warn("Removing interface " + iterf);
            }
        }
    }
    
    private onlineEvents = new Set<() => unknown>();
    public addOnlineHandler(method: () => unknown) {
        this.onlineEvents.add(method);
    }
    public removeOnlineHandler(method: () => unknown) {
        this.onlineEvents.delete(method);
    }

    private isConnected() {
        if (this.#defaultInterface?.getSockets().size) {
            return true;
        }
        for (const socket of this.iterateSockets(true)) {
            if (!(socket instanceof LocalLoopbackInterfaceSocket)) {
                return true;
            }
        }
        return false;
    }

    #logger = new Logger("CommunicationHub")
    
    #interfaces = new Set<CommunicationInterface>()
    // CommunicationInterfaceSockets are ordered, most recent last
    #endpointSockets = new Map<Endpoint, Map<ConnectedCommunicationInterfaceSocket, DynamicProperties>>().setAutoDefault(Map).enableAutoRemove()
    #registeredSockets = new Map<ConnectedCommunicationInterfaceSocket, Set<Endpoint>>().setAutoDefault(Set).enableAutoRemove()

    get registeredSockets() {
        return this.#registeredSockets;
    }
    get endpointSockets() {
        return this.#endpointSockets;
    }
    get interfaces() {
        return this.#interfaces;
    }

    // maps main endpoints to a list of instance endpoints that are currently connected via sockets
    #activeEndpointInstances = new Map<Endpoint, Set<Endpoint>>().setAutoDefault(Set).enableAutoRemove()

    #defaultInterface?: CommunicationInterface
    #defaultSocket?: ConnectedCommunicationInterfaceSocket

    set defaultSocket(socket: ConnectedCommunicationInterfaceSocket|undefined) {
        this.#defaultSocket = socket;
        if (this.#defaultSocket) Runtime.setMainNode(this.#defaultSocket.endpoint);
    }
    get defaultSocket() {
        return this.#defaultSocket;
    }

    #datexInHandler?: DatexInHandler

    directionSymbols = {
        [InterfaceDirection.IN]: "◀──",
        [InterfaceDirection.OUT]: "──▶",
        [InterfaceDirection.IN_OUT]: "◀─▶"
    }

    constructor() {
        this.startCleanupInterval();
    }

    /** Public facing methods: **/

    public async addInterface(comInterface: CommunicationInterface, setAsDefault = false, timeout?: number) {
        this.#interfaces.add(comInterface)
        const connected = await comInterface.init(COM_HUB_SECRET, timeout);
        if (connected && setAsDefault) this.setDefaultInterface(comInterface)
        if (!connected) this.#interfaces.delete(comInterface);
        this.updateConnectionStatus();
        return connected
    }

    public async removeInterface(comInterface: CommunicationInterface) {
        this.#interfaces.delete(comInterface)
        await comInterface.deinit(COM_HUB_SECRET);
        this.updateConnectionStatus();
    }

    public printStatus() {
        console.log(this.getStatus())
    }

    public getStatus() {
        let string = "";
        string += ESCAPE_SEQUENCES.BOLD + "DATEX Communication Hub\n\n" + ESCAPE_SEQUENCES.RESET;
        string += `Local Endpoint: ${Runtime.endpoint}\n`
        string += `Registered Interfaces: ${this.#interfaces.size}\n`
        string += `Connected Sockets: ${this.#registeredSockets.size}\n\n`

        const mapping = new Map<string, Map<CommunicationInterfaceSocket, {directEndpoint?: Endpoint, directEndpointDynamicProperties?: DynamicProperties, indirectEndpoints: Map<Endpoint, DynamicProperties>}>>()

        const endpointPreferredSockets = new Map<Endpoint, CommunicationInterfaceSocket|undefined>()

        // interfaces with direct sockets
        for (const comInterface of this.#interfaces) {
            const sockets = new Set(
                [...comInterface.getSockets()]
                    .map(socket => [socket.endpoint, socket] as [Endpoint, ConnectedCommunicationInterfaceSocket])
            )
            const identifier = comInterface.toString()
            if (!mapping.has(identifier)) mapping.set(identifier, new Map())
            sockets.forEach(([endpoint, socket]) => mapping.get(identifier)!.set(socket, {directEndpoint: endpoint, directEndpointDynamicProperties: this.#endpointSockets.get(endpoint)?.get(socket), indirectEndpoints: new Map()}))
        }

        // indirect connections
        for (const [endpoint, sockets] of this.#endpointSockets) {
            for (const [socket, dynamicProperties] of sockets) {
                // check if endpoint is indirect
                if (socket.endpoint !== endpoint) {
                    if (!socket.interfaceProperties) {
                        console.warn("Invalid socket, missing interfaceProperties", socket);
                        continue;
                    }
                    const identifier = socket.toString();
                    if (!mapping.has(identifier)) mapping.set(identifier, new Map());
                    if (!mapping.get(identifier)!.has(socket)) mapping.get(identifier)!.set(socket, {indirectEndpoints: new Map});

                    mapping.get(identifier)!.get(socket)!.indirectEndpoints.set(endpoint, dynamicProperties);
                }
            }
        }
 
        string += "Default interface: " + (this.#defaultInterface ? this.#defaultInterface.toString() : "none") + "\n";

        const COLORS = {
            DARK_GREEN: [41, 120, 83],
            DARK_RED: [120, 41, 53],
            DARK_GREY: [110, 110, 110],
        }
        const DARK_GREEN = `\x1b[38;2;${COLORS.DARK_GREEN.join(';')}m`
        const DARK_GREY = `\x1b[38;2;${COLORS.DARK_GREY.join(';')}m`
        const DARK_RED = `\x1b[38;2;${COLORS.DARK_RED.join(';')}m`

        const getFormattedSocketString = (socket: CommunicationInterfaceSocket, endpoint: Endpoint, dynamicProperties: DynamicProperties) => {
            if (socket.interfaceProperties?.noContinuousConnection && endpoint == BROADCAST) return "";

            if (!endpointPreferredSockets.has(endpoint)) endpointPreferredSockets.set(endpoint, this.getPreferredSocketForEndpoint(endpoint));
            const isPreferred = endpointPreferredSockets.get(endpoint)! === socket;

            const directionSymbolColor = isPreferred ? ESCAPE_SEQUENCES.BOLD : ESCAPE_SEQUENCES.GREY;
            const directionSymbol =  directionSymbolColor + this.directionSymbols[socket.interfaceProperties?.direction as InterfaceDirection] ?? "?";
            const isDirect = socket.endpoint === endpoint;
            const color = socket.connected ? 
                (
                    socket.endpoint ? 
                    (isDirect ? ESCAPE_SEQUENCES.UNYT_GREEN : DARK_GREEN) :
                    (isDirect ? ESCAPE_SEQUENCES.UNYT_GREY : DARK_GREY)
                ) : 
                (isDirect ? ESCAPE_SEQUENCES.UNYT_RED : DARK_RED)
            const connectedState = `${color}⬤${ESCAPE_SEQUENCES.RESET}`
            const knownSince = (Date.now()-dynamicProperties.knownSince)/1000;
            const distance = dynamicProperties.distance
            return `  ${connectedState} ${directionSymbol}${isDirect?'':' (indirect)'}${isDirect&&this.defaultSocket==socket?' (default)':''} ${endpoint??'unknown endpoint'}${ESCAPE_SEQUENCES.GREY} (distance:${distance < 0 ? 'unknown' : distance}, knownSince:${knownSince < 0 ? 'unknown' : knownSince.toFixed(2)+'s'})${ESCAPE_SEQUENCES.RESET}\n`
        }

        // print
        for (const [identifier, sockets] of mapping) {
            string += `\n${ESCAPE_SEQUENCES.BOLD}${identifier}${ESCAPE_SEQUENCES.RESET}\n`
            for (const [socket, {directEndpoint, directEndpointDynamicProperties, indirectEndpoints}] of sockets) {
                if (directEndpoint) string += getFormattedSocketString(socket, directEndpoint, directEndpointDynamicProperties!)
                for (const [endpoint, dynamicProperties] of indirectEndpoints) {
                    string += getFormattedSocketString(socket, endpoint, dynamicProperties)
                }
            }
        }

        return string;
    }

    public getEndpointSockets(endpoint: Endpoint|string) {
        endpoint = endpoint instanceof Endpoint ? endpoint : Endpoint.get(endpoint) as Endpoint;

        let string = "";
        string += `Available sockets for ${endpoint}:\n`

        for (const socket of this.iterateEndpointSockets(endpoint, false, true)) {
            string += "  - " + socket.toString() + "\n";
        }

        return string;
    }

    public printEndpointSockets(endpoint: Endpoint|string) {
        console.log(this.getEndpointSockets(endpoint))
    }


    /** Internal methods: */

    public registerSocket(socket: ConnectedCommunicationInterfaceSocket, endpoint: Endpoint|undefined = socket.endpoint, dynamicProperties: DynamicProperties) {
        if (this.#endpointSockets.get(endpoint)?.has(socket)) return;

        if (!endpoint) throw new Error("Cannot register socket to communication hub without endpoint.")
        if (!socket.connected || !socket.endpoint || !socket.interfaceProperties) throw new Error("Cannot register disconnected or uninitialized socket.")

        const isDirect = socket.endpoint==endpoint;

        // set default socket
        if (isDirect && socket.toString()==this.#defaultInterface?.toString() && socket.canSend) {
            this.#logger.debug("Setting default socket " + socket.toString() + " (endpoint " + endpoint.toString()+")")
            this.defaultSocket = socket;		
        }


        this.#logger.debug("Added new" + (isDirect?'':' indirect') + " socket " + socket.toString() + " for endpoint " + endpoint.toString())
        this.#registeredSockets.getAuto(socket).add(endpoint);
        this.#endpointSockets.getAuto(endpoint).set(socket, dynamicProperties);
        // add to instances map if not main endpoint
        if (endpoint.main !== endpoint)	this.#activeEndpointInstances.getAuto(endpoint.main).add(endpoint);
        this.sortSockets(endpoint);
        this.updateConnectionStatus();
    }

    public unregisterSocket(socket: CommunicationInterfaceSocket, endpoint: Endpoint|undefined = socket.endpoint) {
        const connectedSocket = socket as ConnectedCommunicationInterfaceSocket;
        if (!endpoint) throw new Error("Cannot unregister socket from communication hub without endpoint.")
        if (!this.#endpointSockets.has(endpoint)) throw new Error("Cannot unregister socket, not registered for endpoint.")
        if (!this.#registeredSockets.has(connectedSocket)) throw new Error("Cannot unregister socket, not registered.")

        const isDirect = connectedSocket.endpoint==endpoint;

        // remove default socket
        if (isDirect && connectedSocket === this.defaultSocket) {
            this.defaultSocket = undefined
        }

        this.#logger.debug("Removed" + (isDirect?'':' indirect') + " socket " + connectedSocket.toString() + " for endpoint " + endpoint.toString())

        const endpointSockets = this.#endpointSockets.get(endpoint)!;
        const socketEndpoints = this.#registeredSockets.get(connectedSocket)!;

        // remove own socket endpoint
        endpointSockets.delete(connectedSocket)
        socketEndpoints.delete(endpoint)
        this.safeDeleteEndpointInstance(endpoint)
        
        // direct socket removed, also remove all indirect sockets
        if (isDirect) {
            for (const indirectEndpoint of socketEndpoints) {
                this.#endpointSockets.get(indirectEndpoint)?.delete(connectedSocket)
                this.safeDeleteEndpointInstance(indirectEndpoint)
            }
            this.#registeredSockets.delete(connectedSocket)
        }
        this.updateConnectionStatus();
    }

    /**
     * Only completely remove endpoint instance from main->instance mapping if no more sockets are registered for the instance
     * @param endpoint 
     */
    private safeDeleteEndpointInstance(endpoint: Endpoint) {
        if (!this.#endpointSockets.get(endpoint)?.size) {
            this.#activeEndpointInstances.get(endpoint.main)?.delete(endpoint)
        }
    }

    public setDatexInHandler(handler: DatexInHandler) {
        this.#datexInHandler = handler
    }


    private startCleanupInterval() {
        setInterval(() => {
            for (const endpoint of this.#endpointSockets.keys()) {
                endpoint.isOnline();
            }
        }, this.CLEANUP_INTERVAL)
    }

    /**
     * @private
     */
    async init() {
        let lastEndpointGooodbyeMessage = await this.compileGoodbyeMessage();
        let lastEndpoint = Runtime.endpoint;
        Runtime.onEndpointChanged(async (endpoint) => {
            this.#logger.success("Endpoint changed to " + endpoint.toString() + " (previous: " + lastEndpoint + ")");

            // send GOODBYE for previous endpoint
            if (lastEndpointGooodbyeMessage /*  && lastEndpoint.main !== lastEndpoint */) {
                this.#logger.info(`Broadcasting GOODBYE for previous endpoint ${lastEndpoint} over all sockets`);

                // iterate direct outgoing sockets
                for (const socket of this.iterateSockets()) {
                    socket.sendGoodbye(lastEndpointGooodbyeMessage)
                }
            } else this.#logger.info(`Skipping GOODBYE message for ${lastEndpoint}`);

            lastEndpointGooodbyeMessage = await this.compileGoodbyeMessage();
            lastEndpoint = endpoint;
            await sleep(1000);

            // iterate direct outgoing sockets
            const helloMessage = await this.compileHelloMessage(); // TODO: set ttl to 1?
            if (helloMessage) {
                for (const socket of this.iterateSockets()) {
                    socket.sendHello(helloMessage)
                }
            }
        })
    }

    public compileGoodbyeMessage() {
        if (!Runtime.endpoint || Runtime.endpoint == LOCAL_ENDPOINT) return;
        this.#logger.debug("Compiled goodbye message for", Runtime.endpoint);
        return Compiler.compile("", [], {type:ProtocolDataType.GOODBYE, sign:true, flood:true, __routing_ttl:1}) as Promise<ArrayBuffer>
    }

    public compileHelloMessage(ttl = 6) {
        if (!Runtime.endpoint || Runtime.endpoint == LOCAL_ENDPOINT) return;
        const keys = Crypto.getOwnPublicKeysExported();
        return Compiler.compile('?', [keys], {type:ProtocolDataType.HELLO, sign:false, flood:true, __routing_ttl:ttl}) as Promise<ArrayBuffer>;
    }
    

    private setDefaultInterface(defaultInterface: CommunicationInterface) {
        this.#defaultInterface = defaultInterface
        this.defaultSocket = defaultInterface.getSockets().values().next().value;
    }

    /**
     * Returns true when the socket is registered.
     * Returns true when the endpoint is registered for the socket (if an endpoint is provided).
     */
    public hasSocket(socket: CommunicationInterfaceSocket, endpoint?: Endpoint) {
        if (endpoint) return this.#registeredSockets.get(socket as ConnectedCommunicationInterfaceSocket)?.has(endpoint)
        else return this.#registeredSockets.has(socket as ConnectedCommunicationInterfaceSocket)
    }

    public handleOfflineEndpoint(endpoint: Endpoint) {
        for (const socket of this.iterateEndpointSockets(endpoint, false, false)) {
            // direct connection endpoint offline, should not happen
            if (socket.endpoint == endpoint) {
                // this.#logger.error("Direct socket endpoint "+endpoint.toString()+" is not reachable, but socket is still connected.");
                // (socket as CommunicationInterfaceSocket).connected = false;
            }
            // indirect endpoint offline, remove socket registration
            else {
                this.#logger.debug("Indirect socket endpoint "+endpoint.toString()+" is offline, removing socket registration.");
                this.unregisterSocket(socket, endpoint);
            }
        }
    }

    /**
     * Returns true when the endpoint or a matching instance endpoint is directly registered for the socket.
     */
    public hasDirectSocket(endpoint: Endpoint) {
        // check if exact endpoint instance is registered
        if (this._hasDirectSocket(endpoint)) return true;

        // find socket that matches instance if main endpoint
        if (endpoint.main === endpoint) {
            const instances = [...this.#activeEndpointInstances.get(endpoint)??[]];
            for (const instance of instances) {
                if (this._hasDirectSocket(instance)) return true;
            }
        }

        return false
    }

     private _hasDirectSocket(endpoint: Endpoint) {
        // check if exact endpoint instance is registered as direct socket
        return this.iterateEndpointSockets(endpoint, true, false)
            .next().done === false;
    }

    /**
     * Method called by CommunicationInterfaceSockets when they receive a datex block
     * @param data
     */

    public datexIn(data: DatexInData) {
        if (!this.#datexInHandler) throw new Error("No datexInHandler set")
        return this.#datexInHandler(data)
    }

    /**
     * Sort available sockets for endpoint:
     * - direct sockets first
     * - then sort by channel channelFactor (latency,bandwidth)
     * - then sort by socket connectTimestamp
     */
    private sortSockets(endpoint: Endpoint) {
        const sockets = this.#endpointSockets.get(endpoint)
        if (!sockets) throw new Error("No sockets for endpoint " + endpoint);
        const sortedSockets = 
            new Map(
                    // sort by direct/indirect, direct first
                    this.sortGrouped(sockets, ([socket]) => socket.endpoint === endpoint ? 0 : 1, 1)
                .map(sockets => 
                    // sort by distance, smallest first
                    this.sortGrouped(sockets, ([_, {distance}]) => distance, 1)
                .map(sockets => 
                    // sort by channelFactor, highest first
                    this.sortGrouped(sockets, ([socket]) => socket.channelFactor, -1)
                .map(sockets => 
                    // sort by knownSince, newest (highest) first
                    this.sortGrouped(sockets, ([_, {knownSince}]) => knownSince, -1)
                )))
            .flat(4)
            )
        this.#endpointSockets.set(endpoint, sortedSockets)
    }

    private sortGrouped<I extends Iterable<unknown>>(iterable: I, groupBy: (item: I extends Iterable<infer Item> ? Item : unknown) => number, sortDirection = 1) {
        return Object
            // group by channelFactor
            .entries(Object.groupBy(iterable as any, groupBy))
            // sort by channelFactor
            .toSorted(([a], [b]) => (Number(a) - Number(b)) * sortDirection)
            .map(([_, values]) => values!)
    }


    private getPreferredSocketForEndpoint(endpoint: Endpoint, excludeSocket?: CommunicationInterfaceSocket) {
        
        // find socket that matches endpoint instance exactly
        const socket = this.findMatchingEndpointSocket(endpoint, excludeSocket);
        if (socket) return socket;

        // find socket that matches instance if main endpoint
        if (endpoint.main === endpoint) {
            const instances = [...this.#activeEndpointInstances.get(endpoint)??[]];
            for (let i=instances.length-1; i>=0; i--) {
                const socket = this.findMatchingEndpointSocket(instances[i], excludeSocket);
                if (socket) return socket;
            }
        }

        if (this.defaultSocket !== excludeSocket)
            return this.defaultSocket;
    }

    private findMatchingEndpointSocket(endpoint: Endpoint, excludeSocket?: CommunicationInterfaceSocket) {
        for (const socket of this.iterateEndpointSockets(endpoint, false, true)) {
            if (socket === excludeSocket) continue;
            return socket;
        }
    }
    

    private *iterateEndpointSockets(endpoint: Endpoint, onlyDirect = true, onlyOutgoing = true) {
        for (const socket of this.#endpointSockets.get(endpoint)?.keys() ?? []) {
            if (onlyDirect && socket.endpoint !== endpoint) continue;
            if (onlyOutgoing && !socket.canSend) continue;
            yield socket;
        }
    }

    private *iterateSockets(onlyOutgoing = true) {
        for (const socket of this.#registeredSockets.keys()) {
            if (onlyOutgoing && !socket.canSend) continue;
            yield socket;
        }
    }

    /**
     * Method called to send a datex block to a receiver (or as a broadcast) 
     * @param dxb 
     */
    public async datexOut(data: DatexOutData):Promise<void> {
        
        this.updateTTL(data.dxb, -1) // decrement TTL

        // broadcast
        if (data.receivers == BROADCAST) return this.datexBroadcastOut(data);

        const receivers = data.receivers instanceof Endpoint ? [data.receivers] : [...data.receivers];
        const outGroups = receivers.length == 1 ? 
        
            // single endpoint shortcut
            new Map([[this.getPreferredSocketForEndpoint(receivers[0], data.socket), new Disjunction(receivers[0])]]) :
            
            // group for multiple endpoints
            new Map(
                // group receivers by socket
                [...Map.groupBy(
                        // map receivers to sockets
                        receivers.map(r => ({endpoint: r, socket: this.getPreferredSocketForEndpoint(r, data.socket)}),
                    ), ({socket}) => socket
                    ).entries()
                ]
                // map endpoint object arrays to Set<Endpoint>
                .map(([k, v]) => [k, new Disjunction(...v.map(({endpoint}) => endpoint))] as const)
            );


        const promises = []

        for (const [socket, endpoints] of outGroups) {
            if (!socket) continue;
            promises.push(this.sendAddressedBlockToReceivers(data.dxb, endpoints, socket));
        }

        // throw error if message could not be sent to some receivers
        if (outGroups.has(undefined)) {
            const endpointsString = [...outGroups.get(undefined)!].map(e => e.toString()).join(", ")
            throw new NetworkError("No socket for " + endpointsString);
        } 

        await Promise.all(promises);
    }

    public datexBroadcastOut(data: DatexOutData) {
        const reachedEndpoints = new Set<Endpoint>()

        for (const socket of this.iterateSockets()) {
            if (data.socket === socket) continue;
            if (reachedEndpoints.has(socket.endpoint)) continue;
            if (socket.interfaceProperties.allowRedirects === false) continue;
            reachedEndpoints.add(socket.endpoint);

            socket.sendBlock(data.dxb).catch(console.error);
        }
    }

    public async sendAddressedBlockToReceivers(dxb: ArrayBuffer, receivers: Disjunction<Endpoint>, destSocket: CommunicationInterfaceSocket) {
        const addressedDXB = Compiler.updateHeaderReceiver(dxb, receivers);
        if ((dxb as any)._is_stream) {
            (addressedDXB as any)._is_stream = true
        }
        if (!addressedDXB) throw new Error("Failed to update header receivers");

        IOHandler.handleDatexSent(addressedDXB, receivers, destSocket)

        const success = await destSocket.sendBlock(addressedDXB);
        if (!success) {
            this.#logger.warn("Failed to send block to " + receivers.toString() + " via " + destSocket.toString() + ", retrying");
            this.updateTTL(dxb, 1) // reset TTL to original
            return this.datexOut({
                dxb,
                receivers,
                socket: destSocket
            })
        }
    }

    private updateTTL(dxb: ArrayBuffer, delta = -1) {
        const uint8 = new Uint8Array(dxb);
        const currentTTL = uint8[5];
        // console.log("currentTTL", currentTTL, delta);

        // too many redirects (ttl is 0)
        if (currentTTL <= 0) throw new NetworkError(DATEX_ERROR.TOO_MANY_REDIRECTS);

        uint8[5] = currentTTL + delta;
    }

}


export const communicationHub = CommunicationHub.get()
