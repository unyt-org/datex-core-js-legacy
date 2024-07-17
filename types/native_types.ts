// deno-lint-ignore-file no-async-promise-executor
import { ValueError } from "./errors.ts";
import { Type } from "./type.ts";
import { Pointer } from "../runtime/pointers.ts";
import type { any_class } from "../utils/global_types.ts";
import { DX_TIMEOUT, INVALID, NOT_EXISTING } from "../runtime/constants.ts";
import { Tuple } from "./tuple.ts";

import "../utils/auto_map.ts"
import { ReactiveMapMethods } from "./reactive-methods/map.ts";
import { Stream } from "./stream.ts";

// @ts-ignore accecssible to dev console
globalThis.serializeImg = (img:HTMLImageElement)=> {
    return new Promise(async resolve=>{
        const blob = await fetch(img.src).then(r => r.blob())
        const fileReader = new FileReader();
        fileReader.onloadend = (e) => {
            // @ts-ignore
            const arr = (new Uint8Array(e.target.result)).subarray(0, 4);
            let header = '';
            for (let i = 0; i < arr.length; i++) {
                header += arr[i].toString(16);
            }
            // Check the file signature against known types
            let type:string;
            switch (header) {
                case '89504e47':
                    type = 'image/png';
                    break;
                case '47494638':
                    type = 'image/gif';
                    break;
                case 'ffd8ffdb':
                case 'ffd8ffe0':
                case 'ffd8ffe1':
                case 'ffd8ffe2':
                    type = 'image/jpeg';
                    break;
                case '25504446':
                    type = 'application/pdf';
                    break;
                case '504B0304':
                    type = 'application/zip'
                    break;
            }
            if (!type) {
                resolve(false)
                return;
            }

            // @ts-ignore
            img._type = Type.get("std", type);
            // @ts-ignore
            img._buffer = fileReader.result;
            resolve(type);
        }
        fileReader.onerror = () => resolve(false)
        fileReader.readAsArrayBuffer(blob);        
    })
}


// <Map>


Type.std.Map.setJSInterface({
    class: Map,

    serialize: value => [...value.entries()],

    empty_generator: ()=>new Map(),

    proxify_children: true,

    cast: value => {
        if (value instanceof Array) {
            try { // might not be an entry array ([[x,y], [z,v]])
                return new Map(value);
            }
            catch (e) {
                throw new ValueError("Failed to convert "+ Type.ofValue(value) +" to "+ Type.std.Map);
            }
        }                    
        else if (value instanceof Tuple) return new Map(value.entries());

        else if (typeof value == "object") return new Map(Object.entries(value));
        return INVALID;
    },

    create_proxy: (value:Map<any,any>, pointer:Pointer) => {

        // override methods
        Object.defineProperty(value, "set", {value:(key, value) => {
                return pointer.handleSet(key, value);
            }, writable:false, enumerable:false});

        Object.defineProperty(value, "clear", {value: () => {
                return pointer.handleClear();
            }, writable:false, enumerable:false});

        Object.defineProperty(value, "delete", {value:(el) => {
                return pointer.handleDelete(el);
            }, writable:false, enumerable:false});

        /**** override getters to trigger handleBeforeValueGet(): ****/

        // original getters
        const getSize = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), "size")!.get!.bind(value);
        const keys = value.keys.bind(value);
        const values = value.values.bind(value);
        const entries = value.entries.bind(value);

        Object.defineProperty(value, "size", {get() {
            pointer.handleBeforeNonReferencableGet();
            return getSize();
        }, enumerable:false});

        Object.defineProperty(value, "values", {value: () => {
            pointer.handleBeforeNonReferencableGet();
            return values()
        }, writable:false, enumerable:false});

        Object.defineProperty(value, "keys", {value: () => {
            pointer.handleBeforeNonReferencableGet();
            return keys()
        }, writable:false, enumerable:false});

        Object.defineProperty(value, "entries", {value: () => {
            pointer.handleBeforeNonReferencableGet();
            return entries()
        }, writable:false, enumerable:false});

        Object.defineProperty(value, Symbol.iterator, {value: value.entries, writable:true, enumerable:false});

        return value;
    },

    get_reactive_methods_object: (ptr) => new ReactiveMapMethods(ptr),

    set_property_silently: (parent:Map<any,any>, key, value, pointer) => Map.prototype.set.call(parent, key, value),
    delete_property_silently: (parent:Map<any,any>, key, pointer) => Map.prototype.delete.call(parent, key),
    clear_silently: (parent:Map<any,any>, pointer) => Map.prototype.clear.call(parent),


    set_property: (parent:Map<any,any>, key, value) => parent.set(key, value),
    get_property: (parent:Map<any,any>, key) => parent.get(key),
    delete_property: (parent:Map<any,any>, key) => parent.delete(key),
    has_property: (parent:Map<any,any>, key) => parent.has(key),

    clear: (parent:Map<any,any>) => parent.clear(),

    count: (parent:Map<any,any>) => parent.size,
    keys: (parent:Map<any,any>) => [...parent.keys()],
    values: (parent:Map<any,any>) => [...parent.values()],
})


// <Set>
Type.std.Set.setJSInterface({
    class: Set,
    //detect_class: (val) => (val instanceof Set && !(val instanceof AndSet)),

    serialize: value => [...value].sort(),

    empty_generator: ()=>new Set(),

    proxify_children: true,

    cast: value => {
        if (value instanceof Array) return new Set(value);
        else if (value instanceof Tuple) return new Set(value.toArray());
        return INVALID;
    },

    override_silently(ref, value) {
        Set.prototype.clear.call(ref);
        for (const entry of value) Set.prototype.add.call(ref, entry)
    },

    create_proxy: (value:Set<any>, pointer:Pointer) => {
        // override methods
        Object.defineProperty(value, "add", {value: el => {
                if (value.has(el)) return false;
                return pointer.handleAdd(el); // TODO: return the Set
            }, writable:false, enumerable:false});

        Object.defineProperty(value, "clear", {value: () => {
                return pointer.handleClear();
            }, writable:false, enumerable:false});

        Object.defineProperty(value, "delete", {value: el => {
                if (!value.has(el)) return false;
                return pointer.handleRemove(el); // TODO: return the Set
            }, writable:false, enumerable:false});

        /**** override getters to trigger handleBeforeValueGet(): ****/

        // original getters
        const getSize = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value), "size")!.get!.bind(value);
        const values = value.values.bind(value);
        const entries = value.entries.bind(value);

        Object.defineProperty(value, "size", {get() {
            pointer.handleBeforeNonReferencableGet();
            return getSize();
        }, enumerable:false});

        Object.defineProperty(value, "values", {value: () => {
            pointer.handleBeforeNonReferencableGet();
            return values()
        }, writable:false, enumerable:false});

        Object.defineProperty(value, "keys", {value: () => {
            pointer.handleBeforeNonReferencableGet();
            return values()
        }, writable:false, enumerable:false});

        Object.defineProperty(value, "entries", {value: () => {
            pointer.handleBeforeNonReferencableGet();
            return entries()
        }, writable:false, enumerable:false});

        Object.defineProperty(value, Symbol.iterator, {value: value.values, writable:true, enumerable:false});

        return value;
    },


    // <Set> - <Set> operations
    // union
    operator_or(first, second) {
        if (first instanceof Set && second instanceof Set) return new Set([...first, ...second])
        else return INVALID
    },
    action_or(ref, value, silently) {
        if (value instanceof Set) {
            for (let v of value) {
                if (silently) Set.prototype.add.call(ref, v);
                else ref.add(v);
            }
        }
        else return INVALID
    },

    // intersection
    operator_and(first, second) {
        if (first instanceof Set && second instanceof Set) return new Set([...first].filter(x => second.has(x)));
        else return INVALID
    },
    action_and(ref, value, silently) {
        if (value instanceof Set) {
            for (let v of ref) {
                if (!value.has(v)) {
                    if (silently) Set.prototype.delete.call(ref, v);
                    else ref.delete(v);
                } 
            }
        }
        else return INVALID
    },


    // <Set> - value operations
    action_add(ref, value, silently) {
        if (silently) Set.prototype.add.call(ref, value);
        else ref.add(value);
    },

    action_subtract(ref, value, silently) {
        if (silently) Set.prototype.delete.call(ref, value);
        else ref.delete(value);
    },



    clear: (parent:Set<any>) => parent.clear(),
    clear_silently: (parent:Set<any>, pointer) => Set.prototype.clear.call(parent),


    get_property: (parent:Set<any>, key) => NOT_EXISTING,
    has_property: (parent:Set<any>, key) => parent.has(key),

    // implemented to support self-referencing serialization, not actual properties
    // small issue with this approach: the Set always contains 'undefined'
    set_property_silently: (parent:Set<unknown>, key, value, pointer) => Set.prototype.add.call(parent, value),
    set_property: (parent:Set<unknown>, key, value) => parent.add(value),


    count: (parent:Set<any>) => parent.size,
    keys: (parent:Set<any>) => [...parent],
    values: (parent:Set<any>) => [...parent],
})


const AsyncGenerator = Object.getPrototypeOf(Object.getPrototypeOf((async function*(){})()));
const Generator = Object.getPrototypeOf(Object.getPrototypeOf((function*(){})()))

Type.js.AsyncGenerator.setJSInterface({
    no_instanceof: true,
    class: AsyncGenerator,
    detect_class: (val) => AsyncGenerator.isPrototypeOf(val) || Generator.isPrototypeOf(val),

    is_normal_object: true,
    proxify_children: true,

    serialize: value => {
        return {
            next: (...args: []|[unknown]) => value.next(...args),
            return: (v: any) => value.return(v),
            throw: (v: any) => value.throw(v),
        }
    },


    cast: value => {
        if (value && value.next && value.return && value.throw) {
            return async function*() {
                let res = await value.next();
                while (!res.done) {
                    yield res.value;
                    res = await value.next();
                }
                return value.return();
            }()
        }
        else return INVALID;
    }
})

Type.js.Promise.setJSInterface({
    class: Promise,
    
    is_normal_object: true,
    proxify_children: true,

    serialize: value => {
        return {
            then: (onFulfilled:any, onRejected:any) => {
                // fails if promise was serialized and js function was reconstructed locally
                try {value}
                catch {
                    throw new Error("Promise cannot be restored - storing Promises persistently is not supported")
                }
                return value.then(onFulfilled, onRejected)
            },
            catch: (onRejected:any) => {
                // fails if promise was serialized and js function was reconstructed locally 
                try {value}
                catch {
                    throw new Error("Promise cannot be restored - storing Promises persistently is not supported")
                }
                return value.catch(onRejected)
            }
        }
    },


    cast: value => {
        if (value && value.then && value.catch) {
            (value.then as any)[DX_TIMEOUT] = Infinity;
            (value.catch as any)[DX_TIMEOUT] = Infinity;
            return new Promise((resolve, reject) => {
                value
                    .then(resolve)
                    .catch(reject);
            })
        }
        else return INVALID;
    }
})

Type.js.ReadableStream.setJSInterface({
    class: ReadableStream,

    serialize: value => {
        return {stream:new Stream(value)}
    },

    cast: value => {
        if (value?.stream instanceof Stream) {
            return (value.stream as Stream).readable_stream
        }
        else return INVALID;
    }
})

Type.js.WritableStream.setJSInterface({
    class: WritableStream,

    serialize: value => {
        const stream = new Stream();
        stream.pipeTo(value);
        return {stream};
    },

    cast: value => {
        if (value?.stream instanceof Stream) {
            return (value.stream as Stream).writable_stream
        }
        else return INVALID;
    }
})

Type.js.Response.setJSInterface({
    class: Response,

    serialize: value => {
        return {
            body: value.body,
            status: value.status,
            statusText: value.statusText,
            headers: Array.from(value.headers.entries())
        }
    },

    cast: value => {
        if (typeof value === "object") {
            const headers = new Headers();
            if (value.headers) {
                for (const [key, val] of value.headers) {
                    headers.append(key, val);
                }
            }
            return new Response(value.body, {
                status: value.status,
                statusText: value.statusText,
                headers
            })
        }
        else return INVALID;
    }
})

Type.js.Request.setJSInterface({
    class: Request,

    serialize: value => {
        return {
            url: value.url,
            method: value.method,
            headers: Array.from(value.headers.entries()),
            body: value.body,
            cache: value.cache,
            credentials: value.credentials,
            integrity: value.integrity,
            keepalive: value.keepalive,
            mode: value.mode,
            redirect: value.redirect,
            referrer: value.referrer,
            referrerPolicy: value.referrerPolicy,
        }
    },

    cast: value => {
        if (typeof value === "object") {
            const headers = new Headers();
            if (value.headers) {
                for (const [key, val] of value.headers) {
                    headers.append(key, val);
                }
            }
            return new Request(value.url, {
                method: value.method,
                headers,
                body: value.body,
                cache: value.cache,
                credentials: value.credentials,
                integrity: value.integrity,
                keepalive: value.keepalive,
                mode: value.mode,
                redirect: value.redirect,
                referrer: value.referrer,
                referrerPolicy: value.referrerPolicy,
            })
        }
        else return INVALID;
    }
})

// override set prototype to make sure all sets are sorted at runtime when calling [...set] (TODO is that good?)
// const set_iterator = Set.prototype[Symbol.iterator];
// Set.prototype[Symbol.iterator] = function() {
//     const ordered = [...set_iterator.call(this)].sort();
//     let i = 0;
//     return <IterableIterator<any>>{
//       next: () => ({
//         done: i >= ordered.length,
//         value: ordered[i++]
//       })
//     }
// }



// // <image/*>
// if (globalThis.HTMLImageElement) Type.get("std:image").setJSInterface({
//     class: globalThis.HTMLImageElement,

//     serialize: value => value._buffer,

//     empty_generator: ()=>new Image(),

//     cast: (value, type) => {
//         console.log("cast image " + type)
//         if (value instanceof ArrayBuffer) {
//             let blob = new Blob([value], {type: "image/"+type.variation});
//             let imageUrl = (globalThis.URL || globalThis.webkitURL).createObjectURL(blob);
//             let img = <HTMLImageElement> new Image();
//             // @ts-ignore
//             img._buffer = value;
//             // @ts-ignore
//             img._type = type;
//             img.src = imageUrl;
//             return img;
//         }
//         return INVALID;
//     },

//     // get specific type
//     get_type: value => {
//         return value._type ?? Type.get("std:image")
//     },

//     visible_children: new Set(["src"]),

// })