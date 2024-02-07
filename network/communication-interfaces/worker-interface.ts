import { Endpoint } from "../../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, InterfaceDirection, InterfaceProperties } from "../communication-interface.ts";

export class WorkerInterfaceSocket extends CommunicationInterfaceSocket {
    constructor(public readonly worker: Worker) {
        super();
    }

    handleReceive = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
            this.receive(event.data)
        }
    }

    open() {
        this.worker.addEventListener("message", this.handleReceive);
    }

    close() {
        this.worker.removeEventListener('message', this.handleReceive);
    }

    send(dxb: ArrayBuffer) {
        try {
            this.worker.postMessage(dxb)
            return true;
        }
        catch {
            return false;
        }
    }
}

/**
 * Creates a direct DATEX communication channel between workers/threads
 */
export class WorkerInterface extends CommunicationInterface {
    
    public properties: InterfaceProperties = {
        type: "worker",
        direction: InterfaceDirection.IN_OUT,
        latency: 15,
        bandwidth: 1_000_000
    }

    constructor(worker: Worker, endpoint?: Endpoint) {
        super()
        const socket = new WorkerInterfaceSocket(worker);
        if (endpoint) socket.endpoint = endpoint;
        this.addSocket(socket);
        // TODO: currently there is no way to know if the worker is still alive
    }

    connect() {
        return true;
    }

    disconnect() {}
    
    cloneSocket(socket: WorkerInterfaceSocket) {
        return new WorkerInterfaceSocket(socket.worker);
    }

}