import { InterfaceDirection } from "../communication-interface.ts";
import { InterfaceProperties } from "../communication-interface.ts";
import type { WebServer } from "./http-server-interface.ts";
import { WebSocketInterface, WebSocketInterfaceSocket } from "./websocket-interface.ts";

/**
 * WebSocket server interface for receiving WebSocket connections from clients
 */
export class WebSocketServerInterface extends WebSocketInterface {

	public properties: InterfaceProperties = {
		type: "websocket-server",
		direction: InterfaceDirection.IN_OUT,
		latency: 40,
		bandwidth: 50_000
	}

	#server: WebServer;

	constructor(server: WebServer) {
		super()
		this.#server = server;
	}

	connect() {
		this.#server.addRequestHandler(this.handleRequest.bind(this), true);
		return true;
	}

	protected async handleRequest(requestEvent: Deno.RequestEvent){
		// is websocket upgrade?
		if (requestEvent.request.headers.get("upgrade") === "websocket") {
			try {
				const socket = await this.upgradeWebSocket(requestEvent);
				await this.initWebSocket(socket);
				return true;
			}
			catch {
				return false;
			}
		}
        else return false;
    }

	protected async upgradeWebSocket(requestEvent: Deno.RequestEvent) {
		// upgrade to websocket
		const req = requestEvent.request; 
		const { socket, response } = Deno.upgradeWebSocket(req);
		await requestEvent.respondWith(response);

		// infer interface ws url from request url
		if (!this.properties.name) {
			let name = requestEvent.request.url
				.replace("http://localhost", "ws://localhost")
				.replace("http://", "wss://")
				.replace("https://", "wss://");
			if (name.endsWith("/")) name = name.slice(0, -1);
			this.properties.name = name;
		}

		return socket;
	}

	onWebSocketOpened(_webSocket: WebSocket) {
		// ignore
	}	  

	onWebSocketClosed(_socket: WebSocketInterfaceSocket) {
		// ignore;
	}
}