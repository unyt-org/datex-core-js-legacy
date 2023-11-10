import { Datex } from "datex-core-legacy/mod.ts";
import InterfaceManager, { CommonInterface } from "datex-core-legacy/network/client.ts";
import { Target } from "datex-core-legacy/types/addressing.ts";

type ParentDocument = [Window] & {postMessage:(data:unknown,origin:string)=>void};

/**
 * Creates a direct DATEX communication channel with window.
 */
export class WindowCommunicationInterface extends CommonInterface<[Window, string]> {

	declare window?: Window
    declare parentDocument?: ParentDocument
    declare otherOrigin: string

    override in = true;
    override out = true;
    override global = false;
    override authorization_required = false; // don't connect with public keys
    override type = "window";
    
    protected async connect() {
        // is the parent document
        if (!this.initial_arguments[0]?.opener || 
            (this.initial_arguments[0].opener === self.window)) {
            this.window = this.initial_arguments[0];
            this.otherOrigin = this.initial_arguments[1];
            this.logger.info("initializing as parent window, window origin: " + this.otherOrigin)
        }
        // is the child 
        else if (this.initial_arguments[0]) {
            this.parentDocument = this.initial_arguments[0]
            this.otherOrigin = new URL(document.referrer).origin;
        
            this.logger.info("initializing as child window, parent window origin: " + this.otherOrigin)

        }
		else {
			this.logger.error("no Window provided for WindowCommunicationInterface");
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

                    // if in parent: send INIT to window after initialized
                    if (this.window) this.sendInit();
                }
            }
        })
        
        // if in sub window: send INIT to parent immediately
        if (this.parentDocument)
            this.sendInit();

        return true;
    }

    private sendInit() {
        this.other.postMessage({
            type:"INIT",
            endpoint:Datex.Runtime.endpoint.toString()
        },
        this.otherOrigin);
    }

    public override disconnect() {
        
    }

    get other() {
        return this.window ?
            this.window :
            this.parentDocument?.opener
    }

    protected sendBlock(datex: ArrayBuffer) {
        this.other.postMessage(datex, this.otherOrigin);
    }

}

// register worker interface immediately
InterfaceManager.registerInterface("window", WindowCommunicationInterface);
