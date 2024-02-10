import { Runtime } from "../runtime/runtime.ts";
import { IOHandler } from "../runtime/io_handler.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { Logical } from "../types/logic.ts";
import { Logger } from "./logger.ts";

// WASM
import {decompile as wasm_decompile} from "../wasm/adapter/pkg/datex_wasm.js";
import { console } from "./ansi_compat.ts";
import { ESCAPE_SEQUENCES } from "./logger.ts";

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
            return "Decompiler Error: " + e.message;
        }
    }

	static enable(showRedirectedMessages = true){
        IOHandler.resetDatexHandlers();
		if (!this.logger) this.logger = new Logger("DATEX Message");

        IOHandler.onDatexReceived((header, dxb, socket)=>{
            const log = (dxb as any)._is_stream ? console.log : this.logger.raw.bind(this.logger);

            // ignore incoming requests from own endpoint to own endpoint
            const receivers = header.routing?.receivers;
            const receiverIsOwnEndpoint = receivers instanceof Logical && receivers?.size == 1 && (receivers.has(Runtime.endpoint) || receivers.has(Runtime.endpoint.main));
            if (!showRedirectedMessages && !receiverIsOwnEndpoint) return;
            if (header.sender == Runtime.endpoint && receiverIsOwnEndpoint && header.type != ProtocolDataType.RESPONSE && header.type != ProtocolDataType.DEBUGGER) return;

            // ignore hello messages
            if (header.type == ProtocolDataType.HELLO || header.type == ProtocolDataType.GOODBYE) {
                log(`${ESCAPE_SEQUENCES.BLUE}◀── ${header.sender||'@*'} ${header.type!=undefined? `(${ProtocolDataType[header.type]}) ` : ''}${socket ? `via ${socket.toString()}` : ''}`);
                return;
            };
            
            let content = MessageLogger.decompile(dxb);
            if (content.trim() == "\x1b[38;2;219;45;129mvoid\x1b[39m;") return; // dont log void; messages
            
            content = 
                `${ESCAPE_SEQUENCES.BLUE}${receiverIsOwnEndpoint?'':Runtime.valueToDatexStringExperimental(receivers, false, false)+ ' '}◀── ${header.sender||'@*'} ${header.type!=undefined ? `(${ProtocolDataType[header.type]}) ` : ''}${socket ? `via ${socket.toString()} ` : ''}`.padEnd(80, '─') + '\n'
                + content
                + `\n${ESCAPE_SEQUENCES.BLUE}──────────────────────────────────────────────────────────────────────────\n`;
            log(content)
        });

        IOHandler.onDatexSent((header, dxb, socket) => {
            
            const log = (dxb as any)._is_stream ? console.log : this.logger.raw.bind(this.logger);

            // ignore outgoing responses from own endpoint to own endpoint
            const receivers = header.routing?.receivers;
            if (header.sender == Runtime.endpoint && (receivers instanceof Logical && receivers?.size == 1 && receivers.has(Runtime.endpoint)) && header.type != ProtocolDataType.RESPONSE && header.type != ProtocolDataType.DEBUGGER) return;
            const senderIsOwnEndpoint = header.sender == Runtime.endpoint || header.sender == Runtime.endpoint.main;
            if (!showRedirectedMessages && !senderIsOwnEndpoint) return;

            // ignore hello messages
            if (header.type == ProtocolDataType.HELLO || header.type == ProtocolDataType.GOODBYE) {
                log(`${ESCAPE_SEQUENCES.GREEN}${header.sender||'@*'} ──▶ ${receivers||'@*'} ${header.type!=undefined ? `(${ProtocolDataType[header.type]}) ` : ''}${socket ? `via ${socket.toString()}` : ''}`);
                return;
            };
            
            let content = MessageLogger.decompile(dxb);
            if (content.trim() == "\x1b[38;2;219;45;129mvoid\x1b[39m;") return; // dont log void; messages
 
            content = 
                `${ESCAPE_SEQUENCES.GREEN}${senderIsOwnEndpoint?'':Runtime.valueToDatexStringExperimental(header.sender, false, false)+' '}──▶ ${receivers||'@*'} ${header.type!=undefined ? `(${ProtocolDataType[header.type]}) ` : ''}${socket ? `via ${socket.toString()} ` : ''}`.padEnd(80, '─') + '\n'
                + content
                + `\n${ESCAPE_SEQUENCES.GREEN}──────────────────────────────────────────────────────────────────────────\n`;

            log(content);
        });

	}

    static disable() {
        IOHandler.resetDatexHandlers()
    }

}