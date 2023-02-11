const caller_line = /((?:https?|file)\:\/\/.*?)(?::\d+)*(?:$|\nevaluate@|\)$)/;


// @ts-ignore check for safari
const is_safari = !!globalThis.Deno && (typeof globalThis.webkitConvertPointFromNodeToPage === 'function')

const meta = new Map<number, any>();
let min_key = 0;

function createMetaMapping(object:any){
	console.log("min key", min_key)
	while (meta.has(min_key)) {
		min_key++;
	}
	console.log("using key", min_key)
    meta.set(min_key, object);
    return min_key;
}
function removeMeta(key:number){
    meta.delete(key);
	if (key < min_key) min_key = key;
}

function _callWithMetaData<args extends any[], returns>(meta:any, ctx:any, fn:(...args:args)=>returns, args:args, key:number): any {
    const encoded = '__meta__'+key+'__';
	return is_safari ? 
		new globalThis.Function('f', 'a', '(function '+encoded+'(){f.call(...a)})()')(fn, [ctx, ...args]) : 
		({[encoded]:()=>fn.call(ctx,...args)})[encoded]()
}



/**
 * returns the URL location from where the function that called getCallerFile() was called
 */
export function getCallerFile() {
	return new Error().stack?.trim()
		?.split('\n')[3]
		?.match(caller_line)
		?.[1]
}

/**
 * returns the URL location directory from where the function that called getCallerDir() was called
 */
export function getCallerDir() {	
	return new Error().stack?.trim()
		?.split('\n')[3]
		?.match(caller_line)
		?.[1]
		?.replace(/[^\/\\]*$/, '')
}




/**
 * Injects meta data to the stack trace, which can be accessed within the function.
 * Calls the function (async) with paramters.
 * @param meta object that can be accessed within the function by calling getMeta()
 * @param ctx value of 'this' inside the function
 * @param fn the function to call
 * @param args function arguments array
 * @returns return value of the function call
 */
export function callWithMetadata<args extends any[], returns>(meta:any, ctx:any, fn:(...args:args)=>returns, args:args): returns {
	const key = createMetaMapping(meta);
	try {
        const res = _callWithMetaData(meta, ctx, fn, args, key);
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
 * @param fn the function to call
 * @param args function arguments array
 * @returns return value of the function call
 */
export async function callWithMetadataAsync<args extends any[], returns extends Promise<any>>(meta:any, ctx:any, fn:(...args:args)=>returns, args:args): Promise<returns extends Promise<infer T> ? T : any> {
	const key = createMetaMapping(meta);
	try {
        const res = await _callWithMetaData(meta, ctx, fn, args, key);
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
    const key = new Error().stack?.match(/__meta__([^_]+)__/)?.[1];
    return meta.get(Number(key));
}