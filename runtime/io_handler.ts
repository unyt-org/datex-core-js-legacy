
// handles std input and output

import { RuntimeError } from "../types/errors.ts";
import { Type } from "../types/type.ts";
import type { datex_scope, dxb_header } from "../utils/global_types.ts";
import { client_type } from "../utils/constants.ts";
import { Endpoint, Target, target_clause } from "../types/addressing.ts";
import { Runtime } from "./runtime.ts";
import { Datex } from "../mod.ts";
import { CommunicationInterfaceSocket } from "../network/communication-interface.ts";

type ioEventHandler = (header:dxb_header, dxb:ArrayBuffer, socket?:CommunicationInterfaceSocket)=>void;

// handles observers for all incoming/outgoing DATEX
export class IOHandler {

    // redirect std/print
    private static std_out:(data:any[])=>void|Promise<void> = async (data:any[])=>{
        for (let d=0; d<data.length;d++) {
            data[d] = await Runtime.castValue(Type.std.text, data[d]);
        }
        client_type == "browser" ? console.log(...data) : console.log("\x1b[90mprint\x1b[0m " + data.join("\n"))
    }
    // redirect std/printf
    private static std_outf = (data:any[])=>{
        console.log("\x1b[90mprintf\x1b[0m " + data.map(v=>Runtime.valueToDatexStringExperimental(v, true, true, false, true)).join("\n"))
    }
    // redirect to std/read
    private static std_in:(data:any[])=>any = ()=>{throw new RuntimeError("No input available")};
    

    // std/print, std/printf, std/read redirects for specific targets
    private static e_std_outs = new Map<Target, globalThis.Function>();
    private static e_std_outfs = new Map<Target, globalThis.Function>();;
    private static e_std_ins = new Map<Target, globalThis.Function>();

    // listeners for all incoming DATEX requests
    private static datex_in_handler: ioEventHandler/* = (header, dxb)=>{
        console.debug('from ' + header.sender, DatexRuntime.decompile(dxb));
    }*/
    private static datex_in_handlers_per_endpoint = new Map<Target, ioEventHandler>();

    // listeners for all outgoing DATEX requests
    private static datex_out_handler: ioEventHandler
    private static datex_out_handlers_per_endpoint = new Map<Endpoint, ioEventHandler>();
    
    // listen for finished scopes with return value: sid -> callback
    private static scope_result_listeners = new Map<number, (scope:datex_scope)=>void>();

    // set std redirects
    static setStdOut(output_callback:(data:any[])=>void|Promise<void>, endpoint?:Target){
        if (endpoint) this.e_std_outs.set(endpoint, output_callback);
        else this.std_out = output_callback;
    }
    static setStdOutF(output_callback:(data:any[])=>void|Promise<void>, endpoint?:Target){
        if (endpoint) this.e_std_outfs.set(endpoint, output_callback);
        else this.std_outf = output_callback;
    }
    static setStdIn(output_callback:(data:any[])=>any, endpoint?:Target){
        if (endpoint) this.e_std_ins.set(endpoint, output_callback);
        else this.std_in = output_callback;
    }

    // set DATEX listeners
    static onDatexReceived(handler:ioEventHandler, endpoint?:Target){
        if (endpoint) this.datex_in_handlers_per_endpoint.set(endpoint, handler);
        else this.datex_in_handler = handler;
    }
    static onDatexSent(handler:ioEventHandler, endpoint?:Endpoint){
        if (endpoint) this.datex_out_handlers_per_endpoint.set(endpoint, handler);  
        else this.datex_out_handler = handler;
    } 

    // add scope result listener
    static addScopeResultListener(sid:number, output_callback:(data:datex_scope)=>void){
        this.scope_result_listeners.set(sid, output_callback);
    }
    

    // redirected from std/print etc.
    public static async stdOutF(params:any[], endpoint:Target){
        if(this.e_std_outfs.has(endpoint)) await this.e_std_outfs.get(endpoint)(params);
        else if (this.std_outf) await this.std_outf(params);
    }
    public static stdOut(params:any[], endpoint:Target){
        for (let i=0;i<params.length;i++) params[i] = Datex.Ref.collapseValue(params[i],true,true);
        if(this.e_std_outs.has(endpoint)) this.e_std_outs.get(endpoint)(params);
        else if (this.std_out) this.std_out(params);
    }
    public static async stdIn(msg_start:any, msg_end:any, endpoint:Target){
        if(this.e_std_ins.has(endpoint)) return this.e_std_ins.get(endpoint)([msg_start, msg_end]);
        else return this.std_in([msg_start, msg_end]);
    }

    // called when scope received 
    static handleDatexReceived(header:dxb_header, dxb:ArrayBuffer, socket?: CommunicationInterfaceSocket) {
        const endpoint = header.sender as Endpoint;

        if (this.datex_in_handlers_per_endpoint.has(endpoint)) this.datex_in_handlers_per_endpoint.get(endpoint)!(header, dxb, socket);
        if (this.datex_in_handler) this.datex_in_handler(header, dxb, socket);
    }

    // called when datex sent out
    static async handleDatexSent(dxb:ArrayBuffer, to:target_clause, socket?: CommunicationInterfaceSocket) {
        if (this.datex_out_handler || this.datex_out_handlers_per_endpoint.has(<Endpoint>to)) {
            let header = <dxb_header> (await Runtime.parseHeader(dxb, null, true));

            if (this.datex_out_handler) this.datex_out_handler(header, dxb, socket)
            if (this.datex_out_handlers_per_endpoint.has(<Endpoint>to)) this.datex_out_handlers_per_endpoint.get(<Endpoint>to)!(header, dxb, socket)
        }
    }
  
    // when scope execution finished succesfully
    static handleScopeFinished(sid:number, scope:datex_scope) {
        if (this.scope_result_listeners.has(sid)) {
            this.scope_result_listeners.get(sid)(scope);
            this.scope_result_listeners.delete(sid);
        }
    }
}
