import { CommunicationInterfaceSocket, InterfaceDirection } from "../communication-interface.ts";
import { CommunicationInterface } from "../communication-interface.ts";
import { InterfaceProperties } from "../communication-interface.ts";

/**
 * Server interface, implemented by UIX Server
 */
export interface WebServer {
	addRequestHandler(requestHandler: requestHandler, prioritize?: boolean): void
}
type requestHandler = (req: Deno.RequestEvent, path:string, con:Deno.Conn)=>void|boolean|string|Promise<void|boolean|string>;


export class HTTPServerInterfaceSocket extends CommunicationInterfaceSocket {

	constructor(public server: WebServer) {
		super();
	}

	open() {
		this.server.addRequestHandler(this.handleRequest.bind(this));
	}
	close() {
		// ignore (TODO: remove request handler)
	}

	protected async handleRequest(requestEvent: Deno.RequestEvent){
		// POST request to /datex-http
		if (requestEvent.request.method == "POST" && new URL(requestEvent.request.url).pathname == "/datex-http") {
            const dxb = await requestEvent.request.arrayBuffer()
			this.receive(dxb);
            requestEvent.respondWith(new Response("Ok"));
        }   
        else return false;
    }

	send(_dxb: ArrayBuffer) {
		// ignore
		return false;
	}

	override async sendHello(_dxb:ArrayBuffer) {
		// ignore
	}
	override async sendGoodbye(_dxb:ArrayBuffer) {
		// ignore
	}
}

export class HTTPServerInterface extends CommunicationInterface {

	public properties: InterfaceProperties = {
		type: "http-server",
		direction: InterfaceDirection.IN,
		latency: 0,
		bandwidth: 1
	}

	#server: WebServer;

	constructor(server: WebServer) {
		super()
		this.#server = server;
	}

	connect() {
		const socket = new HTTPServerInterfaceSocket(this.#server)
		this.addSocket(socket)
		return true;
	}

	disconnect() {
		// ignore
	}

	cloneSocket(socket: HTTPServerInterfaceSocket) {
		return new HTTPServerInterfaceSocket(socket.server);
	}
}