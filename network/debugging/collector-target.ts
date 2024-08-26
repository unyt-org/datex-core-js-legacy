// deno-lint-ignore-file
import { Stream } from "../../types/stream.ts";
import { MessageFilter, MessageStream } from "./Types.ts";
import { DebuggingInterface } from "./debugging-interface.ts";

@endpoint
@sync("CollectorDebuggingInterface")
export class CollectorDebuggingInterface {
	private static debuggingInterfaces: Map<DebuggingInterface, Stream<MessageStream> | undefined> = new Map();
	private static instance: CollectorDebuggingInterface | undefined
	private static streamControllers: Set<ReadableStreamDefaultController<MessageStream>> = new Set();

	@property public static async registerInterface(interf: DebuggingInterface) {
		this.debuggingInterfaces.set(interf, undefined);
		
		// only call the getMessage for a stream when at least one collector stream is active
		// aka getMessages was not called before
		if (this.streamControllers.size)
			await this.pipeToStreams(interf, this.streamControllers);
	}

	@property public static get() {
		// TODO handle permissions and instances
		this.instance = this.instance ?? $$(new CollectorDebuggingInterface());
		return this.instance;
	}

	private static async pipeToStreams(interf: DebuggingInterface, streams: Iterable<ReadableStreamDefaultController<MessageStream>>) {
		const interfaces = CollectorDebuggingInterface.debuggingInterfaces;
		if (interfaces.get(interf) == undefined)
			interfaces.set(interf, await interf.getMessages());
		for await (const message of interfaces.get(interf)!.readable_stream)
			for (const stream of streams)
				stream.enqueue(message);
	}

	@property async getMessages(filter: MessageFilter = { }) {
		const list = CollectorDebuggingInterface.debuggingInterfaces;
		let streamContoller!: ReadableStreamDefaultController<MessageStream>;
		const stream = new Stream(new ReadableStream<MessageStream>({
			start(controller) {
				streamContoller = controller;
			}
		}));
		CollectorDebuggingInterface.streamControllers.add(streamContoller);
		for (const [interf] of list)
			CollectorDebuggingInterface.pipeToStreams(interf, [streamContoller]);
		return stream;
	}
}