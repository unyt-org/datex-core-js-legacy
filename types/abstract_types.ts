// for classes that can have a value applied to it (e.g. DatexFunction)

import type { datex_scope } from "../utils/global_types.ts";
import type { Stream } from "./stream.ts"
import type { Tuple } from "./tuple.ts";

// <std:ValueConsumer>
export interface ValueConsumer {
    handleApply: (value:any, SCOPE: datex_scope)=>Promise<any>|any
}

// for reading binary streams or strings (e.g. WritableStream)
// <std:StreamConsumer>
export interface StreamConsumer<T=any> {
    write: (next:T, scope?:datex_scope)=>Promise<any>|any
    pipe: (in_stream:Stream<T>, scope?:datex_scope)=>Promise<any>|any
}


/***** Type definitions */

export type primitive = number|bigint|string|boolean|null|undefined;
export type fundamental = primitive|{[key:string]:any}|Array<any>|Tuple;