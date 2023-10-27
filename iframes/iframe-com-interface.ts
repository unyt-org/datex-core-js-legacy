import { Datex } from "../mod.ts";
import InterfaceManager, { CommonInterface } from "../network/client.ts";
import { Target } from "../types/addressing.ts";

type ParentDocument = [Window] & {postMessage:(data:unknown,origin:string)=>void};

/**
 * Creates a direct DATEX communication channel with an iframe.
 * Important: The iframe must have impotred the "./iframe-init.ts" module
 */
export class IFrameCommunicationInterface extends CommonInterface<[HTMLIFrameElement|ParentDocument]> {

	declare iframe?: HTMLIFrameElement
    declare parentDocument?: ParentDocument
    declare otherOrigin: string

    override in = true;
    override out = true;
    override global = false;
    override authorization_required = false; // don't connect with public keys
    override type = "iframe";
    
    protected async connect() {

        if (this.initial_arguments[0] instanceof HTMLIFrameElement) {
            this.iframe = this.initial_arguments[0];

            // init iframe
            this.iframe.setAttribute("sandbox", "allow-scripts allow-same-origin")
            this.otherOrigin = new URL(this.iframe.src).origin;
            this.logger.info("initializing as parent window, iframe origin: " + this.otherOrigin)

            if (this.iframe.contentDocument && this.iframe.contentDocument.readyState !== "complete") {
                await new Promise(resolve => this.iframe!.addEventListener("load", resolve));
            }
        }
        // is a parent document with a window
        else if (this.initial_arguments[0]?.[0] instanceof Window) {
            this.parentDocument = this.initial_arguments[0]
            this.otherOrigin = new URL(document.referrer).origin;
        
            this.logger.info("initializing as iframe, parent window origin: " + this.otherOrigin)

        }
		else {
			this.logger.error("no IFrame or Window provided for IFrameCommunicationInterface");
			return false;
		}
        globalThis.addEventListener("message", (event) => {
            if (event.origin == this.otherOrigin) {
                const data = event.data;

                if (data instanceof ArrayBuffer) {
                    InterfaceManager.handleReceiveBlock(data, this.endpoint, this);
                }

                else if (data?.type == "INIT") {
                    this.endpoint = Target.get(data.endpoint) as Datex.Endpoint;

                    // if in parent: send INIT to iframe after initialized
                    if (this.iframe) this.sendInit();
                }
            }
        
        })
        
        // if in ifram: send INIT to parent immediately
        if (this.parentDocument)
            this.sendInit();

        return true;
    }

    private sendInit() {
        this.other.postMessage({type:"INIT", endpoint:Datex.Runtime.endpoint.toString()}, this.otherOrigin);
    }

    public override disconnect() {
        
    }

    get other() {
        return (this.parentDocument??this.iframe?.contentWindow)!
    }

    // FIXME
    i = 0;
    protected sendBlock(datex: ArrayBuffer) {
        if (this.i > 1000)
            return;
        if (new Uint8Array(datex.slice(0, 2)).toString() === "1,100")
            this.i++;
        this.other.postMessage(datex, this.otherOrigin);
    }

}

// register worker interface immediately
InterfaceManager.registerInterface("iframe", IFrameCommunicationInterface);