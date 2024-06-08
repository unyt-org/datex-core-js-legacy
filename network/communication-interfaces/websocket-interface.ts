import { CommunicationInterface, CommunicationInterfaceSocket } from "../communication-interface.ts";
import { onlineStatus } from "../online-status.ts";

/**
 * WebSocket interface socket, used by WebSocket client and server interfaces
 */
export class WebSocketInterfaceSocket extends CommunicationInterfaceSocket {
    constructor(public readonly webSocket: WebSocket) {
        super();
    }

    handleReceive = (event: MessageEvent) => {
        this.receive(event.data)
    }

    open() {
        this.webSocket.addEventListener('message', this.handleReceive);
    }

    close() {
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

/**
 * Common base class for WebSocket client and server interfaces
 */
export abstract class WebSocketInterface extends CommunicationInterface<WebSocketInterfaceSocket> {

    #webSockets = new Map<WebSocket, {
        errorHandler: () => void,
        openHandler: () => void
    }>()

    initWebSocket(webSocket: WebSocket) {
        return new Promise<boolean>(resolve => {
            try {
                webSocket.binaryType = 'arraybuffer';

                const socket = new WebSocketInterfaceSocket(webSocket)
        
                let connectionOpen = false;
                const errorHandler = () => {
                    console.warn("error handler", connectionOpen)
                    // don't trigger any further errorHandlers
                    webSocket.removeEventListener('close', errorHandler);
                    webSocket.removeEventListener('error', errorHandler);

                    this.#webSockets.delete(webSocket);
                    if (webSocket.readyState !== WebSocket.CLOSED) {
                        // make sure the socket is closed
                        try {webSocket.close()} catch {/*ignore*/} 
                    }

                    if (!connectionOpen) resolve(false);
                    else {
                        console.warn("Remove socket");
                        this.removeSocket(socket);
                        this.onWebSocketClosed(socket)
                    }
                };

                const openHandler = async () => {
                    await this.addSocket(socket);
                    connectionOpen = true;
                    this.onWebSocketOpened(webSocket);
                    resolve(true);
                };

                // webSocket already open, call openHandler immediately
                if (webSocket.readyState === WebSocket.OPEN) {
                    openHandler();
                }

                webSocket.addEventListener('open', openHandler);
                webSocket.addEventListener('error', errorHandler);
                webSocket.addEventListener('close', errorHandler);
                
                effect(()=>{
                    if (!onlineStatus.val)
                        errorHandler();
                });
                
                this.#webSockets.set(webSocket, {
                    errorHandler,
                    openHandler
                })
            }
            catch {
                resolve(false)
            }
        })
    }

    /**
     * Called when a new WebSocket connection is opened
     */
    abstract onWebSocketOpened(webSocket: WebSocket): void

    /**
     * Called when a WebSocket connection is closed
     */
    abstract onWebSocketClosed(socket: WebSocketInterfaceSocket): void

    disconnect() {
        for (const [webSocket, {errorHandler, openHandler}] of this.#webSockets.entries()) {
            try {
                webSocket.removeEventListener('open', openHandler);
                webSocket.removeEventListener('error', errorHandler);
                webSocket.removeEventListener('close', errorHandler);
                webSocket.close();
            }
            catch {}
        }
        this.#webSockets.clear();
    }

    cloneSocket(socket: WebSocketInterfaceSocket) {
        return new WebSocketInterfaceSocket(socket.webSocket);
    }
}