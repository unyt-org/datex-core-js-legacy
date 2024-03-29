import { VOID } from "../runtime/constants.ts";
import type { datex_scope } from "../utils/global_types.ts";
import type { ValueConsumer } from "./abstract_types.ts";
import { AssertionError, RuntimeError, ValueError } from "./errors.ts";
import { ExtensibleFunction } from "./function-utils.ts";
import { Callable } from "./function.ts";
import { Scope } from "./scope.ts";
import { Tuple } from "./tuple.ts";

export class Assertion<T=any> extends ExtensibleFunction implements ValueConsumer {

    // datex scope
    scope:Scope
    // native js function
    ntarget:(...values:any[])=>Promise<boolean|string|undefined>|boolean|string|undefined
    ntarget_async:boolean // does ntarget return a promise
    

    public static get<T extends (...values:any[])=>Promise<boolean|string|undefined>|boolean|string|undefined = (...values:any[])=>Promise<boolean|string|undefined>|boolean|string|undefined>(
        scope?:Scope, 
        ntarget?:T, 
        ntarget_async = true
    ):Assertion & Callable<Parameters<T>, void|Promise<void>> {
        return <Assertion & Callable<Parameters<T>, void|Promise<void>>> new Assertion(scope, ntarget, ntarget_async);
    }


    // assertion function/datex: return true or void if okay, otherwise return a string or false
    // TODO constructor should be private, but ts error with setJSInterface
    constructor(scope?:Scope, ntarget?:(...values:any[])=>Promise<boolean|string|undefined>|boolean|string|undefined, ntarget_async = true) {
        super((...args:any[]) => this.handleApply(new Tuple(args)));
        this.scope = scope;
        this.ntarget = ntarget;
        this.ntarget_async = ntarget_async;
    }

    
    assert(value:T|Tuple<T>, SCOPE?:datex_scope, return_boolean = false): boolean|Promise<boolean> {
        // ntarget
        if (this.ntarget) {
            if (this.ntarget_async) return this.checkResultPromise(<Promise<string | boolean>>this.ntarget(...(value instanceof Tuple ? value.toArray() : (value instanceof Array ? value : [value]))), return_boolean)
            else return this.checkResult(<string | boolean>this.ntarget(...(value instanceof Tuple ? value.toArray() : (value instanceof Array ? value : [value]))), return_boolean)
        }

        // datex
        else if (this.scope) return this.checkResultPromise(this.scope.execute(SCOPE?.sender, SCOPE?.context, value), return_boolean);

        // invalid
        else throw new RuntimeError("Cannot execute <Assertion>");
    }

    private async checkResultPromise(valid_promise:Promise<string|boolean|undefined>, return_boolean = false) {
        return this.checkResult(await valid_promise, return_boolean);
    }

    private checkResult(valid:string|boolean|undefined, return_boolean = false):boolean {
        if (return_boolean) return valid === true || valid === VOID

        if (valid !== true && valid !== VOID) {
            if (valid == false) throw new AssertionError(this.scope?.decompiled ? `${this.scope.decompiled.replace(/;$/,'')} is false` : 'Invalid');
            else if (typeof valid == "string") throw new AssertionError(valid);
            else throw new ValueError("Invalid assertion result - must be of type <float>, <boolean>, or <text>")
        }
        return true;
    }

    handleApply(value: T|Tuple<T>, SCOPE?: datex_scope) {
        return this.assert(value, SCOPE);
    }
}