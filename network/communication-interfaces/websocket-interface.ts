import { CommunicationInterface, CommunicationInterfaceSocket } from "../communication-interface.ts";

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
					this.#webSockets.delete(webSocket);
					if (!connectionOpen) resolve(false);
					else {
						this.onConnectionError();
					}
				};
				const openHandler = () => {
					this.addSocket(socket);		
					connectionOpen = true;
					this.onWebSocketOpen(webSocket);
					resolve(true);
				};

				webSocket.addEventListener('open', openHandler);
				webSocket.addEventListener('error', errorHandler);
				webSocket.addEventListener('close', errorHandler);

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
	abstract onWebSocketOpen(webSocket: WebSocket): void

	disconnect() {
		for (const [webSocket, {errorHandler, openHandler}] of this.#webSockets.entries()) {
			webSocket.removeEventListener('open', openHandler);
			webSocket.removeEventListener('error', errorHandler);
			webSocket.removeEventListener('close', errorHandler);
			webSocket.close();
		}
		this.#webSockets.clear();
	}

	cloneSocket(socket: WebSocketInterfaceSocket) {
		return new WebSocketInterfaceSocket(socket.webSocket);
	}
}