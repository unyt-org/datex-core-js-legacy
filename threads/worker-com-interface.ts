import InterfaceManager, { CommonInterface } from "../network/client.ts";

/**
 * Creates a direct DATEX communication channel between workers/threads
 */
export class WorkerCommunicationInterface extends CommonInterface<[Worker]> {

	declare worker: Worker

    override in = true;
    override out = true;
    override global = false;
    override authorization_required = false; // don't connect with public keys
    override type = "worker";
    override immediate = true;
    
    protected connect() {

		this.worker = this.initial_arguments[0];
		if (!this.worker) {
			console.log("no worker provided for WorkerCommunicationInterface");
			return false;
		}

		this.worker.addEventListener("message", (event) => {
			const data = event.data;
			if (data instanceof ArrayBuffer) {
				InterfaceManager.handleReceiveBlock(data, this.endpoint, this);
			}
		});
        
        return true;
    }

    public override disconnect() {
        
    }

    protected sendBlock(datex: ArrayBuffer) {
        this.worker.postMessage(datex)
    }

}

// register worker interface immediately
InterfaceManager.registerInterface("worker", WorkerCommunicationInterface);