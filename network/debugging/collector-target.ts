// deno-lint-ignore-file
import { Stream } from "../../types/stream.ts";
import { MessageFilter, MessageStream } from "./Types.ts";
import { DebuggingInterface } from "./debugging-interface.ts";

@endpoint
@sync("CollectorDebuggingInterface")
export class CollectorDebuggingInterface {
	private static debuggingInterfaces: Map<DebuggingInterface, Stream<MessageStream> | undefined> = new Map();
	private static instance: CollectorDebuggingInterface | undefined

	@property public static async registerInterface(interf: DebuggingInterface) {
		this.debuggingInterfaces.set(interf, undefined);
	}

	@property public static get() {
		// TODO handle permissions and instances
		this.instance = this.instance ?? $$(new CollectorDebuggingInterface());
		return this.instance;
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