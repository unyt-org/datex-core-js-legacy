import { ReadableStream } from "../runtime/runtime.ts";
import { Pointer } from "../runtime/pointers.ts";
import type { datex_scope } from "../utils/global_types.ts";
import { TypedArray } from "../utils/global_values.ts";
import { StreamConsumer } from "./abstract_types.ts";
import { Logger } from "../utils/logger.ts";

const logger = new Logger("Stream")

// <Stream> is stream sink and readable stream at the same time
export class Stream<T = ArrayBuffer> implements StreamConsumer<T> {


    controller?: ReadableStreamDefaultController

    readable_stream: ReadableStream<T> 

    constructor(readable_stream?:ReadableStream<T>) {
        this.readable_stream = readable_stream ?? new ReadableStream<T>({
            start: controller => {this.controller = controller}
        });
    }

    started_ptr_stream = false

    write(chunk: T, scope?: datex_scope) {

        // convert buffers
        // if (chunk instanceof TypedArray) chunk = (<any>chunk).buffer;

        if (!this.started_ptr_stream && !scope) {  // no scope -> assume called from JS, not DATEX
            this.started_ptr_stream = true;
            const ptr = Pointer.getByValue(this);
            if (ptr instanceof Pointer) {
                logger.info("Start stream out for " + ptr.idString());
                ptr.startStreamOut(); // stream to all subscribers or origin
            }
        }

        this.controller?.enqueue(chunk);
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

    close() {
        this.controller?.close()
    }

    getReader() {
        // split in two readable streams
        const streams = this.readable_stream.tee()
        this.readable_stream = streams[1];
        return streams[0].getReader()
    }

}
