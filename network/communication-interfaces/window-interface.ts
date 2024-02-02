import { CommunicationInterface, CommunicationInterfaceSocket } from "../communication-interface.ts";


export class WindowInterfaceSocket extends CommunicationInterfaceSocket {

}

export class WindowInterface extends CommunicationInterface {
	constructor() {
		super()
		this.sockets.add(new WindowInterfaceSocket())
	}
}