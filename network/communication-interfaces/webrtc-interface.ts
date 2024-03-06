import { logger } from "../../datex_all.ts";
import { Pointer } from "../../runtime/pointers.ts";
import { Endpoint } from "../../types/addressing.ts";
import { PermissionError } from "../../types/errors.ts";
import { communicationHub } from "../communication-hub.ts";
import { CommunicationInterface, CommunicationInterfaceSocket, InterfaceDirection, InterfaceProperties } from "../communication-interface.ts";

@endpoint class WebRTCSignaling {

    /**
     * signaling: offer|accept
     */
    @property static negotiation(data: RTCSessionDescriptionInit) {
        if (!datex.meta.signed) throw new PermissionError("unauthorized");
        if (data.type == "offer") WebRTCInterface.handleOffer(datex.meta.caller, data);
        else if (data.type == "answer") WebRTCInterface.handleAnswer(datex.meta.caller, data);
        else throw new Error("Unsupported session description type: " + data.type);
    }

    /**
     * signaling: candidate
     */
    @property static candidate(data: RTCIceCandidateInit) {
        if (!datex.meta.signed) throw new PermissionError("unauthorized");
        WebRTCInterface.handleCandidate(datex.meta.caller, data);
    }

    /**
     * request a specfic media stream - only works once a webrtc connection is established
     */
    @property static requestMediaStream(ptrId: string) {
        if (!datex.meta.signed) throw new PermissionError("unauthorized");
        return WebRTCInterface.requestMediaStream(datex.meta.caller, ptrId);
    }
}

export class WebRTCInterfaceSocket extends CommunicationInterfaceSocket {

    constructor(public inChannel: RTCDataChannel, public outChannel: RTCDataChannel) {
        super()
    }

    handleReceive = (event: MessageEvent) => {
        if (event.data instanceof ArrayBuffer) {
            this.receive(event.data)
        }
    }

    open() {
        this.inChannel.addEventListener("message", this.handleReceive);
    }

    close() {
        this.inChannel.removeEventListener('message', this.handleReceive);
    }

    send(dxb: ArrayBuffer) {
        try {
            this.outChannel.send(dxb)
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

    #socket?: WebRTCInterfaceSocket;
    #sessionInit?: RTCSessionDescriptionInit
    #endpoint: Endpoint;
    #connection?: RTCPeerConnection;

    #resolveTrackReceivedPromise!: (track: MediaStreamTrack) => void;
    #trackReceivedPromise!: Promise<MediaStreamTrack>


    constructor(endpoint: Endpoint, sesionInit?: RTCSessionDescriptionInit) {
        if (WebRTCInterface.connectedInterfaces.has(endpoint)) throw new Error("A WebRTCInterface for " + endpoint + " already exists");
        super()

        this.generateTrackReceivedPromise();
        this.#endpoint = endpoint;
        this.#sessionInit = sesionInit;
        this.properties.name = this.#endpoint.toString();
    }

    connect() {

        WebRTCInterface.connectingInterfaces.set(this.#endpoint, this);

        const {promise, resolve} = Promise.withResolvers<boolean>()

        // try to establish a WebRTC connection, exchange keys first
        this.#connection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        const dataChannelOut = this.#connection.createDataChannel("datex", {protocol: "datex"});

        // listeners

        this.#connection.onicecandidate = (e) => {
            if (e.candidate) WebRTCSignaling.candidate.to(this.#endpoint)(e.candidate.toJSON())
        };

        // connected
        this.#connection.onconnectionstatechange = _ => {
            switch(this.#connection?.connectionState) {
                case "disconnected":
                case "closed":
                case "failed": {
                    if (this.#socket) this.removeSocket(this.#socket);
                    resolve(false);
                }
                
            }              
        };

        // received data channel 
        this.#connection.ondatachannel = (event) => {

            this.logger.debug("received WebRTC data channel");
            const dataChannelIn = event.channel

            this.#socket = new WebRTCInterfaceSocket(dataChannelIn, dataChannelOut);
            this.#socket.endpoint = this.#endpoint;
            this.addSocket(this.#socket);
            
            if (WebRTCInterface.connectingInterfaces.has(this.#endpoint)) {
                WebRTCInterface.connectingInterfaces.delete(this.#endpoint);
                WebRTCInterface.connectedInterfaces.set(this.#endpoint, this);
            }
            resolve(true);
        };
    
        // received track
        this.#connection.ontrack = (event) => {
            console.debug("received track", event.track);
            this.#resolveTrackReceivedPromise(event.track);
            this.generateTrackReceivedPromise()
        }

        this.#connection.onnegotiationneeded = async () => {
            try {
                await this.#connection!.setLocalDescription();
                WebRTCSignaling.negotiation.to(this.#endpoint)(this.#connection!.localDescription!.toJSON())
            }
            catch (e) {
                console.error(e)
            }
        }

        // handle initial offer
        if (this.#sessionInit) {
            this.handleOffer(this.#sessionInit);
        }

        return promise;
    }

    generateTrackReceivedPromise() {
        const {promise, resolve} = Promise.withResolvers<MediaStreamTrack>();
        this.#trackReceivedPromise = promise;
        this.#resolveTrackReceivedPromise = resolve;
    }

    async collectMediaStreamTracks(count: number) {
        if (!this.#connection) throw new Error("No WebRTC connection found to collect media stream tracks");

        let tracks: MediaStreamTrack[];
        let previousCount = -1;
        while ((tracks = this.#connection.getReceivers().map(receiver => receiver.track)).length < count) {
            // throw if no new track was added (would lead to infinite loop)
            if (previousCount == tracks.length) throw new Error("Track promise was resolved, but no new track added to connection");
            previousCount = tracks.length;
            await this.#trackReceivedPromise
        }
        const mediaStream = new MediaStream();
        for (const track of tracks) {
            mediaStream.addTrack(track);
        }
        return mediaStream;
    }


    async handleOffer(data: RTCSessionDescriptionInit) {
        await this.#connection!.setRemoteDescription(data);
        const answer = await this.#connection!.createAnswer();
        await this.#connection!.setLocalDescription(answer);
        WebRTCSignaling.negotiation.to(this.#endpoint)(this.#connection!.localDescription!.toJSON())
    }


    disconnect() {
        this.#connection?.close();
        WebRTCInterface.connectedInterfaces.delete(this.#endpoint);
    }

    override removeSocket(socket: WebRTCInterfaceSocket) {
        super.removeSocket(socket);
        WebRTCInterface.connectedInterfaces.delete(this.#endpoint);
        WebRTCInterface.connectingInterfaces.delete(this.#endpoint);
    }
    
    cloneSocket(socket: WebRTCInterfaceSocket) {
        return new WebRTCInterfaceSocket(socket.inChannel, socket.outChannel);
    }

    /**
     * MediaStream handling
     */

    attachMediaStream(mediaStream: MediaStream) {
        if (!this.#connection) throw new Error("No WebRTC connection found to attach media stream");
        for (const track of mediaStream.getTracks()) {
            this.#connection.addTrack(track, mediaStream);
        }
    }

    static async getMediaStream(ptrId: string) {
        const pointerOrigin = Pointer.getOriginFromPointerId(ptrId);
        console.debug("requesting mediastream for " + ptrId + ", origin " + pointerOrigin)
        if (!this.connectedInterfaces.has(pointerOrigin)) await communicationHub.addInterface(new WebRTCInterface(pointerOrigin));
        const interf = this.connectedInterfaces.get(pointerOrigin)!;
        if (!interf.#connection) throw new Error("No WebRTC connection could be established to get media stream");

        const tracksCount = await WebRTCSignaling.requestMediaStream.to(pointerOrigin)(ptrId);
        console.debug("collecting "+tracksCount+" tracks")
        const mediaStream = await interf.collectMediaStreamTracks(tracksCount);
        console.debug("mediastream",mediaStream)
        return mediaStream;
    }

    /**
     * Register a media stream to be used by the WebRTC interface
     * @param mediaStream 
     */
    static registerMediaStream(mediaStream: MediaStream) {
        mediaStream = Pointer.proxifyValue(mediaStream) // make sure the media stream is bound to a pointer
        this.registeredMediaStreams.set(Pointer.getId(mediaStream)!, new WeakRef(mediaStream));
    }


    static registeredMediaStreams = new Map<string, WeakRef<MediaStream>>(); // TODO: garbage collect weakrefs
    static connectingInterfaces = new Map<Endpoint, WebRTCInterface>();
    static connectedInterfaces = new Map<Endpoint, WebRTCInterface>();

    static getInterfaceForEndpoint(endpoint: Endpoint, findConnecting = true, findConnected = true) {
        return (
            (findConnecting ? this.connectingInterfaces.get(endpoint) : undefined) ??
            (findConnected ? this.connectedInterfaces.get(endpoint) : undefined)
        )
    }

    static getInterfaceConnection(endpoint: Endpoint, findConnecting = true, findConnected = true) {
        if (!findConnecting && !findConnected) throw new Error("Cannot find WebRTC connection: both findConnecting and findConnected are false");

        let interf = this.getInterfaceForEndpoint(endpoint, findConnecting, findConnected)

        // try with main instance
        if (!interf) {
            interf = this.getInterfaceForEndpoint(endpoint.main, findConnecting, findConnected);
            if (interf) interf.#endpoint = endpoint; // specify received endpoint instance
        }

        if (!interf) {
            console.warn("No WebRTC interface found for endpoint " + endpoint);
            return null;
        }
        else if (!interf.#connection) {
            console.warn("No WebRTC connection found for endpoint " + endpoint);
            return null;
        }
        else return interf.#connection
    }

    static handleAnswer(endpoint: Endpoint, data: RTCSessionDescriptionInit) {
        const connection = this.getInterfaceConnection(endpoint, true, true);
        if (connection) connection.setRemoteDescription(data);
    }

    static async handleOffer(endpoint: Endpoint, data: RTCSessionDescriptionInit) {
        const interf = this.getInterfaceForEndpoint(endpoint, true, true);
        // offer for existing interface
        if (interf) {
            await interf.handleOffer(data);
        }
        // create new interface
        else {
            logger.info("Received WebRTC offer from " + endpoint + ", creating new interface...")
            await communicationHub.addInterface(new WebRTCInterface(endpoint, data));
        }
    }


    static handleCandidate(endpoint: Endpoint, data: RTCIceCandidateInit) {
        const connection = this.getInterfaceConnection(endpoint, true, true);
        if (connection) connection.addIceCandidate(data);
    }

    static requestMediaStream(endpoint: Endpoint, ptrId: string) {
        const connection = this.getInterfaceConnection(endpoint, false, true);
        if (!connection) throw new Error("Cannot request MediaStream $" + ptrId + ": no WebRTC connection available");
        
        const mediaStream = this.registeredMediaStreams.get(ptrId)?.deref();
        if (!mediaStream) throw new Error("MediaStream $" + ptrId + " not found");
        
        console.debug(endpoint + " requested mediastream $" + ptrId)
        const tracks = mediaStream.getTracks();
        for (const track of tracks) {
            connection.addTrack(track, mediaStream);
        }
        return tracks.length
    }

}