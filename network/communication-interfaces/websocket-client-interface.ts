import { Endpoint } from "../../types/addressing.ts";
import { client_type } from "../../utils/constants.ts";
import { InterfaceDirection } from "../communication-interface.ts";
import { InterfaceProperties } from "../communication-interface.ts";
import { WebSocketInterface, WebSocketInterfaceSocket } from "./websocket-interface.ts";

export class WebSocketClientInterface extends WebSocketInterface {

	public properties: InterfaceProperties = {
		type: "websocket-client",
		direction: InterfaceDirection.IN_OUT,
		latency: 40,
		bandwidth: 50_000
	}

	public origin:URL
	#initialEndpoint?: Endpoint
	
	constructor(origin: string|URL, initialEndpoint?: Endpoint) {
		super()

		// normalize origin
		if (typeof origin === "string") {
			if (!origin.match(/^\w+?:\/\//)) {
				origin = 'wss://' + origin
			}
			origin = new URL(origin)
		}
		if (origin.protocol === "https:") origin.protocol = "wss:"
		if (origin.protocol === "http:") origin.protocol = "ws:"
		if (origin.protocol !== "wss:" && origin.protocol !== "ws:") {
			throw new Error("Invalid protocol for WebSocketClientInterface")
		}

		this.origin = origin;
		this.#initialEndpoint = initialEndpoint;
		this.properties.name = origin.toString();
	}

	
	connect() {
		if (client_type == "browser" && !navigator.onLine) {
            this.logger.error("Cannot connect (offline)")
            return false;
        }

		const webSocket = new WebSocket(this.origin);
		return this.initWebSocket(webSocket)
	}

	protected addSocket(socket: WebSocketInterfaceSocket) {
		// set initial endpoint if already known
		if (this.#initialEndpoint) socket.endpoint = this.#initialEndpoint;
		return super.addSocket(socket);
	}

	onWebSocketOpened(_webSocket: WebSocket) {
		if (this.origin.protocol == 'ws' && !this.origin.host.match(/localhost(:\d+)?/)) 
			this.logger.warn(`unsecure websocket connection to ${this.origin.host}`)
	}

	onWebSocketClosed(_webSocket: WebSocket) {
		// only one websocket exists, so we handle a interface connection error here and try to reconnect
		this.onConnectionError();
	}

}