import { Runtime } from "../runtime/runtime.ts";
import { IOHandler } from "../runtime/io_handler.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { Logical } from "../types/logic.ts";
import { Logger } from "./logger.ts";

// WASM
import {decompile as wasm_decompile} from "../wasm/adapter/pkg/datex_wasm.js";

export class MessageLogger {
	

	static logger:Logger

    static decompile(dxb:ArrayBuffer, has_header = true, colorized = true){
        try {
            // extract body (TODO: just temporary, rust impl does not yet support header decompilation)
            if (has_header) {
                const res = Runtime.parseHeaderSynchronousPart(dxb);
                if (!(res instanceof Array)) return "/* ERROR: Invalid DATEX Header */";
                dxb = res[1];
            }
         
            return wasm_decompile(new Uint8Array(dxb), true, colorized, true).replace(/\r\n$/, '');
        } catch (e) {
            console.log("decompiler error",e.message);
            return "/* ERROR: Decompiler Error */";
        }
    }

	static enable(){

		if (!this.logger) this.logger = new Logger("DATEX Message");

        IOHandler.onDatexReceived((header, dxb)=>{
            // ignore incoming requests from own endpoint to own endpoint
            const receivers = header.routing?.receivers;
            if (header.sender == Runtime.endpoint && (receivers instanceof Logical && receivers?.size == 1 && receivers.has(Runtime.endpoint)) && header.type != ProtocolDataType.RESPONSE && header.type != ProtocolDataType.DEBUGGER) return;
        
            this.logger.plain(`\n#color(blue)⭠  ${header.sender||'@*'} `.padEnd(70, '─'));
            console.log(MessageLogger.decompile(dxb));
            this.logger.plain(`#color(blue)─────────────────────────────────────────────────────────\n`);
        });

        IOHandler.onDatexSent((header, dxb)=>{
            // ignore outgoing responses from own endpoint to own endpoint
            const receivers = header.routing?.receivers;
            if (header.sender == Runtime.endpoint && (receivers instanceof Logical && receivers?.size == 1 && receivers.has(Runtime.endpoint)) && header.type != ProtocolDataType.RESPONSE && header.type != ProtocolDataType.DEBUGGER) return;

            this.logger.plain(`\n#color(green)⭢  ${receivers||'@*'} `.padEnd(70, '─'));
            console.log(MessageLogger.decompile(dxb));
            this.logger.plain(`#color(green)─────────────────────────────────────────────────────────\n`);
        });

	}

}