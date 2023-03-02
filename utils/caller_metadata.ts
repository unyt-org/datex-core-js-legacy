const caller_file = /((?:https?|file)\:\/\/.*?)(?::\d+)*(?:$|\nevaluate@|\)$)/;
const caller_row_col = /(\d+)\:(\d+)(\))?$/;
const caller_name = /([^ ]*)(?:@| \()(?:https?|file)\:\/\//;
const extract_meta = /__meta__([^_]+)__/;

// @ts-ignore check for safari
const is_safari = !globalThis.Deno && (typeof globalThis.webkitConvertPointFromNodeToPage === 'function')

const meta = new Map<number, any>();
let min_key = 0;

function createMetaMapping(object:any){
	while (meta.has(min_key)) {
		min_key++;
	}
    meta.set(min_key, object);
    return min_key;
}
function removeMeta(key:number){
    meta.delete(key);
	if (key < min_key) min_key = key;
}

function _callWithMetaData<args extends any[], returns>(key:number, fn:(...args:args)=>returns, args?:args, ctx?:any): any {
    const encoded = '__meta__'+key+'__';
	const _args = <args> args ?? [];
	return is_safari ? 
		new globalThis.Function('f', 'c', 'a', 'return (function '+encoded+'(){return c ? f.apply(c, a) : f(a)})()')(fn, ctx, args) : 
		({[encoded]:()=>ctx ? fn.apply(ctx, _args) : fn(..._args)})[encoded]()
}


function getPartsFromStack(stack:string|undefined) {
	if (!stack) return null;
	return stack
		.trim()
		.replace(/^Error\n/, '') // remove chrome Error line
		.replace(/(\n.*@\[native code\])+$/, '') // remove safari [native code] lines at the end
		.replace(/\n *at ModuleJob\.run \(node\:internal\/(.|\n)*$/, '') // remove nodejs internal stack
		.split('\n');
}



/**
 * returns the URL location from where the function that called getCallerFile() was called
 */
export function getCallerFile() {
	const parts = getPartsFromStack(new Error().stack);
	return parts
		?.[Math.min(parts.length-1, 2)]
		?.match(caller_file)
		?.[1] ?? window.location?.href
}

/**
 * returns the URL location directory from where the function that called getCallerDir() was called
 */
export function getCallerDir() {
	const parts = getPartsFromStack(new Error().stack);
	return parts
		?.[Math.min(parts.length-1, 2)]
		?.match(caller_file)
		?.[1]
		?.replace(/[^\/\\]*$/, '') ?? window.location?.href
}

/**
 * returns structured call stack data for the last callers: file, name and position in source code
 * {
 * 		file: string|null,
 * 		name: string|null,
 * 		row: number|null,
 * 		col: number|null
 * }
 */
export function getCallerInfo() {
	let parts = getPartsFromStack(new Error().stack);
	if (!parts) return null;
	// remove second line '@...' without name in safari
	if (is_safari && parts[1].startsWith("@")) parts.splice(1, 1); 
	parts = parts.slice(Math.min(parts.length-1, 2))

	const info = [];

	for (const part of parts) {
		const pos = part.match(caller_row_col);
		// get name part, ignore if starts with safari 'module code'
		let name:string|null|undefined = part.trim().startsWith('module code') ? null : part.match(caller_name)?.[1];
		// ignore if just at http://
		if (name == 'at' && part.trim().startsWith('at ')) name = null;
		
		info.push({
			file: part.match(caller_file)?.[1] || null,
			name: name || null,
			row: pos?.[1] ? Number(pos?.[1]) : null,
			col: pos?.[2] ? Number(pos?.[2]) : null
		})
	}

	return info;
}



/**
 * Injects meta data to the stack trace, which can be accessed within the function.
 * Calls the function (async) with paramters.
 * @param meta object that can be accessed within the function by calling getMeta()
 * @param ctx value of 'this' inside the function
 * @param func the function to call
 * @param args function arguments array
 * @returns return value of the function call
 */
export function callWithMetadata<args extends any[], returns extends Awaited<any>>(meta:any, func:(...args:args)=>returns, args?:args, ctx?:any): returns {
	const key = createMetaMapping(meta);
	try {
        const res = _callWithMetaData(key, func, args, ctx);
        removeMeta(key); // clear meta
        return res;
    }
    catch (e) {
        removeMeta(key); // clear meta
        throw e;
    }
}

/**
 * Injects meta data to the stack trace, which can be accessed within the function.
 * Calls the function (async) with paramters.
 * @param meta object that can be accessed within the function by calling getMeta()
 * @param ctx value of 'this' inside the function
 * @param func the function to call
 * @param args function arguments array
 * @returns return value of the function call
 */
export async function callWithMetadataAsync<args extends any[], returns extends Promise<any>>(meta:any, func:(...args:args)=>returns, args?:args, ctx?:any): Promise<returns extends Promise<infer T> ? T : any> {
	const key = createMetaMapping(meta);
	try {
        const res = await _callWithMetaData(key, func, args, ctx);
        removeMeta(key); // clear meta
        return res;
    }
    catch (e) {
        removeMeta(key); // clear meta
        throw e;
    }
}


/**
 * get the current DATEX meta data within a JS function scope
 * @returns meta object
 */
export function getMeta(){
    const key = new Error().stack?.match(extract_meta)?.[1];
    return meta.get(Number(key));
}

/**
 * clear metadata for further call stack
 */
export function clearMeta(){
    const key = Number(new Error().stack?.match(extract_meta)?.[1]);
    if (!isNaN(key)) removeMeta(key);
}