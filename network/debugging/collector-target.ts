// deno-lint-ignore-file
import { Stream } from "../../types/stream.ts";
import { MessageFilter, MessageStream } from "./Types.ts";
import { DebuggingInterface } from "./debugging-interface.ts";

@endpoint
@sync("CollectorDebuggingInterface")
export class CollectorDebuggingInterface {
	private static debuggingInterfaces: Map<DebuggingInterface, Stream<MessageStream> | undefined> = new Map();
	private static instance: CollectorDebuggingInterface | undefined
	private static collectorStreams: Set<Stream<MessageStream>> = new Set();

	@property public static async registerInterface(interf: DebuggingInterface) {
		this.debuggingInterfaces.set(interf, undefined);
		
		// only call the getMessage for a stream when at least one collector stream is active
		// aka getMessages was not called before
		if (this.collectorStreams.size)
			await this.pipeToStreams(interf, this.collectorStreams);
	}

	@property public static get() {
		// TODO handle permissions and instances
		this.instance = this.instance ?? $$(new CollectorDebuggingInterface());
		return this.instance;
	}

	private static async pipeToStreams(interf: DebuggingInterface, streams: Iterable<Stream<MessageStream>>) {
		const interfaces = CollectorDebuggingInterface.debuggingInterfaces;
		if (interfaces.get(interf) == undefined)
			interfaces.set(interf, await interf.getMessages());
		for (const stream of streams)
			interfaces.get(interf)!.pipeTo(stream.writable_stream)
	}

	@property async getMessages(filter: MessageFilter = { }) {
		const list = CollectorDebuggingInterface.debuggingInterfaces;
		const collectorStream = new Stream<MessageStream>();
		CollectorDebuggingInterface.collectorStreams.add(collectorStream);
		for (const [interf] of list)
			CollectorDebuggingInterface.pipeToStreams(interf, [collectorStream]);
		return collectorStream;
	}
}