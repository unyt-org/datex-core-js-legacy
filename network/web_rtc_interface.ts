import { remote, expose } from "../datex.ts";
import { Endpoint, Target, datex_advanced, scope } from "../datex_all.ts";
import { client_type } from "../utils/constants.ts";

import InterfaceManager, { CommonInterface } from "./client.ts";

// signaling for WebRTC connections (used by WebRTCClientInterface)
@scope("webrtc") class _WebRTCSignaling {

    @expose @remote static offer(data:any) {
        InterfaceManager.connect("webrtc", datex.meta!.sender, [data]);
    }

    @expose @remote static accept(data:any) {
        WebRTCClientInterface.waiting_interfaces_by_endpoint.get(datex.meta!.sender)?.setRemoteDescription(data);
    }  

    @expose @remote static candidate(data:any) {
        WebRTCClientInterface.waiting_interfaces_by_endpoint.get(datex.meta!.sender)?.addICECandidate(data);
    }  
}
const WebRTCSignaling = datex_advanced(_WebRTCSignaling);


/** 'Relayed' interface */
export class WebRTCClientInterface extends CommonInterface {

    override type = "webrtc"

    connection?: RTCPeerConnection
    data_channel_out?: RTCDataChannel
    data_channel_in?: RTCDataChannel

    override in = true
    override out = true
    override global = false
    
    static waiting_interfaces_by_endpoint:Map<Target, WebRTCClientInterface> = new Map()

    constructor(endpoint: Endpoint){
        super(endpoint);
        if (client_type != "browser") return;
        WebRTCClientInterface.waiting_interfaces_by_endpoint.set(endpoint, this);
    }

    public override disconnect(){
        super.disconnect();
        this.connection?.close()
    }
    
    connect() {
        const description:RTCSessionDescription = this.initial_arguments[0];

        // deno-lint-ignore no-async-promise-executor
        return new Promise<boolean>(async resolve=>{

            // try to establish a WebRTC connection, exchange keys first
            this.connection = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });

            // listeners
            this.connection.onicecandidate = (e) => {
                if (e.candidate) WebRTCSignaling.to(this.endpoint).candidate(e.candidate.toJSON())
            };

            // connected
            this.connection.addEventListener('connectionstatechange', event => {
                switch(this.connection?.connectionState) {
                    case "connected": 
                        WebRTCClientInterface.waiting_interfaces_by_endpoint.delete(this.endpoint);
                        //resolve(true);
						break;
                    case "disconnected": this.connected = false;resolve(false);break;
                    case "closed": this.connected = false;resolve(false);break;
                    case "failed": resolve(false);
                }              
            });

            // received data channel 
            this.connection.ondatachannel = (event) => {
                this.data_channel_in = event.channel;
                this.logger.success("received data channel");
				console.log(this.data_channel_in)
                this.data_channel_in.onmessage = (event)=>{
					console.log("in>")
                    InterfaceManager.handleReceiveBlock(event.data, this.endpoint, this);
                }
                this.connected = true;
				resolve(true);
            };

            // create an offer
            if (!description) {
                this.logger.success("initializing a WebRTC connection ...", this.connection);
                
                this.data_channel_out = this.connection.createDataChannel("datex", {protocol: "datex"});

                // this.data_channel_out.addEventListener('open', e => console.warn('local data channel opened', e));
                // this.data_channel_out.addEventListener('close', e => console.warn('local data channel closed'));

                const offer = await this.connection.createOffer();
                await this.connection.setLocalDescription(offer);
                WebRTCSignaling.to(this.endpoint).offer(this.connection.localDescription!.toJSON())
            }

            // accept offer
            else {
                this.logger.success("accepting a WebRTC connection request ...");

                this.data_channel_out = this.connection.createDataChannel("datex", {protocol: "datex"});

                await this.connection.setRemoteDescription(description)
                const answer = await this.connection.createAnswer();
                await this.connection.setLocalDescription(answer);

                WebRTCSignaling.to(this.endpoint).accept(this.connection.localDescription!.toJSON())
            }
        })

    }

    async setRemoteDescription(description:any) {
        await this.connection?.setRemoteDescription(description)
    }

    async addICECandidate(candidate:object) {
        await this.connection?.addIceCandidate(new RTCIceCandidate(candidate));
    }

    sendBlock(datex:ArrayBuffer){
		console.log("send",this,this.data_channel_out)
        this.data_channel_out?.send(datex)
    }
}

InterfaceManager.registerInterface("webrtc", WebRTCClientInterface);