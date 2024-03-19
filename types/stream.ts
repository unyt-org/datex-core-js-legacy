import { ReadableStream } from "../runtime/runtime.ts";
import { Pointer } from "../runtime/pointers.ts";
import type { datex_scope } from "../utils/global_types.ts";
import type { StreamConsumer } from "./abstract_types.ts";
import { Logger } from "../utils/logger.ts";

const logger = new Logger("Stream")

// <Stream> is stream sink and readable stream at the same time
export class Stream<T = ArrayBuffer> implements StreamConsumer<T> {


    controller?: ReadableStreamDefaultController

    readable_stream: ReadableStream<T> 
    #writable_stream?: WritableStream<T>

    get writable_stream() {
        if (!this.#writable_stream) {
            this.#writable_stream = new WritableStream<T>({
                write: (chunk) => {
                    this.write(chunk);
                }
            });
        }
        return this.#writable_stream;
    }

    constructor(readable_stream?:ReadableStream<T>) {
        this.readable_stream = readable_stream ?? new ReadableStream<T>({
            start: controller => {this.controller = controller}
        });
        // immediately start stream out if readable_stream is given
        if (readable_stream) this.#startStreamOut()
    }

    started_ptr_stream = false

    #startStreamOut() {
        const ptr = Pointer.createOrGet(this);
        if (ptr instanceof Pointer) {
            logger.info("Start stream out for " + ptr.idString());
            setTimeout(() => {
                ptr.startStreamOut(); // stream to all subscribers or origin, workaround: timeout to prevent stream init too early (TODO: fix)
            }, 100)
        }
        else {
            throw new Error("Could not bind stream to pointer.")
        }
        this.started_ptr_stream = true;
    }

    write(chunk: T, scope?: datex_scope) {

        // convert buffers
        // if (chunk instanceof TypedArray) chunk = (<any>chunk).buffer;

        if (!this.started_ptr_stream && !scope) {  // no scope -> assume called from JS, not DATEX
            this.#startStreamOut()
        }

        try {
            this.controller?.enqueue(chunk);
        }
        catch (e) {
            console.error("stream write error", e);
        }
    }

    async pipe(in_stream:Stream<T>|ReadableStream<T>, scope?: datex_scope) {
        const reader = in_stream.getReader();
        let next:ReadableStreamReadResult<T>;
        while (true) {
            next = await reader.read()
            if (next.done) break;
            this.write(next.value, scope);
        }
    }

    async pipeTo(out_stream:WritableStream<T>) {
        const reader = this.getReader();
        const writer = out_stream.getWriter();
        let next:ReadableStreamReadResult<T>;
        while (true) {
            next = await reader.read()
            if (next.done) break;
            writer.write(next.value);
        }
    }

    close() {
        this.controller?.close()
        this.controller = undefined;
    }

    getReader() {
        // split in two readable streams
        const streams = this.readable_stream.tee()
        this.readable_stream = streams[1];
        return streams[0].getReader()
    }

    values() {
        return this.readable_stream.values()
    }

    get [Symbol.asyncIterator]() {
        return this.readable_stream.values.bind(this.readable_stream)
    }
}
