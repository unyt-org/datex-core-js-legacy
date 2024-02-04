import { Runtime } from "../../runtime/runtime.ts";
import { LOCAL_ENDPOINT, Endpoint } from "../../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, InterfaceDirection, InterfaceProperties } from "../communication-interface.ts";

export class LocalLoopbackInterfaceSocket extends CommunicationInterfaceSocket {

	open() {}
	close() {}

	send(dxb: ArrayBuffer) {
		Runtime.datexIn({
			dxb,
			socket: this
		})
		return true;
	}

	override async sendHello(_dxb:ArrayBuffer) {
		// ignore
	}
	override async sendGoodbye(_dxb:ArrayBuffer) {
		// ignore
	}
}

export class LocalLoopbackInterface extends CommunicationInterface<LocalLoopbackInterfaceSocket> {
	
	#currentSocket?: LocalLoopbackInterfaceSocket

	public properties: InterfaceProperties = {
		type: "local",
		direction: InterfaceDirection.OUT,
		priority: 100
	}

	constructor() {
		super();
	}

	connect() {
		// default @@local socket (never removed)
		this.createSocket(LOCAL_ENDPOINT);

		Runtime.onEndpointChanged((endpoint) => {
			if (endpoint === LOCAL_ENDPOINT) return;
			// remove socket for previous endpoint
			if (this.#currentSocket) this.removeSocket(this.#currentSocket)
			// add new socket for endpoint
			this.#currentSocket = this.createSocket(endpoint);
		})

		return true;
	}
	disconnect() {}	

	private createSocket(endpoint: Endpoint) {
		const socket = new LocalLoopbackInterfaceSocket();
		socket.endpoint = endpoint;
		this.addSocket(socket)
		return socket;
	}

	cloneSocket(_socket: LocalLoopbackInterfaceSocket): never {
		throw new Error("LocalLoopbackInterface does not support cloning")
	}
	
}