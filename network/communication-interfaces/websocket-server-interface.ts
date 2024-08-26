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

    #server?: WebServer;
    #serverOptions?: Deno.ServeOptions;

    #denoServer?: Deno.HttpServer;

    constructor(server?: WebServer)
    constructor(serveOptions: Deno.ServeOptions)
    constructor(server?: WebServer|Deno.ServeOptions) {
        super()
        if ((server as any)?.addRequestHandler) this.#server = server as WebServer;
        else this.#serverOptions = server as Deno.ServeOptions;
    }

    connect() {
        if (this.#server) {
            this.#server.addRequestHandler(async (reqEvent) => {
                const response = await this.handleRequest(reqEvent.request);
                if (response) {
                    reqEvent.respondWith(response).catch(() => {});
                    return true;
                }
                else return false;
            }, true);
        }
        else if (this.#serverOptions) {
            this.#denoServer = Deno.serve({
                ...this.#serverOptions,
                handler: async (req) => {
                    const response = await this.handleRequest(req);
                    if (response) return response;
                    else return new Response("DATEX WebSocketInterface", {status: 501});
                }
            });
        }
        // TODO: websocket interface might not be set up yet
        return true;
    }

    async disconnect() {
        super.disconnect();
        if (this.#denoServer) {
            try {
                await this.#denoServer.shutdown();
            }
            catch (e) {
                console.error("Failed to shutdown server", e);
            }
        }
    }


    /**
     * Can be called manually to upgrade a request to a WebSocket connection
     * used for the websocket server interface
     * @param request 
     * @returns a response to the request if a websocket upgrade is possible
     */
    public handleRequest(request: Request){
        // is websocket upgrade?
        if (request.headers.get("upgrade") === "websocket") {
            try {
                const {socket, response} = this.upgradeWebSocket(request);
                this.initWebSocket(socket).catch(console.error);
                return response;
            }
            catch {
                return false;
            }
        }
        else return false;
    }

    protected upgradeWebSocket(request: Request) {
        // upgrade to websocket
        const { socket, response } = Deno.upgradeWebSocket(request);
        
        // infer interface ws url from request url
        if (!this.properties.name) {
            let name = request.url
                .replace("http://localhost", "ws://localhost")
                .replace("http://", "wss://")
                .replace("https://", "wss://");
            if (name.endsWith("/")) name = name.slice(0, -1);
            this.properties.name = name;
        }

        return { socket, response };
    }

    onWebSocketOpened(_webSocket: WebSocket) {
        // ignore
    }	  

    onWebSocketClosed(_socket: WebSocketInterfaceSocket) {
        // ignore;
    }
}