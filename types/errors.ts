import { Runtime } from "../runtime/runtime.ts";
import type { datex_scope } from "../utils/global_types.ts";
import { Endpoint } from "./addressing.ts";
import { DATEX_ERROR_MESSAGE } from "./error_codes.ts";

// <*Error>
export class Error extends globalThis.Error {
    override message:string;
    datex_stack?: [Endpoint, string?][]
    type = "";
    code?:bigint

    constructor(message?:string|number|bigint|null)
    constructor(message?:string|number|bigint|null, scope?:datex_scope|null)
    constructor(message?:string|number|bigint, stack?:[Endpoint, string?][]|null)
    constructor(message:string|number|bigint|null = '', stack:datex_scope|null|[Endpoint, string?][] = [[Runtime.endpoint]]) {
        super();

        // extract name from class name
        this.name = this.constructor.name.replace("Datex","");

        // convert scope to stack
        if (typeof stack == "object" && stack!=null && !(stack instanceof Array)) {
            this.addScopeToStack(stack)
        }
        // stack already provided (as array)
        else if (Runtime.OPTIONS.ERROR_STACK_TRACES && stack instanceof Array) this.datex_stack = stack;
        // no stack
        else this.datex_stack = [];

        // error message
        if (typeof message == "string") this.message = message;
        // error code
        else if (typeof message == "number" || typeof message == "bigint"){
            this.code = BigInt(message);
            this.message = DATEX_ERROR_MESSAGE[Number(this.code)];
        }
        else this.message = "";
        
        this.updateStackMessage();
    }

    addScopeToStack(scope:datex_scope){
        if (Runtime.OPTIONS.ERROR_STACK_TRACES) {
            this.pushToStack([
                Runtime.endpoint, 
                (scope.context_location ? scope.context_location.toString() : (scope.sender + " " + scope.header.sid?.toString(16))) + 
                    ":" + scope.current_index?.toString(16)
            ]);
        }
    }

    pushToStack(...data:[Endpoint, string?][]) {
        if (!this.datex_stack) this.datex_stack = []
        this.datex_stack.push(...data);
        this.updateStackMessage();
    }

    setStack(...data:[Endpoint, string?][]) {
        this.datex_stack = data
        this.updateStackMessage();
    }

    updateStackMessage() {
        this.stack = this.name +": " + (this.message||"Unknown") + '\n';

        if (!this.datex_stack) this.datex_stack = []

        for (let i = this.datex_stack.length-1; i>=0; i--) {
            const d = this.datex_stack[i];
            this.stack += `    on ${d[0]} (${d[1]??"Unknown"})\n`
        }
    }

    override toString(){
        return this.message;
    }

    static fromJSError(e:globalThis.Error) {
        // native errors are not exposed
        if (!Runtime.OPTIONS.NATIVE_ERROR_MESSAGES) return new Error("Unknown");
        
        if (Runtime.OPTIONS.NATIVE_ERROR_STACK_TRACES) {
            let ignore = false;
            const js_stack = <[Endpoint, string][]> e.stack?.split("\n").slice(1).map(e=>{
                // stop stack before __DX_meta__, just internal stuff
                if (!Runtime.OPTIONS.NATIVE_ERROR_DEBUG_STACK_TRACES) {
                    if (e.includes("__DX_meta__")) ignore = true; 
                    if (e.includes("at async callWithMeta")) ignore = true; 
                }
                return ignore ? undefined : [Runtime.endpoint,`JavaScript Error ${e.trim()}`]
            }).filter(v=>!!v).reverse() ?? [];
            return new Error(e.name + " - " + e.message, js_stack)
        }
        else return new Error(e.name + " - " + e.message);
    }
}

export class SyntaxError extends Error {}
export class CompilerError extends Error {}
export class PointerError extends Error {}
export class ValueError extends Error {}
export class PermissionError extends Error {}
export class TypeError extends Error {}
export class NetworkError extends Error {}
export class RuntimeError extends Error {}
export class SecurityError extends Error {}
export class AssertionError extends Error {}
