import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { Runtime } from "../runtime/runtime.ts";
import { Compiler } from "../compiler/compiler.ts";
import { Endpoint } from "../types/addressing.ts";
import type { dxb_header } from "../utils/global_types.ts";
import { Pointer } from "../runtime/pointers.ts";
import {decompile} from "../wasm/adapter/pkg/datex_wasm.js";

/** <std:Scope> */
export class Scope<T=any> {

    // injected variable names != arguments
    internal_vars:any[] = []
    // compiled dxb
    compiled: ArrayBuffer;

    // object containing all variables from a parent scope
    parent_variables:any;

    // decompiled dxb (unformatted and formatted)
    private _decompiled = "### DATEX ###";
    private _decompiled_f = "### DATEX ###";

    constructor(internal_vars:any[], compiled:ArrayBuffer, generate_decompiled=true) {
        this.internal_vars = internal_vars;

        // make internal vars persistent even if currently not loaded in JS (TODO: how to handle this case in the future?)
        for (const internal_var of this.internal_vars) {
            if (internal_var instanceof Pointer) {
                internal_var.is_persistant = true;
            }
        }

        this.compiled = compiled;
        // decompile
        if (generate_decompiled) {
            try {
                this._decompiled_f = decompile(new Uint8Array(this.compiled), true, false, true);
                this._decompiled   = decompile(new Uint8Array(this.compiled), false, false, true);
            }
            catch (e) {
                console.error("could not generated decompiled scope script")
            }
            
        }
    }

    // run the dxb with arguments, executed by a specific endpoint
    public execute(executed_by:Endpoint, context?:any, it?:any):Promise<T> {
        
        // generate new header using executor scope header
        const header:dxb_header = {
            sender: executed_by,
            type: ProtocolDataType.LOCAL,
            executable: true,
            sid: Compiler.generateSID()
        }

        // create scope TODO fix internal_vars array or object (force converting to object for now)
        const scope = Runtime.createNewInitialScope(header, {...this.internal_vars}, context, it);
        // update scope buffers
        Runtime.updateScope(scope, this.compiled, header)
        // execute scope
        return Runtime.simpleScopeExecution(scope)
    }

    get decompiled():string {
        return this._decompiled;
    }
    get decompiled_formatted():string {
        return this._decompiled_f;
    }


    bodyToString(formatted=false, parentheses=true, spaces = '  '){
        return (parentheses?'(':'') + (formatted&&parentheses ? "\n":"") + (formatted ? this.decompiled_formatted?.replace(/^/gm, spaces) : this.decompiled).replace(/ *$/,'') + (parentheses?')':'')
    }

    toString(formatted=false, spaces = '  '){
        return `scope ${this.bodyToString(formatted, true, spaces)}`;
    }
}
