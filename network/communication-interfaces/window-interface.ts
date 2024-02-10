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

    get window() {
        return this.#windowOrIFrame instanceof HTMLIFrameElement ? this.#windowOrIFrame.contentWindow! : this.#windowOrIFrame;
    }

    constructor(window: Window, windowOrigin?: string|URL, type?: "parent"|"child")
    constructor(iframe: HTMLIFrameElement, iframeOrigin?: string|URL, type?: "parent"|"child")
    constructor(window: Window|HTMLIFrameElement, windowOrigin?: string|URL, type?: "parent"|"child") {
        super()

        let windowOriginURL = windowOrigin ? new URL(windowOrigin) : null;

        this.#windowOrIFrame = window;

        // is parent document, has iframe
        if (window instanceof HTMLIFrameElement) {
            this.#isChild = false;
            window.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox")
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

                const socket = new WindowInterfaceSocket(this.window, this.#windowOrigin)
                this.addSocket(socket)

                // if in parent: send INIT to window after initialized
                if (!this.#isChild) this.sendInit();
            }
        }
    }

    cloneSocket(socket: WindowInterfaceSocket) {
        return new WindowInterfaceSocket(socket.window, socket.windowOrigin);
    }

    
    static createChildWindowInterface(childWindow: Window, windowOrigin: string|URL) {
        return new WindowInterface(childWindow, windowOrigin, "parent")
    }

    static createChildIFrameInterface(iframe: HTMLIFrameElement) {
        return new WindowInterface(iframe, undefined, "parent")
    }

    static createParentInterface(parentWindow: Window, windowOrigin?: string|URL) {
        return new WindowInterface(parentWindow, windowOrigin, "child")
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