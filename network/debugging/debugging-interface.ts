// deno-lint-ignore-file require-await
import { IOHandler, dxb_header } from "../../datex_all.ts";
import { Stream } from "../../types/stream.ts";
import { CommunicationInterfaceSocket } from "../communication-interface.ts";
import { MessageFilter, MessageStream } from "./Types.ts";

@endpoint
@sync("DebuggingInterface")
export class DebuggingInterface {
	@property async getMessages(filter: MessageFilter = { }) {
		let streamContoller: ReadableStreamDefaultController<MessageStream>;
		IOHandler.onDatexReceived((header, _dxb, socket)=>{
			if (!socket) {
				console.error("Could not get socket in onDatexReceived", header);
				return;
			}
			streamContoller.enqueue(this.getMessage("IN", socket, header));
		});
		IOHandler.onDatexSent((header, _dxb, socket)=>{
			if (!socket) {
				console.error("Could not get socket onDatexSent", header);
				return;
			}
			streamContoller.enqueue(this.getMessage("OUT", socket, header));
		});
		return new Stream(new ReadableStream<MessageStream>({
			start(controller) {
				streamContoller = controller;
			}
		}));
	}

	private getMessage(direction: 'IN' | 'OUT', socket: CommunicationInterfaceSocket, header: dxb_header): MessageStream {
		return {
			header,
			socket: {
				endpoint: socket.endpoint!,
				type: socket.interfaceProperties!.type,
				uuid: socket.uuid
			},
			direction
		} as const;
	}
}