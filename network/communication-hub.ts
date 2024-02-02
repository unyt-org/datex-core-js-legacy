import { dxb_header } from "../utils/global_types.ts";
import { Endpoint } from "../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket } from "./communication-interface.ts";
import { Disjunction } from "../types/logic.ts";
import "../utils/auto_map.ts";

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
	 * @private
	 */
	handler = new CommunicationHubHandler()

}


export const COM_HUB_SECRET = Symbol("COM_HUB_SECRET")

/**
 * Internal handler for managing CommunicationInterfaces
 */
export class CommunicationHubHandler {
	
	#interfaces = new Set<CommunicationInterface>()
	#endpointSockets = new Map<Endpoint, Set<CommunicationInterfaceSocket>>().setAutoDefault(Set)
	#registeredSockets = new Set<CommunicationInterfaceSocket>()
	#defaultSocket?: CommunicationInterfaceSocket

	#datexInHandler?: DatexInHandler

	/** Public facing methods: **/
	public async addInterface(comInterface: CommunicationInterface, setAsDefault = false) {
		this.#interfaces.add(comInterface)
		await comInterface.init(COM_HUB_SECRET);
		if (setAsDefault) this.#defaultSocket = comInterface.sockets.values().next().value
	}

	public async removeInterface(comInterface: CommunicationInterface) {
		this.#interfaces.delete(comInterface)
		await comInterface.deinit(COM_HUB_SECRET);
	}


	/** Internal methods: */

	public addSocket(socket: CommunicationInterfaceSocket) {
		if (!socket.endpoint) throw new Error("Cannot add socket to communication hub without endpoint.")
		if (this.#endpointSockets.get(socket.endpoint)?.has(socket)) throw new Error("Cannot add socket to communication hub without endpoint.")
		this.#registeredSockets.add(socket)
		this.#endpointSockets.getAuto(socket.endpoint).add(socket)
	}

	public removeSocket(socket: CommunicationInterfaceSocket) {
		if (!socket.endpoint) throw new Error("Cannot remove socket from communication hub without endpoint.")
		this.#endpointSockets.getAuto(socket.endpoint).delete(socket)
		this.#registeredSockets.delete(socket)
		if (this.#endpointSockets.get(socket.endpoint)!.size == 0) this.#endpointSockets.delete(socket.endpoint)
	}

	public setDatexInHandler(handler: DatexInHandler) {
		this.#datexInHandler = handler
	}

	public hasSocket(socket: CommunicationInterfaceSocket) {
		return this.#registeredSockets.has(socket)
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
	 * Method called to send a datex block to a receiver (or as a broadcast) 
	 * @param dxb 
	 */
	public datexOut(data: DatexOutData) {
		// ...sendAddressedBlockToReceivers
		// ...sendAddressedBlockToReceivers
		// ...sendAddressedBlockToReceivers

		// this.#defaultSocket?.sendBlock(Datex.Compiler.compile('?', [keys], {type:ProtocolDataType.HELLO, sign:false, flood:true, __routing_ttl:10}))
	}

	public sendAddressedBlockToReceivers(dxb: ArrayBuffer, receiver: Disjunction<Endpoint>, destInterface: CommunicationInterface) {
		// Compiler...
	}

}




export const communicationHub = CommunicationHub.get()
