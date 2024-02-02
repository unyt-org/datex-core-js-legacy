import { client_type } from "../../utils/constants.ts";
import { CommunicationInterface, InterfaceProperties, CommunicationInterfaceSocket } from "../communication-interface.ts";


export class WebSocketClientInterfaceSocket extends CommunicationInterfaceSocket {
	constructor(public readonly webSocket: WebSocket) {
		super();
	}

	handleReceive = (event: MessageEvent) => {
		console.log("receive ws client")
		this.receive(event.data)
	}

	open() {
		console.log("open ws client")
		this.webSocket.addEventListener('message', this.handleReceive);
	}

	close() {
		console.log("close ws client")
		this.webSocket.removeEventListener('message', this.handleReceive);
	}

	send(datex: ArrayBuffer) {
		try {
			this.webSocket.send(datex)
			return true;
		}
		catch {
			return false;
		}
	}
}

export class WebSocketClientInterface extends CommunicationInterface<WebSocketClientInterfaceSocket> {

	
	public origin:URL
    private webSocket?: WebSocket;

	public properties: InterfaceProperties = {
		name: "web-socket-client",
		canSend: true,
		canReceive: true,
		priority: 10
	}
	
	constructor(origin: string|URL) {
		super()

		// normalize origin
		if (typeof origin === "string") {
			origin = new URL(origin)
		}
		if (origin.protocol === "https:") origin.protocol = "wss:"
		if (origin.protocol === "http:") origin.protocol = "ws:"
		if (origin.protocol !== "wss:" && origin.protocol !== "ws:") {
			throw new Error("Invalid protocol for WebSocketClientInterface")
		}

		this.origin = origin;
		this.properties.description = origin.toString();
	}

	#errorEventListener?: () =>void
	#openEventListener?: () =>void


	connect() {
		if (client_type == "browser" && !navigator.onLine) {
            this.logger.error("Cannot connect (offline)")
            return false;
        }
		
		return new Promise<boolean>(resolve => {
			try {
				this.webSocket = new WebSocket(this.origin);    
				this.webSocket.binaryType = 'arraybuffer';

				const socket = new WebSocketClientInterfaceSocket(this.webSocket)
		
				// connection opened
				let connectionOpen = false;
				this.#errorEventListener = () => {
					if (!connectionOpen) resolve(false);
					else {
						this.onConnectionError();
					}
				};
				this.#openEventListener = () => {
					if (this.origin.protocol == 'ws' && !this.origin.host.match(/localhost(:\d+)?/)) this.logger.warn(`unsecure websocket connection to ${this.origin.host}`)
					this.addSocket(socket);		
					connectionOpen = true;		
					resolve(true);
				};
				this.webSocket.addEventListener('open', this.#openEventListener);
				this.webSocket.addEventListener('error', this.#errorEventListener);
			}
			catch {
				resolve(false)
			}
		})
	}

	disconnect() {
		if (!this.webSocket) return;
		if (this.#openEventListener) this.webSocket.removeEventListener('open', this.#openEventListener);
		if (this.#errorEventListener) this.webSocket.removeEventListener('error', this.#errorEventListener);
		this.webSocket?.close();
	}

	cloneSocket(socket: WebSocketClientInterfaceSocket) {
		return new WebSocketClientInterfaceSocket(socket.webSocket);
	}
}