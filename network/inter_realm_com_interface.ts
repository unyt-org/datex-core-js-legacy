import { LOCAL_ENDPOINT, Endpoint } from "../types/addressing.ts";
import { Runtime } from "../runtime/runtime.ts";
import { Logger } from "../utils/logger.ts";
import InterfaceManager, { CommonInterface } from "./client.ts";
import { f } from "../datex_short.ts";


const logger = new Logger("Inter Realm Com")

const BroadcastChannel = globalThis.BroadcastChannel;
        
// enable DATEX communication with another browser window / tab
export class InterRealmCommunicationInterface extends CommonInterface {

    static SIGNALING = "DATEX:signaling";
    static DATA = "DATEX:endpoint:";
    static signalingChannel = BroadcastChannel ? new BroadcastChannel(InterRealmCommunicationInterface.SIGNALING) : undefined;

    private static rxChannel1:BroadcastChannel;

    private static rx1Id = Runtime.endpoint.toString() + Math.round(Math.random()*Number.MAX_SAFE_INTEGER);

    override in = true;
    override out = true;
    override global = false;
    override authorization_required = false; // don't connect with public keys
    override type = "interrealm";

    private txChannel?:BroadcastChannel;
    
    private static known_endpoints = new Set<number>(); // list of currently connected endpoint 'hashes'

    static #initialized = false;

    public static init(){
        if (this.#initialized) return;
        this.#initialized = true;

        // create endpoint data broadcast channels and announce via signaling channel
        Runtime.onEndpointChanged(()=>InterRealmCommunicationInterface.updateEndpoint());
        InterRealmCommunicationInterface.updateEndpoint();


        // listen for signaling announcements
        InterRealmCommunicationInterface.signalingChannel?.addEventListener("message", event => {
        
            if (this.known_endpoints.has(event.data[0])) return; // already connected (check hash); hash required for page reloading -> new hash, create new connection

            const endpoint:Endpoint = <Endpoint>f(event.data[1]);

            logger.success("inter-realm endpoint: " + endpoint);

            // connect to endpoint
            InterfaceManager.connect("interrealm", endpoint);

            // also announce own endpoint again
            InterRealmCommunicationInterface.announceEndpoint();

            this.known_endpoints.add(event.data[0])
        });
    }

    // announce endpoint and update broadcast channel
    static updateEndpoint(){
        if (Runtime.endpoint == LOCAL_ENDPOINT) return; // ignore %0000000 endpoint

        // new data broadcast channels with endpoint name
        this.rxChannel1 = new BroadcastChannel(InterRealmCommunicationInterface.DATA+Runtime.endpoint);

        this.announceEndpoint();
        this.addDataChannelListeners();
    }

    // announce endpoint via signaling
    static announceEndpoint(){
        if (Runtime.endpoint == LOCAL_ENDPOINT) return; // ignore %0000000 endpoint

        logger.success("announcing endpoint for inter-process messaging");

        if (this.rxChannel1) this.signalingChannel?.postMessage([this.rx1Id, Runtime.endpoint.toString()]);
    }

    static addDataChannelListeners(){
        // DATEX block received on main channel
        if (this.rxChannel1) this.rxChannel1.addEventListener("message", event => {
            //logger.info("inter-process data", event);
            InterfaceManager.handleReceiveBlock(event.data);
        })

        // DATEX block received on second channel (id endpoint)
        if (this.rxChannel2) this.rxChannel1.addEventListener("message", event => {
            //logger.info("inter-process data", event);
            InterfaceManager.handleReceiveBlock(event.data);
        })
    }

    protected connect() {
        // init broadcast channel for sending data
        this.txChannel = new BroadcastChannel(InterRealmCommunicationInterface.DATA+this.endpoint);
        return true;
    }

    public override disconnect() {
        InterfaceManager.addInterface(this); // directly re-add interface on disconnect
        CommonInterface.addInterfaceForEndpoint(this.endpoint, this); // add endpoint back
    }

    protected sendBlock(datex: ArrayBuffer) {
        if (!this.txChannel) throw new Error("Canno set block via inter realm com, missing tx channel")
        this.txChannel.postMessage(datex);
    }

}


// register interrealm interface immediately
if (BroadcastChannel) {
    InterfaceManager.registerInterface("interrealm", InterRealmCommunicationInterface);
    // setup broadcast channels
    InterRealmCommunicationInterface.init()
}

else logger.error("BroadcastChannel not supported")
