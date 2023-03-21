

//import { Storage } from "../runtime/storage.ts"; TODO Storage cannot be importet here, handle file caching somehow (somewhere else)
import { ValueError } from "../types/errors.ts";
import { baseURL, client_type, Deno } from "./global_values.ts";

export function getRandomString(template: string = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", charset: string = "abcdefghijklmnopqrstuvwxyz0123456789") {
    return template.replace(/x/g, (_: string, ...args: any[]) => {
        return charset[getRandomInt(0, charset.length-1)]
    });
}

export function getRandomInt(min = 0, max: number = Number.MAX_SAFE_INTEGER): number {
    const byte: number = globalThis.crypto.getRandomValues(new Uint8Array(1))[0];
    const range = max - min + 1;
    if (byte >= Math.floor(256 / range) * range)
        return getRandomInt(min, max);
    return min + (byte % range);
}

// get local file content (node) or url content (browser)
export async function getFileContent<E extends boolean = true>(url:string|URL, error_on_fail?:E, binary = false):  Promise<E extends false ? Uint8Array|string|null : Uint8Array|string> {
    const path = url.toString();
    error_on_fail ??= <any>true;

    // get local file
    if (client_type == "deno" && (path.startsWith("/") || path.startsWith("file://"))) {
        return getLocalFileContent(path, error_on_fail, binary);
    }

    // get from url
    try {
        const res = await fetch(path, {credentials: 'include', mode:'cors'});
        if (binary) return new Uint8Array(await res.arrayBuffer());
        else return (await res.text()).replaceAll("\r\n", "\n");
    } 
    catch(e) {
        if (error_on_fail) {
            // logger.error("Could not read file " + path);
            throw (e)
        }
    }
    return <any>null
}

// get local file content (node only)
export async function getLocalFileContent<E extends boolean = true>(file_path:string|URL, error_on_fail?:E, binary = false): Promise<E extends false ? Uint8Array|string|null : Uint8Array|string> {
    error_on_fail ??= <any>true;
    
    try {
        const read = binary ? Deno.readFile : Deno.readTextFile;
        const res = await read(file_path instanceof URL ? file_path : (file_path.startsWith('/') ? new URL('file://'+file_path) : new URL(file_path, baseURL)));
        return res;
    }
    catch (e) {
        if (error_on_fail) {
            // logger.error("Could not read file " + file_path);
            throw (e)
        }
    }
    return <any>null;
}

// // get local file content as string (node only)
// export async function getLocalFileTextContent<E extends boolean = true>(file_path:string|URL, error_on_fail?: E): Promise<E extends false ? string|null : string> {
//     if (error_on_fail == undefined) error_on_fail = <any>true;
//     const content = await getLocalFileContent(file_path, error_on_fail);
//     if (content) return new TextDecoder().decode(content).replaceAll("\r\n", "\n");
//     else return <any>null;
// }


export function urlToPath(url:URL) {
    return url.toString().replace(/^(file|https?)\:\/\//,'');
}

// binary - base64 conversion
export const btoa = globalThis.btoa;
export const atob = globalThis.atob;

/** ArrayBuffer <-> Base64 String */
export function arrayBufferToBase64(buffer:ArrayBuffer):string {
	let binary = '';
	const bytes = new Uint8Array( buffer );
	const len = bytes.byteLength;
	for (let i = 0; i < len; i++) {
		binary += globalThis.String.fromCharCode( bytes[ i ] );
	}
	return btoa( binary );
}

export function base64ToArrayBuffer(base64:string):ArrayBuffer {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array( len );
    for (let i = 0; i < len; i++)        {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}



// get hex string id from buffer
export function buffer2hex(buffer:Uint8Array|ArrayBuffer, seperator?:string, pad_size_bytes?:number, x_shorthand = false):string {
    if (buffer instanceof ArrayBuffer) buffer = new Uint8Array(buffer);

    // first pad buffer
    if (pad_size_bytes) buffer = buffer.slice(0, pad_size_bytes);

    let array:string[] = <string[]> Array.prototype.map.call(buffer, x => ('00' + x.toString(16).toUpperCase()).slice(-2))
    let skipped_bytes = 0;

    // collapse multiple 0s to x...
    if (x_shorthand) {
        array = array.slice(0,pad_size_bytes).reduce((previous, current) => {
            if (current == '00') {
                if (previous.endsWith('00')) {
                    skipped_bytes++;
                    return previous.slice(0, -2) + "x2"; // add to existing 00
                }
                else if (previous[previous.length-2] == 'x') {
                    const count = (parseInt(previous[previous.length-1],16)+1);
                    if (count <= 0xf) {
                        skipped_bytes++;
                        return previous.slice(0, -1) + count.toString(16).toUpperCase()  // add to existing x... max 15
                    }
                }
            }
            return previous + current;
        }).split(/(..)/g).filter(s=>!!s);
    }

    if (pad_size_bytes != undefined) array = Array.from({...array, length: pad_size_bytes-skipped_bytes}, x=>x==undefined?'00':x); // pad

    return array.join(seperator??'');
}

// get buffer from hex string id, x_shorthand: replace [x2] with [00 00], [xa] with [00] * 10
export function hex2buffer(hex:string, pad_size_bytes?:number, x_shorthand = false):Uint8Array { 
    if (!hex) return new Uint8Array(0); // empty buffer

    hex = hex.replace(/[_\- ]/g, "");
    if (hex.length%2 != 0) throw new ValueError('Invalid hexadecimal buffer: ' + hex);    
    if ((x_shorthand && hex.match(/[G-WYZ\s]/i)) || (!x_shorthand && hex.match(/[G-Z\s]/i))) throw new ValueError('Invalid hexadecimal buffer: ' + hex);       

    let array:number[];

    if (!x_shorthand) array = hex.match(/[\dA-Fa-fxX]{2}/gi)?.map( s => parseInt(s, 16)) ?? [];
    else array = hex.match(/[\dA-Fa-fxX]{2}/gi)?.map((s, i, a) => {
        s = s.toLowerCase();
        if (s.startsWith("x") && s[1]!="x") return Array(parseInt(s[1],16)).fill(0); // expand x...
        else if (s.includes("x")) throw new ValueError('Invalid buffer "x" shorthand: ' + hex.slice(0, 30)); 
        return parseInt(s, 16)
    }).flat(1) ?? []

    if (pad_size_bytes != undefined) return new Uint8Array({...array, length: pad_size_bytes});
    else return new Uint8Array(array);
}