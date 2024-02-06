import { dxb_header } from "../utils/global_types.ts";
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

export type DatexInData = {
	dxb: ArrayBuffer|ReadableStreamDefaultReader<Uint8Array>,
	socket: CommunicationInterfaceSocket
}

export type DatexOutData = {
	dxb: ArrayBuffer,
	receivers: Endpoint|Disjunction<Endpoint>, // @@any for broadcasts
	socket?: CommunicationInterfaceSocket
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

	get defaultSocket() {
		return this.handler.defaultSocket;
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

/**
 * Internal handler for managing CommunicationInterfaces
 */
export class CommunicationHubHandler {

	/**
	 * Interval for checking online status for indirect/direct socket endpoints
	 */
	readonly CLEANUP_INTERVAL = 10 * 60 * 1000; // 10min


	#logger = new Logger("CommunicationHub")
	
	#interfaces = new Set<CommunicationInterface>()
	// CommunicationInterfaceSockets are ordered, most recent last
	#endpointSockets = new Map<Endpoint, Set<ConnectedCommunicationInterfaceSocket>>().setAutoDefault(Set).enableAutoRemove()
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
		this.startCleanupInterval()
	}

	/** Public facing methods: **/

	public async addInterface(comInterface: CommunicationInterface, setAsDefault = false, timeout?: number) {
		this.#interfaces.add(comInterface)
		const connected = await comInterface.init(COM_HUB_SECRET, timeout);
		if (connected && setAsDefault) this.setDefaultInterface(comInterface)
		if (!connected) this.#interfaces.delete(comInterface);
		return connected
	}

	public async removeInterface(comInterface: CommunicationInterface) {
		this.#interfaces.delete(comInterface)
		await comInterface.deinit(COM_HUB_SECRET);
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

		const mapping = new Map<string, Set<[Endpoint, CommunicationInterfaceSocket]>>()

		// interfaces with direct sockets
		for (const comInterface of this.#interfaces) {
			const sockets = new Set(
				[...comInterface.getSockets()]
					.map(socket => [socket.endpoint, socket] as [Endpoint, CommunicationInterfaceSocket])
			)
			const identifier = comInterface.toString()
			if (mapping.has(identifier)) {
				sockets.forEach(([endpoint, socket]) => mapping.get(identifier)!.add([endpoint, socket]))
			}
			else mapping.set(identifier, sockets)
		}

		// indirect connections
		for (const [endpoint, sockets] of this.#endpointSockets) {
			for (const socket of sockets) {
				// check if endpoint is indirect
				if (socket.endpoint !== endpoint) {
					if (!socket.interfaceProperties) {
						console.warn("Invalid socket, missing interfaceProperties", socket);
						continue;
					}
					const identifier = socket.toString();
					if (mapping.has(identifier)) {
						mapping.get(identifier)!.add([endpoint, socket])
					}
					else mapping.set(identifier, new Set([[endpoint, socket]]))
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

		// print
		for (const [identifier, sockets] of mapping) {
			string += `\n${ESCAPE_SEQUENCES.BOLD}${identifier}${ESCAPE_SEQUENCES.RESET}\n`
			for (const [endpoint, socket] of sockets) {
				// skip placeholder @@any for noContinuosConnection interfaces
				if (socket.interfaceProperties?.noContinuousConnection && endpoint == BROADCAST) continue;

				const directionSymbol = this.directionSymbols[socket.interfaceProperties?.direction as InterfaceDirection] ?? "?"
				const isDirect = socket.endpoint === endpoint;
				const color = socket.connected ? 
					(
						socket.endpoint ? 
						(isDirect ? ESCAPE_SEQUENCES.UNYT_GREEN : DARK_GREEN) :
						(isDirect ? ESCAPE_SEQUENCES.UNYT_GREY : DARK_GREY)
					) : 
					(isDirect ? ESCAPE_SEQUENCES.UNYT_RED : DARK_RED)
				const connectedState = `${color}⬤${ESCAPE_SEQUENCES.RESET}`
				string += `  ${connectedState} ${directionSymbol}${isDirect?'':' (indirect)'}${isDirect&&this.defaultSocket==socket?' (default)':''} ${endpoint??'unknown endpoint'}${ESCAPE_SEQUENCES.RESET}\n`
			}
		}

		return string;
	}

	public printEndpointSockets(endpoint: Endpoint|string) {
		endpoint = endpoint instanceof Endpoint ? endpoint : Endpoint.get(endpoint) as Endpoint;

		let string = "";
		string += `Available sockets for ${endpoint}:\n`

		for (const socket of this.iterateEndpointSockets(endpoint, false, false)) {
			string += "  - " + socket.toString() + "\n";
		}

		console.log(string)
	}


	/** Internal methods: */

	public registerSocket(socket: ConnectedCommunicationInterfaceSocket, endpoint: Endpoint|undefined = socket.endpoint) {
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
		this.#endpointSockets.getAuto(endpoint).add(socket);
		// add to instances map if not main endpoint
		if (endpoint.main !== endpoint)	this.#activeEndpointInstances.getAuto(endpoint.main).add(endpoint);
		this.sortSockets(endpoint)
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
		const endpointInstances = this.#activeEndpointInstances.getAuto(endpoint.main)

		// remove own socket endpoint
		endpointSockets.delete(connectedSocket)
		socketEndpoints.delete(endpoint)
		endpointInstances.delete(endpoint)
		
		// direct socket removed, also remove all indirect sockets
		if (isDirect) {
			for (const indirectEndpoint of socketEndpoints) {
				this.#endpointSockets.get(indirectEndpoint)?.delete(connectedSocket)
				this.#activeEndpointInstances.get(indirectEndpoint.main)?.delete(indirectEndpoint)
			}
			this.#registeredSockets.delete(connectedSocket)
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
		Runtime.onEndpointChanged(async (endpoint) => {
			this.#logger.debug("Endpoint changed to " + endpoint.toString())

			// send GOODBYE for previous endpoint
			if (lastEndpointGooodbyeMessage) {
				this.#logger.debug("Broadcasting GOODBYE for previous endpoint over all sockets");

				// iterate direct outgoing sockets
				for (const socket of this.iterateSockets()) {
					socket.sendGoodbye(lastEndpointGooodbyeMessage)
				}
			}

			await sleep(1000);

			// iterate direct outgoing sockets
			const helloMessage = await this.compileHelloMessage(1);
			if (helloMessage) {
				for (const socket of this.iterateSockets()) {
					socket.sendHello(helloMessage)
				}
			}
			
			
			lastEndpointGooodbyeMessage = await this.compileGoodbyeMessage();
		})
	}

	public compileGoodbyeMessage() {
		if (!Runtime.endpoint || Runtime.endpoint == LOCAL_ENDPOINT) return;
		return Compiler.compile("", [], {type:ProtocolDataType.GOODBYE, sign:true, flood:true, __routing_ttl:1}) as Promise<ArrayBuffer>
	}

	public compileHelloMessage(ttl = 6) {
		if (!Runtime.endpoint || Runtime.endpoint == LOCAL_ENDPOINT) return;
		const keys = Crypto.getOwnPublicKeysExported();
		return Compiler.compile('?', [keys], {type:ProtocolDataType.HELLO, sign:false, flood:true, __routing_ttl:ttl}) as Promise<ArrayBuffer>;
	}
	

	private setDefaultInterface(defaultInterface: CommunicationInterface) {
		this.#defaultInterface = defaultInterface
		this.defaultSocket = defaultInterface.getSockets().values().next().value
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
		const sortedSockets = new Set(
				Object
				// group by direct/indirect
				.entries(Object.groupBy(sockets, socket => (socket.endpoint!==endpoint).toString()))
				// sort by direct/indirect
				.toSorted()

				// sort by channelFactor and recency, flatten
				.flatMap(([_, sockets]) => this.sortSocketsByChannelFactorAndRecency(sockets!))
		)
		this.#endpointSockets.set(endpoint, sortedSockets)
	}

	private sortSocketsByChannelFactorAndRecency(sockets: Iterable<ConnectedCommunicationInterfaceSocket>) {
		return Object
			// group by channelFactor
			.entries(Object.groupBy(sockets, socket => socket.channelFactor))
			// sort by channelFactor
			.toSorted(([a], [b]) => Number(b) - Number(a))
			// sort by connectTimestamp in each channelFactor group
			.map(([channelFactor, sockets]) => [channelFactor, sockets!.toSorted(
				(a, b) => b.connectTimestamp - a.connectTimestamp
			)] as const)
			// flatten
			.flatMap(([_, sockets]) => sockets)
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
		for (const socket of this.#endpointSockets.get(endpoint) ?? []) {
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
		
		// broadcast
		if (data.receivers == BROADCAST) return this.datexBroadcastOut(data);

		const receivers = data.receivers instanceof Endpoint ? [data.receivers] : [...data.receivers];
		const outGroups = receivers.length == 1 ? 
		
		// single endpoint shortcut
		new Map([[this.getPreferredSocketForEndpoint(receivers[0]), new Disjunction(...receivers)]]) :
		
		// group for multiple endpoints
		new Map(
			// group receivers by socket
			[...Map.groupBy(
					// map receivers to sockets
					receivers.map(r => ({endpoint: r, socket: this.getPreferredSocketForEndpoint(r)}),
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
			reachedEndpoints.add(socket.endpoint);

			socket.sendBlock(data.dxb).catch(console.error);
		}
	}

	public async sendAddressedBlockToReceivers(dxb: ArrayBuffer, receivers: Disjunction<Endpoint>, destSocket: CommunicationInterfaceSocket) {
		const addressdDXB = Compiler.updateHeaderReceiver(dxb, receivers);
		if (!addressdDXB) throw new Error("Failed to update header receivers");

		IOHandler.handleDatexSent(addressdDXB, receivers, destSocket)

		const success = await destSocket.sendBlock(addressdDXB);
		if (!success) {
			return this.datexOut({
				dxb,
				receivers,
				socket: destSocket
			})
		}
	}

}


export const communicationHub = CommunicationHub.get()
