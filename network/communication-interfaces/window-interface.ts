import { Runtime } from "../../runtime/runtime.ts";
import { Endpoint, Target } from "../../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, InterfaceDirection, InterfaceProperties } from "../communication-interface.ts";
import { communicationHub } from "../communication-hub.ts";

export class WindowInterfaceSocket extends CommunicationInterfaceSocket {
	constructor(public readonly window: Window, public readonly windowOrigin: string) {
		super();
	}

	handleReceive = (event: MessageEvent) => {
		if (event.origin == this.windowOrigin && event.data instanceof ArrayBuffer) {
			this.receive(event.data)
		}
	}

	open() {
		globalThis.addEventListener('message', this.handleReceive);
	}

	close() {
		globalThis.removeEventListener('message', this.handleReceive);
	}

	send(dxb: ArrayBuffer) {
		try {
			this.window.postMessage(dxb, this.windowOrigin)
			return true;
		}
		catch {
			return false;
		}
	}
}

export class WindowInterface extends CommunicationInterface {
	
	#window: Window
	#windowOrigin: string
	#isChild: boolean
	
	public properties: InterfaceProperties = {
		type: "window",
		direction: InterfaceDirection.IN_OUT,
		priority: 10
	}

	constructor(window: Window, windowOrigin?: string|URL) {
		super()

		const windowOriginURL = windowOrigin ? new URL(windowOrigin) : null;

		this.#window = window;

		// is the child
		if (window === self.window.opener) {
			this.#isChild = true;

			// explicitly set window origin
			if (windowOriginURL) {
				this.#windowOrigin = windowOriginURL.origin;
			}
			else {
				// first try window.location.origin
				try {
					this.#windowOrigin = window.location.origin;
				}
				// try document.referrer
				catch {
					if (!document.referrer) throw new Error("The origin of the parent window cannot be determined automatically. Please provide windowOrigin as second argument.");
					this.#windowOrigin = new URL(document.referrer).origin;
				}
			}
            this.logger.info("initializing as child window, parent window origin: " + this.#windowOrigin)
		}
		// is the parent document
        else {
			this.#isChild = false;

			// explicitly set window origin
			if (windowOriginURL) {
				this.#windowOrigin = windowOriginURL.origin;
			}
			else {
				throw new Error("The origin of the child window cannot be determined automatically. Please provide windowOrigin as second argument.");				
			}
            this.logger.info("initializing as parent window, window origin: " + this.#windowOrigin)
        }

		this.properties.name = windowOriginURL?.toString() || this.#windowOrigin;
	
		globalThis.addEventListener("message", this.onReceive);
		if (this.#isChild) {
			// if in sub window: send INIT to parent immediately
			this.sendInit();
		}
		this.handleClose();
	}

	connect() {
		return true;
	}

	disconnect() {
		// make sure event listener is removed if INIT not yet completed
		globalThis.removeEventListener("message", this.onReceive);
	}
	

	private sendInit() {
        this.#window.postMessage({
            type: "INIT",
            endpoint: Runtime.endpoint.toString()
        }, this.#windowOrigin);
    }

	onClose?: ()=>void

	private handleClose() {
		const interval = setInterval(() => {
			if (this.#window.closed) {
				clearInterval(interval);
				console.log("closed")
				this.clearSockets()
				this.onClose?.()
			}
		}, 1000);
	}

	private onReceive = (event: MessageEvent) => {
        if (event.origin == this.#windowOrigin) {
            const data = event.data;

           	if (data?.type == "INIT") {
				globalThis.removeEventListener("message", this.onReceive);

				const socket = new WindowInterfaceSocket(this.#window, this.#windowOrigin)
				socket.endpoint = Target.get(data.endpoint) as Endpoint;
				this.addSocket(socket)

                // if in parent: send INIT to window after initialized
                if (!this.#isChild) this.sendInit();
            }
        }
    }

	cloneSocket(socket: WindowInterfaceSocket) {
		return new WindowInterfaceSocket(socket.window, socket.windowOrigin);
	}

	
	static createChildInterface(childWindow: Window, windowOrigin: string|URL) {
		return new WindowInterface(childWindow, windowOrigin)
	}

	static createParentInterface(parentWindow: Window, windowOrigin?: string|URL) {
		return new WindowInterface(parentWindow, windowOrigin)
	}

	/**
	 * Opens a new window and registers a attached WindowInterface.
	 * The WindowInterface is automatically removed when the window is closed.
	 */
	static createWindow(url: string | URL, target?: string, features?: string, connectionTimeout?: number) {
		const newWindow = window.open(url, target, features);
		if (!newWindow) return Promise.resolve({window: null, endpoint: null});
		const windowInterface = this.createChildInterface(newWindow, url)
		
		communicationHub.addInterface(windowInterface)
		windowInterface.onClose = () => {
			communicationHub.removeInterface(windowInterface)
		}

		return new Promise<{window:Window|null, endpoint: Endpoint|null}>((resolve) => {
			windowInterface.addEventListener("connect", e => {
				resolve({
					window: newWindow,
					endpoint: e.endpoint
				})
			})
			if (connectionTimeout!=null && isFinite(connectionTimeout)) { 
				setTimeout(() => {
					newWindow.close();
					resolve({window: newWindow, endpoint: null})
				}, connectionTimeout);
			}
		})
	}

}