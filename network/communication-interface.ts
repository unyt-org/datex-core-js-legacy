import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { LOCAL_ENDPOINT, Runtime, dxb_header } from "../datex_all.ts";
import { Endpoint } from "../types/addressing.ts";
import { Logger } from "../utils/logger.ts";
import { COM_HUB_SECRET, communicationHub } from "./communication-hub.ts";


export enum InterfaceDirection {
	IN,
	OUT,
	IN_OUT
}

export type InterfaceProperties =  {
	type: string,
	name?: string,

	direction: InterfaceDirection,
	/**
	 * Time in milliseconds to wait before reconnecting after a connection error
	 */
	reconnectInterval?: number,
	/**
	 * Estimated mean latency for this interface type in milliseconds (round trip time).
	 * Lower latency interfaces are preferred over higher latency channels
	 */
	latency: number,
	/**
	 * Bandwidth in bytes per second
	 */
	bandwidth: number
}

function getIdentifier(properties?: InterfaceProperties) {
	if (!properties) return "unknown";
	return `${properties.type}${properties.name? ` (${properties.name})` : ''}`
}

class EndpointConnectEvent extends Event {
	constructor(public endpoint: Endpoint) {
		super('connect');
	}
}
class EndpointDisconnectEvent extends Event {
	constructor(public endpoint: Endpoint) {
		super('disconnect')
	}
}

interface CustomEventMap {
    "connect": EndpointConnectEvent
    "disconnect": EndpointDisconnectEvent
}

/**
 * A connected communication interface socket that is registered in the communication hub
 * and can be used to send and receive messages
 */
export type ConnectedCommunicationInterfaceSocket = CommunicationInterfaceSocket & {
	connected: true,
	endpoint: Endpoint,
	channelFactor: number,
	interfaceProperties: InterfaceProperties
}


type ReadonlySet<T> = Set<T> & {add: never, delete: never, clear: never}



export abstract class CommunicationInterfaceSocket extends EventTarget {
	/**
	 * Endpoint is only set once. If the endpoint changes, a new socket is created
	 */
	#endpoint?: Endpoint
	#connected = false
	#destroyed = false;
	#opened = false;

	clone?: CommunicationInterfaceSocket

	static defaultLogger = new Logger("CommunicationInterfaceSocket")
	public logger = CommunicationInterfaceSocket.defaultLogger;

	#connectTimestamp = Date.now()

	get connectTimestamp() {
		return this.#connectTimestamp
	}

	/**
	 * Calculated value describing the properties of the interface channel,
	 * based on bandwidth and latency.
	 * Interfaces with higher channel factor are preferred.
	 */
	get channelFactor() {
		if (!this.interfaceProperties) return undefined;
		return this.interfaceProperties.bandwidth / this.interfaceProperties.latency
	}

	interfaceProperties?: InterfaceProperties

	get isRegistered() {
		return communicationHub.handler.hasSocket(this)
	}

	get connected() {
		return this.#connected
	}
	set connected(connected) {
		if (connected === this.#connected) return; // no change
		if (this.#destroyed) throw new Error("Cannot change connected state of destroyed socket.")
		this.#connected = connected
		this.#updateRegistration();
	}

	get endpoint(): Endpoint|undefined {	
		return this.#endpoint
	}

	set endpoint(endpoint: Endpoint) {
		if (this.#endpoint) throw new Error("Cannot change endpoint of socket. Create a new socket instead.")
		this.#endpoint = endpoint
		this.#updateRegistration();
	}

	/**
	 * Adds or removes the socket from the communication hub based
	 * on the connection state and endpoint availability
	 */
	#updateRegistration() {
		// handle open/close
		if (this.#opened && !this.#connected) {
			this.#opened = false;
			this.close()
		}
		else if (!this.#opened && this.#connected) {
			this.open()
			this.#opened = true;
		}

		if (!this.#endpoint || this.#destroyed) return;

		if (this.#connected) {
			if (!this.isRegistered) {
				this.#connectTimestamp = Date.now()
				this.dispatchEvent(new EndpointConnectEvent(this.#endpoint))
				communicationHub.handler.registerSocket(this as ConnectedCommunicationInterfaceSocket)
			}
		}
		else {
			if (this.isRegistered) {
				communicationHub.handler.unregisterSocket(this)
			}
		}
	}

	public get canSend() {
		return this.interfaceProperties?.direction !== InterfaceDirection.IN
	}
	public get canReceive() {
		return this.interfaceProperties?.direction !== InterfaceDirection.OUT
	}

	public sendHello(dxb: ArrayBuffer) {
		if (!Runtime.endpoint || Runtime.endpoint == LOCAL_ENDPOINT) return;
		this.sendBlock(dxb).catch(console.error)
	}

	public sendGoodbye(dxb: ArrayBuffer) {
		if (!Runtime.endpoint || Runtime.endpoint == LOCAL_ENDPOINT) return;
		this.sendBlock(dxb).catch(console.error)
	}

	public async sendBlock(dxb: ArrayBuffer) {
		if (!this.canSend) throw new Error("Cannot send from an IN interface socket");
		if (this.#destroyed) throw new Error("Cannot send from destroyed socket.")
		if (!this.connected) throw new Error("Cannot send from disconnected socket");

		const successful = await this.send(dxb)
		if (!successful) {
			console.error("Failed to send block")
			this.connected = false
		}
		return successful;
	}

	protected async receive(dxb: ArrayBuffer) {
		if (!this.canReceive) throw new Error("Cannot receive on an OUT interface socket");
		if (this.#destroyed) throw new Error("Cannot receive on destroyed socket");
		if (!this.connected) throw new Error("Cannot receive on disconnected socket");

		let header: dxb_header;
		try {
			header = await communicationHub.handler.datexIn({
				dxb,
				socket: this
			})
		}
		catch (e) {
			console.error(e);
			return;
		}
		// a cloned socket was already created in the meantime, handle header in clone
		if (this.clone) {
			this.clone.handleReceiveHeader(header)
		}
		// handle header in this socket
		else this.handleReceiveHeader(header)
	}

	protected handleReceiveHeader(header: dxb_header) {
		if (this.#destroyed) throw new Error("Cannot receive on destroyed socket");
		if (!this.connected) throw new Error("Cannot receive on disconnected socket");

		// listen for GOODBYE messages
		if (this.endpoint) {
			if (header.type == ProtocolDataType.GOODBYE && header.sender === this.endpoint) {
				this.connected = false
				this.#destroyed = true
				this.dispatchEvent(new EndpointDisconnectEvent(this.endpoint))
			}
			// message from another endpoint, record as indirect socket connection
			else if (header.sender !== this.endpoint && !communicationHub.handler.hasSocket(this as ConnectedCommunicationInterfaceSocket, header.sender)) {
				if (header.sender === Runtime.endpoint) {
					this.logger.error("Indirect connection to own endpoint detected at "+this)
				}
				else communicationHub.handler.registerSocket(this as ConnectedCommunicationInterfaceSocket, header.sender)
			}
		}
		// detect new endpoint
		else if (header.sender) {
			this.endpoint = header.sender
		}
	}


	/**
	 * Send a DATEX block via this interface
	 * @param datex
	 * @param to 
	 */
	protected abstract send(datex:ArrayBuffer): Promise<boolean>|boolean

	protected abstract open(): void
	protected abstract close(): void

	toString() {
		return getIdentifier(this.interfaceProperties)
	}


	declare addEventListener: <K extends keyof CustomEventMap>(type: K, listener: (ev: CustomEventMap[K]) => void) => void;
    declare removeEventListener: <K extends keyof CustomEventMap>(type: K, listener: (ev: CustomEventMap[K]) => void) => void;
	declare dispatchEvent: <K extends keyof CustomEventMap>(ev: CustomEventMap[K]) => boolean;
}


/**
 * Base class for all DATEX communication interfaces
 */
export abstract class CommunicationInterface<Socket extends CommunicationInterfaceSocket = CommunicationInterfaceSocket> extends EventTarget {

	protected logger = new Logger(this.constructor.name)

	#sockets = new Set<Socket>()

	abstract properties: InterfaceProperties

	abstract connect(): boolean|Promise<boolean>
	abstract disconnect(): void|Promise<void>

	#connecting = false;

	/**
	 * @private
	 */
	async init(secret: symbol) {

		if (secret !== COM_HUB_SECRET) throw new Error("Directly calling CommunicationInterface.init() is not allowed")
		if (Runtime.endpoint == LOCAL_ENDPOINT) throw new Error("Cannot use communication interface with local endpoint")
		await this.#reconnect()
	}

	/**
	 * @private
	 */
	async deinit(secret: symbol) {
		if (secret !== COM_HUB_SECRET) throw new Error("Directly calling CommunicationInterface.deinit() is not allowed")
		this.clearSockets()
		await this.disconnect()
	}

	getSockets(): ReadonlySet<Socket> {
		return this.#sockets as ReadonlySet<Socket>
	}


	#connectHandler: ((endpoint: EndpointConnectEvent) => void)|null|undefined

	/**
	 * Event handler that is called when a new endpoint is connected to a socket on this interface
	 */
	set onConnect(handler: ((endpoint: EndpointConnectEvent) => void)|null|undefined) {
		if (handler) {
			this.#connectHandler = handler
			this.addEventListener("connect", handler)
		}
		else {
			if (this.#connectHandler) this.removeEventListener("connect", this.#connectHandler)
			this.#connectHandler = handler
		}
	}

	async #reconnect() {
		if (this.#connecting) return;
		this.#connecting = true;
		while (!await this.connect()) {
			await sleep(this.properties.reconnectInterval || 3000)
		}
		this.logger.success("Connected to " + this);
		this.#connecting = false;
	}

	protected async onConnectionError() {
		this.logger.error("Connection error (" + this + ")");
		this.clearSockets();
		await this.#reconnect()
	}
	
	/**
	 * Create a new socket for this interface
	 */
	protected async addSocket(socket: Socket) {
		if (this.#sockets.has(socket)) throw new Error("Socket already part of interface sockets.")

		socket.addEventListener('disconnect', e => {
			this.dispatchEvent(new EndpointDisconnectEvent(e.endpoint))
			// remove old socket
			this.removeSocket(socket)
			// clone and add new socket
			const newSocket = this.cloneSocket(socket);
			socket.clone = newSocket;
			this.addSocket(newSocket);
		})
		socket.addEventListener('connect', e => {
			this.dispatchEvent(new EndpointConnectEvent(e.endpoint))
		})

		socket.interfaceProperties = this.properties
		socket.logger = this.logger;
		socket.connected = true; // adds sockets to communication hub
		this.#sockets.add(socket);
		// send HELLO message
		if (socket.canSend) {
			const helloMessage = await communicationHub.handler.compileHelloMessage()
			if (helloMessage) socket.sendHello(helloMessage)
		}
	}

	/**
	 * Create a new socket from an existing socket
	 * which is no longer connected to an endpoint
	 * @param socket 
	 */
	protected abstract cloneSocket(socket: Socket): Socket

	/**
	 * Remove a socket from this interface
	 */
	protected removeSocket(socket: Socket) {
		if (!this.#sockets.has(socket)) throw new Error("Cannot remove socket, not part of interface sockets.")
		this.#sockets.delete(socket)
		socket.connected = false; // removes socket from communication hub
	}

	/**
	 * Remove all sockets from this interface
	 */
	protected clearSockets() {
		for (const socket of this.#sockets) {
			this.removeSocket(socket)
		}
	}

	toString() {
		return getIdentifier(this.properties)
	}

	declare addEventListener: <K extends keyof CustomEventMap>(type: K, listener: (ev: CustomEventMap[K]) => void) => void;
    declare removeEventListener: <K extends keyof CustomEventMap>(type: K, listener: (ev: CustomEventMap[K]) => void) => void;
	declare dispatchEvent: <K extends keyof CustomEventMap>(ev: CustomEventMap[K]) => boolean;
}