import { Datex } from "../datex.ts";
import { IframeCommunicationInterface } from "./iframe-communication-interface.ts";
const AUTH_ORIGIN = 'https://authdev2.unyt.app/endpoint-proxy';


export type outgoingMessages = {
	'request': [string, string|undefined],
	'sign': [ArrayBuffer, ArrayBuffer],
	'decrypt': [ArrayBuffer, ArrayBuffer]
}
export type incomingMessages = {

}


export class EndpointProxy extends IframeCommunicationInterface<incomingMessages, outgoingMessages> {

	protected override async onConnected() {
		console.log("connected!");
		const endpoint = await this.sendMessage("request", '@backend')
		console.log("endpoint",endpoint)
	}

	protected override onMessage<T extends never>(type: T,data: incomingMessages[T][0]): incomingMessages[T][1]|Promise<incomingMessages[T][1]> {
		console.log("new message", type, data)
		return undefined as any;
	}
}

const proxy = new EndpointProxy(AUTH_ORIGIN)