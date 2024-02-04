import { dxb_header } from "../utils/global_types.ts";
import { Endpoint } from "../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, ConnectedCommunicationInterfaceSocket } from "./communication-interface.ts";
import { Disjunction } from "../types/logic.ts";
import "../utils/auto_map.ts";
import { InterfaceDirection } from "./communication-interface.ts";
import { ESCAPE_SEQUENCES, Logger } from "../utils/logger.ts";
import { Datex } from "../mod.ts";
import { NetworkError } from "../types/errors.ts";
import { Compiler } from "../compiler/compiler.ts";

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

	public addInterface(comInterface: CommunicationInterface, setAsDefault = false) {
		return this.handler.addInterface(comInterface, setAsDefault);
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

	#logger = new Logger("CommunicationHub")
	
	#interfaces = new Set<CommunicationInterface>()
	// CommunicationInterfaceSockets are ordered, most recent last
	#endpointSockets = new Map<Endpoint, Set<ConnectedCommunicationInterfaceSocket>>().setAutoDefault(Set).enableAutoRemove()
	#registeredSockets = new Map<ConnectedCommunicationInterfaceSocket, Set<Endpoint>>().setAutoDefault(Set).enableAutoRemove()

	// maps main endpoints to a list of instance endpoints that are currently connected via sockets
	#activeEndpointInstances = new Map<Endpoint, Set<Endpoint>>().setAutoDefault(Set).enableAutoRemove()

	#defaultSocket?: ConnectedCommunicationInterfaceSocket

	#datexInHandler?: DatexInHandler

	directionSymbols = {
		[InterfaceDirection.IN]: "◀──",
		[InterfaceDirection.OUT]: "──▶",
		[InterfaceDirection.IN_OUT]: "◀─▶"
	}


	/** Public facing methods: **/
	public async addInterface(comInterface: CommunicationInterface, setAsDefault = false) {
		this.#interfaces.add(comInterface)
		await comInterface.init(COM_HUB_SECRET);
		if (setAsDefault) this.#defaultSocket = comInterface.getSockets().values().next().value
	}

	public async removeInterface(comInterface: CommunicationInterface) {
		this.#interfaces.delete(comInterface)
		await comInterface.deinit(COM_HUB_SECRET);
	}

	public printStatus() {
		let string = "";
		string += "DATEX Communication Hub\n"
		string += `  Local Endpoint: ${Datex.Runtime.endpoint}\n`
		string += `  ${this.#interfaces.size} interfaces registered\n`
		string += `  ${this.#registeredSockets.size} sockets connected\n\n`

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
 
	    string += "Default socket: " + (this.#defaultSocket ? this.#defaultSocket.toString() : "none") + "\n";


		// print
		for (const [identifier, sockets] of mapping) {
			string += `\n${identifier}\n`
			for (const [endpoint, socket] of sockets) {
				const directionSymbol = this.directionSymbols[socket.interfaceProperties?.direction as InterfaceDirection] ?? "?"
				const isDirect = socket.endpoint === endpoint;
				const color = socket.connected ? 
					(
						socket.endpoint ? 
						ESCAPE_SEQUENCES.UNYT_GREEN :
						ESCAPE_SEQUENCES.UNYT_GREY
					) : 
					ESCAPE_SEQUENCES.UNYT_RED
				const connectedState = `${color}⬤${ESCAPE_SEQUENCES.RESET}`
				string += `  ${connectedState} ${directionSymbol}${isDirect?'':' (indirect)'} ${endpoint??'unknown endpoint'}\n`
			}
		}

		console.log(string)
	}

	public printEndpointSockets(endpoint: Endpoint|string) {
		endpoint = endpoint instanceof Endpoint ? endpoint : Endpoint.get(endpoint) as Endpoint;

		let string = "";
		string += `Available sockets for ${endpoint}:\n`

		for (const socket of this.#endpointSockets.get(endpoint) ?? []) {
			string += "  - " + socket.toString() + "\n";
		}

		console.log(string)
	}


	/** Internal methods: */

	public registerSocket(socket: ConnectedCommunicationInterfaceSocket, endpoint: Endpoint|undefined = socket.endpoint) {
		if (this.#endpointSockets.get(endpoint)?.has(socket)) return

		if (!endpoint) throw new Error("Cannot register socket to communication hub without endpoint.")
		if (!socket.connected || !socket.endpoint || !socket.interfaceProperties) throw new Error("Cannot register disconnected or uninitialized socket.")

		this.#logger.debug("Added new" + (socket.endpoint==endpoint?'':' indirect') + " socket " + socket.toString() + " for endpoint " + endpoint.toString())
		this.#registeredSockets.getAuto(socket).add(endpoint);
		this.#endpointSockets.getAuto(endpoint).add(socket);
		this.#activeEndpointInstances.getAuto(endpoint.main).add(endpoint);
		this.sortSockets(endpoint)
	}

	public unregisterSocket(socket: CommunicationInterfaceSocket, endpoint: Endpoint|undefined = socket.endpoint) {
		const connectedSocket = socket as ConnectedCommunicationInterfaceSocket;
		if (!endpoint) throw new Error("Cannot unregister socket from communication hub without endpoint.")
		if (!this.#endpointSockets.has(endpoint)) throw new Error("Cannot unregister socket, not registered for endpoint.")
		if (!this.#registeredSockets.has(connectedSocket)) throw new Error("Cannot unregister socket, not registered.")

		// remove default socket
		if (connectedSocket === this.#defaultSocket) this.#defaultSocket = undefined;

		const isDirect = connectedSocket.endpoint==endpoint;

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

	/**
	 * Returns true when the socket is registered.
	 * Returns true when the endpoint is registered for the socket (if an endpoint is provided).
	 */
	public hasSocket(socket: CommunicationInterfaceSocket, endpoint?: Endpoint) {
		if (endpoint) return this.#registeredSockets.get(socket as ConnectedCommunicationInterfaceSocket)?.has(endpoint)
		else return this.#registeredSockets.has(socket as ConnectedCommunicationInterfaceSocket)
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
	 * - then sort by priority
	 * - then sort by connectTimestamp
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

				// sort by priority and timestamp, flatten
				.flatMap(([_, sockets]) => this.sortSocketsByPriorityAndTimestamp(sockets!))
		)
		this.#endpointSockets.set(endpoint, sortedSockets)
	}

	private sortSocketsByPriorityAndTimestamp(sockets: Iterable<ConnectedCommunicationInterfaceSocket>) {
		return Object
			// group by priority
			.entries(Object.groupBy(sockets, socket => socket.interfaceProperties.priority))
			// sort by priority
			.toSorted(([a], [b]) => Number(b) - Number(a))
			// sort by connectTimestamp in each priority group
			.map(([priority, sockets]) => [priority, sockets!.toSorted(
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

		if (this.#defaultSocket !== excludeSocket)
			return this.#defaultSocket;
	}

	private findMatchingEndpointSocket(endpoint: Endpoint, excludeSocket?: CommunicationInterfaceSocket) {
		for (const socket of this.#endpointSockets.get(endpoint) ?? []) {
			if (socket === excludeSocket) continue;
			return socket;
		}
	}
	

	/**
	 * Method called to send a datex block to a receiver (or as a broadcast) 
	 * @param dxb 
	 */
	public async datexOut(data: DatexOutData):Promise<void> {
		
		// broadcast
		if (data.receivers == Datex.BROADCAST) return this.datexBroadcastOut(data);

		const receivers = data.receivers instanceof Endpoint ? [data.receivers] : [...data.receivers];
		const outGroups = new Map(
				// group receivers by socket
				[...Map.groupBy(
					// map receivers to sockets
					receivers.map(r => ({endpoint: r, socket: this.getPreferredSocketForEndpoint(r)}),
				), ({socket}) => socket)
				.entries()
			]
			// map endpoint object arrays to Set<Endpoint>
			.map(([k, v]) => [k, new Disjunction(...v.map(({endpoint}) => endpoint))] as const)
		);


		const promises = []

		for (const [socket, endpoints] of outGroups) {
			const endpointsString = [...endpoints].map(e => e.toString()).join(", ")
			if (!socket) continue;
			this.#logger.debug("sending to " + endpointsString + " ("+socket.toString()+")");
			promises.push(this.sendAddressedBlockToReceivers(data.dxb, endpoints, socket));
		}

		// throw error if message could not be sent to some receivers
		if (outGroups.has(undefined)) {
			const endpointsString = [...outGroups.get(undefined)!].map(e => e.toString()).join(", ")
			throw new NetworkError("No socket for endpoints " + endpointsString);
		} 

		await Promise.all(promises);
	}

	public datexBroadcastOut(data: DatexOutData) {
		const reachedEndpoints = new Set<Endpoint>()

		for (const [socket] of this.#registeredSockets) {
			if (data.socket === socket) continue;
			if (reachedEndpoints.has(socket.endpoint)) continue;
			reachedEndpoints.add(socket.endpoint);

			socket.sendBlock(data.dxb);
		}
	}

	public async sendAddressedBlockToReceivers(dxb: ArrayBuffer, receivers: Disjunction<Endpoint>, destSocket: CommunicationInterfaceSocket) {
		const addressdDXB = Compiler.updateHeaderReceiver(dxb, receivers);
		if (!addressdDXB) throw new Error("Failed to update header receivers");
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
