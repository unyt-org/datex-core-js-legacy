import { Runtime } from "../../runtime/runtime.ts";
import { Endpoint, Target } from "../../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, InterfaceDirection, InterfaceProperties } from "../communication-interface.ts";
import { communicationHub } from "../communication-hub.ts";

export class WindowInterfaceSocket extends CommunicationInterfaceSocket {
    constructor(public readonly window: Window, public readonly windowOrigin: string, public readonly transmissionMode: "buffer"|"json" = "buffer") {
        super();
    }

    handleReceive = (event: MessageEvent) => {
        if (event.origin == this.windowOrigin) {
            if (event.data instanceof ArrayBuffer) this.receive(event.data)
            else if (typeof event.data == "string") this.receive(stringToArrayBuffer(event.data))
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
            if (this.transmissionMode == "json") this.window.postMessage(arrayBufferToString(dxb), this.windowOrigin)
            else this.window.postMessage(dxb, this.windowOrigin)
            return true;
        }
        catch {
            return false;
        }
    }
}

/**
 * Creates a direct DATEX communication channel between a parent and child window
 */
export class WindowInterface extends CommunicationInterface {
    
    public properties: InterfaceProperties = {
        type: "window",
        direction: InterfaceDirection.IN_OUT,
        latency: 15,
        bandwidth: 1_000_000
    }

    #windowOrIFrame: Window|HTMLIFrameElement
    #windowOrigin: string
    #isChild: boolean
    #transmissionMode: "buffer"|"json"

    get window() {
        return this.#windowOrIFrame instanceof HTMLIFrameElement ? this.#windowOrIFrame.contentWindow! : this.#windowOrIFrame;
    }

    constructor(window: Window, windowOrigin?: string|URL, type?: "parent"|"child", transmissionMode?: "buffer"|"json")
    constructor(iframe: HTMLIFrameElement, iframeOrigin?: string|URL, type?: "parent"|"child", transmissionMode?: "buffer"|"json" )
    constructor(window: Window|HTMLIFrameElement, windowOrigin?: string|URL, type?: "parent"|"child", transmissionMode: "buffer"|"json" = "buffer") {
        super()

        let windowOriginURL = windowOrigin ? new URL(windowOrigin) : null;

        this.#windowOrIFrame = window;
        this.#transmissionMode = transmissionMode;

        // is parent document, has iframe
        if (window instanceof HTMLIFrameElement) {
            this.#isChild = false;
            // Modifying the sandbox attr does not make sense since here
            // since the src is already set and iframe is sandboxed on load
            // window.setAttribute("sandbox", "allow-popups-to-escape-sandbox allow-modals allow-forms allow-popups allow-scripts allow-same-origin allow-top-navigation")
            this.#windowOrigin = new URL(window.src).origin;
            windowOriginURL = new URL(window.src);
            this.logger.debug("initializing as parent window, child iframe origin: " + this.#windowOrigin)
        }
        // is opened child window or inside iframe
        else if (type !== "parent" && (type === "child" || window === self.window.opener || globalThis.self !== globalThis.top)) {
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
            this.logger.debug("initializing as child window, parent window origin: " + this.#windowOrigin)
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
            this.logger.debug("initializing as parent window, child window origin: " + this.#windowOrigin)
        }

        this.properties.name = windowOriginURL?.toString() || this.#windowOrigin;
    
        globalThis.addEventListener("message", this.onReceive);
        if (this.#isChild) {
            // if in sub window: send INIT to parent immediately
            this.sendInit();
        }
        this.handleClose();
    }

    #connectedPromise = Promise.withResolvers<true>()

    connect() {
        return this.#connectedPromise.promise;
    }

    disconnect() {
        // make sure event listener is removed if INIT not yet completed
        globalThis.removeEventListener("message", this.onReceive);
    }
    

    private sendInit() {
        this.window.postMessage({
            type: "INIT",
            endpoint: Runtime.endpoint.toString()
        }, this.#windowOrigin);
    }

    onClose?: ()=>void

    private handleClose() {
        // check window.closed every second
        const interval = setInterval(() => {
            if (this.window?.closed) {
                clearInterval(interval);
                this.clearSockets()
                this.onClose?.()
            }
        }, 1000);
    }

    private onReceive = (event: MessageEvent) => {
        if (event.origin == this.#windowOrigin) {
            const data = event.data;
            if (data?.type == "INIT") {
                this.#connectedPromise.resolve(true)
                
                // only one active socket allowed, remove existing
                this.clearSockets();

                const socket = new WindowInterfaceSocket(this.window, this.#windowOrigin, this.#transmissionMode)
                this.addSocket(socket)

                // if in parent: send INIT to window after initialized
                if (!this.#isChild) this.sendInit();
            }
        }
    }

    cloneSocket(socket: WindowInterfaceSocket) {
        return new WindowInterfaceSocket(socket.window, socket.windowOrigin, socket.transmissionMode);
    }

    
    static createChildWindowInterface(childWindow: Window, windowOrigin: string|URL, transmissionMode?: "buffer"|"json") {
        return new WindowInterface(childWindow, windowOrigin, "parent", transmissionMode)
    }

    static createChildIFrameInterface(iframe: HTMLIFrameElement, transmissionMode?: "buffer"|"json") {
        return new WindowInterface(iframe, undefined, "parent", transmissionMode)
    }

    static createParentInterface(parentWindow: Window, windowOrigin?: string|URL, transmissionMode?: "buffer"|"json") {
        return new WindowInterface(parentWindow, windowOrigin, "child", transmissionMode)
    }


    /**
     * Opens a new window and registers a attached WindowInterface.
     * The WindowInterface is automatically removed when the window is closed.
     */
    static createWindow(url: string | URL, target?: string, features?: string, connectionTimeout?: number) {
        const newWindow = window.open(url, target, features);
        if (!newWindow) return Promise.resolve({window: null, endpoint: null});
        const windowInterface = this.createChildWindowInterface(newWindow, url)
        
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

    /**
     * Binds a Iframe and registers a attached WindowInterface.
     * The WindowInterface is automatically removed when the iframe is closed.
     */
    static bindIFrame(iframe: HTMLIFrameElement, connectionTimeout?: number) {
        const windowInterface = this.createChildIFrameInterface(iframe)
        
        communicationHub.addInterface(windowInterface)
        windowInterface.onClose = () => {
            communicationHub.removeInterface(windowInterface)
        }

        return new Promise<Endpoint|null>((resolve) => {
            windowInterface.addEventListener("connect", e => {
                resolve(e.endpoint)
            })
            if (connectionTimeout!=null && isFinite(connectionTimeout)) { 
                setTimeout(() => {
                    resolve(null)
                }, connectionTimeout);
            }
        })
    }

}

export function arrayBufferToString(buf: ArrayBuffer) {
	return String.fromCharCode.apply(null, new Uint16Array(buf) as unknown as number[]);
}
 
export function stringToArrayBuffer(str: string) {
	const buf = new ArrayBuffer(str.length*2); // 2 bytes for each char
	const bufView = new Uint16Array(buf);
	for (let i=0, strLen=str.length; i < strLen; i++) {
		bufView[i] = str.charCodeAt(i);
	}
	return buf;
}