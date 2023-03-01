import { Runtime } from "../runtime/runtime.ts";
import { Type } from "../types/type.ts";
import { Endpoint } from "../types/addressing.ts";
import { Scope } from "./scope.ts";


export class Deferred<T>  {

    #datex: Scope<T>
    #sender: Endpoint

    #promise?:Promise<T>

    constructor(datex:Scope<T>, sender:Endpoint) {
        this.#datex = datex;
        this.#sender = sender;
    }

    value():Promise<T> {
        if (!this.#promise) {
            this.#promise = new Promise(async (resolve, reject)=>{
                try {
                    const res = await this.#datex.execute(this.#sender??Runtime.endpoint);
                    resolve(res);
                }
                catch (e) {
                    reject(e);
                }
            })
        }
        return this.#promise;
    }

}

// only temporary, remove
Type.get("std:def").setJSInterface({
    class: Deferred,

    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(["value"]),
})