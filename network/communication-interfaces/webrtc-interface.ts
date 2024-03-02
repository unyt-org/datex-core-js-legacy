import { Endpoint } from "../../types/addressing.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, InterfaceDirection, InterfaceProperties } from "../communication-interface.ts";

@endpoint class WebRTCSignaling {

    @property static offer(data:any) {
        InterfaceManager.connect("webrtc", datex.meta!.sender, [data]);
    }

    @property static accept(data:any) {
        WebRTCClientInterface.waiting_interfaces_by_endpoint.get(datex.meta!.sender)?.setRemoteDescription(data);
    }  

    @property static candidate(data:any) {
        WebRTCClientInterface.waiting_interfaces_by_endpoint.get(datex.meta!.sender)?.addICECandidate(data);
    }  
}

export class WebRTCInterfaceSocket extends CommunicationInterfaceSocket {

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
 * Creates a direct DATEX communication channel between two WebRTC clients
 */
export class WebRTCInterface extends CommunicationInterface {
    
    public properties: InterfaceProperties = {
        type: "webrtc",
        direction: InterfaceDirection.IN_OUT,
		latency: 20,
        bandwidth: 50_000
    }

    constructor(endpoint: Endpoint) {
        super()
        const socket = new WebRTCInterfaceSocket();
        socket.endpoint = endpoint;
        this.addSocket(socket);
    }

    connect() {
        return true;
    }

    disconnect() {}
    
    cloneSocket(_socket: WebRTCInterfaceSocket) {
        return new WebRTCInterfaceSocket();
    }

}