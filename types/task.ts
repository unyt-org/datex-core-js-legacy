// DATEX class wrapper around JS Promises to support remote executed Task

import { Runtime } from "../runtime/runtime.ts";
import { Pointer } from "../runtime/pointers.ts";
import type { datex_scope } from "../utils/global_types.ts";
import { Scope } from "./scope.ts";
import { Type } from "./type.ts";
import { Endpoint } from "./addressing.ts";

export class Task<R=any,E=any> {

    datex?:Scope<R>
    #executed = false;
    
    promise?:Promise<any>

    // locally executed task, can be awaited
    get is_local(){return !!this.datex}

    result?: R|E
    state: 0n|1n|2n = 0n // 0 = running, 1 = success, 2 = error

    constructor(datex?:Scope<R>) {
        this.datex = datex;
    }

    replicate(){
        // not local, no this.datex, create remote awaiting promise, because run is/was called externally
        this.#remotePromise();
    }

    // TODO default create anonymouse pointer for this class -> pointer available immediately at construct/replicate?
    #remotePromise(){
        this.promise = new Promise((resolve, reject) => {
            // already finished
            if (this.state > 0n) {
                if (this.state == 2n) reject(this.result);
                else resolve(this.result);
            }
            // wait for state change
            Pointer.observe(this, ()=>{
                console.log("finished task:",this);
                if (this.state > 0n) {
                    if (this.state == 2n) reject(this.result);
                    else resolve(this.result);
                    return false; // unobserve
                }
            }, this, 'state')
        })
    }

    run (sender?:Endpoint, context?:any): Promise<any> {
        if (!this.datex) throw new Error("Cannot run <Task> without DATEX body");
        if (!this.#executed) {
            this.#executed = true;
            this.promise = new Promise(async (resolve, reject)=>{
                try {
                    const res = await this.datex!.execute(sender??Runtime.endpoint, context);
                    this.result = res;
                    this.state = 1n;
                    resolve(res);
                }
                catch (e) {
                    this.result = e;
                    this.state = 2n;
                    reject(e);
                }
            })
        }
        return this.promise!;
    }
}


Type.get("std:Task").setJSInterface({
    class: Task,

    // serialize: value => new Datex.Tuple(value.finished, value.result, value.error),

    // cast: value => {
    //     if (value instanceof Datex.Tuple) {
    //         const task = new Datex.Task();
    //         task.finished = value[0];
    //         task.result = value[1];
    //         task.error = value[2];
    //         return task;
    //     }
    //     else if (typeof value == "object") {
    //         const task = new Datex.Task();
    //         task.finished = value.finished;
    //         task.result = value.result;
    //         task.error = value.error;
    //         return task;
    //     }
    //     return INVALID;
    // },
    is_normal_object: true,
    proxify_children: false,
    visible_children: new Set(["state", "result"]),
}).setReplicator(Task.prototype.replicate)