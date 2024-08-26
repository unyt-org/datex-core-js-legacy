// deno-lint-ignore-file
// import { DisposableCallbackHandler } from "../../utils/disposable-callback-handler.ts";
import { Stream } from "../../types/stream.ts";
import { MessageFilter, MessageStream } from "./Types.ts";
import { DebuggingInterface } from "./debugging-interface.ts";

@endpoint
@sync("CollectorDebuggingInterface")
export class CollectorDebuggingInterface {
	private static debuggingInterfaces: Map<DebuggingInterface, Stream<MessageStream> | undefined> = new Map();

	@property public static async registerInterface(interf: DebuggingInterface) {
		this.debuggingInterfaces.set(interf, undefined);
	}

	public static get() {
		return new CollectorDebuggingInterface();
	}

	@property async getMessages(filter: MessageFilter = { }) {
		const list = CollectorDebuggingInterface.debuggingInterfaces;
		const collectorStream = new Stream<MessageStream>();
		for (const [interf, stream] of list) {
			if (stream == undefined)
				list.set(interf, await interf.getMessages());
			list.get(interf)!.pipeTo(collectorStream.writable_stream);
		}
		return collectorStream;
	}
}