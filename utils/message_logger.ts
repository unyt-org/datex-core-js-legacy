import { Runtime } from "../runtime/runtime.ts";
import { IOHandler } from "../runtime/io_handler.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { Logical } from "../types/logic.ts";
import { Logger } from "./logger.ts";

// WASM
import {decompile as wasm_decompile} from "../wasm/adapter/pkg/datex_wasm.js";
import { console } from "./ansi_compat.ts";

export class MessageLogger {
	

	static logger:Logger

    static decompile(dxb:ArrayBuffer, has_header = true, colorized = true, resolve_slots = true){
        try {
            // extract body (TODO: just temporary, rust impl does not yet support header decompilation)
            if (has_header) {
                const res = Runtime.parseHeaderSynchronousPart(dxb);
                if (!(res instanceof Array)) return "/* ERROR: Invalid DATEX Header */";
                dxb = res[1];
            }
         
            return wasm_decompile(new Uint8Array(dxb), true, colorized, resolve_slots).replace(/\r\n$/, '');
        } catch (e) {
            return "Decompiler Error: "+ e.message;
        }
    }

	static enable(){

		if (!this.logger) this.logger = new Logger("DATEX Message");

        IOHandler.onDatexReceived((header, dxb)=>{
            // ignore incoming requests from own endpoint to own endpoint
            const receivers = header.routing?.receivers;
            if (header.sender == Runtime.endpoint && (receivers instanceof Logical && receivers?.size == 1 && receivers.has(Runtime.endpoint)) && header.type != ProtocolDataType.RESPONSE && header.type != ProtocolDataType.DEBUGGER) return;

            // ignore hello messages
            if (header.type == ProtocolDataType.HELLO || header.type == ProtocolDataType.GOODBYE) {
                this.logger.plain(`\n#color(blue)⭠  ${header.sender||'@*'} ${header.type!=undefined? `(${ProtocolDataType[header.type]}) ` : ''}`);
                return;
            };
            
            const content = MessageLogger.decompile(dxb);
            if (content.trim() == "\x1b[38;2;219;45;129mvoid\x1b[39m;") return; // dont log void; messages
            
            this.logger.plain(`\n#color(blue)⭠  ${header.sender||'@*'} ${header.type!=undefined ? `(${ProtocolDataType[header.type]}) ` : ''}`.padEnd(70, '─'));
            console.log(content);
            this.logger.plain(`#color(blue)─────────────────────────────────────────────────────────\n`);
        });

        IOHandler.onDatexSent((header, dxb)=>{
            // ignore outgoing responses from own endpoint to own endpoint
            const receivers = header.routing?.receivers;
            if (header.sender == Runtime.endpoint && (receivers instanceof Logical && receivers?.size == 1 && receivers.has(Runtime.endpoint)) && header.type != ProtocolDataType.RESPONSE && header.type != ProtocolDataType.DEBUGGER) return;

            // ignore hello messages
            if (header.type == ProtocolDataType.HELLO || header.type == ProtocolDataType.GOODBYE) {
                this.logger.plain(`\n#color(green)${header.sender||'@*'} ⭢  ${receivers||'@*'} ${header.type!=undefined ? `(${ProtocolDataType[header.type]}) ` : ''}`);
                return;
            };
            
            const content = MessageLogger.decompile(dxb);
            if (content.trim() == "\x1b[38;2;219;45;129mvoid\x1b[39m;") return; // dont log void; messages
 
            this.logger.plain(`\n#color(green)⭢  ${receivers||'@*'} ${header.type!=undefined ? `(${ProtocolDataType[header.type]}) ` : ''}`.padEnd(70, '─'));
            console.log(content);
            this.logger.plain(`#color(green)─────────────────────────────────────────────────────────\n`);
        });

	}

}