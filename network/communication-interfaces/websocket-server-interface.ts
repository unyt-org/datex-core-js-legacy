import { InterfaceDirection } from "../communication-interface.ts";
import { InterfaceProperties } from "../communication-interface.ts";
import type { WebServer } from "./http-server-interface.ts";
import { WebSocketInterface } from "./websocket-interface.ts";


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
		this.#server.addRequestHandler(this.handleRequest.bind(this));
		return true;
	}

	protected handleRequest(requestEvent: Deno.RequestEvent){
		// is websocket upgrade?
		if (requestEvent.request.headers.get("upgrade") === "websocket") {
			const socket = this.upgradeWebSocket(requestEvent);
			this.initWebSocket(socket);
			return true;
		}
        else return false;
    }

	protected upgradeWebSocket(requestEvent: Deno.RequestEvent) {
		// upgrade to websocket
		const req = requestEvent.request; 
		const { socket, response } = Deno.upgradeWebSocket(req);
		requestEvent.respondWith(response);

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

	onWebSocketOpen(_webSocket: WebSocket): void {
		// ignore
	}	  
}