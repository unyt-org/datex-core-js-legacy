
/**
╔══════════════════════════════════════════════════════════════════════════════════════╗
║  DATEX Runtime                                                                       ║
╠══════════════════════════════════════════════════════════════════════════════════════╣
║  Complete DATEX runtime for the web and node.js                                      ║
║  * Parses & executes DATEX requests, handles pointers, garbage collection and more   ║
║  * Supports the DATEX binary format (dxb) and DATEX script code                      ║
║  Visit https://docs.unyt.org/datex for more information                              ║
╠═════════════════════════════════════════╦════════════════════════════════════════════╣
║  © 2022 unyt.org                        ║                                            ║
╚═════════════════════════════════════════╩════════════════════════════════════════════╝
*/

//logger.info("initializing ...");

// displayInit();


globalThis.performance?.mark("runtime_start");

// for debugging: converting bigints to JSON
// @ts-ignore
BigInt.prototype.toJSON = function(){return globalThis.String(this)+"n"}
// @ts-ignore
Symbol.prototype.toJSON = function(){return globalThis.String(this)}

/***** imports */
import { Compiler, compiler_options, PrecompiledDXB, ProtocolDataTypesMap, DatexResponse} from "../compiler/compiler.ts"; // Compiler functions
import { Pointer, PointerProperty, RefOrValue, Ref, ObjectWithDatexValues, JSValueWith$, MinimalJSRef, ObjectRef, RefLike, UpdateScheduler} from "./pointers.ts";
import { BROADCAST, Endpoint, endpoints, IdEndpoint, LOCAL_ENDPOINT, Target, target_clause, WildcardTarget } from "../types/addressing.ts";
import { RuntimePerformance } from "./performance_measure.ts";
import { NetworkError, PermissionError, PointerError, RuntimeError, SecurityError, ValueError, Error as DatexError, CompilerError, TypeError, SyntaxError, AssertionError } from "../types/errors.ts";
import { Function as DatexFunction } from "../types/function.ts";
import { MatchCondition, Storage } from "../storage/storage.ts";
import { Observers } from "../utils/observers.ts";
import { BinaryCode } from "../compiler/binary_codes.ts";
import type { ExecConditions, trace, compile_info, datex_meta, datex_scope, dxb_header, routing_info } from "../utils/global_types.ts";
import { Markdown } from "../types/markdown.ts";
import { Type } from "../types/type.ts";
import { Tuple } from "../types/tuple.ts";
import { DatexObject } from "../types/object.ts";
import { Crypto } from "../runtime/crypto.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { arrayBufferToBase64, base64ToArrayBuffer, buffer2hex, getFileContent } from "../utils/utils.ts";
import { IOHandler } from "./io_handler.ts";
import { DX_PERMISSIONS, DX_SLOTS, DX_TYPE, DX_SERIALIZED, DX_VALUE, INVALID, MAX_UINT_16, NOT_EXISTING, UNKNOWN_TYPE, VOID, WILDCARD, SLOT_WRITE, SLOT_READ, DX_GET_PROPERTY, SLOT_GET, SLOT_SET } from "./constants.ts";
import { baseURL, DEFAULT_HIDDEN_OBJECT_PROPERTIES, logger, TypedArray } from "../utils/global_values.ts";
import { client_type } from "../utils/constants.ts";
import { MessageLogger } from "../utils/message_logger.ts";
import { JSInterface } from "./js_interface.ts";
import { Stream } from "../types/stream.ts";
import { Quantity } from "../types/quantity.ts";
import { Scope } from "../types/scope.ts";
import type { fundamental } from "../types/abstract_types.ts";
import { IterationFunction as IteratorFunction, Iterator, RangeIterator } from "../types/iterator.ts";
import { Assertion } from "../types/assertion.ts";
import { Deferred } from "../types/deferred.ts";
import { Task } from "../types/task.ts";
import { DATEX_ERROR } from "../types/error_codes.ts";
import { Conjunction, Disjunction, Logical, Negation } from "../types/logic.ts";
import { Logger } from "../utils/logger.ts";
import { Debugger } from "./debugger.ts";
import {decompile as wasm_decompile} from "../wasm/adapter/pkg/datex_wasm.js";
import { CommunicationInterfaceSocket } from "../network/communication-interface.ts";

import "../types/native_types.ts"; // load prototype overrides
import { Time } from "../types/time.ts";
import { initPublicStaticClasses } from "../js_adapter/js_class_adapter.ts";
import { JSTransferableFunction } from "../types/js-function.ts";
import { createFunctionWithDependencyInjections } from "../types/function-utils.ts";
import type { Blockchain } from "../network/blockchain_adapter.ts";
import { AutoMap } from "../utils/auto_map.ts";
import { Supranet } from "../network/supranet.ts";
import { sendDatexViaHTTPChannel } from "../network/datex-http-channel.ts";
import { deleteCookie, getCookie, setCookie } from "../utils/cookies.ts";
import { addPersistentListener, removePersistentListener } from "../utils/persistent-listeners.ts";
import { endpoint_config } from "./endpoint_config.ts";
import type { DatexInData, DatexOutData } from "../network/communication-hub.ts";
import { communicationHub } from "../network/communication-hub.ts";

const mime = client_type === "deno" ? (await import("https://deno.land/x/mimetypes@v1.0.0/mod.ts")).mime : null;

// from datex_short.ts --------------------------------------------
function $$<T>(value:RefOrValue<T>): MinimalJSRef<T> {
    return <any> Pointer.createOrGet(value).js_value;
}
function static_pointer<T>(value:RefOrValue<T>, endpoint:IdEndpoint, unique_id:number, label?:string|number) {
    const static_id = Pointer.getStaticPointerId(endpoint, unique_id);
    const pointer = Pointer.create(static_id, value)
    if (label) pointer.addLabel(typeof label == "string" ? label.replace(/^\$/, '') : label);
    return Ref.collapseValue(pointer);
}

// --------------------------------------------------------------


// @ts-ignore
export const ReadableStream = globalThis.ReadableStream;

/*********************************************************************************************************************/

RuntimePerformance.marker("module loading time", "modules_loaded", "runtime_start");

// TODO reader for node.js
const ReadableStreamDefaultReader = globalThis.ReadableStreamDefaultReader ?? class {};

const EXPOSE = Symbol("EXPOSE");

export class StaticScope {

    public static STD: StaticScope;
    public static scopes = new Map<any, StaticScope>()

    public static readonly NAME: unique symbol = Symbol("name");
    public static readonly DOCS: unique symbol = Symbol("docs");

    // return a scope with a given name, if it already exists
    public static get(name?:string, expose = true): StaticScope {
        if (!expose) return new StaticScope(name, false);
        else return this.scopes.get(name) || new StaticScope(name);
    }

    [EXPOSE]: boolean

    private constructor(name?:string, expose = true){
        this[EXPOSE] = expose;
        const proxy = <this> Pointer.proxifyValue(this, false, undefined, false);
        DatexObject.setWritePermission(<Record<string | symbol, unknown>>proxy, undefined); // make readonly
        
        const ptr = Pointer.pointerifyValue(proxy);
        ptr.grantPublicAccess(true);

        if (name) proxy.name = name;
        return proxy;
    }

    // handle scope variables
    getVariable(name: string) {
        return this[name];
    }
    setVariable(name: string, value: any) {
        return this[name] = value;
    }
    hasVariable(name: string) {
        return Object.hasOwn(this,name)
    }

    // update/set the name of this static scope
    set name(name:string){
        if (this[StaticScope.NAME] && this[EXPOSE]) StaticScope.scopes.delete(this[StaticScope.NAME]);
        this[StaticScope.NAME] = name;
        if (this[EXPOSE]) StaticScope.scopes.set(this[StaticScope.NAME], this);
        if (this[StaticScope.NAME] == "std") StaticScope.STD = this;
    }

    get name() {
        return this[StaticScope.NAME]
    }

    set docs(docs:string) {
        this[StaticScope.DOCS] = docs;
    }
    
    get docs() {
        return this[StaticScope.DOCS];
    }
}

// DatexObject.setWritePermission(StaticScope.scopes, undefined); // make readonly


// typed object
export class TypedValue<T extends Type = Type>  {

    [DX_TYPE]: Type

    constructor(type:T, value?:T extends Type<infer TT> ? TT : unknown) {
        this[DX_VALUE] = value;
        this[DX_TYPE] = type;
    }

    toString() {
        return "[Could not resolve type: "+ this[DX_TYPE] + "]"
    }

}


// typed value that can not be mapped to an object
export class UnresolvedValue {

    [DX_TYPE]: Type
    [DX_VALUE]: any

    constructor(type:Type, value:any) {
        this[DX_VALUE] = value;
        this[DX_TYPE] = type;
    }

}


/** Runtime */

type local_text_map = {[lang:string]:{[key:string]:string}};

type mime_type = `${string}/${string}`
type mime_type_definition<T> = (new(...args:any[])=>T) | {class:(new(...args:any[])=>T),generator:(value:Blob)=>T}

type Source = '_source'|{};

/**
 * available permission that can be given to trusted endpoints
 */
export type trustedEndpointPermission = "remote-js-execution" | "protected-pointer-access" | "fallback-pointer-source";

export class Runtime {


    // can be changed
    public static OPTIONS = {
        PROTECT_POINTERS: false, // explicit permissions are required for remote endpoints to read/write pointers (current default: false)
        INDIRECT_REFERENCES: false, // enable support for indirect references to pointers from other pointers
        DEFAULT_REQUEST_TIMEOUT: 5000, // default timeout for DATEX requests in ms
        GARBAGE_COLLECTION_TIMEOUT: 1000, // time after which a value can get garbage collected
        USE_BIGINTS: true,  // DATEX integers are interpreted as JS BigInts 
                            // otherwise DATEX floats and integers are interpreted as numbers
                            // recommended: true, otherwise all integers are implicitly casted to the type <decimal> in DATEX
        ERROR_STACK_TRACES: true, // create detailed stack traces with all DATEX Errors
        NATIVE_ERROR_STACK_TRACES: true, // create detailed stack traces of JS Errors (NATIVE_ERROR_MESSAGES must be true)
        NATIVE_ERROR_DEBUG_STACK_TRACES: false, // also display internal DATEX library stack traces (hidden per default)
        NATIVE_ERROR_MESSAGES: true // expose native error messages
    }

    public static MIME_TYPE_MAPPING: Record<mime_type, mime_type_definition<unknown>> = {
        "text/markdown": Markdown
    }


    static mime_type_classes = new Map(Object.entries(this.MIME_TYPE_MAPPING).map(x=>[('class' in x[1] && typeof x[1].class == "function") ? x[1].class : x[1], x[0]])) 


    /**
     * List of endpoints that are allowed to create js:Functions that are executable on this endpoint
     */
    public static trustedEndpoints = new Map<Endpoint, trustedEndpointPermission[]>()

    public static ENV: ObjectRef<{LANG:string, DATEX_VERSION:string, [key:string]:string}>
    public static VERSION = "beta";

    public static PRECOMPILED_DXB: {[key:string]:PrecompiledDXB}

    // blockchain is loaded in init()
    static Blockchain?: typeof Blockchain

    static #saved_local_strings = new WeakMap<local_text_map, Map<RefOrValue<string>, Pointer<string>>>();
    static #not_loaded_local_strings = new WeakMap<local_text_map, Set<RefOrValue<string>>>();
    
    /**
     * Add a trusted endpoints with special permissions (default: all permissions enabled):
     *  - `"protected-pointer-access"`: allows this endpoint to access all pointers, even if the PROTECT_POINTERS runtime flag is set
     *  - `"remote-js-execution"`: allows local execution of <js:Function> values (containing JS source code) that were created by this endpoint
     * @param endpoint 
     * @param permissions 
     */
    public static addTrustedEndpoint(endpoint:Endpoint, permissions:trustedEndpointPermission[] = ["protected-pointer-access", "remote-js-execution", "fallback-pointer-source"]) {
        if (this.trustedEndpoints.has(endpoint))
            logger.debug("Updated permissions for trusted endpoint " + endpoint + ": " + permissions.join(", "));
        else 
            logger.debug("Added trusted endpoint " + endpoint + " with permissions: " + permissions.join(", "));
        this.trustedEndpoints.set(endpoint, permissions);
    }

    public static getLocalString(local_map:{[lang:string]:string}):Pointer<string> {
        const ptr = Pointer.createTransform([PointerProperty.get(Runtime.ENV, 'LANG')],
            (lang:string) => {
                return local_map[lang] ?? this.getTranslatedLocalString(local_map['en'], lang)
            }, // sync js mapping
            `
            var lang = #env->LANG; 
            var local_map = ${Runtime.valueToDatexString(local_map)};
            always (
                if (local_map.(lang)) (local_map.(lang))
                else (
                    local_map.'en' default '?'
                    /*
                    val text = local_map.'en';
                    val language = lang;
                    @example.translate (text, language);
                    */
                )
            )
            `, true // used for persistent DATEX storage
        ) as Pointer<string>;
        ptr.transformMap = local_map;
        return ptr;
    }

    public static getLocalStringFromMap(local_map:local_text_map, key:RefOrValue<string>):Pointer<string> {
        // get cached transform pointer
        let saved_strings = this.#saved_local_strings.get(local_map);
        if (saved_strings && saved_strings.has(key)) return saved_strings.get(key)!;

        // create new transform pointer
        else {
            const keyVal = Ref.collapseValue(key, true, true);
            const value_available = !local_map[Runtime.ENV.LANG] || (keyVal in local_map[Runtime.ENV.LANG]); // in map or auto translate
            const transformValues:RefLike<string>[] = [PointerProperty.get(Runtime.ENV, 'LANG')];
            if (key instanceof Ref) transformValues.push(key)

            const string_transform = Pointer.createTransform(transformValues, 
                (lang:string) => this.transformLangValue(lang, local_map, Ref.collapseValue(key, true, true)), // sync js mapping
                value_available ? `
                    var lang = #env->LANG; 
                    var local_map = ${Runtime.valueToDatexString(local_map)};
                    var key = ${Runtime.valueToDatexString(key)};
                    always (
                        if (local_map.(lang)) (local_map.(lang).(key))
                        else (
                            local_map.'en' default '?'
                            /*
                            val text = local_map.'en'.(key);
                            val language = lang;
                            @example.translate (text, language);
                            */
                        )
                    )` : '' // used for persistent DATEX storage
                    , true
            );
            // add to saved string
            if(!saved_strings) this.#saved_local_strings.set(local_map, saved_strings = new Map());
            saved_strings.set(key, string_transform);

            // value not yet available, add to not loaded local strings
            if (!value_available) {
                if (!this.#not_loaded_local_strings.has(local_map)) this.#not_loaded_local_strings.set(local_map, new Set());
                this.#not_loaded_local_strings.get(local_map)!.add(key);
            }
            return string_transform;
        }
    }

    // updates not yet initialized local string map values
    public static async newLocalStringsMapValues(local_map:local_text_map) {
        const local_strings_map = this.#saved_local_strings.get(local_map);
        if (!local_strings_map) {
            return;
        }
        const lang = Runtime.ENV.LANG;

        // force override transform values (currently unknown)
        for (const key of this.#not_loaded_local_strings.get(local_map)??[]) {
            const keyVal = Ref.collapseValue(key, true, true);
            if (lang in local_map && keyVal in local_map[lang]) {
                local_strings_map.get(key)!.val = await this.transformLangValue(lang, local_map, keyVal);
                local_strings_map.get(key)!.setDatexTransform(`
                var lang = #env->LANG; 
                var local_map = ${Runtime.valueToDatexString(local_map)};
                var key = ${Runtime.valueToDatexString(key)};
                always (
                    if (local_map.(lang)) (local_map.(lang).(key))
                    else (
                        'Could not translate to (lang)'
                        /*
                        val text = local_map.'en'.(key);
                        val language = lang;
                        @example.translate (text, language);
                        */
                    )
                )`) // used for persistent DATEX storage
                this.#not_loaded_local_strings.get(local_map)!.delete(key); // is now loaded
                if (this.#not_loaded_local_strings.get(local_map)!.size == 0) this.#not_loaded_local_strings.delete(local_map) // no more keys in 'not loaded' set
            }
        }
    }

    private static transformLangValue(lang:string, local_map:{[lang:string]:{[key:string]:string}}, key:string, auto_translate = true):Promise<string>|string {
        return (lang in local_map ? local_map[lang]?.[key] : (auto_translate ? this.getTranslatedLocalString(local_map['en']?.[key], lang) : local_map['en']?.[key])) ?? '██████████████';
    }

    private static getTranslatedLocalString(text_en:string, lang:string) {
        return "Could not translate to " + lang;// <Promise<string>> datex `@example.translate (${text_en},${lang})`
    }

    // @ts-ignore
    public static HOST_ENV = '';

    static #endpoint: Endpoint;  // this endpoint (default is special local endpoint %000000000000000000000000)

    static get endpoint(){
        return this.#endpoint
    }

    static set endpoint(endpoint: Endpoint){
        const _isInitialSetWorkaround = this.#endpoint==undefined;
        if (this.#endpoint === endpoint) return; // already set
        if (endpoint != LOCAL_ENDPOINT) logger.debug("using endpoint: " + endpoint);
        this.#endpoint = endpoint;

        if (!_isInitialSetWorkaround) Observers.call(this,"endpoint",this.#endpoint);
    }

    static _setEndpoint(endpoint: Endpoint) {
        this.endpoint = endpoint;
    }

    static {
        Observers.register(Runtime, "endpoint");
    }

    static onEndpointChanged(listener:(endpoint:Endpoint)=>void){
        Observers.add(this,"endpoint",listener);
    }

    public static main_node:Endpoint; // TODO remove?

    static endpoint_entrypoint:any

    private static utf8_decoder = new TextDecoder("utf-8");
    private static utf8_encoder = new TextEncoder();

    // initialize std pointers if not yet initialized
    private static initialized = false;

    /**
     * resolves as soon as all scheduled DATEX updates are sent
     */
    public static get synchronized() {
        // first force trigger all remaining scheduled pointer updates
        UpdateScheduler.triggerAll();
        
        return new Promise<void>((resolve) => {
            Runtime.datexOutAllSent().then(() => {
                resolve()
            });
        });
    }

    // binary codes that always indicate the end of a subscope
    private static END_BIN_CODES = [
        undefined, 
        BinaryCode.CLOSE_AND_STORE, 

        BinaryCode.IMPLEMENTS, 
        BinaryCode.EXTENDS, 
        BinaryCode.MATCHES, 
        BinaryCode.DEFAULT, 

        BinaryCode.ARRAY_END,
        BinaryCode.SUBSCOPE_END, 
        BinaryCode.OBJECT_END, 
        BinaryCode.TUPLE_END, 

        BinaryCode.ELEMENT, 
        BinaryCode.ELEMENT_WITH_KEY,
        BinaryCode.ELEMENT_WITH_INT_KEY,
        BinaryCode.ELEMENT_WITH_DYNAMIC_KEY,
        BinaryCode.KEY_PERMISSION,

        BinaryCode.EQUAL_VALUE,
        BinaryCode.EQUAL,
        BinaryCode.NOT_EQUAL_VALUE,
        BinaryCode.NOT_EQUAL,
        BinaryCode.GREATER,
        BinaryCode.GREATER_EQUAL,
        BinaryCode.LESS,
        BinaryCode.LESS_EQUAL,

        BinaryCode.ADD,
        BinaryCode.SUBTRACT,
        BinaryCode.MULTIPLY,
        BinaryCode.DIVIDE,
        BinaryCode.POWER,
        BinaryCode.OR,
        BinaryCode.AND,
        BinaryCode.MODULO,
    ];


    private static readonly_internal_vars = new Set<string|number>([
        'current',
        'sender',
        'timestamp', 
        'signed',
        'encrypted',
        'meta',
        'this',
        'location'
    ])

    // DATEX OUT + REDIRECT

    private static callbacks_by_sid = new Map<string, [resolve:globalThis.Function, reject:globalThis.Function, timeoutId?: number]>();
    private static detailed_result_callbacks_by_sid = new Map<string, (scope:datex_scope, header:dxb_header, error?:Error)=>void>(); // call only once
    private static detailed_result_callbacks_by_sid_multi = new Map<string, (scope:datex_scope, header:dxb_header, error?:Error)=>void>(); // call multiple times


    public static setMainNode(main_node:Endpoint){
        this.main_node = main_node
    }


    // default static scope: std
    static STD_STATIC_SCOPE:Record<string,any>;

    private static STD_TYPES_ABOUT:Map<Type,Markdown>;

    static #datex_out_handler_initialized_resolve?:(value: void | PromiseLike<void>) => void
    static #datex_out_init_promise:Promise<void>|undefined = new Promise<void>(resolve=>this.#datex_out_handler_initialized_resolve=resolve);


    // default datex out: send to self (if no routing available)
    private static datex_out:(data: DatexOutData)=>Promise<void> = async (data)=>{
        await this.datexIn(data);
    } 

    public static setDatexOutHandler(handler:(data: DatexOutData)=>Promise<void>){
        this.datex_out = handler
        //  TODO:
        // datex out callback wrapper, handles crypto proxy
        // (data: DatexOutData) => {
        //     // redirect as crypto proxy: decrypt
        //     // if (to && this.#cryptoProxies.has(to)) {
        //     //     // TODO#CryptoProxy: decrypt + check channel
        //     //     const decKey = this.#cryptoProxies.get(to)![1]
        //     //     console.log("TODO: handle proxy decrypt for " + to)
        //     // }

        //     return handler(data);
        // }

        if (this.#datex_out_handler_initialized_resolve) {
            this.#datex_out_handler_initialized_resolve();
            // initialized, delete promise
            this.#datex_out_handler_initialized_resolve = undefined;
            this.#datex_out_init_promise = undefined;
        }
    }


    /** handles symmetric keys for scope sessions */
    private static scope_symmetric_keys:Map<Endpoint,Map<number, CryptoKey>> = new Map();


    // get key for a sender
    protected static async getOwnSymmetricKey(scope_id:number):Promise<CryptoKey> {
        if (!this.scope_symmetric_keys.has(this.endpoint)) this.scope_symmetric_keys.set(this.endpoint, new Map())
        let sender_map = this.scope_symmetric_keys.get(this.endpoint);
        // create new if not yet created
        if (!sender_map.has(scope_id)) sender_map.set(scope_id, await Crypto.generateSymmetricKey())
        return sender_map.get(scope_id)
    }

    // get key for a sender
    protected static async getScopeSymmetricKeyForSender(scope_id:number, sender:Endpoint):Promise<CryptoKey> {
        if (!this.scope_symmetric_keys.has(sender)) this.scope_symmetric_keys.set(sender, new Map())
        let sender_map = this.scope_symmetric_keys.get(sender);
        if (!sender_map.has(scope_id)) {
            throw new SecurityError("Found no encryption key for this scope");
        }
        return sender_map.get(scope_id)
    }


    // set key if received from remote endpoint
    protected static async setScopeSymmetricKeyForSender(scope_id:number, sender:Endpoint, key:CryptoKey) {
        if (!this.scope_symmetric_keys.has(sender)) this.scope_symmetric_keys.set(sender, new Map())
        this.scope_symmetric_keys.get(sender).set(scope_id, key)
    }

    protected static async removeScopeSymmetricKeyForSender(scope_id:number, sender:Endpoint) {
        this.scope_symmetric_keys.get(sender)?.delete(scope_id)
    }

    // content cache
    static #url_content_cache = new Map<string,any>();
    static #url_raw_content_cache = new Map<string,any>();

    public static deleteURLCache(url: string|URL) {
        this.#url_content_cache.delete(url.toString())
        this.#url_raw_content_cache.delete(url.toString())
    }

    // converts exports from DATEX tuple to normal JS object
    private static normalizeDatexExports(module:any){
        // TODO: fix tuple madness
		if (module instanceof Tuple && !Pointer.getByValue(module)) module = Object.fromEntries(module.named);
        return module;
    }

    // get content of https://, file://, ...
    public static async getURLContent<T=unknown, RAW extends boolean = false>(url_string:string, raw?:RAW, cached?:boolean, potentialDatexAsJsModule?: boolean):Promise<RAW extends false ? T : [data:unknown, type?:string]>
    public static async getURLContent<T=unknown, RAW extends boolean = false>(url:URL, raw?:RAW, cached?:boolean, potentialDatexAsJsModule?:boolean):Promise<RAW extends false ? T : [data:unknown, type?:string]>
    public static async getURLContent<T=unknown, RAW extends boolean = false>(url_string:string|URL, raw:RAW=false, cached = false, potentialDatexAsJsModule = true):Promise<RAW extends false ? T : [data:unknown, type?:string]> {

        if (url_string.toString().startsWith("route:") && window.location?.origin) url_string = new URL(url_string.toString().replace("route:", ""), window.location.origin)

        // catch fatal route errors here
        if (url_string.toString().startsWith("fatal:")) {
            throw new Error(url_string.toString().replace("fatal:",""))
        }

        const url = url_string instanceof URL ? url_string : new URL(url_string, baseURL);
        url_string = url.toString();

        // get cached content
        if (cached) {
            if (raw && this.#url_raw_content_cache.has(url_string)) return this.#url_raw_content_cache.get(url_string);
            if (!raw && this.#url_content_cache.has(url_string))    return this.#url_content_cache.get(url_string);
        }

        let result:any;

        if (url.protocol == "https:" || url.protocol == "http:" || url.protocol == "blob:") {
            let response:Response|undefined = undefined;
            let overrideContentType: string|undefined;

            let doFetch = true;


            // exceptions to force potentialDatexAsJsModule (definitely dx files)
            if (url_string.endsWith("/.dxb") || url_string.endsWith("/.dx") || url_string == "https://unyt.cc/nodes.dx") {
                potentialDatexAsJsModule = false;
            }

            // js module import
            if (!raw && (url_string.endsWith(".js") || url_string.endsWith(".ts") || url_string.endsWith(".tsx") || url_string.endsWith(".jsx"))) {
                doFetch = false; // no body fetch required, can directly import() module
                overrideContentType = "application/javascript"
            }
            // potential js module as dxb/dx: fetch headers first and check content type
            else if (!raw && potentialDatexAsJsModule && (url_string.endsWith(".dx")  || url_string.endsWith(".dxb"))) {
                try {
                    response = await fetch(url, {method: 'HEAD', cache: 'no-store'});
                    const type = response.headers.get('content-type');
                    if (type?.startsWith("text/javascript") || type?.startsWith("application/javascript")) {
                        doFetch = false; // no body fetch required, can directly import() module
                    }
                }
                catch (e) {
                    if (!response) console.error(e);
                }
                if (!response?.ok) {
                    throw new RuntimeError("Cannot get content of '"+url_string+"' (" + response?.status??"unknown" + ")");
                }
            }

            if (doFetch) {
                try {
                    response = await fetch(url);
                }
                catch (e) {
                    if (!response) console.error(e);
                }
                if (!response?.ok) {
                    throw new RuntimeError("Cannot get content of '"+url_string+"' (" + response?.status??"unknown" + ")");
                }
            }
            
            const type = overrideContentType ?? response?.headers.get('content-type');

            if (type == "application/datex" || type == "text/dxb" || url_string.endsWith(".dxb")) {
                const content = await response!.arrayBuffer();
                if (raw) result = [content, type];
                else result = await this.executeDXBLocally(content, url);
            }
            else if (type?.startsWith("text/datex") || url_string.endsWith(".dx")) {
                const content = await response!.text()
                if (raw) result = [content, type];
                else result = await this.executeDatexLocally(content, undefined, undefined, url);
            }
            else if (type?.startsWith("application/json5") || url_string.endsWith(".json5")) {
                const content = await response!.text();
                if (raw) result = [content, type];
                else result = await Runtime.datexOut([content, [], {sign:false, encrypt:false, type:ProtocolDataType.DATA}]);
            }
            else if (type?.startsWith("application/json") || type?.endsWith("+json")) {
                if (raw) result = [await response!.text(), type]; 
                else result = await response!.json()
            }
            else if (type?.startsWith("text/javascript") || type?.startsWith("application/javascript")) {
                if (raw) result = [await response!.text(), type]; 
                else result = await import(url_string)
            }
            else {
                const content = await response!.arrayBuffer()
                if (raw) result = [content, type];
                else {
                    if (!type) throw Error("Cannot infer type from URL content");
                    const mime_type = type.split("/");
                    result = Runtime.castValue(Type.get("std",mime_type[0], mime_type[1].split(/;| /)[0]), content);
                }
            }
        }

        else if (url.protocol == "file:") {

            const filePath = url.pathname;
            // check if has deno api (worker, deno or browser (remote))
            if (client_type !== "deno") {
                throw new RuntimeError("Cannot get content of '"+url_string+"'");
            }

            if (filePath.endsWith('.dxb')) {
                const content = (<Uint8Array>(await getFileContent(url, true, true))).buffer;
                if (raw) result = [content, "application/datex"];
                else result = await this.executeDXBLocally(content, url);
            }
            else if (filePath.endsWith('.dx')) {
                const content = <string> await getFileContent(url);
                if (raw) result = [content, "text/datex"];
                else result = await this.executeDatexLocally(content, undefined, undefined, url);
            }
            else if (filePath.endsWith('.json')) {
                const content = <string> await getFileContent(url);
                if (raw) result = [content, "application/json"];
                else result = JSON.parse(content)
            }
            else if (filePath.endsWith('.json5')) {
                const content = <string> await getFileContent(url);
                if (raw) result = [content, "application/json5"];
                else result = await Runtime.datexOut([content, [], {sign:false, encrypt:false, type:ProtocolDataType.DATA}]);
            }
            else if (filePath.endsWith('.js') || filePath.endsWith('.ts')  || filePath.endsWith('.tsx') || filePath.endsWith('.jsx') || filePath.endsWith('.mts') || filePath.endsWith('.mjs')) {
                const content = <string> await getFileContent(url);
                if (raw) result = [content, "application/javascript"];
                else {
                    result = await import(url_string )
                    // TODO: why try catch?, it should not be used?
                    // try {
                        
                    // } catch (e) {
                    //     console.warn(url_string)
                    //     console.error(e)
                    // }
                }
            }
            else {
                if (!mime) throw Error("Cannot infer type from URL content - missing mime module");
                const content = <Uint8Array>(await getFileContent(url, true, true));
                const ext = url.toString().match(/\.[^./]*$/)?.[0].replace(".","");
                if (!ext) throw Error("Cannot infer type from URL content (no extension)");
                const mime_type = mime.getType(ext);
                if (!mime_type) throw Error("Cannot infer type from URL content - could not resolve mime type (extension: "+ext+")");

                if (raw) result = [content, mime_type];
                else {
                    const type = mime_type.split("/");
                    result = Runtime.castValue(Type.get("std",type[0], type[1].split(/;| /)[0]), content);
                }
            }
            
        }

        else {
            throw new RuntimeError("Protocol '"+url.protocol.slice(0,-1)+"' not supported");
        }

        // cache result
        if (cached) {
            if (raw) this.#url_raw_content_cache.set(url_string, result);
            else this.#url_content_cache.set(url_string, result);
        }

        return result;
    }


    /**
     * executes a DATEX Script with insert data and returns the evaluated result
     * @param dx DATEX Script
     * @param data insert values (replaces '?' in SCRIPT)
     * @returns evaluated script result
     */
    static async parseDatexData(dx:string, data?:any[]):Promise<any> {
        return Runtime.executeDXBLocally(<ArrayBuffer> await Compiler.compile(dx, data, {sign:false, encrypt:false, type:ProtocolDataType.DATA}))
    }

    /**
     * executes a DATEX Binary encoded as Base64
     * @param dxb_base64 DATEX Binary as Base64 string
     * @returns evaluated DATEX result
     */
    public static getValueFromBase64DXB(dxb_base64:string):Promise<any> {
        return Runtime.executeDXBLocally(base64ToArrayBuffer(dxb_base64))
    }

    /**
     * evaluates a DATEX Data Binary without a DATEX header encoded as Base64
     * @param dxb_base64 DATEX Data Binary (without header) as Base64 string
     * @returns evaluated DATEX result
     */
    public static decodeValueBase64<T=unknown>(dxb_base64:string, outer_serialized=false, conditions?:ExecConditions):Promise<T> {
        // create scope
        const scope = Runtime.createNewInitialScope();
        scope.outer_serialized = outer_serialized;
        scope.exec_conditions = conditions;
        // set dxb as scope buffer
        Runtime.updateScope(scope, base64ToArrayBuffer(dxb_base64), {end_of_scope:true, sender:Runtime.endpoint})
        // execute scope
        return Runtime.simpleScopeExecution(scope)
    }

    /**
     * evaluates a DATEX Data Binary without a DATEX header
     * @param dxb DATEX Data Binary (without header)
     * @returns evaluated DATEX result
     */
    public static decodeValue(dxb:ArrayBuffer, outer_serialized=false, conditions?:ExecConditions):Promise<any> {
        // create scope
        const scope = Runtime.createNewInitialScope();
        scope.outer_serialized = outer_serialized;
        scope.exec_conditions = conditions;
        // set dxb as scope buffer
        Runtime.updateScope(scope, dxb, {end_of_scope:true, sender:Runtime.endpoint})
        // execute scope
        return Runtime.simpleScopeExecution(scope)
    }

    /**
     * Clones a value by serializing and deserializing, keeping only local references
     * @param value any DATEX value
     * @returns cloned value
     */
    public static async collapseCloneValue<T>(value:T):Promise<T> {
        const encoded = Compiler.encodeValue(value, undefined, true, true, true, true, false, true);
        // console.log(MessageLogger.decompile(encoded,false));
        return await Runtime.decodeValue(encoded);
    }

    /**
     * Clones a value (no deep clone) by serializing and deserializing
     * @param value any DATEX value
     * @returns cloned value
     */
    public static async cloneValue<T>(value:T):Promise<T> {
        return await Runtime.decodeValue(Compiler.encodeValue(value, undefined, true, false, true, false, false));
    }
    
    /**
     * Clones a value by serializing and deserializing
     * @param value any DATEX value
     * @returns deep-cloned value
     */
    public static async deepCloneValue<T>(value:T):Promise<T> {
        return await Runtime.decodeValue(Compiler.encodeValue(value, undefined, true, true, true, false, false));
    }

    /**
     * Executes a DATEX Script locally and returns the result
     * @param datex DATEX Script
     * @param options compiler options
     * @param context_location context in which the script should be executed (URL)
     * @returns evaluated DATEX result
     */
    public static async executeDatexLocally(datex:string|PrecompiledDXB, data?:unknown[], options?:compiler_options & { __overrideMeta?: Partial<datex_meta> }, context_location?:URL):Promise<unknown> {
        return Runtime.executeDXBLocally(<ArrayBuffer> await Compiler.compile(datex, data, {sign:false, encrypt:false, context_location, ...options}), context_location, options?.__overrideMeta)
    }

    /**
     * Executes a DATEX Binary locally and returns the result
     * @param dxb DATEX Binary
     * @param context_location context in which the script should be executed (URL)
     * @param overrideMeta custom override header metadata
     * @param forceLocalExecution execute block even if receiver is external (default false)
     * @returns evaluated DATEX result
     */
    public static async executeDXBLocally(dxb:ArrayBuffer, context_location?:URL, overrideMeta?: Partial<datex_meta>, forceLocalExecution = false):Promise<unknown> {
        // generate new header using executor scope header
        let header:dxb_header;
        let dxb_body:ArrayBuffer;

        const res = await this.parseHeader(dxb, undefined, false, forceLocalExecution)
        if (res instanceof Array) {
            header = res[0];
            dxb_body = res[1].buffer;
        }
        else {
            throw new DatexError("Cannot execute dxb locally, the receiver defined in the header is external")
        }
           
        // override meta
        if (overrideMeta) {
            Object.assign(header, overrideMeta)
        }

        // create scope
        const scope = Runtime.createNewInitialScope(header, undefined, undefined, undefined, context_location);
    
        // set dxb as scope buffer
        Runtime.updateScope(scope, dxb_body, header)


        // execute scope
        return Runtime.simpleScopeExecution(scope)
    }

    /**
     * Handles compilation in Runtime
     *  manages SID and sets the right encryption keys
     *  redirects to Compiler.compile
     * @param data compile info (DATEX Script, data, options, ...)
     * @returns compiled DATEX Binary
     */
    protected static async compileAdvanced(data:compile_info):Promise<ArrayBuffer|ReadableStream> {
        const header_options = data[2];

        if (!header_options) throw new Error("header_options not defined")

        // get sid or generate new
        if (header_options.sid == null) header_options.sid = Compiler.generateSID();

        // encryption?
        if (header_options.encrypt && !header_options.sym_encrypt_key) {
            header_options.sym_encrypt_key = await this.getOwnSymmetricKey(header_options.sid);
            header_options.send_sym_encrypt_key = true; // TODO handle
        }

        return Compiler.compile(...data) // TODO currently workaround bridge to get generator value
    }

    static #prepocessingTasks = new Set<Promise<void>>();
    static #sendingTasks = new Set<Promise<void>>();

    /**
     * resolves as soon as all datex out preprocessing tasks are finished
     */
    protected static datexOutPreprocessingFinished() {
        return Promise.all(this.#prepocessingTasks);
    }

    /**
     * resolves as soon as all currently scheduled outgoing datex messages are sent
     */
    protected static datexOutAllSent() {
        // first await prepocessing, then await sending tasks
        return this.datexOutPreprocessingFinished()
            .then(() => Promise.all(this.#sendingTasks));
    }

    /**
     * Creates a new preprocessing task
     * @returns function that removes the task from the preprocessing tasks
     */
    protected static createPrepocessingTask() {
        const {promise, reject, resolve} = Promise.withResolvers<void>();
        this.#prepocessingTasks.add(promise);
        return () => {
            this.#prepocessingTasks.delete(promise);
            resolve();
        };
    }

    /**
     * Creates a new sending task
     * @returns function that removes the task from the sending tasks
     */
    protected static createDatexSendingTask() {
        const {promise, reject, resolve} = Promise.withResolvers<void>();
        this.#sendingTasks.add(promise);
        return () => {
            this.#sendingTasks.delete(promise);
            resolve();
        };
    }


    /**
     * Sends DATEX to one or multiple endpoints
     * @param data DATEX Binary or compile info (Script, data, options, ...)
     * @param to receiving endpoint, not required if flood is set to true
     * @param sid optional, can be explicitly set, otherwise inferred from compiled DXB or automatically generated
     * @param wait_for_result returns result if set to true, otherwise the receiving endpoint(s) don't send a response
     * @param encrypt encrypt DXB (TODO still required as extra parameter?)
     * @param detailed_result_callback callback function returning the complete scope and header of the response 
     * @param flood flood (broadcast) message
     * @param flood_exclude endpoint to exclude from the broadcast
     * @param timeout response timeout
     * @returns evaluated response value
     */
    public static async datexOut(data:ArrayBuffer|compile_info, to:target_clause=Runtime.endpoint, sid?:number, wait_for_result=true, encrypt=false, detailed_result_callback?:(scope:datex_scope, header:dxb_header, error:Error)=>void, flood = false, timeout?:number, socket?:CommunicationInterfaceSocket):Promise<any>{

        const finish = this.createPrepocessingTask();

        try {
            // external request, but datex out not yet initialized, wait for initialization
            if (!(to instanceof Endpoint && Runtime.endpoint.equals(to)) && this.#datex_out_init_promise /*instanceof Promise*/) {
                await this.#datex_out_init_promise;
            }

            // one or multiple blocks
            let dxb:ArrayBuffer|ReadableStream<ArrayBuffer>;

            // only info about what to compile, not yet compiled
            if (data instanceof Array) {
                if (!data[2]) data[2] = {}
                if (!data[2].to && to!=null) data[2].to = to; // add receiver if not found in compile options
                if (!data[2].sid && sid!=null) data[2].sid = sid; // add sid if not found in compile options
                if (data[2].flood==null && flood!=null) data[2].flood = flood; // add flood if not found in compile options
                if (data[2].encrypt==null && encrypt!=null) data[2].encrypt = encrypt; // add flood if not found in compile options
                dxb = await this.compileAdvanced(data);
                // override values from compiled data
                sid = data[2].sid ?? sid;
                flood = data[2].flood ?? flood;
                encrypt = data[2].encrypt ?? encrypt;
            }
            // already compiled
            else dxb = data;

            // no sid provided, and not compiled with new sid
            if (!sid) throw new RuntimeError("Could not get an SID for sending data");
            if (!this.datex_out) throw new NetworkError(DATEX_ERROR.NO_OUTPUT);
            if (!flood && !to) throw new NetworkError(DATEX_ERROR.NO_RECEIVERS);

            const unique_sid = sid+"-"+(data[2]?.return_index??0); // sid + block index;
            const evaluated_receivers = to ? <Disjunction<Endpoint>> Logical.collapse(to, Target) : null;

            // single block
            if (dxb instanceof ArrayBuffer) {
                return this.datexOutSingleBlock(dxb, evaluated_receivers, sid, unique_sid, <compile_info>data, wait_for_result, encrypt, detailed_result_callback, flood, timeout, socket);
            }

            // multiple blocks
            else {
                const reader = dxb.getReader();
                let next:ReadableStreamReadResult<ArrayBuffer>;
                let end_of_scope = false;
                // read all blocks (before the last block)
                while (true) {
                    next = await reader.read()
                    if (next.done) break;

                    // empty arraybuffer indicates that next block is end_of_scope
                    if (next.value.byteLength == 0) end_of_scope = true;
                    // end_of_scope, now return result for last block (wait_for_result)
                    else if (end_of_scope) return this.datexOutSingleBlock(next.value, evaluated_receivers, sid, unique_sid, <compile_info>data, wait_for_result, encrypt, detailed_result_callback, flood, timeout, socket);
                    // not last block,  wait_for_result = false, no detailed_result_callback
                    else this.datexOutSingleBlock(next.value, evaluated_receivers, sid, unique_sid, <compile_info>data, false, encrypt, null, flood, timeout, socket);
                }
                
            }
        }

        finally {
            finish();
        }
        
    }

    private static async _handleEndpointOffline(endpoint:Endpoint, handler:(err:Error)=>void) {
        if (!await endpoint.isOnline()) {
            handler(new NetworkError("Endpoint " + endpoint + " is offline"))
        }
    }

    // handle sending a single dxb block out
    private static datexOutSingleBlock(dxb:ArrayBuffer, to:Disjunction<Endpoint>, sid:number, unique_sid:string, data:compile_info, wait_for_result=true, encrypt=false, detailed_result_callback:((scope:datex_scope, header:dxb_header, error:Error)=>void)|undefined, flood = false, timeout:number|undefined, socket:CommunicationInterfaceSocket) {
              
        // empty filter?
        if (to?.size == 0) {
            throw new NetworkError("No valid receivers");
        } 

        const finish = this.createDatexSendingTask();

        return new Promise<any>((resolve, reject) => {

            // flood exclude flood_exclude receiver
            if (flood) {
                this.datex_out({
                    dxb,
                    receivers: BROADCAST,
                    socket: socket
                })
                    .then(finish)
                    .catch(e => {
                        if (wait_for_result) reject(e);
                        else logger.debug("Error sending datex block (flood)");
                    });
            }
            // send to receivers
            else if (to) {
                //this.datex_out(dxb, to)?.catch(e=>reject(e));
                // send and catch errors while sending, like NetworkError
                const isSingleReceiver = to.size == 1;
                // check offline status (async), immediately reject if offline
                if (isSingleReceiver && wait_for_result) this._handleEndpointOffline([...to][0], reject)
                // send dxb

                this.datex_out({
                    dxb,
                    receivers: to,
                    socket
                })
                    .then(finish)
                    .catch(e => {
                        if (wait_for_result) reject(e);
                        else logger.debug("Error sending datex block to " + [...to].map(t=>t.toString()).join(", ") + ": " + e.message);
                    });

            }

            // callback for detailed results?
            if (detailed_result_callback) {
                // only one expected response
                if (to.size == 1)
                    this.detailed_result_callbacks_by_sid.set(unique_sid, detailed_result_callback);

                // multiple reponses expected
                else 
                    this.detailed_result_callbacks_by_sid_multi.set(unique_sid, detailed_result_callback);
            }
          

            if (wait_for_result) { // only set callback if required
                let timeoutId = undefined;
                // default timeout
                if (timeout == undefined) timeout = this.OPTIONS.DEFAULT_REQUEST_TIMEOUT;
                if (timeout > 0 && Number.isFinite(timeout)) {
                    timeoutId = setTimeout(()=>{
                        // reject if response wasn't already received (might still be processed, and resolve not yet called)
                        reject(new NetworkError("DATEX request timeout after "+timeout+"ms: " + unique_sid +  " to " + Runtime.valueToDatexString(to)));
                    }, timeout);
                }
                this.callbacks_by_sid.set(unique_sid, [resolve, reject, timeoutId]);
            }
            else resolve(true)
        })
    }

    // evaluate filter
    private static evaluateFilter(filter:target_clause):Set<Target> {
        // TODO!!!
        if (filter instanceof Target) return new Set([filter])
        else if (filter instanceof Set) return <Set<Target>>filter;
        else logger.error("cannot evaluate non-filter", filter);
    }

    /**
     * Redirect a DATEX Binary Message to endpoints as specified in the header.routing.receivers
     * Also decreases the TTL
     * @param datex DATEX Binary
     * @param header header information
     * @param wait_for_result returns the result if set to true
     * @returns result of the redirected DATEX 
     */
    static redirectDatex(datex:ArrayBuffer, header:dxb_header, wait_for_result=true, socket?:CommunicationInterfaceSocket):Promise<any> {
        logger.debug("redirect " + (ProtocolDataType[header.type]) + " " + header.sid + " " + header.sender + " > " + Runtime.valueToDatexString(header.routing.receivers) + ", ttl="+ (header.routing?.ttl));
        return this.datexOut(datex, header.routing.receivers, header.sid, wait_for_result, undefined, undefined, undefined, undefined, socket);
    }

    /**
     * Broadcast DATEX Binary Message
     * @param datex DATEX Binary
     * @param exclude endpoint that should be excluded from the broadcast
     * @param ttl override TTL
     */
    static floodDatex(datex:ArrayBuffer, header:dxb_header, socket?:CommunicationInterfaceSocket) {
        logger.debug("flood " + (ProtocolDataType[header.type]) + " " + header.sid + ", ttl="+ (header.routing?.ttl));
        this.datexOut(datex, undefined, header.sid, false, false, null, true, undefined, socket);
    }

    public static async precompile() {
        // precompile dxb
        this.PRECOMPILED_DXB = {
            SET_PROPERTY:   await PrecompiledDXB.create('?.? = ?'),
            SET_PROPERTY_REF:   await PrecompiledDXB.create('?.? $= ?'),
            SET_WILDCARD:   await PrecompiledDXB.create('?.* = ?'),
            CLEAR_WILDCARD:   await PrecompiledDXB.create('?.* = void'),
            // PROPERTY_ADD:   await PrecompiledDXB.create('? += ?'),
            // PROPERTY_SUB:   await PrecompiledDXB.create('? -= ?'),
            STREAM:         await PrecompiledDXB.create('? << ?'),
        }
    }

    private static ownLastEndpoint?: Endpoint;
    private static lastEndpointUnloadHandler?: EventListener

    static goodbyeMessage?: ArrayBuffer // is set by supranet when connected

    /**
     * Adds endpoint to localStorage active lists
     * Handles beforeunload (sending GOODBYE)
     * @param endpoint 
     */
    static setActiveEndpoint(endpoint:Endpoint) {       

        let endpoints:string[] = [];
        if (client_type == "browser") {
            try {
                endpoints = JSON.parse(localStorage['active_endpoints']) as string[]
            }
            catch {
                localStorage['active_endpoints'] = ""
            }
        }
        
        // remove previous local endpoint
        if (this.ownLastEndpoint && endpoints.includes(this.ownLastEndpoint?.toString())) endpoints.splice(endpoints.indexOf(this.ownLastEndpoint?.toString()), 1);
        
        // remove previous goodbye
        if (this.lastEndpointUnloadHandler) {
            removePersistentListener(globalThis, "beforeunload", this.lastEndpointUnloadHandler)
            this.lastEndpointUnloadHandler = undefined;
        }

        // endpoint already in active list (added from other tab?)
        if (endpoints.includes(endpoint.toString())) {
            logger.warn("Endpoint " + endpoint + " is already active");
        }
        // add endpoint to active list
        else {
            endpoints.push(endpoint.toString())
            this.ownLastEndpoint = endpoint;
            this.lastEndpointUnloadHandler = () => {
                // send goodbye
                if (this.goodbyeMessage) sendDatexViaHTTPChannel(this.goodbyeMessage);
                if (client_type == "browser") {
                    try {
                        // remove from localstorage list
                        endpoints = JSON.parse(localStorage['active_endpoints']) as string[]
                        if (endpoints.includes(endpoint?.toString())) endpoints.splice(endpoints.indexOf(endpoint?.toString()), 1);
                        localStorage['active_endpoints'] = JSON.stringify(endpoints)
                    }
                    catch {
                        localStorage['active_endpoints'] = ""
                    }
                }
            }
            
            // delete endpoint on exit
            addPersistentListener(globalThis, "beforeunload", this.lastEndpointUnloadHandler)
        }

        this.compileGoodByeMessage()

        if (client_type == "browser") localStorage['active_endpoints'] = JSON.stringify(endpoints)

        // update endpoint cookie
        const endpointName = endpoint.toString();
        // TODO: store signed endpoint validation cookie
        if (client_type == "browser") {
            deleteCookie("datex-endpoint-new");
            const currentEndpointName = getCookie("datex-endpoint");
            // only update if endpoint not already set in cookie
            if (currentEndpointName != endpointName) {
                deleteCookie("datex-endpoint-validation");
                setCookie("datex-endpoint", endpointName, endpoint_config.temporary ? 0 : undefined);
                (async() => {
                    const nonceBase64 = getCookie("datex-endpoint-nonce");
                    if (nonceBase64) {
                        const nonce = base64ToArrayBuffer(nonceBase64);
                        setCookie("datex-endpoint-validation", arrayBufferToBase64(await Crypto.sign(nonce)), endpoint_config.temporary ? 0 : undefined);
                    }
                })()
            }  
        }
    }

    /**
     * Compiles GOODBYE message with current endpoint instance as sender
     */
    static async compileGoodByeMessage() {
        this.goodbyeMessage = <ArrayBuffer> await Compiler.compile("", [], {type:ProtocolDataType.GOODBYE, sign:true, flood:true, __routing_ttl:10})
    }

    static getActiveLocalStorageEndpoints() {
        if (client_type == "browser") {
            try {
                const endpoints = JSON.parse(localStorage['active_endpoints']) as string[]
                return endpoints.map((e) => Target.get(e) as Endpoint).filter((e) => e!==this.ownLastEndpoint)
            }
            catch {
                localStorage['active_endpoints'] = ""
                return []
            }
        }
        else return []
    }

    /**
     * Removes all active datex scopes for an endpoint
     */
    public static clearEndpointScopes(endpoint: Endpoint) {
        const removeCount = this.active_datex_scopes.get(endpoint)?.size;
        this.active_datex_scopes.delete(endpoint);
        if (removeCount) logger.debug("removed " + removeCount + " datex scopes for " + endpoint);
    }

    /**
     * Creates default static scopes
     * + other async initializations
     * @param endpoint initial local endpoint
     * @returns 
     */
    public static init(endpoint?:Endpoint) {

        // save all currently active endpoints for shared local storage (multiple tabs)
        if (endpoint && endpoint != LOCAL_ENDPOINT && client_type == "browser") this.setActiveEndpoint(endpoint)


        if (endpoint) Runtime.endpoint = endpoint;

        if (this.initialized) return;
        this.initialized = true;


        // default labels:
        // Pointer.createLabel({
        //     REQUEST:ProtocolDataType.REQUEST,
        //     RESPONSE:ProtocolDataType.RESPONSE,
        //     DATA:ProtocolDataType.DATA,
        //     HELLO:ProtocolDataType.HELLO,
        //     LOCAL:ProtocolDataType.LOCAL,
        //     UPDATE:ProtocolDataType.UPDATE,
        // }, "TYPE");

        // create std static scope
        this.STD_STATIC_SCOPE = {};

        // std.print
        const print = DatexFunction.createFromJSFunction((meta, ...params:any[])=>{
            IOHandler.stdOut(params, meta.sender);
        }, undefined, undefined, undefined, undefined, undefined, new Tuple({v1:Type.std.Any, v2:Type.std.Any, v3:Type.std.Any, v4:Type.std.Any, v5:Type.std.Any, v6:Type.std.Any}), 0)

        // std.printf (formatted output)
        const printf = DatexFunction.createFromJSFunction(async (meta,...params:any[])=>{
            await IOHandler.stdOutF(params, meta.sender);
        }, undefined, undefined, undefined, undefined, undefined, new Tuple({v1:Type.std.Any, v2:Type.std.Any, v3:Type.std.Any, v4:Type.std.Any, v5:Type.std.Any, v6:Type.std.Any}), 0);

        // std.printn (native output)
        const printn = DatexFunction.createFromJSFunction((...params:any[])=>{
            console.log("printn >", ...params);
        }, undefined, undefined, undefined, undefined, undefined, new Tuple({v1:Type.std.Any, v2:Type.std.Any, v3:Type.std.Any, v4:Type.std.Any, v5:Type.std.Any, v6:Type.std.Any}));


        // std.printn (native output)
        const _logger = new Logger("DATEX Script");
        const dx_logger = {
            success: $$((text:string) => {
                _logger.success(text)
            }),
            error: $$((text:string) => {
                _logger.error(text)
            }),
            debug: $$((text:string) => {
                _logger.debug(text)
            }),
            info: $$((text:string) => {
                _logger.info(text)
            }),
            plain: $$((text:string) => {
                _logger.plain(text)
            })
        }

        // std.read
        const read = DatexFunction.createFromJSFunction((meta, msg_start:any="", msg_end:any="")=>{
            return IOHandler.stdIn(msg_start, msg_end, meta.sender);
        }, undefined, undefined, undefined, undefined, undefined, new Tuple({msg_start:Type.std.text, msg_end:Type.std.text}), 0);

        // std.sleep
        const sleep = DatexFunction.createFromJSFunction((time_ms:bigint)=>{
            return new Promise<void>(resolve=>setTimeout(()=>resolve(), Number(time_ms)));
        });

        // std.localtext
        const localtext = DatexFunction.createFromJSFunction((local_map:{[lang: string]: string})=>{
            return Runtime.getLocalString(local_map);
        });


        this.STD_STATIC_SCOPE['print']      = static_pointer(print, LOCAL_ENDPOINT, 0xaa00, "$std_print");
        this.STD_STATIC_SCOPE['printf']     = static_pointer(printf, LOCAL_ENDPOINT, 0xaa01, "$std_printf");
        this.STD_STATIC_SCOPE['printn']     = static_pointer(printn, LOCAL_ENDPOINT, 0xaa02, "$std_printn");
        this.STD_STATIC_SCOPE['read']       = static_pointer(read, LOCAL_ENDPOINT, 0xaa03, "$std_read");
        this.STD_STATIC_SCOPE['sleep']      = static_pointer(sleep, LOCAL_ENDPOINT, 0xaa04, "$std_sleep");
        this.STD_STATIC_SCOPE['logger']     = static_pointer(dx_logger, LOCAL_ENDPOINT, 0xaa05, "$std_dx_logger");
        this.STD_STATIC_SCOPE['localtext']  = static_pointer(localtext, LOCAL_ENDPOINT, 0xaa06, "$std_localtext");
    
        // std.types 
        // try to get from cdn.unyt.org
        // try {
        //     this.STD_TYPES_ABOUT = await Runtime.getURLContent('https://cdn.unyt.org/unyt_core/dx_data/type_info.dx')
        // }
        // // otherwise try to get local file (only backend)
        // catch {
        //     this.STD_TYPES_ABOUT = await Runtime.getURLContent(new URL('../dx_data/type_info.dx', import.meta.url));
        // }

        DatexObject.setWritePermission(<Record<string|symbol,unknown>>this.STD_STATIC_SCOPE, undefined); // make readonly
        DatexObject.seal(this.STD_STATIC_SCOPE);


        // logger.success("Initialized <std:> library")
    }



    /**
     * Formats a variable name (converts integer to hex string)
     * @param name variable name / id
     * @param prefix variable prefix (e.g. '#')
     * @returns formatted name
     */
    public static formatVariableName(name:string|number, prefix:string) {
        return prefix + (typeof name == "number" ? name.toString(16) : name)
    }


    private static getAbout(type:Type):Markdown|undefined {
        if (type instanceof Type) return type.about;
        else return VOID;
    }

    /**
     * Splits the bits of a byte into multiple values
     * @param bit_distribution sizes for each part of the byte, must add up to 8 (e.g. [2,2,2,2])
     * @param byte the byte as a number
     * @returns array containing the separate byte parts
     */    
    public static convertByteToNumbers(bit_distribution:number[], byte:number):number[] {
        const byte_str = byte.toString(2).padStart(8, '0');
        const nrs = [];
        let pos = 0;
        for (const size of bit_distribution) {
            nrs.push(parseInt(byte_str.slice(pos, pos+size), 2));
            pos += size;
        }
        return nrs;
    }
    
    
    // parseHeader, synchronous Part
    public static parseHeaderSynchronousPart(dxb:ArrayBuffer):[dxb_header, Uint8Array, Uint8Array, number, Uint8Array, ArrayBuffer] {
        const header_data_view = new DataView(dxb);
        const header_uint8     = new Uint8Array(dxb); 

        if (header_uint8[0] !== 0x01 || header_uint8[1] !== 0x64) {
            throw new SecurityError("DXB Format not recognized")
        }

        if (dxb.byteLength<4) throw new SecurityError("DXB Block must be at least 4 bytes")

        const header:dxb_header = {};
        const routing_info:routing_info = {}

        // version
        header.version = header_uint8[2];

        const VERSION_2 = header.version == 2;
        if (VERSION_2) console.log("using header v.2");

        let i = 3;

        const block_size = header_data_view.getUint16(i, true);
        i += Int16Array.BYTES_PER_ELEMENT;

        // ROUTING HEADER /////////////////////////////////////////////////
        routing_info.ttl = header_uint8[i++];
        routing_info.prio = header_uint8[i++];

        const signed_encrypted = header_uint8[i++];
        header.signed = signed_encrypted == 1 || signed_encrypted == 2; // is signed?
        header.encrypted = signed_encrypted == 2 || signed_encrypted == 3; // is encrypted?

        header.routing = routing_info;

        // sender
        const last_index:[number] = [0];
        routing_info.sender = header.sender = VERSION_2 ? Compiler.extractHeaderSenderV2(header_uint8, last_index) : Compiler.extractHeaderSender(header_uint8, last_index);
        i = last_index[0];
       
        
        let receiver_size = header_data_view.getUint16(i, true);
        i += Uint16Array.BYTES_PER_ELEMENT;

        let encrypted_key:ArrayBuffer;

        // indicates flooding
        if (receiver_size == MAX_UINT_16) {
            routing_info.flood = true;
        }
        else if (receiver_size!=0) {
            // receivers

            let type = header_uint8[i++];

            // is pointer
            if (type == 1) {
                const id_buffer = header_uint8.subarray(i, i+=Pointer.MAX_POINTER_ID_SIZE);
                const target = Pointer.get(id_buffer)?.val;
                if (!target) throw new ValueError("Receiver filter pointer not found (TODO request)")
                if (!(target instanceof Target || target instanceof Logical || target instanceof Array || target instanceof Set)) throw new ValueError("Receiver filter pointer is not a filter")
                else {
                    console.log("Pointer TARGET", target)
                    routing_info.receivers = <target_clause>target;
                }
               
            }

            // filter target
            else {     
                let targets = new Disjunction<Endpoint>();

                let targets_nr = header_data_view.getInt16(i, true)
                i += Int16Array.BYTES_PER_ELEMENT;

                for (let t = 0; t<targets_nr; t++) {
                    let type = header_uint8[i++]; // get endpoint type
                    let name_length = header_uint8[i++]; // get name length
                    let subspace_number = header_uint8[i++]; // get subspace number
                    let instance_length = header_uint8[i++]; // get instance length
        
                    let name_binary = header_uint8.subarray(i, i+=name_length);
                    let name = type == BinaryCode.ENDPOINT ? name_binary : Runtime.utf8_decoder.decode(name_binary)  // get name
        
                    let subspaces = [];
                    for (let n=0; n<subspace_number; n++) {
                        let length = header_uint8[i++];
                        let subspace_name = Runtime.utf8_decoder.decode(header_uint8.subarray(i, i+=length));
                        subspaces.push(subspace_name);
                    }
        
                    let instance = Runtime.utf8_decoder.decode(header_uint8.subarray(i, i+=instance_length))  // get instance
    
                    const target = <Endpoint> Target.get(name, instance, type);

                    targets.add(target)
    
                    // get attached symmetric key?
                    let has_key = header_uint8[i++];
    
                    if (has_key) {
                        // add to keys
                        if (this.endpoint.equals(<Endpoint>target)) encrypted_key = header_uint8.slice(i, i+512);
                        i += 512;
                    }
                }
                routing_info.receivers = targets;
                
            }

        }
        

        ///////////////////////////////////////////////////////////////////

        let signature_start = i;
        if (header.signed) i += Compiler.signature_size; // has signature?

        // always get the following values: /////////////
        
        // sid 
        header.sid = header_data_view.getUint32(i, true);
        i+=Uint32Array.BYTES_PER_ELEMENT;

        // block index
        header.return_index = header_data_view.getUint16(i, true);
        i+=Uint16Array.BYTES_PER_ELEMENT;

        header.inc = header_data_view.getUint16(i, true);
        i+=Uint16Array.BYTES_PER_ELEMENT;

        // now save symmetric key
    
        // foreign endpoint (if receiver not self or force eating this response) //////////
        // handle result
        // TODO better check for && !routing_info.receivers.equals(Runtime.endpoint)
        if (
            routing_info.receivers && // has receivers
            // not for local endpoint:
            !(
                routing_info.receivers instanceof Disjunction && 
                routing_info.receivers.size == 1 && // single receiver
                (
                    Runtime.endpoint.equals([...routing_info.receivers][0]) || // endpoint instance equals receiver
                    Runtime.endpoint.main.equals([...routing_info.receivers][0]) || // endpoint main equals receiver
                    [...routing_info.receivers][0] == LOCAL_ENDPOINT // receiver is @@local
                )
            )
        ) {
            header.redirect = true;
        }
        ///////////////////////////////////////////////////////////////////



        // type
        header.type = header_uint8[i++];

        // get additional meta data (header data)

        // flags
        let [_, executable, end_of_scope, device_type] =
            this.convertByteToNumbers([1,1,1,5], header_uint8[i++]);
        header.executable = executable ? true : false;
        header.end_of_scope = end_of_scope ? true : false;
        
        if (header.version == 2) console.log("header:",header);

        // timestamp
        header.timestamp = new Date(Number(header_data_view.getBigUint64(i, true)) + Compiler.BIG_BANG_TIME);
        i+=BigUint64Array.BYTES_PER_ELEMENT;

        // iv if encrypted
        let iv:Uint8Array;
        if (header.encrypted) {
            iv = header_uint8.slice(i, i+16);
            i+=16;
        }
        
        
        // extract buffers
        let header_buffer = header_uint8.slice(0, i);
        let data_buffer = header_uint8.slice(i);

        return [header, data_buffer, header_buffer, signature_start, iv, encrypted_key] 
    }

    // returns header info and dxb body, or routing information if not directed to own endpoint
    static async parseHeader(dxb:ArrayBuffer, force_sym_enc_key?:CryptoKey, force_only_header_info = false, force_no_redirect = false):Promise<[dxb_header, Uint8Array, Uint8Array, Uint8Array]|dxb_header> {

        const res = this.parseHeaderSynchronousPart(dxb);

        let header: dxb_header,
            data_buffer:Uint8Array, 
            header_buffer:Uint8Array, 
            signature_start:number, 
            iv: Uint8Array,
            encrypted_key: ArrayBuffer;

        // no redirect
        if ((!res[0].redirect && !force_only_header_info) || force_no_redirect) {
            [header, data_buffer, header_buffer, signature_start, iv, encrypted_key] = res;

            try {
                // save encrypted key?
                if (encrypted_key) {
                    const sym_enc_key = await Crypto.extractEncryptedKey(encrypted_key);
                    await this.setScopeSymmetricKeyForSender(header.sid, header.sender, sym_enc_key)
                }

                // get signature
                if (header.signed) {
                    if (!header.sender) throw new SecurityError("Signed DATEX without a sender");
                    let j = signature_start;
                    const signature = header_buffer.subarray(j, j + Compiler.signature_size);
                    const content = new Uint8Array(dxb).subarray(j + Compiler.signature_size);
                    j += Compiler.signature_size;
                    const valid = await Crypto.verify(content, signature, header.sender);

                    if (!valid) {
                        logger.error("Invalid signature from " + header.sender);
                        throw new SecurityError("Invalid signature from " + header.sender);
                    }
                }

                // decrypt

                if (header.encrypted) {
                    if (!iv) throw new SecurityError("DATEX not correctly encrypted");
                    // try to decrypt body
                    data_buffer = new Uint8Array(await Crypto.decryptSymmetric(data_buffer.buffer, force_sym_enc_key ?? await this.getScopeSymmetricKeyForSender(header.sid, header.sender), iv));
                }
                    
                // header data , body buffer, header buffer, original (encrypted) body buffer
                return [header, data_buffer, header_buffer, res[1]];
            }
            catch (e) {
                throw [header, e];
            }

        }

        // only return header (for redirect)
        else return res[0];

    }



    static active_datex_scopes = new Map<Target, Map<number, {next:number, scope?:datex_scope, active:Map<number, [dxb_header, ArrayBuffer, ArrayBuffer]>}>>();

    public static datexIn(data: DatexInData) {
        if (data.dxb instanceof ArrayBuffer) return this.handleDatexIn(data.dxb, undefined, undefined, undefined, data.socket); 
        else if (data.dxb instanceof ReadableStreamDefaultReader) {
            throw new Error("Continuos DATEX block input streams are not supported yet")
            // return this.handleContinuousBlockStream(data.dxb, undefined, undefined, undefined, data.socket)
        }
        else throw new Error("Invalid data for datexIn")
    }


    // extract dxb blocks from a continuos stream
    private static async handleContinuousBlockStream(dxb_stream_reader: ReadableStreamDefaultReader<Uint8Array>, full_scope_callback, variables?:any, header_callback?:(header:dxb_header)=>void, socket?:CommunicationInterfaceSocket) {
        
        let current_block: Uint8Array;
        let current_block_size: number
        let new_block = new Uint8Array(4);
        let overflow_block: Uint8Array;

        let index = 0;
        let timeout;

        const newValue = (value:Uint8Array) => {

            // reset after some time
            /*clearTimeout(timeout);
            timeout = setTimeout(()=>{
                console.log("reset dxb stream after timeout")
                current_block = null; 
                overflow_block = null;
                index = 0;
            }, 6000)*/

            // insert overflow data
            if (overflow_block) {
                const _overflow_block = overflow_block;
                overflow_block = null;
                newValue(_overflow_block);
            }

            if (current_block) {
                // too big for current_block
                if (index+value.byteLength > current_block_size) {
                    current_block.set(value.subarray(0,current_block_size-index), index);
                    overflow_block = value.subarray(current_block_size-index);
                }
                else current_block.set(value, index);
            }
            else {
                // too big for new_block
                if (index+value.byteLength > 4) {
                    new_block.set(value.subarray(0,4-index), index);
                    overflow_block = value.subarray(4-index);
                }
                else new_block.set(value, index);
            }

            index += value.byteLength;

            // block start and size is available
            if (!current_block && index >= 4) {
                // check magic number and block size
                if (!(new_block[0] == 0x01 && new_block[1] == 0x64)) {
                    logger.error("DXB Format not recognized in block stream");
                    // try again
                    overflow_block = null;
                    index = 0;
                }
                else {
                    // get Uint16 block size and create new buffer
                    current_block_size = new_block[2]*256+new_block[3];
                    current_block = new Uint8Array(current_block_size);
                    current_block.set(new_block); // copy first header part into new block  
                    index = 4; // force to 4
                }
            }

            // block end
            if (current_block && index >= current_block_size) {
                console.log("received new block from stream")
                this.handleDatexIn(current_block.buffer, full_scope_callback, variables, header_callback, socket)
                    .catch(e=>console.error("Error handling block stream: ", e)) 
                // reset for next block
                current_block = null; 
                index = 0; // force to 0
            }
        }

        try {
            while (true) {
                const { value, done } = await dxb_stream_reader.read();
                if (done) {
                    logger.error("reader has been cancelled")
                    break;
                }
                newValue(value);
            }
        } catch (error) {
            logger.error("disconnected: " + error)
        } finally {
            dxb_stream_reader.releaseLock();
        }
        
    }

    // simple scope execution, no callbacks, multi block scopes, return global or throw error
    public static async simpleScopeExecution(scope:datex_scope) {
        // run scope, result is saved in 'scope' object
        await this.run(scope);
        return Ref.collapseValue(scope.result);
    }

    static #cryptoProxies = new Map<Endpoint, [signKey:CryptoKey, decKey:CryptoKey]>()

    public static enableCryptoProxy(proxiedEndpoint: Endpoint, keys: [signKey:CryptoKey, decKey:CryptoKey]) {
        logger.success("enabling crypto proxy for " + proxiedEndpoint)
        this.#cryptoProxies.set(proxiedEndpoint, keys)
    }


    // keep track of last received messages endpoint:sid:inc:returnindex
    private static receivedMessagesHistory:string[] = []

    private static async checkDuplicate(header: dxb_header) {
        const identifier = `${header.type}:${header.sender}:${header.sid}:${header.inc}:${header.return_index}:${await Compiler.getValueHashString(header.routing?.receivers)}`;
        let isDuplicate = false;
        // is duplicate
        if (this.receivedMessagesHistory.includes(identifier)) {
            // console.debug("duplicate " + identifier, header.type);
            isDuplicate = true;
        }

        // add to history
        this.receivedMessagesHistory.push(identifier);
        
        // remove after 20s
        setTimeout(()=> {
            this.receivedMessagesHistory.shift();
        }, 20_000)

        return isDuplicate;
    }

    /**
     * Updates the online state of the sender endpoint of an incoming DXB message
     * @param header DXB header of incoming message
     */
    private static updateEndpointOnlineState(header: dxb_header) {
        if (!header) {
            logger.error("updateEndpointOnlineState: no header provided");
            return;
        }
        if (header.sender) {
            // received signed GOODBYE message -> endpoint is offline
            if (header.type == ProtocolDataType.GOODBYE) {
                if (header.signed) {
                    logger.debug("GOODBYE from " + header.sender)
                    header.sender.setOnline(false)
                    Pointer.clearEndpointSubscriptions(header.sender)
                    Pointer.clearEndpointPermissions(header.sender)
                    this.clearEndpointScopes(header.sender);
                }
                else {
                    logger.error("ignoring unsigned GOODBYE message")
                }
            }
            // other message, assume sender endpoint is online now
            else {
                // TODO: HELLO message received, regard as new login to network, reset previous subscriptions? 
                // does not work correctly because valid subscriptions are reset after HELLO message is received after some time
                // if (header.type == ProtocolDataType.HELLO && !header.sender.ignoreHello) Pointer.clearEndpointSubscriptions(header.sender)
                header.sender.setOnline(true)
            }
        }
    }

    /**
     * handle incoming DATEX Binary
     * @param dxb DATEX Binary Message
     * @param full_scope_callback returns the scope result, error and sid after the dxb was evaluated
     * @param header_callback callback method returning information for the evaluated header before executing the dxb
     * @returns header information (after executing the dxb)
     */
    private static async handleDatexIn(dxb:ArrayBuffer, full_scope_callback:((sid:number, scope:any, error?:boolean)=>void)|undefined, _:any|undefined, header_callback:((header:dxb_header)=>void)|undefined, socket: CommunicationInterfaceSocket): Promise<dxb_header> {

        let header:dxb_header, data_uint8:Uint8Array;

        let res:dxb_header|[dxb_header, Uint8Array, Uint8Array, Uint8Array];
        try {
            res = await this.parseHeader(dxb);
        }
        catch (e) {
            // e is [dxb_header, Error]
            //throw e
            const header = e[0];
            if (header) {
                this.handleScopeError(header, e[1]);
                this.updateEndpointOnlineState(header);
                console.error(e[1]??e)

                return header;
            }
            throw e;
        }
        

        // normal request
        if (res instanceof Array) {

            [header, data_uint8] = res;

            if (await this.checkDuplicate(header)) return header;

            this.updateEndpointOnlineState(header);

            // + flood, exclude last_endpoint - don't send back in flooding tree
            if (header.routing && header.routing.flood) {
                this.floodDatex(dxb, header, socket);
            }

            // callback for header info
            if (header_callback instanceof globalThis.Function) header_callback(header);

            // assume sender endpoint is online now  
            if (header.sender) header.sender.setOnline(true);

            if (header.type !== ProtocolDataType.GOODBYE && header.type !== ProtocolDataType.HELLO && header.sender && header.signed) {
                await Crypto.activateEndpoint(header.sender)
            }

            if (header.type === ProtocolDataType.GOODBYE && header.sender && !Crypto.public_keys.has(header.sender.main)) {
                console.log("ignoring GOODBYE from " + header.sender);
                return header;
            }
        }

        // needs to be redirected 
        else {

            if (await this.checkDuplicate(res)) return res;

            // redirect as crypto proxy: sign
            if (res.sender && this.#cryptoProxies.has(res.sender)) {
                // TODO#CryptoProxy: sign
                const signKey = this.#cryptoProxies.get(res.sender)![0]
                console.log("TODO: handle proxy sign for " + res.sender)
            }

            // propagate TRACE message
            try {
                const to = [...(res.routing?.receivers??[])][0];
                if (res.type == ProtocolDataType.TRACE || res.type == ProtocolDataType.TRACE_BACK) {
                    const trace = await this.executeDXBLocally(dxb, undefined, undefined, true);
                    if (to instanceof Endpoint && trace instanceof Array) {
                        let destinationReached = false;
                        let localHops = 0;
                        
                        for (const entry of trace) {
                            if (entry.endpoint === to || entry.endpoint.main === to) {
                                destinationReached = true;
                            }
                            if (entry.endpoint === Runtime.endpoint) localHops++;
                            
                            if ((destinationReached && localHops>2) || (!destinationReached && localHops>1)) {
                                console.error(trace);
                                throw new Error("Circular " + ProtocolDataTypesMap[res.type])
                            }
                        }
                        try {
                            await to.trace({header: res, socket, trace})
                        }
                        catch {}
                        return {};
                    }
                    else {
                        logger.error("Invalid TRACE message")
                    }
                }
                
                await this.redirectDatex(dxb, res, false, socket);
            }
            catch (e) {
                console.log("redirect failed", e)
            }

            // callback for header info
            if (header_callback instanceof globalThis.Function) header_callback(res);
            return res;
        }

        // if (header.type == ProtocolDataType.TRACE_BACK) {
        //     debugger;
        //     console.warn("TRACE_BACK from " + header.sender);
        // }

        const data = data_uint8.buffer; // get array buffer

        // create map for this sender
        if (!this.active_datex_scopes.has(header.sender)) {
            if (header.end_of_scope) {} // is new scope and immediately closed
            else this.active_datex_scopes.set(header.sender, new Map());
        }
        // modified sid: negative for own responses to differentiate
        const sid = (Runtime.endpoint.equals(header.sender) || Runtime.endpoint.main.equals(header.sender)) && header.type == ProtocolDataType.RESPONSE ? -header.sid : header.sid;
        // create map for this sid if not yet created
        const sender_map = this.active_datex_scopes.get(header.sender);
        if (sender_map && !sender_map.has(sid)) {
            sender_map.set(sid, {next:0, active:new Map()});
        }
        const scope_map = sender_map?.get(sid);


        // this is the next block or the only block (immediately closed)
        if (!scope_map || (scope_map.next == header.inc)) {


            // get existing scope or create new
            const scope = scope_map?.scope ?? this.createNewInitialScope(header);
            scope.socket = socket;

            // those values can change later in the while loop
            let _header = header;
            let _data = data;
            let _dxb = dxb;

            // inform that response was received (still processing)
            const unique_sid = header.sid+"-"+header.return_index;
            const callbacks = this.callbacks_by_sid.get(unique_sid);
            if (callbacks) {
                // clear response received timeout
                if (callbacks[2] != undefined) clearTimeout(callbacks[2])
            }

            // parse current block and try if blocks with higher ids exist
            do {
                let has_error = false;
                try {
                    // update scope buffers
                    this.updateScope(scope, _data, _header) // set new _data (datex body) and _header (header information)
                    // run scope, result is saved in 'scope' object
                    await this.run(scope);
                }
                // catch global errors
                catch (e) {
                    // return full dxb
                    if (full_scope_callback && typeof full_scope_callback == "function") {
                        full_scope_callback(sid, e, true);
                    }

                    //logger.error("scope error", e);
                    this.handleScopeError(_header, e, scope);
                    has_error = true;
                }

                // end reached (end of scope or 'end' command in scope)
                if (_header.end_of_scope || scope.closed) {

                    // save persistent memory
                    if (scope.persistent_vars) {
                        const identifier = scope.context_location.toString()
                        for (const name of scope.persistent_vars) Runtime.saveScopeMemoryValue(identifier, name, scope.internal_vars[name]);
                    }

                    // cleanup
                    sender_map?.delete(sid);
                    this.removeScopeSymmetricKeyForSender(sid, _header.sender);
                    
                    // handle result normal
                    if (!has_error) {
                        // return full dxb
                        if (full_scope_callback && typeof full_scope_callback == "function") {
                            full_scope_callback(sid, scope);
                        }

                        // handle result
                        await this.handleScopeResult(_header, scope, scope.result)
                    }
    
                    break;
                }

                else {
                    scope_map.next++; // increase index counter
                    if (scope_map.next > Compiler.MAX_BLOCK) scope_map.next = 0; // index overflow, reset to 0
                    if (!scope_map.scope) scope_map.scope = scope; // save scope

                    // check for waiting block with next index
                    if (scope_map.active.has(scope_map.next)) {
                        [_header, _data, _dxb] = scope_map.active.get(scope_map.next);
                    }
                    else break; // currently no waiting block
                    
                }

            } while(true)

        }

        // has to wait for another block first
        else {
            // should not happen, scope_map.next can't already be higher, because it would have required this block
            // possible reason: this block was already sent earlier
            if (scope_map.next > header.inc) {
                logger.error("invalid scope inc, lower than next required number")
            }
            // block not yet required, wait
            else {
                scope_map.active.set(header.inc, [header, data, dxb]);
            }
        }
    
        return header
    }

    private static handleScopeDebuggerSession(scope:datex_scope) {

        const header = scope.header;

        const deb = new Debugger();


        this.datexOut(["?", [deb], {type:ProtocolDataType.DEBUGGER, to:header.sender, return_index:header.return_index, sign:header.signed}], header.sender,  header.sid, false);

    }


    private static handleScopeError(header:dxb_header, e: any, scope?:datex_scope) {

        if (header?.type == undefined) {
            console.log("Scope error occured, cannot get the original error here!");
            return;
        }

        // return error to sender (if request)
        if (header.type == ProtocolDataType.REQUEST) {
            // is not a DatexError -> convert to DatexError
            if (e instanceof globalThis.Error && !(e instanceof DatexError)) {
                e = DatexError.fromJSError(e);
                if (scope) e.addScopeToStack(scope);
            }
            this.datexOut(["yeet ?", [e], {type:ProtocolDataType.RESPONSE, to:header.sender, return_index:header.return_index, sign:header.signed}], header.sender, header.sid, false);
        }
        else if (
            header.type == ProtocolDataType.RESPONSE || 
            header.type == ProtocolDataType.DATA ||
            header.type == ProtocolDataType.TRACE_BACK ||
            header.type == ProtocolDataType.LOCAL) 
        {
            const unique_sid = header.sid+"-"+header.return_index;

            // handle result
            if (this.callbacks_by_sid.has(unique_sid)) {
                this.callbacks_by_sid.get(unique_sid)![1](e, true);
                this.callbacks_by_sid.delete(unique_sid);
            }
            if (this.detailed_result_callbacks_by_sid.has(unique_sid)) {
                this.detailed_result_callbacks_by_sid.get(unique_sid)!(scope, header, e);
                this.detailed_result_callbacks_by_sid.delete(unique_sid)
            }
            else if (this.detailed_result_callbacks_by_sid_multi.has(unique_sid)) {
                this.detailed_result_callbacks_by_sid_multi.get(unique_sid)!(scope, header, e);
            }

        }
        else if (header.type == ProtocolDataType.UPDATE) {
            // ignore
        }
        else if (header.type == ProtocolDataType.GOODBYE) {
            console.error("Error in GOODBYE message:",e)
        }
        else {
            logger.error("Invalid proctocol data type: " + ProtocolDataTypesMap[header.type]??header.type)
        }

    }

    private static async handleScopeResult(header:dxb_header, scope: datex_scope, return_value:any, source?: Source){
        
        const unique_sid = header.sid+"-"+header.return_index;
        
        // return global result to sender (if request)
        if (header.type == ProtocolDataType.REQUEST) {
            this.datexOut(["?", [return_value], {type:ProtocolDataType.RESPONSE, to:header.sender, return_index:header.return_index, encrypt:header.encrypted, sign:header.signed}], header.sender, header.sid, false);
        }

        // handle response
        else if (header.type == ProtocolDataType.RESPONSE ||
            header.type == ProtocolDataType.DATA ||
            header.type == ProtocolDataType.TRACE_BACK ||
            header.type == ProtocolDataType.LOCAL)
        {

            if (header.type == ProtocolDataType.TRACE_BACK) {
                const traceStack = return_value as trace[]
                traceStack.push({endpoint:Runtime.endpoint, socket: {type: scope.socket?.interfaceProperties?.type??"unknown", name: scope.socket?.interfaceProperties?.name}, timestamp: new Date()});
            }

            // handle result
            if (this.callbacks_by_sid.has(unique_sid)) {
                this.callbacks_by_sid.get(unique_sid)![0](return_value);      
                this.callbacks_by_sid.delete(unique_sid)                     
            }
            if (this.detailed_result_callbacks_by_sid.has(unique_sid)) {
                this.detailed_result_callbacks_by_sid.get(unique_sid)!(scope, header);
                this.detailed_result_callbacks_by_sid.delete(unique_sid)
            }
            else if (this.detailed_result_callbacks_by_sid_multi.has(unique_sid)) {
                this.detailed_result_callbacks_by_sid_multi.get(unique_sid)!(scope, header);
            }
            
        }

        // // bc transaction
        // else if (header.type == ProtocolDataType.BC_TRNSCT) {
        //     console.log("bc transaction");
        // }

        // hello (also temp: get public keys)
        else if (header.type == ProtocolDataType.HELLO) {
            if (!header.sender) logger.error("Invalid HELLO message, no sender");
            else if (return_value) {
                try {
                    const keys_updated = await Crypto.bindKeys(header.sender, ...<[ArrayBuffer,ArrayBuffer]>return_value);
                    if (header.routing?.ttl)
                        header.routing.ttl--;
                    
                    logger.debug("HELLO ("+header.sid+"/" + header.inc+ "/" + header.return_index + ") from " + header.sender +  ", keys "+(keys_updated?"":"not ")+"updated, ttl = " + header.routing?.ttl);
                }
                catch (e) {
                    logger.error("Invalid HELLO keys");
                }
            }
            else {
                logger.debug("HELLO from " + header.sender +  ", no keys, ttl = " + header.routing?.ttl);
            }
        }

        else if (header.type == ProtocolDataType.GOODBYE) {
            
        }

        else if (header.type == ProtocolDataType.TRACE) {
            const sender = return_value[0].endpoint;
            const traceStack  = return_value as trace[];
            traceStack.push({endpoint:Runtime.endpoint, destReached:true, socket: {type: scope.socket?.interfaceProperties?.type??"unknown", name: scope.socket?.interfaceProperties?.name}, timestamp: new Date()});
            console.log("TRACE request from " + sender);

            this.datexOut(["?", [traceStack], {type:ProtocolDataType.TRACE_BACK, to:sender, return_index:header.return_index, encrypt:header.encrypted, sign:header.signed}], sender, header.sid, false);
        }
        
        else if (header.type == ProtocolDataType.DEBUGGER) {
            logger.success("DEBUGGER ?", return_value)
        }

        else if (header.type == ProtocolDataType.UPDATE) {
            // ignore
        }

        else {
            logger.error("Invalid proctocol data type: " + ProtocolDataTypesMap[header.type]??header.type)
        }
        // global scope output (e.g. for displaying binary data or scope metadata)
        IOHandler.handleScopeFinished(header.sid, scope);

    }

    // Persistant Scope Memory
    static persistent_memory:AutoMap<string,{[key:number|string]:any}>;

    static saveScopeMemoryValue(scope_identifier:string, key:string|number, value: any) {
        logger.debug("saving persistent memory location ? for ?: ?", key, scope_identifier, value)
        if (this.persistent_memory) this.persistent_memory.getAuto(scope_identifier)[key] = value;
        else logger.error("persistent memory was not initialized");
    }

    static getScopeMemory(scope_identifier:string) {
        return this.persistent_memory?.get(scope_identifier)
    }

    /** casts an object, handles all <std:*> types */
    public static async castValue(type:Type, value:any, context?:any, context_location?:URL, origin:Endpoint = Runtime.endpoint, no_fetch?:boolean, assigningPtrId?: string): Promise<any> {
        
        let old_type = Type.ofValue(value);
        let old_value = value instanceof UnresolvedValue ? value[DX_VALUE] : value;
        // already the right type
        if (old_type == type) return old_value;
        
        let new_value:any = UNKNOWN_TYPE;

        // only handle std namespace / js:Object / js:Symbol
        if (type.namespace == "std" || type == Type.js.NativeObject || type == Type.js.Symbol || type == Type.js.RegExp || type == Type.js.MediaStream) {
            const uncollapsed_old_value = old_value
            if (old_value instanceof Pointer) old_value = old_value.val;

            // handle default casts
            switch (type) {

                // get <Type>
                case Type.std.Type:{
                    new_value = old_type;
                    break;
                }

                case Type.std.void: {
                    new_value = VOID;
                    break;
                }

                case Type.std.null: {
                    new_value = null;
                    break;
                }

                case Type.std.text: {
                    if (old_value === VOID) new_value = globalThis.String()
                    else if (old_value instanceof Markdown) new_value = old_value.toString();
                    else if (old_value instanceof ArrayBuffer) new_value = Runtime.utf8_decoder.decode(old_value); // cast to <text>
                    else if (old_value instanceof Blob) new_value = await old_value.text()
                    else new_value = this.valueToDatexString(value, false, true); 
                    break;
                }
                case Type.std.decimal: {
                    if (old_value === VOID) new_value = Number()
                    else if (old_value==null) new_value =  0;
                    else if (typeof old_value == "string" || typeof old_value == "boolean" || typeof old_value == "bigint"){
                        new_value = Number(old_value);
                        if (isNaN(new_value)) throw new ValueError("Failed to convert "+ old_type +" to "+type);
                    }
                    break;
                }
                case Type.std.integer: {
                    if (old_value === VOID) new_value = this.OPTIONS.USE_BIGINTS ? 0n : 0;
                    else if (typeof old_value == "number") new_value = Runtime.OPTIONS.USE_BIGINTS ?  BigInt(Math.floor(old_value)) : Math.floor(old_value);
                    else if (old_value==null) new_value = this.OPTIONS.USE_BIGINTS ? 0n : 0;
                    else if (typeof old_value == "string" || typeof old_value == "boolean" || typeof old_value == "bigint"){
                        new_value = Math.floor(Number(old_value));
                        if (isNaN(new_value)) throw new ValueError("Failed to convert "+ old_type+" to "+type);
                        if (Runtime.OPTIONS.USE_BIGINTS) new_value = BigInt(new_value);
                    }
                    else new_value = INVALID;
                    break;
                }
                case Type.std.boolean: {
                    if (old_value === VOID) new_value = globalThis.Boolean();
                    new_value = !!old_value;
                    break;
                }
                case Type.std.endpoint: {
                    if (typeof old_value=="string") new_value = await Endpoint.fromStringAsync(old_value)
                    else new_value = INVALID;
                    break;
                }
                case Type.std.target: {
                    if (typeof old_value=="string") new_value = Target.get(old_value);
                    else new_value = INVALID;
                    break;
                }
                case Type.std.Object: {
                    if (old_value === VOID) new_value = Object();
                    else if (old_value instanceof Tuple) new_value = old_value.toObject();
                    else if (old_value && typeof old_value == "object") new_value = {...<object>Runtime.serializeValue(old_value)??{}};
                    else new_value = INVALID;
                    break;
                }
                case Type.js.NativeObject: {
                    if (old_value === VOID) new_value = Object();
                    else if (old_value instanceof Tuple) new_value = old_value.toObject();
                    else if (old_value && typeof old_value == "object") new_value = {...<object>Runtime.serializeValue(old_value)??{}};
                    else new_value = INVALID;
                    break;
                }
                case Type.js.Symbol: {
                    if (old_value === VOID) new_value = Symbol();
                    else if (typeof old_value == "string") new_value = Symbol(old_value);
                    else new_value = INVALID;
                    break;
                }
                case Type.js.RegExp: {
                    if (typeof old_value == "string") new_value = new RegExp(old_value);
                    else if (old_value instanceof Tuple) {
                        const array = old_value.toArray() as [string, string?];
                        new_value = new RegExp(...array);
                    }
                    else if (old_value instanceof Array) {
                        new_value = new RegExp(...old_value as [string, string?]);
                    }
                    else new_value = INVALID;
                    break;
                }
                case Type.js.MediaStream: {
                    if (!globalThis.MediaStream) throw new Error("MediaStreams are not supported on this endpoint")
                    if (old_value === VOID || typeof old_value == "object") {
                        if (assigningPtrId) {
                            const {WebRTCInterface} = await import("../network/communication-interfaces/webrtc-interface.ts")
                            new_value = await WebRTCInterface.getMediaStream(assigningPtrId)
                        } 
                        else new_value = new MediaStream();
                    }
                    else new_value = INVALID;
                    break;
                }
                case Type.std.Tuple: {
                    if (old_value === VOID) new_value = new Tuple().seal();
                    else if (old_value instanceof Array){
                        new_value = new Tuple(old_value).seal();
                    }
                    else if (old_value instanceof Set) {
                        new_value = new Tuple(old_value).seal();
                    }
                    else if (old_value instanceof Map){
                        new_value = new Tuple(old_value.entries()).seal();
                    }
                    else if (old_value instanceof Iterator){
                        new_value = await old_value.collapse()
                    }
                    else new_value = new Tuple([old_value]).seal();
                    break;
                }
                

                case Type.std.Array: {
                    if (old_value === VOID) new_value = [];
                    else if (old_value instanceof Tuple) new_value = old_value.toArray();
                    else if (old_value instanceof Set) new_value = [...old_value];
                    else if (old_value instanceof Map) new_value = [...old_value.entries()];
                    else if (old_value instanceof ArrayBuffer) new_value = [...new Uint8Array(old_value)];
                    else new_value = INVALID;
                    break;
                }        
                case Type.std.buffer: {
                    if (old_value === VOID) new_value = new ArrayBuffer(0);
                    else if (typeof old_value=="string") new_value = this.utf8_encoder.encode(old_value).buffer;
                    else new_value = INVALID;
                    break;
                }

                // Errors
                case Type.std.Error: {
                    if (old_value === VOID) new_value = new DatexError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new DatexError(old_value, null);
                    else if(old_value instanceof Array) new_value = new DatexError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.SyntaxError: {
                    if (old_value === VOID) new_value = new SyntaxError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new SyntaxError(old_value, null);
                    else if(old_value instanceof Array) new_value = new SyntaxError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.CompilerError: {
                    if (old_value === VOID) new_value = new CompilerError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new CompilerError(old_value, null);
                    else if(old_value instanceof Array) new_value = new CompilerError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.PointerError: {
                    if (old_value === VOID) new_value = new PointerError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new PointerError(old_value, null);
                    else if(old_value instanceof Array) new_value = new PointerError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.ValueError: {
                    if (old_value === VOID) new_value = new ValueError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new ValueError(old_value, null);
                    else if(old_value instanceof Array) new_value = new ValueError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.PermissionError: {
                    if (old_value === VOID) new_value = new PermissionError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new PermissionError(old_value, null);
                    else if(old_value instanceof Array) new_value = new PermissionError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                } 
                case Type.std.TypeError: {
                    if (old_value === VOID) new_value = new TypeError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new TypeError(old_value, null);
                    else if(old_value instanceof Array) new_value = new TypeError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.NetworkError: {
                    if (old_value === VOID) new_value = new NetworkError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new NetworkError(old_value, null);
                    else if(old_value instanceof Array) new_value = new NetworkError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.SecurityError: {
                    if (old_value === VOID) new_value = new SecurityError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new SecurityError(old_value, null);
                    else if(old_value instanceof Array) new_value = new SecurityError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.RuntimeError: {
                    if (old_value === VOID) new_value = new RuntimeError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new RuntimeError(old_value, null);
                    else if(old_value instanceof Array) new_value = new RuntimeError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }
                case Type.std.AssertionError: {
                    if (old_value === VOID) new_value = new AssertionError(null, null);
                    else if(typeof old_value == "string" || typeof old_value == "number" || typeof old_value == "bigint") new_value = new AssertionError(old_value, null);
                    else if(old_value instanceof Array) new_value = new AssertionError(old_value[0], old_value[1])
                    else new_value = INVALID;
                    break;
                }

                case Type.std.WeakRef: {
                    if (old_value === VOID) {
                        // empty weakref
                        new_value = new WeakRef(Symbol("EMPTY"));
                        new_value.deref = ()=>{};
                    }
                    else if (typeof uncollapsed_old_value == "symbol" || typeof uncollapsed_old_value == "object" || typeof uncollapsed_old_value == "function") {
                        const ptr = Pointer.collapseValue(Pointer.createOrGet(uncollapsed_old_value))
                        new_value = new WeakRef(ptr);
                    }
                    // pointer id -> resolve pointer
                    else if (typeof old_value == "string" && old_value.startsWith("$")) {
                        try {
                            const ptr = Pointer.collapseValue(await Pointer.load(old_value.slice(1)))
                            new_value = new WeakRef(ptr);
                        }
                        catch {
                            // pointer not found, empty weakref
                            new_value = new WeakRef(Symbol("EMPTY"));
                            new_value.deref = ()=>{};
                        }
                    }
                    else new_value = INVALID;
                    break;
                }

                case Type.std.time: {
                    if (old_value === VOID) new_value = new Time(Date.now());
                    else if (typeof old_value == "number" || typeof old_value == "bigint") new_value = new Time(Number(old_value));
                    else new_value = INVALID;
                    break;
                }

                case Type.std.url: {
                    if (typeof old_value == "string") new_value = new URL(old_value, context_location);
                    else new_value = INVALID;
                    break;
                }

                case Type.std.Iterator: {
                    new_value = Iterator.get(old_value);
                    break;
                }


                case Type.std.Assertion: {
                    if (old_value instanceof Scope) new_value = Assertion.get(old_value)
                    else new_value = INVALID;
                    break;
                }
                
                case Type.std.Stream: {
                    if (old_value === VOID) new_value = new Stream();
                    else if (typeof old_value == "object") new_value = new Stream();
                    else new_value = INVALID;
                    break;
                }
                case Type.std.Scope: {
                    new_value = INVALID;
                    break;
                }
                case Type.std.Negation: {
                    new_value = new Negation(old_value)
                    break;
                }
        
                default: {

                    if (Type.std.Function.matchesType(type)) {
                        if (old_value instanceof Tuple) {
                            // from js source
                            if (old_value.has('js_source')) {
                                const source = old_value.get('js_source');
                                const dependencies = old_value.get('js_deps') ?? {}
                                const intermediateFn = createFunctionWithDependencyInjections(source, dependencies)
                                new_value = DatexFunction.createFromJSFunction(intermediateFn, old_value.get('context'), old_value.get('location'), undefined, undefined, undefined, type.parameters?.[0]);
                                new_value.external_variables = dependencies;
                                DatexObject.setType(new_value, type);
                            }
                            // datex
                            else {
                                new_value = DatexFunction.createFromDatexScope(old_value.get('body'), old_value.get('context'), old_value.get('location'), undefined, false, type.parameters?.[0]);
                                DatexObject.setType(new_value, type);
                            }
                        }
                        else if (old_value instanceof Scope) {
                            new_value = DatexFunction.createFromDatexScope(old_value, context, undefined, undefined, false, type.parameters?.[0]);
                            DatexObject.setType(new_value, type);
                        }
                        else if (old_value == VOID) {
                            new_value = DatexFunction.createFromDatexScope(old_value, context, undefined, undefined, false, type.parameters?.[0]);
                            DatexObject.setType(new_value, type);
                        }
                        else new_value = INVALID;
                    }

                    // special arrays
                    else if (Type.std.Array.matchesType(type)) {
                        switch (type.variation) {
                            case "8": new_value = [...new Int8Array(old_value)];break;
                            case "16": new_value = [...new Int16Array(old_value)];break;
                            case "32": new_value = [...new Int32Array(old_value)];break;
                            case "64": new_value = [...new BigInt64Array(old_value)];break;
                            case "u8": new_value = [...new Uint8Array(old_value)];break;
                            case "u16": new_value = [...new Uint16Array(old_value)];break;
                            case "u32": new_value = [...new Uint32Array(old_value)];break;
                            case "u64": new_value = [...new BigUint64Array(old_value)];break;
                            default: new_value = INVALID;
                        }
                        new_value[DX_TYPE] = type;
                    }

                    // handle mime types
                    else if (
                        Type.std.text.matchesType(type) || 
                        Type.std.application.matchesType(type) ||
                        Type.std.image.matchesType(type) ||
                        Type.std.audio.matchesType(type) ||
                        Type.std.video.matchesType(type) ||
                        Type.std.model.matchesType(type)
                    ) {
                        const full_mime_type = `${type.name}/${type.variation}`;
                        let mime_type = full_mime_type;
                        // logger.debug("mime type: " + mime_type);

                        // custom mime type mapping
                        if (mime_type in Runtime.MIME_TYPE_MAPPING || ((mime_type = `${type.name}/*`) in Runtime.MIME_TYPE_MAPPING)){
                            const mapping = Runtime.MIME_TYPE_MAPPING[<keyof typeof Runtime.MIME_TYPE_MAPPING>mime_type];
                            // generator function
                            if ('generator' in mapping && typeof mapping.generator == "function") {
                                const blob = new Blob([old_value], {type:full_mime_type});
                                new_value = mapping.generator(blob);
                            }
                            // simple class
                            else {
                                new_value = new (<new(...args:any[])=>unknown> mapping) (old_value)
                            }
                        }
                        // default: blob
                        else {
                            new_value = new Blob([old_value], {type:full_mime_type});
                        }

                        // save type and cache
                        new_value[DX_TYPE] = type;
                        new_value[DX_SERIALIZED] = old_value;
                    }

                }
            }
        }


        // try custom type cast to JS class
        if (new_value === UNKNOWN_TYPE && (type.hasMatchingJSClassOrPrototype() || type.template)) {
            new_value = type.cast(old_value, context, origin, false, false, assigningPtrId);
        }

        // still unknown type
        if (new_value === UNKNOWN_TYPE){

            // try loading the type configuration dynamically for this type and cast again
            if (!no_fetch) {
                try {
                    await JSInterface.loadTypeConfiguration(type);
                    return Runtime.castValue(type, value, context, undefined, origin, true, assigningPtrId); // no_fetch = true
                } catch (e) {
                    logger.error(e)
                }
            }

            else {
                // cannot fetch type, just cast default
                logger.warn("Cannot find a type definition for "+type.toString()+". Make sure the module for this type is imported. If this type is no longer used, try to clear your eternal caches.");
                new_value = type.cast(old_value, context, origin, false, false, assigningPtrId);
            }

        }

        // could not cast 
        if (new_value === INVALID) {
            throw new TypeError("Cannot cast "+ old_type +" to "+type);
        }

        // return new value
        return new_value;
    }

    
    static async cacheValue(value:unknown){
        if (value instanceof Blob) {
            (<Record<symbol,fundamental>><unknown>value)[DX_SERIALIZED] = await value.arrayBuffer();
        }
        else {
            throw new ValueError("Cannot cache value of type " + Type.ofValue(value));
        }
    }

    /**
     * Serialize any value to a value accepted by the DATEX Compiler - no recursive serialization
     * @param value any value
     * @returns serialized value
     */    
    static serializeValue(value:unknown, receiver?:target_clause):fundamental {

        let type:Type;

        // cached serialized (e.g. for mime types)
        if ((<Record<symbol,fundamental>>value)?.[DX_SERIALIZED]) return (<Record<symbol,fundamental>>value)[DX_SERIALIZED];

        // pointer property
        if (value instanceof PointerProperty) return value;

        // raw datex - only works with asynchronous compilation (not with optimized value compilation) - otherwise a CompilerError is thrown
        if (value instanceof DatexResponse) return value;

        // primitives
        if (typeof value == "string" || typeof value == "boolean" || typeof value == "number" || typeof value == "bigint") return value;
        
        // symbol
        if (typeof value == "symbol") return value.toString().slice(7,-1) || undefined

        // regex
        if (value instanceof RegExp) return value.flags ? new Tuple([value.source, value.flags]) : value.source;

        if (globalThis.MediaStream && value instanceof MediaStream) return {};

        // weakref
        if (value instanceof WeakRef) {
            const deref = value.deref();
            // empty weak ref
            if (!deref) return VOID;
            const ptr = Pointer.createOrGet(deref)
            if (ptr) return "$"+ptr.id;
            else throw new TypeError("Cannot serialize weakref to non-pointer value");
        }
        
        // directly return, cannot be overwritten
        if (value === VOID || value === null || value instanceof Endpoint || value instanceof Type) return value;
        if (value instanceof Scope) return value;
        if (value instanceof URL) return value;
        if (value instanceof Logical) return value;
        if (value instanceof Time) return value;

        // TODO fix recursive context problem TODO: replace with return value.body ?? VOID;
        if (value instanceof DatexFunction) {
            // only expose js source if function location matches receiver
            // TODO: improve, prevent 100% internal js code exposure
            if (value.ntarget && receiver === value.location) {
                return new Tuple({js_source: value.js_source, js_deps: value.external_variables, body:value.body, location:value.location});
            }
            return new Tuple({/*context:value.context,*/ body:value.body, location:value.location});
        }
        if (value instanceof Assertion) return value.scope;
        if (value instanceof Iterator) return VOID;

        // collapse wildcard target
        if (value instanceof WildcardTarget) return value.target;
        // normal ArrayBuffer does not need to be serialized further:
        if (value instanceof ArrayBuffer) return value;
        // stream has no internal content
        if (value instanceof Stream) return VOID;
       
        // special Typed Buffer -> get buffer
        if (value instanceof TypedArray) return value.buffer;

        // mime types - not cached
        if (value instanceof Blob) {
            throw new RuntimeError("Uncached mime type value cannot be serialized to DATEX Type");
        }
        if (Runtime.mime_type_classes.has(value.constructor)) throw new RuntimeError("Uncached custom mime type value cannot be serialized to DATEX Type");

        // check if custom serialization available
        let serialized = JSInterface.serializeValue(value); 
        if (serialized instanceof TypedArray) serialized = (<any>serialized).buffer;

        if (serialized!==INVALID  && serialized !==NOT_EXISTING) {} // serialization with DatexCustomPseudoClasses was successful

        // serialization for <std:*> types
        else if (value instanceof DatexError) serialized = [value.code ?? value.message, value.datex_stack]
        else if (value instanceof Error) serialized = value.toString();
        //else if (value instanceof Date) serialized = BigInt(value.getTime()||0);


        // DatexUnresolvedValue without corresponding JS class
        else if (value instanceof UnresolvedValue) serialized = Runtime.serializeValue(value[DX_VALUE])

        // create new object, lose the original reference

        // Array or object: allow all keys/values
        else if (value instanceof Array) {
            serialized = [];
            for (let i=0; i<value.length; i++){
                serialized[i] = value[i];
            }
        }

        else if (value instanceof Tuple) serialized = value.clone();
    
        // type with fixed visible children -> check which properties are actually available to DATEX
        else if ((type = Type.ofValue(value)) && type.visible_children) {
            serialized = {};
            const type = Type.ofValue(value);
            const pointer = Pointer.getByValue(value)
            for (const key of type.visible_children){
                serialized[key] = pointer?.shadow_object ? pointer.shadow_object[key]/*keep references*/ : value[key];
            }
        }

        // is object
        else if (typeof value == "object") {
            serialized = {};
            const pointer = Pointer.getByValue(value)
            for (const key of Object.keys(value)){
                serialized[key] = pointer?.shadow_object ? pointer.shadow_object[key] : value[key];
            }
        }

        if (serialized == INVALID || serialized == NOT_EXISTING) return VOID;

        return serialized;
    }

    

    /**
     * Compares to values by comparing their DATEX representation
     * required to be async because of hash generation
     * @param a first value
     * @param b second value
     * @returns true if values are equal, else false
     */
    public static async equalValues(a:any, b:any) {
        // collapse (primitive) pointers
        a = Ref.collapseValue(a,true,true);
        b = Ref.collapseValue(b,true,true);

        // empty Tuple equals void
        if (a === VOID && b instanceof Tuple && Object.keys(b).length == 0) return true;
        if (b === VOID && a instanceof Tuple && Object.keys(a).length == 0) return true;

        // compare ints/floats
        if ((typeof a == "number" || typeof a == "bigint") && (typeof b == "number" || typeof b == "bigint")) return a == b;

        // cannot match
        if (typeof a != typeof b) return false;
        // both primitive values
        if (a !== Object(a) && b !== Object(a !== Object(a))) {
            return a === b;
        }
        // compare hashes
        const [hashA, hashB] = await Promise.all([Compiler.getValueHashString(a), Compiler.getValueHashString(b)])

        return (hashA === hashB)
    }



    private static FORMAT_INDENT = 3;

    public static TEXT_KEY = /^\w+$/;

    private static escapeString(string:string, formatted=false) {
        string = string
            .replace(/\\/g, '\\\\')
            .replace(/\"/g, '\\"');
        if (!formatted) string = string.replace(/\n/g, "\\n");
        return '"'+string+'"';
    }


    /**
     * @experimental
     * Converts values to string by compiling and decompiling (Decompiler not yet 100% correct)
     * resolves recursive structures and references correctly, compared to valueToDatexString
     * @param value any value
     * @param deep_clone collapse pointers recursively
     * @param collapse_value collapse value if it is apointer 
     * @param formatted add new lines / more spaces, otherwise compact representation
     * @returns value as DATEX Script string
     */
    static valueToDatexStringExperimental(value: unknown, formatted = true, colorized = false, deep_clone = false, collapse_value = false, resolve_slots = true){
        try {
            // extract body (TODO: just temporary, rust impl does not yet support header decompilation)
            const compiled = new Uint8Array(Compiler.encodeValue(value, undefined, false, deep_clone, collapse_value, false, true, false, true));
            return wasm_decompile(compiled, formatted, colorized, resolve_slots).replace(/\r\n$/, '');
        } catch (e) {
            console.debug(e);
            return this.valueToDatexString(value, formatted)
        }
        // return Decompiler.decompile(Compiler.encodeValue(value, undefined, false, deep_clone, collapse_value), true, formatted, formatted, false);
    }


    /** Converts any value to its DAETX representation 
     * 
     * @param formatted adds line breaks and indentations
     * @param collapse_pointers collapse value if pointer (not recursive)
     * @param deep_collapse if true, all pointer values are collapsed recursively 
     * @param pointer_anchors add start and end sequence (e.g. html) around a pointer
     * @return value as DATEX Script string
     */

    static valueToDatexString(value:any, formatted = false, collapse_pointers = false, deep_collapse = false, pointer_anchors?:[string,string]): string {
        return this._valueToDatexString(value, formatted, 0, collapse_pointers, deep_collapse, pointer_anchors);
    }

    /**_serialized: object already only consists of primitives or arrays / objects */
    private static _valueToDatexString(value:any, formatted = false, depth=0, collapse_pointers=false, deep_collapse = false, pointer_anchors?:[string,string], _serialized = false, parents = new Set<any>()): string {
        let string:string;

        // proxyify pointers
        if (!collapse_pointers && !deep_collapse) value = Pointer.pointerifyValue(value);
        if (collapse_pointers && value instanceof Ref) value = value.val; 
        // don't show anonymous pointers as pointers
        if (value instanceof Pointer && value.is_anonymous) value = value.original_value;

        // check for recursive objects
        if (parents.has(value)) return value instanceof Tuple ? "(...)"  : (value instanceof Array ? "[...]" : "{...}");

        // get type
        const type = value instanceof Pointer ? Type.std.Object : Type.ofValue(value);

        if (typeof value == "string") {
            string = Runtime.escapeString(value, formatted);
        }
        else if (value === null) {
            string = "null";
        }
        else if (value === VOID) {
            string = "void";
        }
        else if (value instanceof Quantity) {
            string = value.toString();
        }
        else if (value instanceof Time) {
            string = value.toString();
        }
        // floats (always represented as x.y)
        else if (typeof value == "number") {
            if (isNaN(value)) string = 'nan';
            else if (value ===  -Infinity) string = '-infinity';
            else if (value ===  Infinity) string = 'infinity';
            else if (Object.is(value, -0)) string = '-0.0'; // special edge case for -0.0
            else if (Number.isInteger(value)) {
                string = value.toString()
                if (!string.includes("e")) string += '.0'; // make sure to show float as x.0 (as long as not in exp. representation)
            }
            else string = value.toString(); // normal float
        }
        // ints & booleans
        else if (typeof value == "bigint" || typeof value == "boolean") {
            string = value.toString();
        }
        else if (value instanceof ArrayBuffer || value instanceof TypedArray) {
            string = "`"+buffer2hex(value instanceof Uint8Array ? value : new Uint8Array(value instanceof TypedArray ? value.buffer : value), null, null)+"`"
        }
        else if (value instanceof Scope) {
            const spaces = Array(this.FORMAT_INDENT*(depth+1)).join(' ');
            string = value.toString(formatted, spaces);
        }
        else if (value instanceof Target) {
            string = value.toString();
        }
        else if (value instanceof URL) {
            string = value.toString();
        }
        else if (value instanceof Pointer) { 
            if (pointer_anchors) string = pointer_anchors[0] + value.idString() + pointer_anchors[1];
            else string = value.idString();
        }
        else if (value instanceof PointerProperty) { 
            const string_value = value.pointer.idString() + "->" + (typeof value.key == "string" && value.key.match(Runtime.TEXT_KEY) ? value.key : Runtime.valueToDatexString(value.key,false));
            if (pointer_anchors) string = pointer_anchors[0] + string_value + pointer_anchors[1];
            else string = string_value;
        }
        else if (value instanceof Type) {
            string = value.toString();
        }
        else if (value instanceof Negation) {
            string = "!" + this._valueToDatexString(value.not(), formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
        }
        else if (value instanceof Conjunction) {
            string = "(";
            const spaces = Array(this.FORMAT_INDENT*(depth+1)).join(' ');
            for (const el of value) {
                string +=  (formatted ? spaces:"") + this._valueToDatexString(el, formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
                string += "&";
            }
            string = string.slice(0,-1);
            string += ")";
        }
        else if (value instanceof Disjunction) {
            string = "(";
            const spaces = Array(this.FORMAT_INDENT*(depth+1)).join(' ');
            for (const el of value) {
                string +=  (formatted ? spaces:"") + this._valueToDatexString(el, formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
                string += "|";
            }
            string = string.slice(0,-1);
            string += ")";
        }
        else if (value instanceof Tuple && _serialized) {
            parents.add(value);
            const brackets = ['(', ')'];
            if (value instanceof Tuple && value.indexed.length == 1 && value.named.size == 0) string = Type.std.Tuple.toString();
            else string = "";
            string += brackets[0] + (formatted ? "\n":"")
            let first = true;
            const spaces = Array(this.FORMAT_INDENT*(depth+1)).join(' ');
            for (const [k,v] of value) {
                if (!first) string += ", " + (formatted ? "\n":"")
                // named property
                if (typeof k == 'string')  string += (formatted ? spaces:"") + `${k.match(Runtime.TEXT_KEY) ? k : Runtime.escapeString(k, false)}: ` + this._valueToDatexString(v, formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
                // indexed property
                else string +=  (formatted ? spaces:"") + this._valueToDatexString(v, formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
                first = false;
            }
            string += (formatted ? "\n"+Array(this.FORMAT_INDENT*depth).join(' '):"") + brackets[1];
        }
        // <Array>
        else if (value instanceof Array && _serialized) {
            parents.add(value);
            const brackets = ['[', ']'];
            string = ((value instanceof Tuple && value.length == 0) ? Type.std.Tuple.toString() : "") + brackets[0] + (formatted ? "\n":"")
            // make clear tuple with only 1 element is a tuple (...)
            if (value instanceof Tuple && value.length == 1) string += "...";
            let first = true;
            const spaces = Array(this.FORMAT_INDENT*(depth+1)).join(' ');
            for (let v of value) {
                if (!first) string += ", " + (formatted ? "\n":"")
                string +=  (formatted ? spaces:"") + this._valueToDatexString(v, formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
                first = false;
            }
            string += (formatted ? "\n"+Array(this.FORMAT_INDENT*depth).join(' '):"") + brackets[1];
        }
        // all other sorts of object
        else if ((typeof value == "object" || value instanceof DatexFunction || value instanceof Assertion /*also an object*/) && _serialized) { // must be a 'JSON' object  
            parents.add(value);   
            const brackets = ['{', '}'];
            const entries = Object.entries(value);

            string = brackets[0] + (formatted ? "\n":"");
            let first = true;
            const spaces = Array(this.FORMAT_INDENT*(depth+1)).join(' ');
            for (const [key, v] of entries) {
                if (!first) string +=  ", " + (formatted ? "\n":"")
                string += (formatted ? spaces:"") + `${key.match(Runtime.TEXT_KEY) ? key : Runtime.escapeString(key, false)}: ` + this._valueToDatexString(v, formatted, depth+1, false, deep_collapse, pointer_anchors, false, new Set(parents))
                first = false;
            }
            string +=  (formatted ? "\n"+Array(this.FORMAT_INDENT*depth).join(' '):"") + brackets[1];
        }
        else if (typeof value == "object" || value instanceof DatexFunction || value instanceof Assertion /*also an object*/) {
            parents.add(value);
            let serialized = value!=null ? this.serializeValue(value, Runtime.endpoint) : value;
            serialized = Pointer.pointerifyValue(serialized); // try to get a pointer from serialized


            if (serialized == VOID) string = "()"; // display void as ()
            else if (type?.is_primitive) string = this._valueToDatexString(serialized, formatted, depth, true, deep_collapse, pointer_anchors, false, new Set(parents)) // is primitive type - use original value
            else string = this._valueToDatexString(serialized, formatted, depth, true, deep_collapse, pointer_anchors, true, new Set(parents)) // is complex or fundamental type
        }

        else { // all invalid DATEX values (functions, ...)
            string = "void";
        }

        // type cast required: if not primitive and complex, or type variation
        // exception for explicit type quantity, type variation is always included in primitive representation without explicit cast
        if (type && ((!type.is_primitive && type.is_complex && type != Type.std.Scope) || type.root_type !== type) && !Type.std.quantity.matchesType(type)) string = type.toString() + (formatted ? " ":"") + string;

        return string;
    }


    static readonly runtime_actions:
    {
        waitForBuffer: (SCOPE: datex_scope, jump_to_index?: number, shift_current_index?: number) => void,
        constructFilterElement: <T extends typeof Endpoint = typeof Endpoint>(SCOPE: datex_scope, type: BinaryCode, appspace_targets?:Endpoint[]) => false | InstanceType<T>
        trimArray: (array: Array<any>) => any[],
        getTrimmedArrayLength: (array: Array<any>) => number,
        returnValue: (SCOPE: datex_scope, value: any) => Promise<void>,
        enterSubScope: (SCOPE: datex_scope) => void,
        exitSubScope: (SCOPE: datex_scope) => Promise<any>,
        newSubScope: (SCOPE: datex_scope) => Promise<void>,
        closeSubScopeAssignments: (SCOPE: datex_scope) => Promise<void>,
        handleAssignAction: (SCOPE: datex_scope, action_type: BinaryCode | -1, parent: any, key: any, value: any, current_val?: any) => Promise<void>,
        checkValueReadPermission: (SCOPE: datex_scope, parent: any, key: string) => void,
        checkValueUpdatePermission: (SCOPE: datex_scope, parent: any, key: string) => void,
        countValue: (value: any) => bigint,
        getReferencedProperty: (SCOPE: datex_scope, parent: any, key: any) => PointerProperty<any>,
        getProperty: (SCOPE: datex_scope, parent: any, key: any) => any,
        has: (SCOPE: datex_scope, parent: any, key: any) => Promise<boolean>,
        getKeys: (value: any, array_indices_as_numbers?:boolean) => Iterator<any>,
        setProperty: (SCOPE: datex_scope, parent: any, key: any, value: any) => void,
        assignAction(SCOPE: datex_scope, action_type: BinaryCode, parent: any, key: any, value: any, current_val?: any): void,
        _removeItemFromArray(arr: any[], value: any): void,
        extractScopeBlock(SCOPE: datex_scope): ArrayBuffer | false,
        extractVariableName(SCOPE: datex_scope): string | number | false,
        extractType(SCOPE: datex_scope, is_extended_type?: boolean): [Type, boolean] | false | Type,
        forkScope(SCOPE: datex_scope): datex_scope,
        insertToScope(SCOPE: datex_scope, el: any, literal_value?: boolean): Promise<void>,
        setInternalVarReference(SCOPE: datex_scope, name: number | string, reference: any, save_persistent?: boolean): void,
        setInternalVarValue(SCOPE: datex_scope, name: number | string, value: any, save_persistent?: boolean): void
    }
    = {

        // shift current index and set cache_previous to true, SCOPE should be stopped after calling this function, to wait for next dxb block
        waitForBuffer(SCOPE:datex_scope, jump_to_index?:number, shift_current_index?:number){
            if (typeof jump_to_index == "number") SCOPE.current_index = jump_to_index;
            else if (typeof shift_current_index == "number") SCOPE.current_index -= shift_current_index; 
            else  SCOPE.current_index = SCOPE.start_index; // use stored jump-back index from SCOPE

            SCOPE.cache_previous = true;
        },

        constructFilterElement<T extends typeof Endpoint=typeof Endpoint>(SCOPE:datex_scope, type:BinaryCode, target_list:Endpoint[]):InstanceType<T>|false {
            /** wait for buffer */
            if (SCOPE.current_index+2 > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/

            const name_is_binary = type == BinaryCode.ENDPOINT || type == BinaryCode.ENDPOINT_WILDCARD;

            let instance:string;

            let name_length = SCOPE.buffer_views.uint8[SCOPE.current_index++]; // get name length
            let subspace_number = SCOPE.buffer_views.uint8[SCOPE.current_index++]; // get subspace number
            let instance_length = SCOPE.buffer_views.uint8[SCOPE.current_index++]; // get instance length

            if (instance_length == 0) instance = "*";
            else if (instance_length == 255) instance_length = 0;

            /** wait for buffer */
            if (SCOPE.current_index+name_length+instance_length+1 > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/  

            let name_binary = SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+=name_length);
            let name = name_is_binary ? name_binary : Runtime.utf8_decoder.decode(name_binary)  // get name

            let subspaces:string[]= [];
            for (let n=0; n<subspace_number; n++) {
                let length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                if (length == 0) {
                    subspaces.push("*");
                }
                else {
                    let subspace_name = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+=length));
                    subspaces.push(subspace_name);
                }
            }


            if (!instance) instance = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+=instance_length))  // get instance
            
            let app_index:number
            if (target_list) app_index = SCOPE.buffer_views.uint8[SCOPE.current_index++];

            return <InstanceType<T>> Target.get(name, instance, type);
        },
        
        // removes trailing undefined/empty values from array (trim length)
        trimArray(array:Array<any>){
            let new_length = array.length;
            for (let i=array.length-1; i>=0; i--) {
                if (array[i] === VOID) new_length--;
                else break;
            }
            array.length = new_length // set new length
            return array;
        },

        // only returns trimmed length, does not trim the array
        getTrimmedArrayLength(array:Array<any>):number{
            let new_length = array.length;
            for (let i=array.length-1; i>=0; i--) {
                if (array[i] === VOID) new_length--;
                else break;
            }
            return new_length;
        },

        async returnValue(SCOPE:datex_scope, value: any){
            await Runtime.handleScopeResult(SCOPE.header, SCOPE, value);
        },

        enterSubScope(SCOPE:datex_scope){
            SCOPE.inner_scope = {ctx_intern:SCOPE.inner_scope.active_object ?? SCOPE.inner_scope.ctx_intern}; // inherit root and internal context from parent subscope / new internal object
            SCOPE.sub_scopes.push(SCOPE.inner_scope);
        },

        // sub scope end, returns result value
        async exitSubScope (SCOPE:datex_scope){

            // handle scope result variable and make pointer / variable assignments
            await Runtime.runtime_actions.closeSubScopeAssignments(SCOPE);

            let result = SCOPE.inner_scope.result;
            let inner_spread = SCOPE.inner_scope.inner_spread; // remember ... from inner subscope

            if (SCOPE.sub_scopes.length==1) {
                logger.error("Cannot exit out of root scope");
                console.warn(buffer2hex(SCOPE.buffer_views.uint8, " "), SCOPE.buffer_views.buffer)// DatexRuntime.decompile(SCOPE.buffer_views.buffer, true, true, true, false));
                return;
            }

            SCOPE.sub_scopes.pop();
            SCOPE.inner_scope = SCOPE.sub_scopes[SCOPE.sub_scopes.length-1];
            if (inner_spread) SCOPE.inner_scope.waiting_collapse = true;

            return result // return last result
        },

        // switch scope between commands(ignore that it is outer scope)
        async newSubScope(SCOPE:datex_scope){
            // currently in outer scope
            const is_outer_scope = SCOPE.inner_scope.is_outer_scope;

            // handle scope result variable and make pointer / variable assignments
            await Runtime.runtime_actions.closeSubScopeAssignments(SCOPE);

            let result = SCOPE.inner_scope.result;
            SCOPE.sub_scopes.pop();

            Runtime.runtime_actions.enterSubScope(SCOPE);

            // insert 'result' to outer scope
            if (is_outer_scope && result!==VOID) {
                SCOPE.result = result;
            }
            // insert sub_result to current scope;
            if (result!==VOID) SCOPE.inner_scope.result = result;

            SCOPE.inner_scope.is_outer_scope = is_outer_scope; // is outer scope?
        },

        // use INNER_SCOPE.active_value, apply remaining assignments -> INNER_SCOPE.result
        async closeSubScopeAssignments(SCOPE:datex_scope){
            const INNER_SCOPE = SCOPE.inner_scope;

            // first check if remaining type casts; inner scope result must be void
            if (INNER_SCOPE.type_casts?.length) {
                // first type cast becomes actual type value
                let el = INNER_SCOPE.type_casts.pop();
                let type:Type | undefined;
                // iterate over now remaining type casts
                while (type = INNER_SCOPE.type_casts.pop()) el = await Runtime.castValue(type, el, INNER_SCOPE.ctx_intern, SCOPE.context_location, SCOPE.origin)
                INNER_SCOPE.active_value = el;
            }

            // assignments:

            // get current active value
            let el = INNER_SCOPE.active_value;
            let did_assignment = false;

            // make sure endpoint has access (TODO: INNER_SCOPE.active_value should never be set if no access)
            const ptr = Pointer.pointerifyValue(el);
            if (ptr instanceof Pointer) ptr.assertEndpointCanRead(SCOPE?.sender)

            // ptrs
            if (INNER_SCOPE.waiting_ptrs?.size) {
                for (const p of INNER_SCOPE.waiting_ptrs) {
                    const isSet = p[1] == undefined;
                    const isInit = typeof p[1] == "object";

                    try {
                        if (SCOPE.header.type==ProtocolDataType.UPDATE) p[0].excludeEndpointFromUpdates(SCOPE.sender); 
                        if (isSet || isInit) {

                            // if value does not support indirect refs, its safe to assume that any existing pointer for the value can be moved
                            // TODO: only workaround, improve
                            const forceMove = !Type.ofValue(el).supportsIndirectRefs
                            const ptr = p[0].setValue(el, forceMove);

                            // remote pointer value was set - handle subscription
                            if (!ptr.is_origin) {

                                // subscription was already added by pointer origin for preemptively loaded pointer, just finalize
                                if (isInit) {
                                    ptr.finalizeSubscribe()
                                }
                                // subscribe for updates at pointer origin
                                else {
                                    await ptr.subscribeForPointerUpdates();
                                }
                                
                            }
                            // resolve
                            if (p[1]?.resolve) {
                                p[1].resolve(ptr)
                                Pointer.loading_pointers.delete(ptr.id); // TODO: only workaround, automatically handle delete, but leads to promise rejection errors
                            }
                        }
                        else await Runtime.runtime_actions.handleAssignAction(SCOPE, p[1], null, null, el, p[0]); // other action on pointer
                    }
                    catch (e) {
                        if (p[1]?.reject) {
                            p[1].reject(e);
                            Pointer.loading_pointers.delete(ptr.id); 
                        }
                        p[0].enableUpdatesForAll();
                        throw e;
                    };
                    p[0].enableUpdatesForAll()
                }
                did_assignment = true;
            }

            // labels (set label to pointer)
            if (INNER_SCOPE.waiting_labels?.size) {
                for (let label of INNER_SCOPE.waiting_labels) {
                    let pointer = Pointer.getByValue(el);
                    // already a pointer
                    if (pointer) pointer.addLabel(label);
                    else {
                        pointer = Pointer.create(null, el);
                        pointer.addLabel(label);
                    }
                }
                did_assignment = true;
            }
   

            // handle child assignment
            if (INNER_SCOPE.waiting_for_action?.length) {
                let action:[type: BinaryCode, parent: any, key: any];
                
                // assign for all waiting
                while (action = INNER_SCOPE.waiting_for_action.pop()) {
                    await Runtime.runtime_actions.handleAssignAction(SCOPE, action[0], action[1], action[2], el);   
                }

                did_assignment = true;
            }

            // internal vars (last, because inner scope sub_result might be re-added)
            if (INNER_SCOPE.waiting_internal_vars?.size) {
                did_assignment = true;

                for (let v of INNER_SCOPE.waiting_internal_vars) {
                    // set value
                    if (v[1] == BinaryCode.SET_INTERNAL_VAR) await Runtime.runtime_actions.setInternalVarValue(SCOPE, v[0], el, v[2]);
                    
                    // set reference
                    else if (v[1] == BinaryCode.SET_INTERNAL_VAR_REFERENCE) await Runtime.runtime_actions.setInternalVarReference(SCOPE, v[0], el, v[2]);

                    // other action on internal variable
                    else { 
                        let parent = SCOPE.internal_vars; // default parent
                        let key = v[0];

                        if (v[0] == 'result') parent = SCOPE; // parent is SCOPE, key is 'result'
                        else if (v[0] == 'sub_result') {parent = INNER_SCOPE; key = 'sub_result'}  // parent is INNER_SCOPE, key is 'sub_result'
                        else if (v[0] == 'remote') parent = SCOPE;  // parent is SCOPE, key is 'remote';
                        else if (v[0] == 'it') parent = SCOPE;  // parent is SCOPE, key is 'it';
                        else key = v[0].toString() // internal var, object key must be string

                        await Runtime.runtime_actions.handleAssignAction(SCOPE, v[1], parent, key, el);
                    }
                }
            }

            // has return?
            if (INNER_SCOPE.return) {
                Runtime.runtime_actions.returnValue(SCOPE, el === VOID ? INNER_SCOPE.result : el);
            }

            // update scope result if no assignment happened and value is not void
            else if (!did_assignment && el !== VOID) INNER_SCOPE.result = el;
        },

        // sets the value a internal variable points to
        // reference might be copied if not a pointer value
        async setInternalVarReference(SCOPE:datex_scope, name:number|string, reference:any, save_persistent = false) {
            // reference is void -> delete
            if (reference === VOID) delete SCOPE.internal_vars[name];
            else {
                // set direct js reference if value has a DATEX reference
                if (Pointer.isReference(reference)) SCOPE.internal_vars[name] = reference; 
                // otherwise, lose reference (copy value) TODO
                else {
                    // TODO: avoid unneccesary cloning
                    //console.log("cloning reference", reference);
                    SCOPE.internal_vars[name] = reference // await Runtime.cloneValue(reference);
                }

                // persistent memory?
                if (save_persistent) {
                    if (!SCOPE.persistent_vars) SCOPE.persistent_vars = [];
                    SCOPE.persistent_vars.push(name);
                }
            }
        },

        // sets the value of the current reference the internal variable points to
        // if no reference available, the value becomes the new reference
        async setInternalVarValue(SCOPE:datex_scope, name:number|string, value:any, save_persistent = false) {

            // handle special internal variables -> modify value
            if (name == 'result') {
                SCOPE.result = SCOPE.inner_scope.result = value; // set new result
            }
            else if (name == 'sub_result') SCOPE.inner_scope.result = value;  // set result of current sub scope
            else if (name == 'it') SCOPE.it = value;  // set it of scope
            else if (name == 'void') {
                // just ignore
            }
            else if (name == 'remote') {
                if (typeof value == "object") SCOPE.remote = value;
                else throw new ValueError("Invalid type for #remote");
            }
            else {// default internal variable

                // variable does not exist, set new reference
                if (!(name in SCOPE.internal_vars)) {
                    await Runtime.runtime_actions.setInternalVarReference(SCOPE, name, value, save_persistent);
                    return;
                }

                const pointer = Pointer.pointerifyValue(SCOPE.internal_vars[name]);

                // no reference, just override internal variable
                if (!(pointer instanceof Pointer)) {
                    await Runtime.runtime_actions.setInternalVarReference(SCOPE, name, value, save_persistent);
                    return;
                }

                else {
                    try {
                        if (SCOPE.header.type==ProtocolDataType.UPDATE) pointer.excludeEndpointFromUpdates(SCOPE.sender);
                        await pointer.setVal(value);
                    }  catch (e) {
                        pointer.enableUpdatesForAll()
                        throw e
                    }
                }

                
            }
        },

        async handleAssignAction(SCOPE:datex_scope, action_type:BinaryCode|-1, parent:any, key:any, value:any, current_val?:any){

            // collapse iterator key to tuple
            if (key instanceof Iterator) key = await key.collapse();

            // set value
            if (action_type == -1) {
               Runtime.runtime_actions.setProperty(SCOPE, parent, key, value);
            }
            // all other actions (+=, -=, ...)
            else {
                await Runtime.runtime_actions.assignAction(SCOPE, action_type, parent, key, value, current_val);
            }
        },


        // throws an error if no permission
        checkValueReadPermission(SCOPE:datex_scope, parent:any, key:string){
            // #read slot
            if (parent[DX_SLOTS]?.has(SLOT_READ)) {
                const filter = parent[DX_SLOTS].get(SLOT_READ);
                if (!Logical.matches(SCOPE.sender, filter, Target)) 
                    throw new PermissionError("Property "+Runtime.valueToDatexString(key)+" does not exist or cannot be accessed");    
            }
            
            const pointer = Pointer.pointerifyValue(parent) // make sure the parent is proxified
            // check pointer read permission
            if (pointer instanceof Pointer && !pointer.canReadProperty(key))
                throw new ValueError("Property '"+key.toString()+"' does not exist or cannot be accessed");
        },

        // throws an error if no permission
        checkValueUpdatePermission(SCOPE:datex_scope, parent:any, key:string){

            // #write slot
            if (parent[DX_SLOTS]?.has(SLOT_WRITE)) {
                const filter = parent[DX_SLOTS].get(SLOT_WRITE);
                if (!Logical.matches(SCOPE.sender, filter, Target)) 
                    throw new PermissionError("Cannot update property "+Runtime.valueToDatexString(key)+"");    
            }
            
            // check pointer write permission
            const pointer = Pointer.pointerifyValue(parent) // make sure the parent is proxified
            if (pointer instanceof Pointer && !pointer.canUpdateProperty(key))
                throw new PermissionError("Cannot update pointer property "+Runtime.valueToDatexString(key)+"");        
        },

        // get count (length) of value
        countValue(value:any){
            if (value === VOID) return 0n; // void is 0

            let count = JSInterface.handleCount(value) 

            if (count == NOT_EXISTING) {
                if (value instanceof Tuple) count = value.size; // array or tuple
                else if (value instanceof Array) count = value.length; // array or tuple
                else if (value.constructor == Object) count = Object.keys(value).length; // plain object
                else count = 1n; // default value
            }
            else if (count == INVALID) throw new ValueError("Value uncountable");        
            return BigInt(count);
        },


        getKeys(value:any, array_indices_as_numbers = false):Iterator<any> {
            // restricted to visible_children
            const pointer = Pointer.getByValue(value);
            if (pointer && pointer.visible_children) return Iterator.get(pointer.visible_children);

            let keys = JSInterface.handleKeys(value, Type.ofValue(value));
            if (keys == INVALID) throw new ValueError("Value has no iterable content");
            if (keys == NOT_EXISTING) {
                if (value instanceof Array) {
                    if (array_indices_as_numbers) return Iterator.get(value.keys())
                    else return Iterator.get([...value.keys()].map(BigInt));
                }
                else keys = Object.keys(value); // default Object.keys
            }
            return Iterator.get(keys);
        },


        // has value
        async has(SCOPE:datex_scope, parent:any, value:any){

            let has = JSInterface.handleHas(parent, value); 

            if (has == NOT_EXISTING) { 
                if (parent instanceof Tuple) {
                    return parent.hasValue(value)
                }
                else if (parent instanceof Array) {
                    return parent.includes(value);
                }
                else if (parent instanceof Iterator) {
                    return (await parent.collapse()).hasValue(value);

                }
                else if (typeof parent == "object") {
                    return Object.values(parent).includes(value)
                    // if (typeof key != "string") throw new ValueError("Invalid key for <Object> - must be of type <text>", SCOPE);
                    // else if (DEFAULT_HIDDEN_OBJECT_PROPERTIES.has(key) || (parent && !(key in parent))) return false;
                    // else return true; // plain object
                }
                else has = INVALID;
            }
            
            if (has == INVALID) throw new ValueError("Cannot check for properties on this value");     
            else return has;   
        },

        // get parent[key] as DatexPointerProperty if possible
        getReferencedProperty(SCOPE: datex_scope, parent:any, key:any){
            const pointer = Pointer.createOrGetLazy(parent);
            if (pointer) {
                if (pointer instanceof Pointer) pointer.assertEndpointCanRead(SCOPE?.sender)
                return PointerProperty.get(pointer, key);
            }
            else throw new RuntimeError("Could not get a child reference");
        },
        
        // get parent[key]; !! Returns promise because of Endpoint.getProperty()
        getProperty(SCOPE:datex_scope, parent:any, key:any){

            if (parent instanceof UnresolvedValue) parent = parent[DX_VALUE];

            if (parent === undefined) throw new ValueError("void has no properties (trying to read property "+key+")");

            const o_parent:Pointer = Pointer.pointerifyValue(parent);
            if (o_parent instanceof Pointer) o_parent.assertEndpointCanRead(SCOPE?.sender)


            key = Ref.collapseValue(key,true,true);

            // check read permission (throws an error)
            Runtime.runtime_actions.checkValueReadPermission(SCOPE, parent, key)

            // has no properties
            if (!Type.doesValueHaveProperties(parent)) throw new ValueError("Value of type "+Type.ofValue(parent)+" has no properties", SCOPE);
            
            // key is * - get iterator with all values
            if (key === WILDCARD) {
                // parent = Value.collapseValue(parent,true,true);
                // let values = JSInterface.handleGetAllValues(parent);
                // if (values == NOT_EXISTING) {
                //     let keys;
                //     // create list of integer keys
                //     if (parent instanceof Array) {
                //         keys = [];
                //         const N = parent.length;
                //         let i = 0n;
                //         while (i < N) keys[Number(i)] = i++;
                //     }
                //     // list of object property keys
                //     else keys = Object.keys(parent);
                //     if (!(Symbol.iterator in keys)) throw new RuntimeError("Value keys are not iterable", SCOPE);
                //     return Runtime.runtime_actions.getProperty(SCOPE, Pointer.pointerifyValue(parent), new Tuple(keys));
                // }
                // else if (values == INVALID) throw new ValueError("Value has no iterable content", SCOPE);
                
                // if (!(Symbol.iterator in values)) throw new RuntimeError("Value keys are not iterable", SCOPE);
                // return values instanceof Tuple ? values: new Tuple(values);
                key = Runtime.runtime_actions.getKeys(parent);
            }
            // key is <Tuple> - get multiple properties (recursive)
            else if (key instanceof Tuple) {
                key = Iterator.get(key);
            }

            // key is <Iterator> - get multiple properties (recursive)
            if (key instanceof Iterator) {
                // parent also iterator
                if (parent instanceof Iterator) {
                    //console.log(parent);
                    return Iterator.map(key, async k => {
                        //console.log(k, await parent.collapse(), await (await Runtime.runtime_actions.getProperty(SCOPE, parent, k)).collapse());
                        return (await Runtime.runtime_actions.getProperty(SCOPE, parent, k)).collapse()
                    });
                }
                // parent normal value
                else return Iterator.map(key, (k)=>Runtime.runtime_actions.getProperty(SCOPE, parent, k))
            }

            // value is iterator, key is normal value -> map iterator
            else if (parent instanceof Iterator) {
                return Iterator.map(parent, (child)=>Runtime.runtime_actions.getProperty(SCOPE, child, key))
            }

            parent = Ref.collapseValue(parent,true,true);

            // custom types get
            let new_obj = JSInterface.handleGetProperty(parent, key) 

            // definitly does not exist and can not exist
            if (new_obj == INVALID) throw new ValueError("Property '"+key.toString()+"' does not exist", SCOPE);


            // was not handled by custom pseudo classes
            else if (new_obj == NOT_EXISTING) {

                // get endpoint subspace
                if (parent instanceof Endpoint) return parent.getProperty(key?.toString());
                // invalid key type
                if (parent instanceof Array && typeof key != "bigint") throw new ValueError("Invalid key for <Array> - must be of type <integer>", SCOPE);
                // sealed tuple
                else if (parent instanceof Tuple) {
                    if (!parent.has(key)) throw new ValueError("Property '"+key.toString()+"' does not exist in <Tuple>", SCOPE)
                    else return parent.get(key)
                }
                // sealed or frozen
                else if ((Object.isSealed(parent) || Object.isFrozen(parent)) && !Object.hasOwn(parent, key)) throw new ValueError("Property '"+key.toString()+"' does not exist", SCOPE)
                // not a key string in a normal object
                else if (typeof key != "string" && !(parent instanceof Array)) throw new ValueError("Invalid key for <Object> - must be of type <text>", SCOPE);
                // default hidden properties
                else if (DEFAULT_HIDDEN_OBJECT_PROPERTIES.has(key)) return VOID;
                // get value
                else {
                    if (parent instanceof Array && typeof key == "bigint" && key < 0n)  key = parent.length+Number(key)  // negative array indices
                   
                    // get single value
                    else {
                        if (key in parent) return parent[key];
                        else if (DX_SLOTS in parent && parent[DX_SLOTS]?.has(SLOT_GET)) return parent[DX_SLOTS].get(SLOT_GET)(key);
                        else return undefined;
                    }
                }
            }

            // was handled by custom pseudo class
            else return new_obj;
        },

        // set parent[key] = value
        setProperty(SCOPE:datex_scope, parent:any, key:any, value:any){

            if (parent instanceof UnresolvedValue) parent = parent[DX_VALUE];

            let o_parent:Pointer = Pointer.pointerifyValue(parent);
            if (!(o_parent instanceof Pointer)) o_parent = null;
            else o_parent.assertEndpointCanRead(SCOPE?.sender)

            key = Ref.collapseValue(key,true,true);
            
            // check read/write permission (throws an error)
            Runtime.runtime_actions.checkValueUpdatePermission(SCOPE, parent, key)

            // handle values without properties
            if (!Type.doesValueHaveProperties(parent)) {
                throw new PermissionError("Cannot set a property for value of type "+Type.ofValue(parent)+"", SCOPE);
            }

            // key is * -  set for all matching keys (recursive)
            if (key === WILDCARD) {
                parent = Ref.collapseValue(parent,true,true);
                // handle custom pseudo class
                if (JSInterface.hasPseudoClass(parent)) {
                    // void => clear
                    if (value === VOID) {
                        if (SCOPE.header.type==ProtocolDataType.UPDATE) o_parent?.excludeEndpointFromUpdates(SCOPE.sender);

                        let res = JSInterface.handleClear(parent, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                        // note: keys == NOT_EXISTING is always false since hasPseudoClass == true
                        if (res == INVALID || res == NOT_EXISTING) {
                            o_parent?.enableUpdatesForAll();
                            throw new ValueError("Cannot clear value", SCOPE);
                        }
                    }
                    else {
                        let keys = JSInterface.handleKeys(parent);
                        // note: keys == NOT_EXISTING is always false since hasPseudoClass == true
                        if (keys == INVALID || keys == NOT_EXISTING) throw new ValueError("Value has no iterable content", SCOPE);
                        Runtime.runtime_actions.setProperty(SCOPE, Pointer.pointerifyValue(parent), new Tuple(keys), value);
                    }
                }

                else if (value instanceof Tuple && (typeof parent == "object")) {
                    DatexObject.extend(parent, value); // link value, don't copy
                }
               
                // handle other objects
                else {
                    let keys:any[];
                    // create list of integer keys
                    if (parent instanceof Array) {
                        keys = [];
                        const N = parent.length;
                        let i = 0n;
                        while (i < N) keys[Number(i)] = i++;
                    }
                    // list of object property keys
                    else keys = Object.keys(parent);
                    if (!(Symbol.iterator in keys)) throw new RuntimeError("Value keys are not iterable", SCOPE);
                    Runtime.runtime_actions.setProperty(SCOPE, Pointer.pointerifyValue(parent), new Tuple(keys), value);
                }
                return;
            }

            // key is <Tuple> - set multiple properties (recursive)
            else if (key instanceof Tuple) {
                // distribute values over keys (tuple)
                if (value instanceof Tuple) {
                    for (let [k, v] of Object.entries(value)) {
                        Runtime.runtime_actions.setProperty(SCOPE, parent, k, v)
                    }
                }

                // set same value for all keys
                else {
                    for (let k of key.toArray()) Runtime.runtime_actions.setProperty(SCOPE, parent, k, value)
                }
                return;
            }
           

            parent = Ref.collapseValue(parent,true,true);
            value = Ref.collapseValue(value,true);

            // TODO permission handling
            // if (parent[DX_PERMISSIONS]?.[key] && !(<Filter>parent[DX_PERMISSIONS][key]).test(SCOPE.sender)) {
            //     throw new PermissionError("Cannot update this value");
            // }

            // get current value
            const current_value = JSInterface.handleGetProperty(parent, key)
            // value has not changed
            if (current_value === value) {
                return;
            }

            if (SCOPE.header.type==ProtocolDataType.UPDATE) o_parent?.excludeEndpointFromUpdates(SCOPE.sender);

            // custom types assign or delete
            let assigned;
            if (value === VOID) assigned = JSInterface.handleDeleteProperty(parent, key, undefined, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
            else assigned = JSInterface.handleSetProperty(parent, key, value, undefined, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);

            if (assigned === INVALID) {
                o_parent?.enableUpdatesForAll();
                throw new ValueError("Property '"+key.toString()+"' can not be "+ (value === VOID ? "deleted" : "set"), SCOPE);
            } 

            else if (assigned == NOT_EXISTING) {
                // invalid key type
                if (parent instanceof Array && (typeof key != "bigint")) {
                    o_parent?.enableUpdatesForAll();
                    throw new ValueError("Invalid key for <Array> - must be of type <integer>", SCOPE);
                } 
                else if (typeof key != "string" && !(parent instanceof Array)) {
                    o_parent?.enableUpdatesForAll();
                    throw new ValueError("Invalid key for <Object> - must be of type <text>", SCOPE);
                }
                // default hidden properties                
                else if (DEFAULT_HIDDEN_OBJECT_PROPERTIES.has(key)) {
                    o_parent?.enableUpdatesForAll();
                    throw new ValueError("Property '"+key.toString()+"' can not be " + (value === VOID ? "deleted" : "set"), SCOPE);
                }
                // handle endpoint properties
                else if (parent instanceof Endpoint) {
                    try {
                        parent.setProperty(key, value);
                    } catch (e) {
                        o_parent?.enableUpdatesForAll();
                        throw e;
                    }
                }
                // set value
                else {
                    if (parent instanceof Array && typeof key == "bigint" && key < 0n)  key = parent.length+Number(key)  // negative array indices
                    
                    // check template types first
                    const type = Type.ofValue(parent);

                    if (type.template && !type.isPropertyAllowed(key)) throw new ValueError("Property '" + key + "' does not exist");
                    if (type.template) type.assertPropertyValueAllowed(key, value)
                    
                    // check sealed tuple
                    if (parent instanceof Tuple && !parent.has(key)) throw new ValueError("Property '"+key.toString()+"' does not exist in <Tuple>", SCOPE)
                    
                    // now set the value
                    try {
                        if (value === VOID) {
                            delete parent[key]; // = void (delete)
                            if (parent instanceof Array && Number(key)+1==parent.length) Runtime.runtime_actions.trimArray(parent) // trim end
                        }
                        // set single value
                        else {
                            if (DX_SLOTS in parent && parent[DX_SLOTS]?.has(SLOT_SET) && !(key in parent)) return parent[DX_SLOTS].get(SLOT_SET)(key, value);
                            else parent[key] = value;
                        }
                    } catch (e) {
                        o_parent?.enableUpdatesForAll();
                        throw new RuntimeError("Property '"+key.toString()+"' is readonly or does not exist", SCOPE)
                    }
                }
            }
            o_parent?.enableUpdatesForAll();
        },

        async assignAction(SCOPE:datex_scope, action_type:BinaryCode, parent:any, key:any, value:any, current_val?:any) {

            current_val ??= await Runtime.runtime_actions.getProperty(SCOPE, parent, key)

            if (parent instanceof UnresolvedValue) parent = parent[DX_VALUE];

            let o_parent:Pointer = Pointer.pointerifyValue(current_val);
            if (!(o_parent instanceof Pointer)) o_parent = null;
            else o_parent.assertEndpointCanRead(SCOPE?.sender)

            key = Ref.collapseValue(key,true,true);

            // check read/write permission (throws an error)
            if (parent) Runtime.runtime_actions.checkValueUpdatePermission(SCOPE, parent, key)

            // key is * -  add for all matching keys (recursive)
            if (key === WILDCARD) {
                parent = Ref.collapseValue(parent);
                let keys:Iterable<any>;
                // handle custom pseudo class
                if (JSInterface.hasPseudoClass(parent)) {
                    let _keys = JSInterface.handleKeys(parent);
                    // note: keys == NOT_EXISTING is always false since hasPseudoClass == true
                    if (_keys == INVALID || _keys == NOT_EXISTING) throw new ValueError("Value has no iterable content", SCOPE);
                    keys = _keys;
                }
                // handle other objects
                else {
                    // create list of integer keys
                    if (parent instanceof Array) {
                        keys = [];
                        const N = parent.length;
                        let i = 0n;
                        while (i < N) keys[Number(i)] = i++;
                    }
                    // list of object property keys
                    else keys = Object.keys(parent);
                    if (!(Symbol.iterator in keys)) throw new RuntimeError("Value keys are not iterable", SCOPE);
                }
                await Runtime.runtime_actions.assignAction(SCOPE, action_type, Pointer.pointerifyValue(parent), new Tuple(keys), value);
                return;
            }

            // key is <Tuple> - multiple properties action (recursive)
            else if (key instanceof Tuple) {
                // TODO
                const array = key.toArray();
                // distribute values over keys
                if (value instanceof Tuple) {
                    for (let i=0; i<array.length; i++) {
                        await Runtime.runtime_actions.assignAction(SCOPE, action_type, parent, array[i], value[i])
                    }
                }
                // use same value for all keys
                else {
                    for (let k of array) await Runtime.runtime_actions.assignAction(SCOPE, action_type, parent, k, value)
                }
                return;
            }

            // custom += actions
            else if (action_type == BinaryCode.ADD) {
                // spread insert tuple
                if (value instanceof Tuple) {
                    if (current_val instanceof Array) {
                        for (let v of value.indexed) {
                            await Runtime.runtime_actions.assignAction(SCOPE, action_type, null, null, v, current_val);
                        }
                    }
                    else DatexObject.extend(current_val, value) // link value, don't copy

                    return;
                }
            } 
            


            current_val = Ref.collapseValue(current_val); // first make sure that current_val is actual value
            parent = Ref.collapseValue(parent);
            value = Ref.collapseValue(value);

            if (SCOPE.header.type==ProtocolDataType.UPDATE) o_parent?.excludeEndpointFromUpdates(SCOPE.sender);

            // custom types add
            let assigned = NOT_EXISTING //JSInterface.handlePropertyAction(action_type, current_val, value);

            if (assigned === INVALID) {
                o_parent?.enableUpdatesForAll();
                throw new ValueError("Could not perform property operation", SCOPE);
            }

            // handle default actions for primitives, ...
            else if (assigned == NOT_EXISTING) {

                 // DatexPrimitivePointers also collapsed
                const current_val_prim = Ref.collapseValue(current_val,true,true);
                const value_prim = Ref.collapseValue(value,true,true); // DatexPrimitivePointers also collapsed
                try {

                    const currentValIsIntegerRef = current_val instanceof Ref && typeof current_val.val == "bigint";
                    const currentValIsDecimalRef = current_val instanceof Ref && typeof current_val.val == "number";

                    // x.current_val ?= value
                    switch (action_type) {

                        case BinaryCode.ADD:
                            if (current_val instanceof Array && !(current_val instanceof Tuple)) current_val.push(value); // Array push (TODO array extend?)
                            else if (current_val instanceof Ref && typeof current_val.val == "string" && typeof value_prim == "string") await current_val.setVal(current_val.val + value_prim); // primitive pointer operations
                            else if (currentValIsDecimalRef && typeof value_prim == "number") await current_val.setVal(current_val.val + value_prim);
                            else if (currentValIsIntegerRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val + value_prim);
                            else if (currentValIsDecimalRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val + Number(value_prim));
                            else if (currentValIsIntegerRef && typeof value_prim == "number") throw new ValueError("Cannot apply a <decimal> value to an <integer> pointer", SCOPE);
                            else if (typeof current_val_prim == "number" && typeof value_prim == "number") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim+value_prim) // add
                            else if ((typeof current_val_prim == "number" && typeof value_prim == "bigint") || (typeof current_val_prim == "bigint" && typeof value_prim == "number")) Runtime.runtime_actions.setProperty(SCOPE, parent, key, Number(current_val_prim)+Number(value_prim)) // add
                            else if (typeof current_val_prim == "bigint" && typeof value_prim == "bigint") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim+value_prim) // add
                            else if (typeof current_val_prim == "string" && typeof value_prim == "string") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim+value_prim) // add
                            else {
                                try {
                                    Type.ofValue(current_val).handleActionAdd(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                                } catch (e) {
                                    if (e instanceof DatexError) throw e;
                                    else throw new ValueError("Failed to perform an add operation on this value", SCOPE);
                                }
                            }
                            break;

                        case BinaryCode.SUBTRACT:
                            if (current_val instanceof Array) Runtime.runtime_actions._removeItemFromArray(current_val, value); // Array splice
                            else if (currentValIsDecimalRef && typeof value_prim == "number") await current_val.setVal(current_val.val - value_prim); // primitive pointer operations
                            else if (currentValIsIntegerRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val - value_prim);
                            else if (currentValIsDecimalRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val - Number(value_prim));
                            else if (currentValIsIntegerRef && typeof value_prim == "number") throw new ValueError("Cannot apply a <decimal> value to an <integer> pointer", SCOPE);
                            else if (typeof current_val_prim == "number" && typeof value_prim == "number") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim-value_prim) // subtract
                            else if ((typeof current_val_prim == "number" && typeof value_prim == "bigint") || (typeof current_val_prim == "bigint" && typeof value_prim == "number")) Runtime.runtime_actions.setProperty(SCOPE, parent, key, Number(current_val_prim)-Number(value_prim)) // subtract
                            else if (typeof current_val_prim == "bigint" && typeof value_prim == "bigint") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim-value_prim) // subtract
                            else {
                                try {
                                    Type.ofValue(current_val).handleActionSubtract(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                                } catch (e) {
                                    if (e instanceof DatexError) throw e;
                                    else throw new ValueError("Failed to perform a subtract operation on this value", SCOPE)
                                }
                            }
                            break;

                        case BinaryCode.MULTIPLY:
                            if (currentValIsDecimalRef && typeof value_prim == "number") await current_val.setVal(current_val.val * value_prim); // primitive pointer operations
                            else if (currentValIsIntegerRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val * value_prim);
                            else if (currentValIsDecimalRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val * Number(value_prim));
                            else if (currentValIsIntegerRef && typeof value_prim == "number") throw new ValueError("Cannot apply a <decimal> value to an <integer> pointer", SCOPE);
                            else if (typeof current_val_prim == "number" && typeof value_prim == "number") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim*value_prim) // subtract
                            else if ((typeof current_val_prim == "number" && typeof value_prim == "bigint") || (typeof current_val_prim == "bigint" && typeof value_prim == "number")) Runtime.runtime_actions.setProperty(SCOPE, parent, key, Number(current_val_prim)*Number(value_prim)) // subtract
                            else if (typeof current_val_prim == "bigint" && typeof value_prim == "bigint") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim*value_prim) // subtract
                            else {
                                try {
                                    Type.ofValue(current_val).handleActionMultiply(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                                } catch (e) {
                                    if (e instanceof DatexError) throw e;
                                    else throw new ValueError("Failed to perform a multiply operation on this value", SCOPE)
                                }
                            }
                            break;

                        case BinaryCode.DIVIDE:
                            if (currentValIsDecimalRef && typeof value_prim == "number") await current_val.setVal(current_val.val / value_prim); // primitive pointer operations
                            else if (currentValIsIntegerRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val / value_prim);
                            else if (currentValIsDecimalRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val / Number(value_prim));
                            else if (currentValIsIntegerRef && typeof value_prim == "number") throw new ValueError("Cannot apply a <decimal> value to an <integer> pointer", SCOPE);
                            else if (typeof current_val_prim == "number" && typeof value_prim == "number") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim/value_prim) // subtract
                            else if ((typeof current_val_prim == "number" && typeof value_prim == "bigint") || (typeof current_val_prim == "bigint" && typeof value_prim == "number")) Runtime.runtime_actions.setProperty(SCOPE, parent, key, Number(current_val_prim)/Number(value_prim)) // subtract
                            else if (typeof current_val_prim == "bigint" && typeof value_prim == "bigint") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim/value_prim) // subtract
                            else {
                                try {
                                    Type.ofValue(current_val).handleActionDivide(current_val, value, false,  SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                                } catch (e) {
                                    if (e instanceof DatexError) throw e;
                                    else throw new ValueError("Failed to perform a divide operation on this value", SCOPE)
                                }
                            }
                            break;

                        case BinaryCode.POWER:
                            if (currentValIsDecimalRef && typeof value_prim == "number") await current_val.setVal(current_val.val ** value_prim); // primitive pointer operations
                            else if (currentValIsIntegerRef && typeof value_prim == "bigint") {
                                if (value_prim < 0) throw new ValueError("Cannot use a negative exponent with an integer")
                                else current_val.val = current_val.val ** value_prim;
                            }
                            else if (currentValIsDecimalRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val ** Number(value_prim));
                            else if (currentValIsIntegerRef && typeof value_prim == "number") throw new ValueError("Cannot apply a <decimal> value to an <integer> pointer", SCOPE);
                            else if (typeof current_val_prim == "number" && typeof value_prim == "number") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim**value_prim) // power
                            else if ((typeof current_val_prim == "number" && typeof value_prim == "bigint") || (typeof current_val_prim == "bigint" && typeof value_prim == "number")) Runtime.runtime_actions.setProperty(SCOPE, parent, key, Number(current_val_prim)**Number(value_prim)) // power
                            else if (typeof current_val_prim == "bigint" && typeof value_prim == "bigint") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim**value_prim) // power
                            else {
                                try {
                                    Type.ofValue(current_val).handleActionPower(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                                } catch (e) {
                                    if (e instanceof DatexError) throw e;
                                    else throw new ValueError("Failed to perform a power operation on this value", SCOPE)
                                }
                            }
                            break;

                        case BinaryCode.MODULO:
                            if (currentValIsDecimalRef && typeof value_prim == "number") await current_val.setVal(current_val.val % value_prim); // primitive pointer operations
                            else if (currentValIsIntegerRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val % value_prim);
                            else if (currentValIsDecimalRef && typeof value_prim == "bigint") await current_val.setVal(current_val.val % Number(value_prim));
                            else if (currentValIsIntegerRef && typeof value_prim == "number") throw new ValueError("Cannot apply a <decimal> value to an <integer> pointer", SCOPE);
                            else if (typeof current_val_prim == "number" && typeof value_prim == "number") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim%value_prim) // subtract
                            else if ((typeof current_val_prim == "number" && typeof value_prim == "bigint") || (typeof current_val_prim == "bigint" && typeof value_prim == "number")) Runtime.runtime_actions.setProperty(SCOPE, parent, key, Number(current_val_prim)%Number(value_prim)) // subtract
                            else if (typeof current_val_prim == "bigint" && typeof value_prim == "bigint") Runtime.runtime_actions.setProperty(SCOPE, parent, key, current_val_prim%value_prim) // subtract
                            else {
                                try {
                                    Type.ofValue(current_val).handleActionModulo(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                                } catch (e) {
                                    if (e instanceof DatexError) throw e;
                                    else throw new ValueError("Failed to perform a modulo operation on this value", SCOPE)
                                }
                            }
                            break;

                        case BinaryCode.AND:
                            try {
                                Type.ofValue(current_val).handleActionAnd(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                            } catch (e) {
                                if (e instanceof DatexError) throw e;
                                else throw new ValueError("Failed to perform an add operation on this value", SCOPE)
                            }
                            break;

                        case BinaryCode.OR:
                            try {
                                Type.ofValue(current_val).handleActionOr(current_val, value, false, SCOPE.header.type==ProtocolDataType.UPDATE ? SCOPE.sender : null);
                            } catch (e) {
                                if (e instanceof DatexError) throw e;
                                else throw new ValueError("Failed to perform an or operation on this value", SCOPE)
                            }
                            break;

                        // set reference
                        case BinaryCode.CREATE_POINTER:

                            if (current_val instanceof Pointer) current_val.val = value_prim; // primitive pointer value update
                            else throw new ValueError("Pointer value assignment not possible on this value", SCOPE)
                            break;

                        default:
                            throw new RuntimeError("Unsupported assignment operation", SCOPE);
                    }

                } catch (e) {
                    console.log(e);
                    o_parent?.enableUpdatesForAll();
                    if (e instanceof DatexError) throw e;
                    throw new PermissionError("Cannot change a readonly value", SCOPE);
                }
            }
            
            o_parent?.enableUpdatesForAll();

        },
            
        _removeItemFromArray(arr:any[], value:any){
            let i = 0;
            while (i < arr.length) {
                if (arr[i] === value) arr.splice(i, 1);
                else ++i;
            }
        },


        extractScopeBlock(SCOPE:datex_scope):ArrayBuffer|false {
            
            // Compiled buffer
            /** wait for buffer */
            if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/

            let buffer_length = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
            SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;

            if (buffer_length == 0) return undefined;

            /** wait for buffer */
            if (SCOPE.current_index+buffer_length > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/

            let _buffer = SCOPE.buffer_views.buffer.slice(SCOPE.current_index, SCOPE.current_index+buffer_length);
            SCOPE.current_index += buffer_length;

            return _buffer;
        },

        extractVariableName(SCOPE:datex_scope):string|number|false  {
            /** wait for buffer */
            if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/

            let length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
            let name:string|number;
            if (length == 0) { // binary name (2 byte number)
                /** wait for buffer */
                if (SCOPE.current_index+Uint16Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return false;
                /********************/
                name = SCOPE.buffer_views.data_view.getUint16(SCOPE.current_index, true);
                SCOPE.current_index += Uint16Array.BYTES_PER_ELEMENT;
            }
            else {
                /** wait for buffer */
                if (SCOPE.current_index+length > SCOPE.buffer_views.uint8.byteLength) return false;
                /********************/
                name = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+length));
                SCOPE.current_index += length;
            }
            return name;
        },

        extractType(SCOPE:datex_scope, is_extended_type = false):[Type,boolean]|false|Type {
            /** wait for buffer */
            if (SCOPE.current_index+2+(is_extended_type?2:0) > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/
            let ns_length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
            let name_length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
            let variation_length = 0;
            let has_parameters;
            if (is_extended_type) {
                variation_length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                has_parameters = SCOPE.buffer_views.uint8[SCOPE.current_index++] ? true : false;
            }

            /** wait for buffer */
            if (SCOPE.current_index+ns_length+name_length+variation_length > SCOPE.buffer_views.uint8.byteLength) return false;
            /********************/

            let ns = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index += ns_length));
            let type = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index += name_length));
            let varation:string;
            if (is_extended_type) {
                varation = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index += variation_length));
            }

            return is_extended_type ? [Type.get(ns, type, varation), has_parameters] : Type.get(ns, type, varation);
        },

        // create a clone of the SCOPE in the current state
        forkScope(SCOPE:datex_scope): datex_scope {
            let structuredClone = globalThis.structuredClone;
            
            const forked_scope:datex_scope = {
                sid: SCOPE.sid,
                header: SCOPE.header,
                sender: SCOPE.sender,
                origin: SCOPE.origin,
                current_index: SCOPE.current_index,
                start_index: SCOPE.start_index,
                index_offset: SCOPE.index_offset,
                cache_previous: SCOPE.cache_previous,
                cache_after_index: SCOPE.cache_after_index,
                context: SCOPE.context,
                sync: SCOPE.sync,
                result: SCOPE.result,
                closed: SCOPE.closed,
                persistent_vars: [...SCOPE.persistent_vars],
                internal_vars: {...SCOPE.internal_vars},
                execution_permission: SCOPE.execution_permission,
                impersonation_permission: SCOPE.impersonation_permission,
                sub_scopes: [],
                meta: {...SCOPE.meta},
                remote: {...SCOPE.remote},
                buffer_views: {...SCOPE.buffer_views},
                inner_scope: undefined
            };

            for (let s of SCOPE.sub_scopes) {
                forked_scope.sub_scopes.push({
                    result: s.result,
                    is_outer_scope: s.is_outer_scope,
                    type_casts: s.type_casts,

                    ctx_intern: s.ctx_intern,

                    last_insert_value: s.last_insert_value,
                    active_object: s.active_object,
                    auto_obj_index: s.auto_obj_index,
                    active_object_new: s.active_object_new,
                    waiting_key: s.waiting_key,
                    waiting_internal_slot: s.waiting_internal_slot,
                    waiting_ptrs: s.waiting_ptrs,
                    waiting_internal_vars: s.waiting_internal_vars,

                    waiting_ext_type: s.waiting_ext_type,
                    waiting_labels: s.waiting_labels,

                    waiting_for_child: s.waiting_for_child,
                    waiting_for_child_action: s.waiting_for_child_action,

                    return: s.return,

                    waiting_range: s.waiting_range,

                    waiting_collapse: s.waiting_collapse,

                    compare_type: s.compare_type,

                    about: s.about,
                    count: s.count,
                    get: s.get,

                    waiting_for_action: s.waiting_for_action,
                    create_pointer: s.create_pointer,
                    delete_pointer: s.delete_pointer,
                    sync: s.sync,
                    copy: s.copy,
                    get_type: s.get_type,
                    get_origin: s.get_origin,
                    get_subscribers: s.get_subscribers,

                    active_value: s.active_value,
                    
                    auto_exit: s.auto_exit,

                    stream_consumer: s.stream_consumer,

                    jmp: s.jmp,
                    jmp_true: s.jmp_true,

                    operator: s.operator,
                    negate_operator: s.negate_operator
                })
            }
            forked_scope.inner_scope = forked_scope.sub_scopes[forked_scope.sub_scopes.length-1]

            return forked_scope;
        },


        // add float, int, person, ... to right parent in scope
        // if literal_value = true, treat types as values
        async insertToScope(SCOPE:datex_scope, el:any, literal_value = false){

            const INNER_SCOPE = SCOPE.inner_scope;

            // check pointer access permission
            const pointer = el instanceof Pointer ? el : Pointer.getByValue(el);
            if (pointer instanceof Pointer) pointer.assertEndpointCanRead(SCOPE?.sender)
            
            // first make sure pointers are collapsed
            el = Ref.collapseValue(el) 

            // collapse Maybes (TODO)
            //if (el instanceof Maybe) el = await el.value;

            /** First handle strongly bound modifiers (template, type casts, spread operator, negation, ...)*/

            // template <> () - ignores type cast!! (TODO change?)
            if (INNER_SCOPE.template) {
                if (INNER_SCOPE.template === true) {
                    if (el instanceof Type) {
                        INNER_SCOPE.template = el;
                        return;
                    }
                    else throw new RuntimeError("Invalid template definition");
                }
                else if (INNER_SCOPE.template instanceof Type) {
                    if (typeof el == "object") {
                        INNER_SCOPE.template.setTemplate(el);
                        delete INNER_SCOPE.template;
                    }
                    else throw new RuntimeError("Invalid template definition");
              
                    return;
                }
                else throw new RuntimeError("Invalid template definition");
            }
            // new ignore type cast

            // new
            else if (INNER_SCOPE.wait_new) {
                if (!(el instanceof Type)) throw new ValueError("first parameter for 'new' must be of type <Type>")
                INNER_SCOPE.new_type = el;
                delete INNER_SCOPE.wait_new;
                return;
            }

            // get scope block vars (wait for pointer property key )
            if (INNER_SCOPE.scope_block_for && SCOPE.buffer_views.uint8[SCOPE.current_index] != BinaryCode.CHILD_GET_REF) {
                INNER_SCOPE.scope_block_vars.push(Pointer.pointerifyValue(el));
                return;
            }

            if (INNER_SCOPE.wait_dynamic_key) {
                const key = el;
                // add key for next value
                INNER_SCOPE.waiting_key = key;       
                INNER_SCOPE.wait_dynamic_key = false;
                Runtime.runtime_actions.enterSubScope(SCOPE);
                return;
            }

            if (INNER_SCOPE.wait_iterator) {
                // TODO
                return;
            }

            if (INNER_SCOPE.wait_await) {
                if (el instanceof Task) {
                    // only tasks with reference can be awaited, otherwise they cannot be observed
                    if (!Pointer.getByValue(el)) throw new RuntimeError("Cannot await a Task that has no reference");
                    delete INNER_SCOPE.wait_await;
                    const task = el;
                    INNER_SCOPE.active_value = await task.promise;
                    return;
                }
                else if (el instanceof Tuple) {
                    delete INNER_SCOPE.wait_await;
                    INNER_SCOPE.active_value = await Promise.all(el.indexed.map(v=>v.promise)); // TODO await non-local task
                    return;
                }
            }

            if (INNER_SCOPE.wait_next) {
                if (el instanceof Iterator) {
                    INNER_SCOPE.active_value = await el.next();
                    SCOPE.it = el.val;
                    delete INNER_SCOPE.wait_next;
                    return;
                }
                else throw new RuntimeError("The 'next' command requires an <Iterator>");
            }

            // negation? (~) - before connective!
            if (INNER_SCOPE.negate_operator) {

                // logical
                if (el instanceof Logical) {
                    el = el.not();
                }
                else if (el instanceof Target || el instanceof Type) {
                    el = new Negation(el)
                }
         
                else if (typeof el == "boolean" || typeof (el = Ref.collapseValue(el, true, true)) == "boolean" ) {
                    el = !el;
                }
                else throw(new ValueError("Cannot negate this value ("+Runtime.valueToDatexString(el)+")", SCOPE))               
                
                delete INNER_SCOPE.negate_operator;
            }

            // add connective element
            if ('connective_size' in INNER_SCOPE) {
                if (INNER_SCOPE.connective_size > 0) {
                    INNER_SCOPE.connective.add(el);
                    INNER_SCOPE.connective_size--;
                }
                if (INNER_SCOPE.connective_size == 0) {
                    INNER_SCOPE.active_value = INNER_SCOPE.connective;
                    delete INNER_SCOPE.connective;
                    delete INNER_SCOPE.connective_size;
                    const res = await Runtime.runtime_actions.exitSubScope(SCOPE);
                    await Runtime.runtime_actions.insertToScope(SCOPE, res);
                }
                return;
            }

            // type parameters <x()> - required for type cast
            if (INNER_SCOPE.waiting_ext_type) {
                if (!(el instanceof Tuple)) el = new Tuple([el]);
                if (el.size) el = INNER_SCOPE.waiting_ext_type.getParametrized((<Tuple>el).toArray());
                else el = INNER_SCOPE.waiting_ext_type;
                INNER_SCOPE.waiting_ext_type = null;
            }

            
            // add to casts, if not followed by end bin code -> interpret as actual type value
            if (!literal_value && el instanceof Type && !(Runtime.END_BIN_CODES.includes(SCOPE.buffer_views.uint8[SCOPE.current_index]) || SCOPE.buffer_views.uint8[SCOPE.current_index] == BinaryCode.CHILD_GET || SCOPE.buffer_views.uint8[SCOPE.current_index] == BinaryCode.CHILD_GET_REF)) {
                if (!INNER_SCOPE.type_casts) INNER_SCOPE.type_casts = [];
                INNER_SCOPE.type_casts.push(el)
                return;
            }


            // apply all casts 
            if (INNER_SCOPE.type_casts) {
                let type:Type
                while (type = INNER_SCOPE.type_casts.pop()) {
                    // workaround to get pointer that the new cast value will be assigned to
                    const waitingPtr = [...INNER_SCOPE.waiting_ptrs??[]][0];
                    let ptrId: string|undefined;
                    if (waitingPtr && (typeof waitingPtr[1] == "object" || waitingPtr[1] == undefined)) ptrId = waitingPtr[0].id;
                    el = await Runtime.castValue(type, el, INNER_SCOPE.ctx_intern, SCOPE.context_location, SCOPE.origin, undefined, ptrId)
                }
            }

           

            // handle child get
            if (INNER_SCOPE.waiting_for_child == 1) {
                el = await Runtime.runtime_actions.getProperty(SCOPE, INNER_SCOPE.active_value, el);
                delete INNER_SCOPE.active_value; // no longer exists
                INNER_SCOPE.waiting_for_child = 0;
                // ... continue (insert new el)
            }

            // handle child get (referenced child if pointer)
            else if (INNER_SCOPE.waiting_for_child == 2) {
                el = Runtime.runtime_actions.getReferencedProperty(SCOPE, INNER_SCOPE.active_value, el);
                delete INNER_SCOPE.active_value; // no longer exists
                INNER_SCOPE.waiting_for_child = 0;
                // ... continue (insert new el)
            }

            // handle child set/add/...
            else if (INNER_SCOPE.waiting_for_child_action) {
                if (!INNER_SCOPE.waiting_for_action) INNER_SCOPE.waiting_for_action = [];
                INNER_SCOPE.waiting_for_action.push([INNER_SCOPE.waiting_for_child_action, INNER_SCOPE.active_value, el]);
                delete INNER_SCOPE.active_value; // no longer exists
                delete INNER_SCOPE.waiting_for_child_action;
                return;
            }


            // child path coming afterwards?, create new subscope (if not already created => auto_exit), set active value and return
            if (!INNER_SCOPE.auto_exit && (SCOPE.buffer_views.uint8[SCOPE.current_index] == BinaryCode.CHILD_GET || SCOPE.buffer_views.uint8[SCOPE.current_index] == BinaryCode.CHILD_GET_REF)) {
                Runtime.runtime_actions.enterSubScope(SCOPE);
                SCOPE.inner_scope.active_value = el;
                SCOPE.inner_scope.auto_exit = 1; // auto exit subscope at next possible position
                return;
            }


            if (INNER_SCOPE.waiting_for_key_perm) {
                INNER_SCOPE.waiting_for_key_perm = false;
                if (el instanceof Logical || el instanceof Target) INNER_SCOPE.key_perm = el;
                else throw new ValueError("Invalid permission prefix, must be <Target>")

                return;
            }


            /************************** */



            // now insert value:

            // range (before path handling)
            if (INNER_SCOPE.waiting_range) {
                // add to range
                if (INNER_SCOPE.waiting_range.length < 2) INNER_SCOPE.waiting_range.push(el)
                // is range closed?
                if (INNER_SCOPE.waiting_range.length == 2) {
                    INNER_SCOPE.active_value = $$(new RangeIterator(INNER_SCOPE.waiting_range[0], INNER_SCOPE.waiting_range[1]))// Tuple.generateRange(INNER_SCOPE.waiting_range[0], INNER_SCOPE.waiting_range[1]); // new el is the generated range <Tuple>
                    INNER_SCOPE.waiting_range = null; // range closed
                }
            }
            

            // insert
            
            // inside Array
            else if (INNER_SCOPE.active_object && (INNER_SCOPE.active_object instanceof Array)) {
                // collapse ...
                if (INNER_SCOPE.waiting_collapse) {
                    INNER_SCOPE.waiting_collapse = false;

                    if (el instanceof Iterator) INNER_SCOPE.active_object.push(...(await el.collapse()).toArray());
                    else if (el instanceof Tuple) INNER_SCOPE.active_object.push(...el.toArray());
                    else if (el instanceof Array) INNER_SCOPE.active_object.push(...el);
                    else throw new ValueError("Cannot collapse value")
                }

                // key insert (integer)
                else if ('waiting_key' in INNER_SCOPE) {
                    if (typeof INNER_SCOPE.waiting_key == "bigint") INNER_SCOPE.active_object[Number(INNER_SCOPE.waiting_key)] = el;
                    else throw new ValueError("<Array> key must be <integer>");

                    // add key permission
                    if (INNER_SCOPE.key_perm) {
                        console.log("array key permission", INNER_SCOPE.waiting_key, INNER_SCOPE.key_perm, el);
                        if (!INNER_SCOPE.active_object[DX_PERMISSIONS]) INNER_SCOPE.active_object[DX_PERMISSIONS] = {};
                        INNER_SCOPE.active_object[DX_PERMISSIONS][INNER_SCOPE.waiting_key] = INNER_SCOPE.key_perm;
                        delete INNER_SCOPE.key_perm;
                    }

                    delete INNER_SCOPE.waiting_key;
                }

                // internal slot 
                else if ('waiting_internal_slot' in INNER_SCOPE) {
                    if (!INNER_SCOPE.active_object[DX_SLOTS]) INNER_SCOPE.active_object[DX_SLOTS] = new Map<number,any>();
                    INNER_SCOPE.active_object[DX_SLOTS].set(INNER_SCOPE.waiting_internal_slot, el);
                    delete INNER_SCOPE.waiting_internal_slot;
                }

                // insert normally into array
                else INNER_SCOPE.active_object.push(el)
            }
            
            // inside Tuple
            else if (INNER_SCOPE.active_object && (INNER_SCOPE.active_object instanceof Tuple)) {
                // collapse ...
                if (INNER_SCOPE.waiting_collapse) {
                    INNER_SCOPE.waiting_collapse = false;

                    if (el instanceof Iterator) INNER_SCOPE.active_object.push(...(await el.collapse()).toArray());
                    else if (el instanceof Tuple) INNER_SCOPE.active_object.spread(el);
                    else if (el instanceof Array) INNER_SCOPE.active_object.push(...el);
                    else throw new ValueError("Cannot collapse value")
                }

                // key insert
                else if ('waiting_key' in INNER_SCOPE) {
                    INNER_SCOPE.active_object.set(INNER_SCOPE.waiting_key, el);

                    // add key permission
                    if (INNER_SCOPE.key_perm) {
                        console.log("tuple key permission", INNER_SCOPE.waiting_key, INNER_SCOPE.key_perm, el);
                        if (!INNER_SCOPE.active_object[DX_PERMISSIONS]) INNER_SCOPE.active_object[DX_PERMISSIONS] = {};
                        INNER_SCOPE.active_object[DX_PERMISSIONS][INNER_SCOPE.waiting_key] = INNER_SCOPE.key_perm;
                        delete INNER_SCOPE.key_perm;
                    }

                    delete INNER_SCOPE.waiting_key;
                }

                // internal slot 
                else if ('waiting_internal_slot' in INNER_SCOPE) {
                    if (!INNER_SCOPE.active_object[DX_SLOTS]) INNER_SCOPE.active_object[DX_SLOTS] = new Map<number,any>();
                    INNER_SCOPE.active_object[DX_SLOTS].set(INNER_SCOPE.waiting_internal_slot, el);
                    delete INNER_SCOPE.waiting_internal_slot;
                }

                // push
                else {
                    INNER_SCOPE.active_object.push(el);
                }
                
            }
            
            // inside Object / Tuple and has key
            else if (INNER_SCOPE.active_object && (INNER_SCOPE.waiting_collapse || 'waiting_key' in INNER_SCOPE || 'waiting_internal_slot' in INNER_SCOPE)) {

                // collapse ...
                if (INNER_SCOPE.waiting_collapse) {
                    INNER_SCOPE.waiting_collapse = false;

                    if (el instanceof Tuple) Object.assign(INNER_SCOPE.active_object, el.toObject());
                    else if (Type.ofValue(el) == Type.std.Object || Type.ofValue(el) == Type.js.NativeObject) Object.assign(INNER_SCOPE.active_object, el)
                    else throw new ValueError("Cannot collapse value")
                }

                // key insert
                else if ('waiting_key' in INNER_SCOPE) {
                    if (typeof INNER_SCOPE.waiting_key == "string") INNER_SCOPE.active_object[INNER_SCOPE.waiting_key] = el;
                    else throw new ValueError("<Object> key must be <text>");

                    // add key permission
                    if (INNER_SCOPE.key_perm) {
                        console.log("object key permission", INNER_SCOPE.waiting_key, INNER_SCOPE.key_perm, el);
                        if (!INNER_SCOPE.active_object[DX_PERMISSIONS]) INNER_SCOPE.active_object[DX_PERMISSIONS] = {};
                        INNER_SCOPE.active_object[DX_PERMISSIONS][INNER_SCOPE.waiting_key] = INNER_SCOPE.key_perm;
                        delete INNER_SCOPE.key_perm;
                    }

                    delete INNER_SCOPE.waiting_key;
                }

                // internal slot 
                else if ('waiting_internal_slot' in INNER_SCOPE) {
                    if (!INNER_SCOPE.active_object[DX_SLOTS]) INNER_SCOPE.active_object[DX_SLOTS] = new Map<number,any>();
                    INNER_SCOPE.active_object[DX_SLOTS].set(INNER_SCOPE.waiting_internal_slot, el);
                    delete INNER_SCOPE.waiting_internal_slot;
                }
   
            }
            
            // jtr or jfa
            else if (INNER_SCOPE.jmp) {
                // falsish values: void, null, false, 0, 0.0
                const is_true = (el !== VOID && el !== false && el !== 0 && el !== 0n && el !== null);
                if ((INNER_SCOPE.jmp_true && is_true) || (!INNER_SCOPE.jmp_true && !is_true)) {
                    SCOPE.current_index = INNER_SCOPE.jmp;
                }
                await Runtime.runtime_actions.newSubScope(SCOPE);
            }

            /**
             * modifications (operations) on a single value (el) =>
            */


            // $$ create pointer (or just proxify if already a pointer)
            else if (INNER_SCOPE.create_pointer || INNER_SCOPE.delete_pointer) {
                if (INNER_SCOPE.create_pointer) {
                    INNER_SCOPE.create_pointer = false;
                    // TODO: handle pointer permission, currently enabled for all
                    // if (!SCOPE.impersonation_permission) throw new PermissionError("No permission to create pointers on this endpoint", SCOPE)
                    INNER_SCOPE.active_value = Pointer.createOrGet(el)
                }
          
                // immediately delete pointer
                if (INNER_SCOPE.delete_pointer) {
                    delete INNER_SCOPE.active_value;
                    INNER_SCOPE.delete_pointer = false;
                    // TODO: handle pointer permission, currently enabled for all
                    // if (!SCOPE.impersonation_permission) throw new PermissionError("No permission to delete pointers on this endpoint", SCOPE)
                    el = Pointer.pointerifyValue(el); // try proxify
                    // try delete
                    if (el instanceof Pointer ) el.delete()
                    else throw new PermissionError("Cannot delete non-pointer", SCOPE)
                    return;
                }
            }

            // sync pointer
            else if (INNER_SCOPE.sync) {
                const silent = INNER_SCOPE.sync == "silent"; // dont send value back
                INNER_SCOPE.sync = false;
                SCOPE.sync = false;

                const pointer = Pointer.pointerifyValue(el);

                if (!(pointer instanceof Ref) || (pointer instanceof Pointer && pointer.is_anonymous)) {
                    throw new ValueError("sync expects a reference value", SCOPE);
                }

                // sync consumer
                const to = INNER_SCOPE.active_value;

                INNER_SCOPE.active_value = VOID;

                // is an endpoint -> subscribe to pointer updates
                if (to instanceof Endpoint) {
                    if (!(pointer instanceof Pointer) || pointer.is_anonymous) throw new ValueError("sync expects a pointer value", SCOPE);

                    
                    // remote sender, only allowed if endpoint equals sender
                    if (!Runtime.endpoint.equals(SCOPE.sender) /*remote sender*/ && !SCOPE.sender.equals(to) /** different endpoint than sender */) {
                        if (!SCOPE.sender.equals(to)) throw new PointerError("Sender has no permission to sync pointer to another origin", SCOPE);
                    }

                    pointer.addSubscriber(SCOPE.sender);
                    if (!silent) INNER_SCOPE.active_value = await Runtime.cloneValue(pointer.val);

                    // }
                    // // redirect to actual parent
                    // else {
                    //     throw new PermissionError("Cannot sync pointer with remote origin " + pointer.origin, SCOPE)
                    // }

                }

                else if (to instanceof DatexFunction) {
                    // TODO check function signature?
                    pointer.observe(<any>to);
                }

                // convert value to stream (writes to stream everytime the pointer value changes)
                else if (to instanceof Stream) {
                    to.write(Ref.collapseValue(pointer, true, true)); // current value as initial value
                    pointer.observe((v,k,t)=>{
                        if (t == Ref.UPDATE_TYPE.INIT) to.write(v);
                    });
                }

                else {
                    throw new ValueError("Value must match <SyncConsumer>")
                }
                
            }

            // stop sync pointer
            else if (INNER_SCOPE.stop_sync) {
                INNER_SCOPE.stop_sync = false;

                let pointer = Pointer.pointerifyValue(el);

                if (!(pointer instanceof Ref) || (pointer instanceof Pointer && pointer.is_anonymous)) throw new ValueError("stop sync expects a reference value", SCOPE);

                // is a sync consumer
                const to = INNER_SCOPE.active_value;

                // is an endpoint -> unsubscribe from pointer updates
                if (to instanceof Endpoint) {
                    if (!(pointer instanceof Pointer) || pointer.is_anonymous) throw new ValueError("stop sync expects a pointer value", SCOPE);

                    // TODO also check pointer permission for 'to'

                    // request sync endpoint is self, cannot subscribe to own pointers!
                    if (Runtime.endpoint.equals(to)) {
                        throw new PointerError("Cannot stop sync pointer with own origin", SCOPE);
                    }
                    // remote sender, only allowed if endpoint equals sender
                    if (!Runtime.endpoint.equals(SCOPE.sender) /*remote sender*/ && !SCOPE.sender.equals(to) /** different endpoint than sender */) {
                        if (!SCOPE.sender.equals(to)) throw new PointerError("Sender has no permission to stop sync pointer to another origin", SCOPE);
                    }

                    // not existing pointer or no access to this pointer
                    if (!pointer.value_initialized) throw new PointerError("Pointer does not exist", SCOPE)
                    // valid, remove subscriber
                    else {
                        pointer.removeSubscriber(SCOPE.sender);
                        INNER_SCOPE.active_value = VOID;
                    }
                    
                    // // redirect to actual parent
                    // else {
                    //     throw new PermissionError("Cannot stop sync pointer with remote origin " + pointer.origin, SCOPE)
                    // }

                }
                
            }

            // else if (INNER_SCOPE.unsubscribe) {
            //     INNER_SCOPE.unsubscribe = false;
            //     SCOPE.unsubscribe = false;

            //     let pointer = Pointer.pointerifyValue(el);
            //     logger.success(SCOPE.sender + " unsubscribed from " + pointer);
            //     if (pointer instanceof Pointer && !pointer.is_anonymous) {
            //         // is parent of this pointer
            //         if (pointer.is_origin) {
            //             pointer.removeSubscriber(SCOPE.sender);
            //             return;
            //         }
            //         // redirect to actual parent
            //         else {
            //             throw new PermissionError("Cannot unsubscribe from pointer with remote origin", SCOPE)
            //         }
            //     }
            //     else throw new ValueError("Cannot unsubscribe from a non-pointer", SCOPE);
            // }

            else if (INNER_SCOPE.copy) {
                try {
                    INNER_SCOPE.active_value = await Runtime.cloneValue(el);
                }
                catch (e) {
                    if (e instanceof DatexError) e.addScopeToStack(SCOPE);
                    throw e;
                }
                INNER_SCOPE.copy = false;
            }
            else if (INNER_SCOPE.clone) {
                try {
                    INNER_SCOPE.active_value = await Runtime.deepCloneValue(el);
                }
                catch (e) {
                    if (e instanceof DatexError) e.addScopeToStack(SCOPE);
                    throw e;
                }
                INNER_SCOPE.clone = false;
            }

            else if (INNER_SCOPE.clone_collapse) {
                try {
                    INNER_SCOPE.active_value = await Runtime.collapseCloneValue(el);
                }
                catch (e) {
                    if (e instanceof DatexError) e.addScopeToStack(SCOPE);
                    throw e;
                }
                INNER_SCOPE.clone_collapse = false;
            }

            else if (INNER_SCOPE.collapse) {
                try {
                    INNER_SCOPE.active_value = Logical.collapse(el, Target);
                }
                catch (e) {
                    if (e instanceof DatexError) e.addScopeToStack(SCOPE);
                    throw e;
                }
                INNER_SCOPE.collapse = false;
            }

            else if (INNER_SCOPE.get_type) {
                INNER_SCOPE.active_value = Type.ofValue(el); // get type for value
                INNER_SCOPE.get_type = false;
            }

            else if (INNER_SCOPE.get_origin) {
                INNER_SCOPE.get_origin = false;
                let pointer = Pointer.pointerifyValue(el);
                if (pointer instanceof Pointer && !pointer.is_anonymous) {
                    INNER_SCOPE.active_value = pointer.origin;
                }
                else throw new ValueError("Cannot get origin of a non-pointer", SCOPE);
            }

            else if (INNER_SCOPE.get_subscribers) {
                INNER_SCOPE.get_subscribers = false;
                let pointer = Pointer.pointerifyValue(el);
                if (pointer instanceof Pointer && !pointer.is_anonymous) {
                    INNER_SCOPE.active_value = pointer.subscribers;
                }
                else throw new ValueError("Cannot get subscribers of a non-pointer", SCOPE);
            }

            // <Type> extends <ParentType>
            else if (INNER_SCOPE.wait_extends) {
                INNER_SCOPE.wait_extends = false;
                if (INNER_SCOPE.active_value instanceof Type && el instanceof Type) {
                    INNER_SCOPE.active_value = el.template && DatexObject.extends(INNER_SCOPE.active_value.template, el.template);
                }
                else if (typeof INNER_SCOPE.active_value == "object") {
                    INNER_SCOPE.active_value = DatexObject.extends(INNER_SCOPE.active_value, el);
                }
                else if ("active_value" in INNER_SCOPE && Type.ofValue(INNER_SCOPE.active_value).is_primitive) throw new RuntimeError("A primitive value cannot extend a value", SCOPE);
                else if ("active_value" in INNER_SCOPE) INNER_SCOPE.active_value = false;
                else throw new RuntimeError("Invalid 'extends' command", SCOPE);
            }

            // value matches <Type>, @alias matches filter
            else if (INNER_SCOPE.wait_matches) {
                INNER_SCOPE.wait_matches = false;
                // TODO: how to handle the matches command (currently different for types and everything else:)
                if (el instanceof Type) {
                    INNER_SCOPE.active_value = el.matches(INNER_SCOPE.active_value);
                }
                else {
                    INNER_SCOPE.active_value = Logical.matches(INNER_SCOPE.active_value, el);
                }
                // else if (INNER_SCOPE.active_value instanceof Endpoint && el instanceof Logical) {
                //     // TODO
                // }
                // else if (el instanceof Logical) {
                //     INNER_SCOPE.active_value = Type.matches(INNER_SCOPE.active_value, el);
                // }
                // else if (INNER_SCOPE.active_value instanceof Endpoint && el instanceof Endpoint) {
                //     INNER_SCOPE.active_value = el.equals(INNER_SCOPE.active_value);
                // }
                // else if (!("active_value" in INNER_SCOPE)) throw new RuntimeError("Invalid 'matches' command", SCOPE);
                // else throw new RuntimeError("Invalid values for 'matches' command", SCOPE);
            }

            // <Type> implements <ParentType>
            else if (INNER_SCOPE.wait_implements) {
                INNER_SCOPE.wait_implements = false;
                if (INNER_SCOPE.active_value instanceof Type && el instanceof Type) {
                    INNER_SCOPE.active_value = el.matchesType(INNER_SCOPE.active_value)
                }
                else if ((INNER_SCOPE.active_value instanceof Logical || INNER_SCOPE.active_value instanceof Type) && (el instanceof Logical || el instanceof Type)) {
                    INNER_SCOPE.active_value = Type.matchesType(INNER_SCOPE.active_value, el);
                }
                else throw new RuntimeError("'implements' must check a <Type> against a <Type>", SCOPE);
                //else if (!("active_value" in INNER_SCOPE)) throw new RuntimeError("Invalid 'implements' command", SCOPE);
            }


            // [1,2,3] has 1 
            else if (INNER_SCOPE.has) {
                INNER_SCOPE.active_value = await Runtime.runtime_actions.has(SCOPE, INNER_SCOPE.active_value, el);
                delete INNER_SCOPE.has;
            }

            else if (INNER_SCOPE.wait_freeze) {
                INNER_SCOPE.wait_freeze = false;
                if (Type.ofValue(el).is_primitive) throw new RuntimeError("Cannot freeze a primitive value", SCOPE);
                else INNER_SCOPE.active_value = DatexObject.freeze(el)
            }

            else if (INNER_SCOPE.wait_seal) {
                INNER_SCOPE.wait_seal = false;
                if (Type.ofValue(el).is_primitive) throw new RuntimeError("Cannot seal a primitive value", SCOPE);
                else INNER_SCOPE.active_value = DatexObject.seal(el)
            }
            // store value in blockchain
            // else if (INNER_SCOPE.wait_store) {
            //     const transaction = new BlockchainTransaction({data:el, type:1})
            //     INNER_SCOPE.active_value = transaction;
            //     // TODO send to blockchain
            //     INNER_SCOPE.wait_store = false;
            // }

            /** 
             * handle multiple other value operations or assignments (using INNER_SCOPE.active_value)
             */

            // stream
            else if (SCOPE.inner_scope.stream_consumer) {
                el = Ref.collapseValue(el, true, true); // collapse primitive values

                // pipe stream
                if (el instanceof Stream) {
                     SCOPE.inner_scope.stream_consumer.pipe(el, SCOPE)
                     INNER_SCOPE.stream_consumer = el; // set current el as new stream_reader
                     console.log("pipe << ", el)
                }

                // write next to stream
                else {
                    SCOPE.inner_scope.stream_consumer.write(el, SCOPE);
                }
            }

            // compare
            else if ("compare_type" in INNER_SCOPE) {

                let is_true = false;

                let a = Ref.collapseValue(INNER_SCOPE.active_value,true); // only collapse pointer properties, keep primitive pointers
                let b = Ref.collapseValue(el,true);

                
                let compared;
                // special compare -> strong EQUAL (referening same endpoint, but possibly different values)
                if (a instanceof Endpoint && b instanceof Endpoint && (INNER_SCOPE.compare_type == BinaryCode.EQUAL || INNER_SCOPE.compare_type == BinaryCode.NOT_EQUAL)) {
                    switch (INNER_SCOPE.compare_type) {
                        case BinaryCode.EQUAL:          is_true = a.equals(b); compared = true; break;
                        case BinaryCode.NOT_EQUAL:      is_true = !a.equals(b); compared = true; break;
                    } 
                }


                // test conditions
                if (!compared) {
                    switch (INNER_SCOPE.compare_type) {
                        // strong equal (reference, same object/value/pointer)
                        case BinaryCode.EQUAL:           is_true = a === b; break;
                        case BinaryCode.NOT_EQUAL:       is_true = a !== b; break;
                        // value equal
                        case BinaryCode.EQUAL_VALUE:     is_true = await Runtime.equalValues(a,b); break;
                        case BinaryCode.NOT_EQUAL_VALUE: is_true = ! (await Runtime.equalValues(a,b)); break;
                        // comparison based on values

                        case BinaryCode.GREATER:      
                        case BinaryCode.GREATER_EQUAL:  
                        case BinaryCode.LESS:    
                        case BinaryCode.LESS_EQUAL: {
                            const typeA = Type.ofValue(a);
                            const typeB = Type.ofValue(b);

                            if (! ((typeA==Type.std.decimal || typeA==Type.std.integer) && (typeB == Type.std.decimal || typeB == Type.std.integer))) {
                                if (!typeA.matchesType(typeB)) {
                                    throw new ValueError("Cannot compare values of different types")
                                }
                                const comp = typeA.handleCompare(a,b);
                                if (comp != NOT_EXISTING) { a = comp; b = 0;} // override a and b for custom type comparison
                                else throw new ValueError("Values of type "+typeA+" cannot be compared");
                            }

                            switch (INNER_SCOPE.compare_type) {
                                case BinaryCode.GREATER:         is_true = a >   b; break;
                                case BinaryCode.GREATER_EQUAL:   is_true = a >=  b; break;
                                case BinaryCode.LESS:            is_true = a <   b; break;
                                case BinaryCode.LESS_EQUAL:      is_true = a <=  b; break;
                            }
                            break;
                        }
                       
                        default: throw new RuntimeError("Invalid comparison, TODO invalid state")
                    }
                }   
                
                // reset
                delete INNER_SCOPE.compare_type;
                // new active value
                INNER_SCOPE.active_value = is_true;
            }
    
            // also handle + and - if current active value is not defined (interpret as 0)
            // +
            else if (INNER_SCOPE.operator === BinaryCode.ADD || INNER_SCOPE.operator === BinaryCode.SUBTRACT) {

                el = Ref.collapseValue(el, true, true); // collapse primitive values
                let val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);

                // negate for subtract
                if (INNER_SCOPE.operator === BinaryCode.SUBTRACT && (typeof el == "number" || typeof el == "bigint")) el = -el;

                if (typeof val == "bigint" && typeof el == "bigint") {
                    INNER_SCOPE.active_value += el;
                }
                else if ((typeof val == "number" || typeof val == "bigint") && (typeof el == "number" || typeof el == "bigint")) {
                    INNER_SCOPE.active_value = Number(val);
                    INNER_SCOPE.active_value += Number(el);
                }
                else if (INNER_SCOPE.operator === BinaryCode.ADD && typeof val == "string" && typeof el == "string") {
                    INNER_SCOPE.active_value += el;
                }
                else {

                    // try custom operator overloading
                    const res = (INNER_SCOPE.operator === BinaryCode.ADD) ?
                        Type.ofValue(INNER_SCOPE.active_value).handleOperatorAdd(INNER_SCOPE.active_value, el):
                        Type.ofValue(INNER_SCOPE.active_value).handleOperatorSubtract(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = (INNER_SCOPE.operator === BinaryCode.ADD) ?
                            Type.ofValue(el).handleOperatorAdd(INNER_SCOPE.active_value, el):
                            Type.ofValue(el).handleOperatorSubtract(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for "+(INNER_SCOPE.operator === BinaryCode.ADD ? "add" : "subtract")+" operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else if (res == NOT_EXISTING) throw new ValueError("Invalid "+(INNER_SCOPE.operator === BinaryCode.ADD ? "add" : "subtract")+" operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;
                }
                delete INNER_SCOPE.operator;
            }

            // &
            else if (INNER_SCOPE.operator === BinaryCode.AND) {

                // collapse primitive values
                const val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);
                el = Ref.collapseValue(el, true, true); 

                // logical
                if (val instanceof Logical) {
                    INNER_SCOPE.active_value = val.and(el);
                }
                else if (val instanceof Target || el instanceof Target || val instanceof Type || el instanceof Type || val instanceof Assertion || el instanceof Assertion) {
                    INNER_SCOPE.active_value = new Conjunction(val, el)           
                }
                
                // booleans
                else if (typeof val == "boolean" && typeof el == "boolean"){
                    INNER_SCOPE.active_value = val && el;
                }

                
                else {

                    // try custom operator overloading
                    const res = Type.ofValue(INNER_SCOPE.active_value).handleOperatorAnd(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = Type.ofValue(el).handleOperatorAnd(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for logical OR operation", SCOPE)
                        else if (res == NOT_EXISTING) {

                            // create conjunctive (&) value by extending
                            const base_type = Type.ofValue(val);
                            const base = await base_type.createDefaultValue();
                            DatexObject.extend(base, val);
                            DatexObject.extend(base, el);
                            INNER_SCOPE.active_value = base;

                        }
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;

                
                }

                // else {
                //     throw new ValueError("Cannot perform a logic AND operation on this value", SCOPE)               
                // }
                delete INNER_SCOPE.operator;
            }

            // |
            else if (INNER_SCOPE.operator === BinaryCode.OR) {
                
                // collapse primitive values
                let val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);
                el = Ref.collapseValue(el, true, true); 


                // logical
                if (val instanceof Logical) {
                    INNER_SCOPE.active_value = val.or(el);
                }
                else if (val instanceof Target || el instanceof Target || val instanceof Type || el instanceof Type) {
                    INNER_SCOPE.active_value = new Disjunction(val, el)           
                }

                // booleans
                else if (typeof val == "boolean" && typeof el == "boolean"){
                    INNER_SCOPE.active_value = val || el;
                }
                else {
                    // try custom operator overloading
                    const res = Type.ofValue(INNER_SCOPE.active_value).handleOperatorOr(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = Type.ofValue(el).handleOperatorOr(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for logical OR operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else if (res == NOT_EXISTING) throw new ValueError("Invalid logical OR operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;
                }
                delete INNER_SCOPE.operator;
            }


            // *
            else if (INNER_SCOPE.operator === BinaryCode.MULTIPLY) {
                
                // collapse primitive values
                let val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);
                el = Ref.collapseValue(el, true, true); 

                if (typeof val == "bigint" && typeof el == "bigint") {
                    INNER_SCOPE.active_value *= el;
                }
                else if ((typeof val == "number" || typeof val == "bigint") && (typeof el == "number" || typeof el == "bigint")) {
                    INNER_SCOPE.active_value = Number(INNER_SCOPE.active_value);
                    INNER_SCOPE.active_value *= Number(el);
                }
                else if (typeof val == "string" && typeof el == "bigint") {
                    INNER_SCOPE.active_value = val.repeat(Number(el));
                }
                else if (typeof val == "bigint" && typeof el == "string") {
                    INNER_SCOPE.active_value = el.repeat(Number(val));
                }
                // repeat tuples n times
                else if (val instanceof Tuple && typeof el == "bigint") {
                    if (el<0) throw new ValueError("Cannot multiply <Tuple> with negative <integer>", SCOPE)
                    INNER_SCOPE.active_value = new Tuple(new Array(Number(el)).fill(val).flat()).seal();
                }
                else if (typeof val == "bigint" && el instanceof Tuple) {
                    if (val<0) throw new ValueError("Cannot multiply <Tuple> with negative <integer>", SCOPE)
                    INNER_SCOPE.active_value = new Tuple(new Array(Number(val)).fill(el).flat()).seal();
                }
                // repeat void n times
                else if (val === VOID && typeof el == "bigint") {
                    if (el<0) throw new ValueError("Cannot multiply <Tuple> with negative <integer>", SCOPE)
                    INNER_SCOPE.active_value = new Tuple(new Array(Number(el)).fill(VOID)).seal();
                }
                else if (typeof val == "bigint" && el === VOID) {
                    console.log("multiple", val ,el)
                    if (val<0) throw new ValueError("Cannot multiply <Tuple> with negative <integer>", SCOPE)
                    INNER_SCOPE.active_value = new Tuple(new Array(Number(val)).fill(VOID)).seal();
                }
                else {
                    // try custom operator overloading
                    const res = Type.ofValue(INNER_SCOPE.active_value).handleOperatorMultiply(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = Type.ofValue(el).handleOperatorMultiply(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for multiply operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else if (res == NOT_EXISTING) throw new ValueError("Invalid multiply operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;
                }
                delete INNER_SCOPE.operator;
            }

            // /
            else if (INNER_SCOPE.operator === BinaryCode.DIVIDE) {

                // collapse primitive values
                let val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);
                el = Ref.collapseValue(el, true, true); 

                if (typeof val == "bigint" && typeof el == "bigint") {
                    if (el === 0n) throw new ValueError("Division by zero", SCOPE);
                    INNER_SCOPE.active_value /= el;
                }
                else if ((typeof val == "number" || typeof val == "bigint") && (typeof el == "number" || typeof el == "bigint")) {
                    INNER_SCOPE.active_value = Number(INNER_SCOPE.active_value);
                    INNER_SCOPE.active_value /= Number(el);
                }
                else {
                    // try custom operator overloading
                    const res = Type.ofValue(INNER_SCOPE.active_value).handleOperatorDivide(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = Type.ofValue(el).handleOperatorDivide(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for divide operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else if (res == NOT_EXISTING) throw new ValueError("Invalid divide operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;
                }
                delete INNER_SCOPE.operator;
            }

            // ^
            else if (INNER_SCOPE.operator === BinaryCode.POWER) {
                
                // collapse primitive values
                let val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);
                el = Ref.collapseValue(el, true, true); 

                if (typeof val == "bigint" && typeof el == "bigint") {
                    if (el < 0) throw new ValueError("Cannot use a negative exponent with an integer")
                    else INNER_SCOPE.active_value **= el;
                }
                else if ((typeof val == "number" || typeof val == "bigint") && (typeof el == "number" || typeof el == "bigint")) {
                    INNER_SCOPE.active_value = Number(INNER_SCOPE.active_value);
                    INNER_SCOPE.active_value **= Number(el);
                }
                else {
                    // try custom operator overloading
                    const res = Type.ofValue(INNER_SCOPE.active_value).handleOperatorPower(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = Type.ofValue(el).handleOperatorPower(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for power operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else if (res == NOT_EXISTING) throw new ValueError("Invalid power operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;
                }
                delete INNER_SCOPE.operator;
            }

            // %
            else if (INNER_SCOPE.operator === BinaryCode.MODULO) {
    
                // collapse primitive values
                let val = Ref.collapseValue(INNER_SCOPE.active_value, true, true);
                el = Ref.collapseValue(el, true, true); 

                if (typeof val == "bigint" && typeof el == "bigint") {
                    INNER_SCOPE.active_value %= el;
                }
                else if ((typeof val == "number" || typeof val == "bigint") && (typeof el == "number" || typeof el == "bigint")) {
                    INNER_SCOPE.active_value = Number(INNER_SCOPE.active_value);
                    INNER_SCOPE.active_value %= Number(el);
                }
                else {
                    // try custom operator overloading
                    const res = Type.ofValue(INNER_SCOPE.active_value).handleOperatorModulo(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) {
                        const res = Type.ofValue(el).handleOperatorModulo(INNER_SCOPE.active_value, el);
                        if (res == INVALID) throw new ValueError("Invalid operands for modulo operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else if (res == NOT_EXISTING) throw new ValueError("Invalid modulo operation (types "+Type.ofValue(INNER_SCOPE.active_value)+" and "+Type.ofValue(el)+")", SCOPE)
                        else INNER_SCOPE.active_value = res;
                    }
                    else INNER_SCOPE.active_value = res;
                }
                delete INNER_SCOPE.operator;
            }

            // special function-like operators

            // throw error
            else if (INNER_SCOPE.operator === BinaryCode.YEET) {
                // add SCOPE to error stack
                if (el instanceof DatexError) el.addScopeToStack(SCOPE);
                throw el;
            }
            
            // about xy
            else if (INNER_SCOPE.about) {
                INNER_SCOPE.active_value = Runtime.getAbout(el);
                delete INNER_SCOPE.about;
            }

            // new 
            else if (INNER_SCOPE.new_type) {
                INNER_SCOPE.active_value = INNER_SCOPE.new_type.cast(el);
                console.log("cast ",INNER_SCOPE.new_type,el,INNER_SCOPE.active_value);
                delete INNER_SCOPE.new_type;
            }


            // count [1,2,3]
            else if (INNER_SCOPE.count) {
                INNER_SCOPE.active_value = Runtime.runtime_actions.countValue(el);
                delete INNER_SCOPE.count;
            }

            // keys x
            else if (INNER_SCOPE.keys) {
                INNER_SCOPE.active_value = Runtime.runtime_actions.getKeys(el);
                delete INNER_SCOPE.keys;
            }

            // get 'file://'...
            else if (INNER_SCOPE.get) {
                if (el instanceof Target || el instanceof Logical) {
                    if (!SCOPE.impersonation_permission && !(el instanceof Endpoint && SCOPE.sender.equals(el) && SCOPE.header.signed)) { 
                        throw new PermissionError("No permission to execute scopes on external endpoints", SCOPE)
                    }
                    if (el instanceof Endpoint) INNER_SCOPE.active_value = await el.getEntrypoint();
                    else {
                        logger.warn("TODO: entrypoint from non-endpoint target?")
                    }
                }
                else if (el instanceof URL) {
                    INNER_SCOPE.active_value = await Runtime.getURLContent(el, false, true);
                }
                // else ignore, continue with current value
                else INNER_SCOPE.active_value = el;
                delete INNER_SCOPE.get;
            }

            // handle other active value cases (no operators)
            else if ("active_value" in INNER_SCOPE) {
                let val = INNER_SCOPE.active_value;

                // handle all ValueConsumers (<Function>, <Type> TODO?, ...)
                if (val instanceof DatexFunction || val instanceof Target /*|| val instanceof Filter*/ || val instanceof Assertion) {
                    // insert <Tuple>el or [el], or [] if el==VOID (call without parameters)                    
                    if (val.handleApply) INNER_SCOPE.active_value = await val.handleApply(Ref.collapseValue(el), SCOPE);
                    else throw new ValueError("Cannot apply values to this value", SCOPE);
                }


                else {
                    const res = await Type.ofValue(INNER_SCOPE.active_value).handleApply(INNER_SCOPE.active_value, el);
                    if (res == INVALID || res == NOT_EXISTING) throw new ValueError(`Cannot apply ${Runtime.valueToDatexString(el)} to ${Runtime.valueToDatexString(val)}`, SCOPE)
                    else INNER_SCOPE.active_value = res;
                } 

                // apply / function call return value -> give access permission to current endpoint
                const ptr = Pointer.pointerifyValue(INNER_SCOPE.active_value);
                if (Runtime.OPTIONS.PROTECT_POINTERS && SCOPE.sender !== Runtime.endpoint && ptr instanceof Pointer) {
                    ptr.grantAccessTo(SCOPE.sender);
                }

            }



            else {
                INNER_SCOPE.active_value = el;
            }            
            
        },

    }

    static createNewInitialScope(header?:dxb_header, internal_vars?:{[name:string|number]:any}, context?:Object, it?:any, context_location?:URL, compiler_context = false):datex_scope {

        context_location = context_location ?? new URL(header ? (header.sender + ':' + header?.sid) : '@@local', baseURL);
        if (compiler_context) context_location = new URL(context_location.toString() + '.@@compiler');

        const persistent_memory = Runtime.getScopeMemory(context_location.toString());

        const scope:datex_scope = {
            sid: header?.sid,
            header: header,
            sender: header?.sender,
            origin: header?.sender,
    
            current_index: 0,
            start_index: 0,

            index_offset: 0,
    
            internal_vars: {...persistent_memory, ...(internal_vars??{})},
            persistent_vars: persistent_memory ? Object.keys(persistent_memory): [],

            execution_permission: header?.executable, // allow execution?
            impersonation_permission: Runtime.endpoint?.equals(header?.sender), // at the moment: only allow endpoint to impersonate itself
    
            inner_scope: null, // has to be copied from sub_scopes[0]
        
            sub_scopes: [],
    
            result: VOID, // -> internal variable __result

            context: context,
            context_location:  context_location,
            it: it,

            meta: {},
            remote: {},

            buffer_views: {}
        }

        //console.log("scope root", scope.root);
        // default meta data
        Object.defineProperty(scope.meta, 'encrypted', {value: header?.encrypted, writable: false, enumerable:true});
        Object.defineProperty(scope.meta, 'signed', {value: header?.signed, writable: false, enumerable:true});
        Object.defineProperty(scope.meta, 'sender', {value: header?.sender, writable: false, enumerable:true});
        Object.defineProperty(scope.meta, 'timestamp', {value: header?.timestamp, writable: false, enumerable:true});
        Object.defineProperty(scope.meta, 'type', {value: header?.type, writable: false, enumerable:true});

        return scope;
    }


    /** call before running a scope with new data */

    static updateScope(scope:datex_scope, datex_body_buffer:ArrayBuffer, header:dxb_header) {
        // merge new block with previous, also if cache_after_index is < current index
        if (scope.cache_previous || (typeof scope.cache_after_index == "number" && scope.current_index+scope.index_offset>=scope.cache_after_index)) {
            const new_uint8 = new Uint8Array(scope.buffer_views.buffer.byteLength + datex_body_buffer.byteLength);
            new_uint8.set(new Uint8Array(scope.buffer_views.buffer), 0);
            new_uint8.set(new Uint8Array(datex_body_buffer), scope.buffer_views.buffer.byteLength);
            scope.buffer_views.buffer = new_uint8.buffer;
        }
        // (re)set buffer if previous block(s) not cached
        else {
            scope.buffer_views.buffer    = datex_body_buffer;
            scope.index_offset += scope.current_index; // update index offset
            scope.current_index = 0; // only reset index to start of new block 
        }
        
        scope.buffer_views.uint8     = new Uint8Array(scope.buffer_views.buffer);     // default      - 1 byte
        scope.buffer_views.data_view = new DataView(scope.buffer_views.buffer);       // works with all typed arrays 

        // update/set header
        scope.header = header;

        scope.execution_permission = header?.executable // allow execution?
        scope.impersonation_permission = Runtime.endpoint?.equals(header?.sender) // at the moment: only allow endpoint to impersonate itself

        // enter outer scope ?
        if (scope.sub_scopes.length == 0) {
            scope.inner_scope = {};
            scope.sub_scopes.push(scope.inner_scope);
            scope.inner_scope.is_outer_scope = true; // is outer scope
        }
     
        scope.cache_previous = false; // reset
    }


    /** parses a datex block, keeps track of the current scope, executes actions */
    static async run(SCOPE:datex_scope):Promise<void> {

        // workaround using decompiler:
        // pre-extract all pointers from script and pre-fetch pointer origin online states
        if (communicationHub.connected) {
            try {
                const content = MessageLogger.decompile(SCOPE.buffer_views.buffer, false, false)
                const origins = [
                    ...new Set(content.match(/\$((?:[A-Fa-f0-9]{2}|[xX][A-Fa-f0-9]){1,26})/gm)?.map(p => {
                        try {
                            return Pointer.getOriginFromPointerId(p.replace("$",""));
                        }
                        catch {}
                    }).filter(o => o && !(o.equals(Runtime.endpoint) || o.equals(SCOPE.sender))))
                ];
                if (origins.length > 1) {
                    logger.debug("pre-fetching online state for "+ origins.length + " endpoints")
                    await Promise.race([
                        Promise.all(origins.map(origin => origin.isOnline())),
                        new Promise(resolve => setTimeout(resolve, 10_000))
                    ])
                }
            }
            catch {}
        }
        

        // loop through instructions
        while (true) {

            // pause scope - not necessarily end
            if (SCOPE.current_index>=SCOPE.buffer_views.uint8.byteLength) {
                return;
            }

            // auto exit subscope?
            if (SCOPE.inner_scope.auto_exit == 2 /* && DatexRuntime.END_BIN_CODES.includes(SCOPE.buffer_views.uint8[SCOPE.current_index])*/) {
                await this.runtime_actions.insertToScope(SCOPE, await this.runtime_actions.exitSubScope(SCOPE), true);
            }
            else if (SCOPE.inner_scope.auto_exit == 1 && !(SCOPE.buffer_views.uint8[SCOPE.current_index] == BinaryCode.CHILD_GET || SCOPE.buffer_views.uint8[SCOPE.current_index] == BinaryCode.CHILD_GET_REF)) {
                SCOPE.inner_scope.auto_exit = 2;
            }

            // keep track of index to jump back to if the buffer is not yet loaded up to a required position
            SCOPE.start_index = SCOPE.current_index;

            let token = SCOPE.buffer_views.uint8[SCOPE.current_index++]

            // ASSIGN_SET = 
            switch (token) {

                // end scope
                case BinaryCode.EXIT: { 
                    SCOPE.closed = true;
                    return;
                }


                // STRING
                case BinaryCode.SHORT_TEXT:
                case BinaryCode.TEXT: {

                    let length: number;

                    if (token == BinaryCode.SHORT_TEXT) {
                        /** wait for buffer */
                        if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                        /********************/

                        length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    }
                    else {
                        /** wait for buffer */
                        if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                        /********************/

                        length = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                        SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    }
                  
                    
                    /** wait for buffer */
                    if (SCOPE.current_index+length > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    
                    let string = this.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+length));
                    SCOPE.current_index += length;

                    await this.runtime_actions.insertToScope(SCOPE, string);
                    break;
                }


                // BUFFER 
                case BinaryCode.BUFFER: {  
                    /** wait for buffer */
                    if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let buffer_length = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    
                    /** wait for buffer */
                    if (SCOPE.current_index+buffer_length > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let buffer = SCOPE.buffer_views.buffer.slice(SCOPE.current_index, SCOPE.current_index+buffer_length);
                    SCOPE.current_index += buffer_length;
                    // console.warn("buffer length", buffer_length, _buffer);

                    // media stream
                    
                    await this.runtime_actions.insertToScope(SCOPE, buffer);
                    break;
                }

                // CHILD_GET
                case BinaryCode.CHILD_GET: {
                    SCOPE.inner_scope.waiting_for_child = 1;
                    break;
                }

                // CHILD_GET_REF
                case BinaryCode.CHILD_GET_REF: { 
                    SCOPE.inner_scope.waiting_for_child = 2;
                    break;
                }
        
                // CHILD SET =
                case BinaryCode.CHILD_SET: { 
                    SCOPE.inner_scope.waiting_for_child_action = -1;
                    break;
                }

                // CHILD ACTION (+=, -=, ...)
                case BinaryCode.CHILD_ACTION: { 
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    // set action specifier
                    SCOPE.inner_scope.waiting_for_child_action =  SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    break;
                }


                // RANGE ..
                case BinaryCode.RANGE: {             
                    SCOPE.inner_scope.waiting_range = [];
                    break;
                }

                // SPREAD ...
                case BinaryCode.EXTEND: {             
                    SCOPE.inner_scope.inner_spread = true; // remember spread
                    break;
                }

                // ERROR
                case BinaryCode.YEET: {
                    SCOPE.inner_scope.operator = BinaryCode.YEET;
                    break;
                }

                // COMPARE
                case BinaryCode.EQUAL_VALUE:
                case BinaryCode.EQUAL:
                case BinaryCode.NOT_EQUAL_VALUE:
                case BinaryCode.GREATER:
                case BinaryCode.GREATER_EQUAL:
                case BinaryCode.LESS:
                case BinaryCode.LESS_EQUAL: {
                    SCOPE.inner_scope.compare_type = token;
                    break;
                }
                                        
                // CACHE POINTS
                case BinaryCode.CACHE_POINT: {
                    SCOPE.cache_after_index = SCOPE.current_index + SCOPE.index_offset;
                    break;
                }
                case BinaryCode.CACHE_RESET: {
                    delete SCOPE.cache_after_index;
                    break;
                }

                // JMPS
                case BinaryCode.JMP: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let index = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    await Runtime.runtime_actions.newSubScope(SCOPE)
                    SCOPE.current_index = index;
                    break;
                }

                case BinaryCode.JTR: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let index = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    SCOPE.inner_scope.jmp = index;
                    SCOPE.inner_scope.jmp_true = true;
                    break;
                }

                case BinaryCode.JFA: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let index = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    SCOPE.inner_scope.jmp = index;
                    SCOPE.inner_scope.jmp_true = false;
                    break;
                }
                
              

                // INTERNAL_VAR  
                case BinaryCode.INTERNAL_VAR: { 
                    const name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/


                    // get var 
                    else {
                        
                        let val:any;
                        // read special internal variables
                        if (name == "result")           val = SCOPE.result;
                        else if (name == "sub_result")  val = SCOPE.inner_scope.result;
                        else if (name == "sender")      val = SCOPE.header.sender;
                        else if (name == "current")     val = Runtime.endpoint;
                        else if (name == "timestamp")   val = SCOPE.header.timestamp
                        else if (name == "encrypted")   val = SCOPE.header.encrypted
                        else if (name == "signed")      val = SCOPE.header.signed
                        else if (name == "public")      val = StaticScope.scopes;
                        else if (name == "meta")        val = SCOPE.meta;
                        else if (name == "remote")      val = SCOPE.remote;
                        else if (name == "this")        val = SCOPE.context;
                        else if (name == "it")          val = SCOPE.it;

                        // all other internal variables
                        else if (name in SCOPE.internal_vars) val = SCOPE.internal_vars[name];
                        // object internal slot
                        else if (typeof name == "number" && name >= 0xfa00 && name < 0xfeff && SCOPE.context[DX_SLOTS]?.has(name)) {
                            val = SCOPE.context[DX_SLOTS].get(name);
                        }
                        else {
                            throw new RuntimeError("Internal variable "+Runtime.formatVariableName(name, '#')+" does not exist", SCOPE);
                        }
                        // insert to scope
                        await this.runtime_actions.insertToScope(SCOPE, val);
                    }
                    break;
                }

                // SET_INTERNAL_VAR  
                case BinaryCode.SET_INTERNAL_VAR: { 
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    if (!Runtime.readonly_internal_vars.has(name)) {
                        if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                        SCOPE.inner_scope.waiting_internal_vars.add([name, BinaryCode.SET_INTERNAL_VAR]);
                    }
                    else {
                        throw new RuntimeError("Internal variable "+Runtime.formatVariableName(name, '#')+" is readonly", SCOPE);
                    }
                    break;
                }


                // SET_INTERNAL_VAR_REFERENCE  
                case BinaryCode.SET_INTERNAL_VAR_REFERENCE: { 
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    if (!Runtime.readonly_internal_vars.has(name)) {
                        if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                        SCOPE.inner_scope.waiting_internal_vars.add([name, BinaryCode.SET_INTERNAL_VAR_REFERENCE]);
                    }
                    else {
                        throw new RuntimeError("Internal variable "+Runtime.formatVariableName(name, '#')+" is readonly", SCOPE);
                    }
                    break;
                }


                // INIT_INTERNAL_VAR  
                case BinaryCode.INIT_INTERNAL_VAR: { 
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    const init_block_size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
					SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;

                    // already exists?
                    if (name in SCOPE.internal_vars) {
                        SCOPE.current_index += init_block_size; // jump to end of init block
                    }

                    // init new
                    else {
                        if (!Runtime.readonly_internal_vars.has(name)) {
                            if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                            SCOPE.inner_scope.waiting_internal_vars.add([name, BinaryCode.SET_INTERNAL_VAR_REFERENCE, true /* save in persistant memory */]);
                        }
                        else {
                            throw new RuntimeError("Internal variable "+Runtime.formatVariableName(name, '#')+" is readonly", SCOPE);
                        }
                    }
                    
                    break;
                }

                // INTERNAL_VAR_ACTION  
                case BinaryCode.INTERNAL_VAR_ACTION: { 
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let action = SCOPE.buffer_views.uint8[SCOPE.current_index++];

                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    if (!Runtime.readonly_internal_vars.has(name)) {
                        if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                        SCOPE.inner_scope.waiting_internal_vars.add([name, action]);
                    }
                    else {
                        throw new RuntimeError("Internal variable '"+name+"' is readonly", SCOPE);
                    }
                    break;
                }


                // INTERNAL VAR shorthands
                case BinaryCode.VAR_RESULT: { 
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.result);
                    break;
                }
                case BinaryCode.VAR_SUB_RESULT: {
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.inner_scope.result);
                    break;
                }
                // case BinaryCode.VAR_ENCRYPTED: { 
                //     await this.runtime_actions.insertToScope(SCOPE, SCOPE.meta.encrypted);
                //     break;
                // }
                // case BinaryCode.VAR_SIGNED: { 
                //     await this.runtime_actions.insertToScope(SCOPE, SCOPE.meta.signed);
                //     break;
                // }
                case BinaryCode.VAR_ENTRYPOINT: { 
                    await this.runtime_actions.insertToScope(SCOPE, Runtime.endpoint_entrypoint);
                    break;
                }
                case BinaryCode.VAR_ORIGIN: { 
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.meta.sender);
                    break;
                }
                case BinaryCode.VAR_ENDPOINT: { 
                    await this.runtime_actions.insertToScope(SCOPE, Runtime.endpoint);
                    break;
                }
                case BinaryCode.VAR_LOCATION: { 
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.context_location);
                    break;
                }
                case BinaryCode.VAR_ENV: { 
                    await this.runtime_actions.insertToScope(SCOPE, Runtime.ENV);
                    break;
                }

                // case BinaryCode.VAR_TIMESTAMP: { 
                //     await this.runtime_actions.insertToScope(SCOPE, SCOPE.meta.timestamp);
                //     break;
                // }
                case BinaryCode.VAR_META: {
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.meta);
                    break;
                }
                case BinaryCode.VAR_REMOTE: {
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.remote);
                    break;
                }
                case BinaryCode.VAR_PUBLIC: {
                    await this.runtime_actions.insertToScope(SCOPE, StaticScope.scopes);
                    break;
                }
                case BinaryCode.VAR_STD: {
                    await this.runtime_actions.insertToScope(SCOPE, Runtime.STD_STATIC_SCOPE);
                    break;
                }
                case BinaryCode.VAR_VOID: {
                    await this.runtime_actions.insertToScope(SCOPE, undefined);
                    break;
                }
                case BinaryCode.VAR_THIS: {
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.context);
                    break;
                }
                case BinaryCode.VAR_IT: {
                    await this.runtime_actions.insertToScope(SCOPE, SCOPE.it);
                    break;
                }

                case BinaryCode.SET_VAR_IT: { 
                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['it', BinaryCode.SET_INTERNAL_VAR]);
                    break;
                }

                case BinaryCode.SET_VAR_RESULT: { 
                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['result', BinaryCode.SET_INTERNAL_VAR]);
                    break;
                }
                case BinaryCode.SET_VAR_SUB_RESULT: {
                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['sub_result', BinaryCode.SET_INTERNAL_VAR]);
                    break;
                }
                case BinaryCode.SET_VAR_VOID: {
                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['void', BinaryCode.SET_INTERNAL_VAR]);
                    break;
                }

                case BinaryCode.VAR_RESULT_ACTION: { 
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let action = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    
                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['result', action]);
                    break;
                }
                case BinaryCode.VAR_SUB_RESULT_ACTION: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let action = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    
                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['sub_result', action]);
                    break;
                }
              
                case BinaryCode.VAR_REMOTE_ACTION: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let action = SCOPE.buffer_views.uint8[SCOPE.current_index++];

                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['remote', action]);
                    break;
                }

                case BinaryCode.VAR_IT_ACTION: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let action = SCOPE.buffer_views.uint8[SCOPE.current_index++];

                    if (!SCOPE.inner_scope.waiting_internal_vars) SCOPE.inner_scope.waiting_internal_vars = new Set();
                    SCOPE.inner_scope.waiting_internal_vars.add(['it', action]);
                    break;
                }

 
                // LABEL  
                case BinaryCode.LABEL: { 
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    const pointer = Pointer.getByLabel(name);

                    await this.runtime_actions.insertToScope(SCOPE, pointer)

                    break;
                }

                // LABEL_ACTION  
                case BinaryCode.LABEL_ACTION: { 
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let action = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    // get pointer
                    const pointer = Pointer.getByLabel(name);

                    if (!SCOPE.inner_scope.waiting_ptrs) SCOPE.inner_scope.waiting_ptrs = new Set();
                    SCOPE.inner_scope.waiting_ptrs.add([pointer, action]); // assign next value to pointer;
                    break;
                }

                // SET_LABEL  
                case BinaryCode.SET_LABEL: { 
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    if (!SCOPE.impersonation_permission) {
                        throw new PermissionError("No permission to create labels on this endpoint", SCOPE)
                    }

                    if (!SCOPE.inner_scope.waiting_labels) SCOPE.inner_scope.waiting_labels = new Set();
                    SCOPE.inner_scope.waiting_labels.add(name);
                    break;
                }


                // INIT_LABEL  
                case BinaryCode.INIT_LABEL: { 
                    let name = Runtime.runtime_actions.extractVariableName(SCOPE)
                    /** wait for buffer */
                    if (name === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    if (!SCOPE.impersonation_permission) {
                        throw new PermissionError("No permission to create labels on this endpoint", SCOPE)
                    }

                    const init_block_size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
					SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;

                    // already exists?
                    if (Pointer.labelExists(name)) {
                        SCOPE.current_index += init_block_size; // jump to end of init block
                    }
                    
                    else {
                        if (!SCOPE.inner_scope.waiting_labels) SCOPE.inner_scope.waiting_labels = new Set();
                        SCOPE.inner_scope.waiting_labels.add(name);
                    }
                   
                    break;
                }

                // COMMAND END  
                case BinaryCode.CLOSE_AND_STORE: {  
                    // switch to new sub scope between commands
                    await this.runtime_actions.newSubScope(SCOPE); 
                    break;
                }

                // CODE_BLOCK 
                case BinaryCode.SCOPE_BLOCK: {  

                    const INNER_SCOPE = SCOPE.inner_scope;
                    
                    let buffer = this.runtime_actions.extractScopeBlock(SCOPE);
                    if (buffer === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    const code_block = buffer ? new Scope(INNER_SCOPE.scope_block_vars, buffer, true): null;

                    // TRANSFORM (always)
                    if (INNER_SCOPE.scope_block_for == BinaryCode.TRANSFORM) {
                        INNER_SCOPE.scope_block_for = null;
                        const waiting = [...SCOPE.inner_scope.waiting_ptrs??[]].at(-1);
                        // assign always() to init ($xxx := always(...))
                        if (waiting && typeof waiting[1] == "object") {  // is init 
                            const ptr = waiting[0]
                            ptr.handleTransformAsync(INNER_SCOPE.scope_block_vars, code_block);
                            // resolve
                            if (waiting[1]?.resolve) {
                                waiting[1].resolve(ptr)
                                Pointer.loading_pointers.delete(ptr.id); // TODO: only workaround, automatically handle delete, but leads to promise rejection errors
                            }
                            SCOPE.inner_scope.waiting_ptrs!.delete(waiting)
                        }
                        else {
                            await this.runtime_actions.insertToScope(
                                SCOPE,
                                Ref.collapseValue(await Pointer.createTransformAsync(INNER_SCOPE.scope_block_vars, code_block))
                            )
                        }
                        
                    }

                    // ASSERT
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.ASSERT) {
                        INNER_SCOPE.scope_block_for = null;
                        const assertion = Assertion.get(code_block);
                        await this.runtime_actions.insertToScope(SCOPE, assertion);
                    }

                    // RESPONSE
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.RESPONSE) {
                        INNER_SCOPE.scope_block_for = null;
                        const response = new DatexResponse(code_block);
                        await this.runtime_actions.insertToScope(SCOPE, response);
                    }

                    // RUN
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.RUN) {
                        INNER_SCOPE.scope_block_for = null;
                        const task = $$(new Task(code_block));
                        task.run(SCOPE.sender, INNER_SCOPE.ctx_intern);
                        await this.runtime_actions.insertToScope(SCOPE, task);
                    }

                    // DO
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.DO) {
                        INNER_SCOPE.scope_block_for = null;
                        const result = await code_block.execute(SCOPE.sender);
                        await this.runtime_actions.insertToScope(SCOPE, result);
                    }

                    // DEFERRED
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.DEFER) {
                        INNER_SCOPE.scope_block_for = null;
                        const deferred = new Deferred(code_block, SCOPE.sender);
                        await this.runtime_actions.insertToScope(SCOPE, deferred);
                    }

                    // SCOPE
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.PLAIN_SCOPE) {
                        INNER_SCOPE.scope_block_for = null;
                        await this.runtime_actions.insertToScope(SCOPE, code_block);
                    }


                    // ITERATOR
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.ITERATOR) {
                        // TODO
                        await this.runtime_actions.insertToScope(SCOPE, new IteratorFunction()); // TODO code_block, undefined, undefined, undefined, SCOPE.context
                    }


                    // FUNCTION
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.FUNCTION) {
                        INNER_SCOPE.scope_block_for = null;
                        
                        if (!(SCOPE.inner_scope.active_value instanceof Tuple || SCOPE.inner_scope.active_value === VOID)) {
                            throw new RuntimeError("Invalid function declaration: parameters must be empty or of type <Tuple>")
                        }
                        const args = INNER_SCOPE.active_value ?? new Tuple();
                        delete INNER_SCOPE.active_value;

                        await this.runtime_actions.insertToScope(SCOPE, DatexFunction.createFromDatexScope(code_block, SCOPE.context, undefined, undefined, undefined, args));
                    }

                    // REMOTE
                    else if (INNER_SCOPE.scope_block_for == BinaryCode.REMOTE) {
                        INNER_SCOPE.scope_block_for = null;

                        if (!(INNER_SCOPE.active_value instanceof Logical || INNER_SCOPE.active_value instanceof Endpoint)) {
                            throw new RuntimeError("Invalid remote execution declaration: target must be of type Endpoint or a composition")
                        }
                        // TODO handle complex target compositions
                        const remote:Disjunction<Endpoint> = Logical.collapse(INNER_SCOPE.active_value, Target);
                        delete INNER_SCOPE.active_value;

                        if (!SCOPE.impersonation_permission && !(remote.size == 1 && [...remote][0] instanceof Endpoint && SCOPE.sender.equals([...remote][0]) && SCOPE.header.signed)) {
                            throw new PermissionError("No permission to execute scopes on external endpoints", SCOPE)
                        }
               
                        // merge dxb with original dxb
                        if (INNER_SCOPE.scope_block_vars.length) {
                            // insert variables from this scope with additional dx
                            const variables_insert_code = Object.keys(INNER_SCOPE.scope_block_vars).map((_, i)=>`#${i}=?;`).join("");

                            // has to be arraybuffer (a single dxb block)
                            const var_dxb = <ArrayBuffer> await Compiler.compile(variables_insert_code, INNER_SCOPE.scope_block_vars, undefined, false, false, false, undefined, Infinity)
                        
                            const tmp = new Uint8Array(var_dxb.byteLength + buffer.byteLength);
                            tmp.set(new Uint8Array(var_dxb), 0);
                            tmp.set(new Uint8Array(buffer), var_dxb.byteLength);
                            buffer = tmp.buffer
                        }

                        
                        const sid = Compiler.generateSID();
                        const full_dxb = await Compiler.appendHeader(buffer, 
                            true,
                            Runtime.endpoint, //sender
                            remote,  // to
                            false, // flood
                            SCOPE.remote.type ?? undefined, // type
                            SCOPE.remote.sign ?? true, // sign
                            SCOPE.remote.encrypt ?? false, // encrypt
                            undefined,
                            undefined, 
                            true,
                            sid
                        );

                        // datex out to filter
                        const res = await Runtime.datexOut(full_dxb, remote, sid, true, undefined, (scope, header, error)=>{
                            // const forked_scope = DatexRuntime.runtime_actions.forkScope(SCOPE);
                            // forked_scope.inner_scope.active_value = scope.result; // set received active value
                            // console.log("callback from " + header.sender + ":",scope.result, forked_scope);
                            // DatexRuntime.run(forked_scope);
                        }, false, SCOPE.remote.timeout?Number(SCOPE.remote.timeout):undefined);
                        // await new Promise<void>(()=>{});
                        // return;

                        await this.runtime_actions.insertToScope(SCOPE, res);
                    }

                    SCOPE.inner_scope.scope_block_vars = null;

                    break;
                }

                // NULL
                case BinaryCode.NULL: {
                    await this.runtime_actions.insertToScope(SCOPE, null);
                    break;
                }

                // VOID
                case BinaryCode.VOID: {
                    await this.runtime_actions.insertToScope(SCOPE, VOID);
                    break;
                }

                // WILDCARD
                case BinaryCode.WILDCARD: {
                    await this.runtime_actions.insertToScope(SCOPE, WILDCARD);
                    break;
                }

                // RETURN
                case BinaryCode.RETURN: {
                    SCOPE.inner_scope.return = true;
                    break;
                }

                // ABOUT
                case BinaryCode.ABOUT: {
                    SCOPE.inner_scope.about = true;
                    break;
                }

                // COUNT
                case BinaryCode.COUNT: {
                    SCOPE.inner_scope.count = true;
                    break;
                }

                // KEYS
                case BinaryCode.KEYS: {
                    SCOPE.inner_scope.keys = true;
                    break;
                }

                // TEMPLATE
                case BinaryCode.TEMPLATE: {
                    SCOPE.inner_scope.template = true;
                    break;
                }

                // OBSERVE
                case BinaryCode.OBSERVE: {
                    SCOPE.inner_scope.observe = true;
                    break;
                }

                // TRANSFORM
                case BinaryCode.TRANSFORM: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.TRANSFORM;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // SCOPE
                case BinaryCode.PLAIN_SCOPE: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.PLAIN_SCOPE;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // RUN
                case BinaryCode.RUN: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.RUN;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // DO
                case BinaryCode.DO: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.DO;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // ITERATOR
                case BinaryCode.ITERATOR: {
                    SCOPE.inner_scope.wait_iterator = true;
                    break;
                }

                // NEXT
                case BinaryCode.NEXT: {
                    SCOPE.inner_scope.wait_next = true;
                    break;
                }


                // ASSERT
                case BinaryCode.ASSERT: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.ASSERT;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // RESPONSE
                case BinaryCode.RESPONSE: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.RESPONSE;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // FUNCTION
                case BinaryCode.FUNCTION: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.FUNCTION;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // REMOTE
                case BinaryCode.REMOTE: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.REMOTE;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // AWAIT
                case BinaryCode.AWAIT: {
                    SCOPE.inner_scope.wait_await = true;
                    break;
                }

                // MAYBE
                case BinaryCode.DEFER: {
                    SCOPE.inner_scope.scope_block_for = BinaryCode.DEFER;
                    SCOPE.inner_scope.scope_block_vars = [];
                    break;
                }

                // HAS
                case BinaryCode.HAS: {
                    SCOPE.inner_scope.has = true;
                    break;
                }

                // SEAL
                case BinaryCode.SEAL: {
                    SCOPE.inner_scope.wait_seal = true;
                    break;
                }
                // FREEZE
                case BinaryCode.FREEZE: {
                    SCOPE.inner_scope.wait_freeze = true;
                    break;
                }

                // EXTENDS
                case BinaryCode.EXTENDS: {
                    SCOPE.inner_scope.wait_extends = true;
                    break;
                }

                // IMPLEMENTS
                case BinaryCode.IMPLEMENTS: {
                    SCOPE.inner_scope.wait_implements = true;
                    break;
                }


                // MATCHES
                case BinaryCode.MATCHES: {
                    SCOPE.inner_scope.wait_matches = true;
                    break;
                }


                // DEFAULT
                case BinaryCode.DEFAULT: {
                    const init_block_size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;

                    // get default value
                    if (SCOPE.inner_scope.active_value === null || SCOPE.inner_scope.active_value === VOID) {
                        delete SCOPE.inner_scope.active_value; // delete null/void active value
                    } 
                    // ignore default
                    else {
                        SCOPE.current_index += init_block_size; // jump to end of default block
                    }

                    break;
                }

                // DEBUG
                case BinaryCode.DEBUGGER: {
                    Runtime.handleScopeDebuggerSession(SCOPE);
                    break;
                }

                case BinaryCode.NEW: {
                    SCOPE.inner_scope.wait_new = true;
                    break;
                }

                // get
                case BinaryCode.GET: {
                    SCOPE.inner_scope.get = true;
                    break;
                }

                // URL
                case BinaryCode.URL: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let length = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    
                    /** wait for buffer */
                    if (SCOPE.current_index+length > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let url = new URL(this.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+length)), SCOPE.context_location);
                    SCOPE.current_index += length;

                    await this.runtime_actions.insertToScope(SCOPE, url);
                    break;
                }

                // RESOLVE_RELATIVE_PATH
                case BinaryCode.RESOLVE_RELATIVE_PATH: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Uint32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let length = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    
                    /** wait for buffer */
                    if (SCOPE.current_index+length > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    
                    const path = this.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+length));
                    const url = new URL(path, SCOPE.context_location);

                    SCOPE.current_index += length;

                    await this.runtime_actions.insertToScope(SCOPE, url);
                    break;
                }

                // ARRAY_START
                case BinaryCode.ARRAY_START: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    // empty array
                    if (SCOPE.buffer_views.uint8[SCOPE.current_index] === BinaryCode.ARRAY_END) {
                        SCOPE.current_index++;
                        await this.runtime_actions.insertToScope(SCOPE, []);
                    }
                    else {
                        this.runtime_actions.enterSubScope(SCOPE); // outer array scope
                        SCOPE.inner_scope.active_object = []; // generate new array
                        SCOPE.inner_scope.active_object_new = true;
                    }
                    break;
                }

                // TUPLE_START
                case BinaryCode.TUPLE_START: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    // empty array
                    if (SCOPE.buffer_views.uint8[SCOPE.current_index] === BinaryCode.TUPLE_END) {
                        SCOPE.current_index++;
                        await this.runtime_actions.insertToScope(SCOPE, new Tuple().seal());
                    }
                    else {
                        this.runtime_actions.enterSubScope(SCOPE); // outer array scope
                        SCOPE.inner_scope.active_object = new Tuple(); // generate new tuple
                        SCOPE.inner_scope.active_object_new = true;
                    }
                    break;
                }

                // OBJECT_START
                case BinaryCode.OBJECT_START: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    // empty object
                    if (SCOPE.buffer_views.uint8[SCOPE.current_index] === BinaryCode.OBJECT_END) {
                        SCOPE.current_index++;
                        await this.runtime_actions.insertToScope(SCOPE, {});
                    }
                    else {
                        this.runtime_actions.enterSubScope(SCOPE); // outer object scope
                        SCOPE.inner_scope.active_object = {}; // generate new object
                        SCOPE.inner_scope.active_object_new = true;
                    }
                    break;
                }

                // // RECORD_START
                // case BinaryCode.RECORD_START: {
                //     /** wait for buffer */
                //     if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                //     /********************/
                //     // empty object
                //     if (SCOPE.buffer_views.uint8[SCOPE.current_index] === BinaryCode.RECORD_END) {
                //         SCOPE.current_index++;
                //         await this.runtime_actions.insertToScope(SCOPE, DatexObject.seal(new Record()));
                //     }
                //     else {
                //         this.runtime_actions.enterSubScope(SCOPE); // outer object scope
                //         SCOPE.inner_scope.active_object = new Record(); // generate new record
                //         SCOPE.inner_scope.active_object_new = true;
                //     }
                //     break;
                // }

                // list element with key
                case BinaryCode.ELEMENT_WITH_KEY: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let length = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    let key = Runtime.utf8_decoder.decode(SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+length));
                    SCOPE.current_index += length;

                    const key_perm = SCOPE.inner_scope.key_perm;
             
                    // insert previous value
                    if (!SCOPE.inner_scope.active_object_new) await this.runtime_actions.insertToScope(SCOPE, await this.runtime_actions.exitSubScope(SCOPE), true);
                    SCOPE.inner_scope.active_object_new = false;

                    // add key for next value
                    SCOPE.inner_scope.waiting_key = key;       
                    // add key permission
                    if (key_perm) SCOPE.inner_scope.key_perm = key_perm;

                    this.runtime_actions.enterSubScope(SCOPE);    

                 
                    break;
                }

                case BinaryCode.ELEMENT_WITH_INT_KEY: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let key = BigInt(SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true));
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;

                    const key_perm = SCOPE.inner_scope.key_perm;
             
                    // insert previous value
                    if (!SCOPE.inner_scope.active_object_new) await this.runtime_actions.insertToScope(SCOPE, await this.runtime_actions.exitSubScope(SCOPE), true);
                    SCOPE.inner_scope.active_object_new = false;

                    // add key for next value
                    SCOPE.inner_scope.waiting_key = key;       
                    // add key permission
                    if (key_perm) SCOPE.inner_scope.key_perm = key_perm;

                    this.runtime_actions.enterSubScope(SCOPE);    

                 
                    break;
                }

                // list element with dynamic key
                case BinaryCode.ELEMENT_WITH_DYNAMIC_KEY: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    // insert previous value
                    if (!SCOPE.inner_scope.active_object_new) await this.runtime_actions.insertToScope(SCOPE, await this.runtime_actions.exitSubScope(SCOPE), true);
                    SCOPE.inner_scope.active_object_new = false;

                    // wait for dynamic key
                    SCOPE.inner_scope.wait_dynamic_key = true;
                    break;
                }

                // key permission
                case BinaryCode.KEY_PERMISSION: {
                    SCOPE.inner_scope.waiting_for_key_perm = true;
                    break;
                }


                // keyless list element 
                case BinaryCode.ELEMENT: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    // insert previous value
                    if (!SCOPE.inner_scope.active_object_new) await this.runtime_actions.insertToScope(SCOPE, await this.runtime_actions.exitSubScope(SCOPE), true);
                    SCOPE.inner_scope.active_object_new = false;

                    this.runtime_actions.enterSubScope(SCOPE);    

                    break;
                }


                case BinaryCode.INTERNAL_OBJECT_SLOT: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    const index = SCOPE.buffer_views.data_view.getUint16(SCOPE.current_index, true);
                    SCOPE.current_index += Uint16Array.BYTES_PER_ELEMENT;
             
                    // insert previous value
                    if (!SCOPE.inner_scope.active_object_new) await this.runtime_actions.insertToScope(SCOPE, await this.runtime_actions.exitSubScope(SCOPE), true);
                    SCOPE.inner_scope.active_object_new = false;

                    // add key for next value
                    SCOPE.inner_scope.waiting_internal_slot = index;       

                    this.runtime_actions.enterSubScope(SCOPE);    
                 
                    break;
                }
              
                // ARRAY_END, OBJECT_END, TUPLE_END, RECORD_END
                case BinaryCode.ARRAY_END:
                case BinaryCode.OBJECT_END:
                case BinaryCode.TUPLE_END: {

                    // now handle object content
                    let result = await this.runtime_actions.exitSubScope(SCOPE);
                    SCOPE.current_index--; // assume still in tuple
                    await this.runtime_actions.insertToScope(SCOPE, result, true);
                    SCOPE.current_index++;

                    let new_object = SCOPE.inner_scope.active_object; // newest tuple closed
                    let scope_result = await this.runtime_actions.exitSubScope(SCOPE); // outer array scope
                    
                    // set scope result as object value
                    if (scope_result instanceof Tuple) {
                        // clear object
                        Object.keys(new_object).forEach(key => delete new_object[key])
                        // assign scope result
                        Object.assign(new_object, scope_result.toObject());
                    }
                    else if (scope_result != VOID && !(new_object instanceof Array)) {
                        throw new ValueError("Cannot cast non-tuple value to object")
                    }

                    // modifiy final object/array
                    if (new_object instanceof Array) Runtime.runtime_actions.trimArray(new_object);
                    // seal record/tuple (DISABLED BECAUSE OF $$ properties)
                    // if (new_object instanceof Tuple) DatexObject.seal(new_object);

                    // insert
                    await this.runtime_actions.insertToScope(SCOPE, new_object);
                    break;
                }

                // STD SHORT TYPES
                case BinaryCode.STD_TYPE_TEXT: 
                case BinaryCode.STD_TYPE_INT:
                case BinaryCode.STD_TYPE_FLOAT:
                case BinaryCode.STD_TYPE_BOOLEAN:
                case BinaryCode.STD_TYPE_NULL:
                case BinaryCode.STD_TYPE_VOID:
                case BinaryCode.STD_TYPE_BUFFER:
                case BinaryCode.STD_TYPE_CODE_BLOCK:
                case BinaryCode.STD_TYPE_UNIT:
                case BinaryCode.STD_TYPE_ARRAY:
                case BinaryCode.STD_TYPE_OBJECT:
                case BinaryCode.STD_TYPE_SET:
                case BinaryCode.STD_TYPE_MAP:
                case BinaryCode.STD_TYPE_TUPLE:
                case BinaryCode.STD_TYPE_STREAM:
                case BinaryCode.STD_TYPE_ANY:
                case BinaryCode.STD_TYPE_ASSERTION:
                case BinaryCode.STD_TYPE_TASK:
                case BinaryCode.STD_TYPE_ITERATOR:
                case BinaryCode.STD_TYPE_TIME:
                case BinaryCode.STD_TYPE_URL:
                case BinaryCode.STD_TYPE_FUNCTION: {
                    await this.runtime_actions.insertToScope(SCOPE, Type.short_types[token]);
                    break;
                }

                // INCREMENT (++)
                case BinaryCode.INCREMENT: {
                    // TODO
                    break;
                }

                // DECREMENT (--)
                case BinaryCode.DECREMENT: {
                    // TODO
                    break;
                }

                // ADD (+)
                case BinaryCode.ADD: {
                    SCOPE.inner_scope.operator = BinaryCode.ADD;
                    break;
                }

                // SUBTRACT (-)
                case BinaryCode.SUBTRACT: {
                    SCOPE.inner_scope.operator = BinaryCode.SUBTRACT;
                    break;
                }

                // MULTIPLY (*)
                case BinaryCode.MULTIPLY: {
                    SCOPE.inner_scope.operator = BinaryCode.MULTIPLY;
                    break;
                }

                // DIVIDE (/)
                case BinaryCode.DIVIDE: {
                    SCOPE.inner_scope.operator = BinaryCode.DIVIDE;
                    break;
                }

                // POWER (^)
                case BinaryCode.POWER: {
                    SCOPE.inner_scope.operator = BinaryCode.POWER;
                    break;
                }

                // MODULO (%)
                case BinaryCode.MODULO: {
                    SCOPE.inner_scope.operator = BinaryCode.MODULO;
                    break;
                }

                // AND (&)
                case BinaryCode.AND: {
                    SCOPE.inner_scope.operator = BinaryCode.AND;
                    break;
                }

                // OR (|)
                case BinaryCode.OR: {
                    SCOPE.inner_scope.operator = BinaryCode.OR;
                    break;
                }

                // NOT (~)
                case BinaryCode.NOT: {
                    SCOPE.inner_scope.negate_operator = true;
                    break;
                }

                // CONJUNCTION
                case BinaryCode.CONJUNCTION: {
                    this.runtime_actions.enterSubScope(SCOPE)
                    SCOPE.inner_scope.connective = new Conjunction();
                    SCOPE.inner_scope.connective_size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    break;
                }

                // DISJUNCTION
                case BinaryCode.DISJUNCTION: {
                    this.runtime_actions.enterSubScope(SCOPE)
                    SCOPE.inner_scope.connective = new Disjunction();
                    SCOPE.inner_scope.connective_size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
                    SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;
                    break;
                }

                // SUBSCOPE_START
                case BinaryCode.SUBSCOPE_START: {
                    this.runtime_actions.enterSubScope(SCOPE)
                    break;
                }
                // SUBSCOPE_END
                case BinaryCode.SUBSCOPE_END: {   
                    const res = await this.runtime_actions.exitSubScope(SCOPE);
                    await this.runtime_actions.insertToScope(SCOPE, res);
                    break;
                }
            
                // TRUE
                case BinaryCode.TRUE: {
                    await this.runtime_actions.insertToScope(SCOPE, true);
                    break;
                }

                // FALSE
                case BinaryCode.FALSE: {
                    await this.runtime_actions.insertToScope(SCOPE, false);
                    break;
                }

                // QUANTITY
                case BinaryCode.QUANTITY: {

                    const sign = SCOPE.buffer_views.uint8[SCOPE.current_index++] == 0 ? -1n : 1n;  // 0 for negative, 1 for positive (and 0)

                    // buffer sizes
                    const num_size = SCOPE.buffer_views.data_view.getUint16(SCOPE.current_index, true)
                    SCOPE.current_index+=Uint16Array.BYTES_PER_ELEMENT;
                    const den_size = SCOPE.buffer_views.data_view.getUint16(SCOPE.current_index, true)
                    SCOPE.current_index+=Uint16Array.BYTES_PER_ELEMENT;

                    // numerator
                    const num_buffer = SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+=num_size);
                    const den_buffer = SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+=den_size)

                    const num = Quantity.bufferToBigInt(num_buffer) * sign;
                    const den = Quantity.bufferToBigInt(den_buffer);	

                    const factor_count = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                    const unit_factors = [];
                    for (let i=0; i<factor_count; i++) {
                        const code = SCOPE.buffer_views.uint8[SCOPE.current_index++];
                        const exponent = SCOPE.buffer_views.data_view.getInt8(SCOPE.current_index++)
                        unit_factors.push([code, exponent]);
                    }

                    let unit = new Quantity([num, den], unit_factors);

                    await this.runtime_actions.insertToScope(SCOPE, unit);
                    break;
                }

                // BIG_INT
                case BinaryCode.BIG_INT: {

                    const sign = SCOPE.buffer_views.uint8[SCOPE.current_index++] == 0 ? -1n : 1n;  // 0 for negative, 1 for positive (and 0)

                    // buffer size
                    const size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true)
                    SCOPE.current_index+=Uint32Array.BYTES_PER_ELEMENT;
                    
                    /** wait for buffer */
                    if (SCOPE.current_index+size > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    // bigint from buffer
                    const bigint_buffer = SCOPE.buffer_views.uint8.subarray(SCOPE.current_index, SCOPE.current_index+=size);
                    const bigint = Quantity.bufferToBigInt(bigint_buffer) * sign;

                    await this.runtime_actions.insertToScope(SCOPE, bigint);
                    break;
                }

                // INT_8
                case BinaryCode.INT_8: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Int8Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let integer:bigint|number = SCOPE.buffer_views.data_view.getInt8(SCOPE.current_index);
                    if (Runtime.OPTIONS.USE_BIGINTS) integer = BigInt(integer);
                    SCOPE.current_index += Int8Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, integer);
                    break;
                }

                // INT_16
                case BinaryCode.INT_16: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Int16Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let integer:bigint|number = SCOPE.buffer_views.data_view.getInt16(SCOPE.current_index, true);
                    if (Runtime.OPTIONS.USE_BIGINTS) integer = BigInt(integer);
                    SCOPE.current_index += Int16Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, integer);
                    break;
                }

                // INT_32
                case BinaryCode.INT_32: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Int32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let integer:bigint|number = SCOPE.buffer_views.data_view.getInt32(SCOPE.current_index, true);
                    if (Runtime.OPTIONS.USE_BIGINTS) integer = BigInt(integer);
                    SCOPE.current_index += Int32Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, integer);
                    break;
                }

                // INT_64
                case BinaryCode.INT_64: {
                    /** wait for buffer */
                    if (SCOPE.current_index+BigInt64Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let integer:bigint|number = SCOPE.buffer_views.data_view.getBigInt64(SCOPE.current_index, true);
                    if (!Runtime.OPTIONS.USE_BIGINTS) integer = Number(integer);
                    SCOPE.current_index += BigInt64Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, integer);
                    break;
                }
                

                // FLOAT
                case BinaryCode.FLOAT_64: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Float64Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    let float = SCOPE.buffer_views.data_view.getFloat64(SCOPE.current_index, true);
                    SCOPE.current_index += Float64Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, float);
                    break;
                }

            
                // FLOAT_AS_INT_32
                case BinaryCode.FLOAT_AS_INT_32: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Int32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    const float = SCOPE.buffer_views.data_view.getInt32(SCOPE.current_index, true);
                    SCOPE.current_index += Int32Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, float);
                    break;
                }

                // FLOAT_AS_INT_8
                case BinaryCode.FLOAT_AS_INT_8: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Int8Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    const float = SCOPE.buffer_views.data_view.getInt8(SCOPE.current_index);
                    SCOPE.current_index += Int8Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, float);
                    break;
                }

                // TIME
                case BinaryCode.TIME: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Int32Array.BYTES_PER_ELEMENT > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    let millis = SCOPE.buffer_views.data_view.getBigInt64(SCOPE.current_index, true);
                    SCOPE.current_index += BigUint64Array.BYTES_PER_ELEMENT;

                    await this.runtime_actions.insertToScope(SCOPE, new Time(Number(millis)));
                    break;
                }

                // TYPE
                case BinaryCode.TYPE: {
                    const type = this.runtime_actions.extractType(SCOPE);
                    if (type === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /** wait for buffer (needed in insertToScope) */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    
                    // ignore outer type cast
                    if (SCOPE.outer_serialized) {
                        SCOPE.outer_serialized = false;
                        break;
                    }

                    await this.runtime_actions.insertToScope(SCOPE, type);
                    break;
                }


                // EXTENDED_TYPE
                case BinaryCode.EXTENDED_TYPE: {
                    const type_info = this.runtime_actions.extractType(SCOPE, true);
                    if (type_info === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /** wait for buffer (needed in insertToScope) */
                    if (SCOPE.current_index+1 > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    // has parameters
                    if (type_info[1]) SCOPE.inner_scope.waiting_ext_type = type_info[0];
                    // only variation, no parameters
                    else await this.runtime_actions.insertToScope(SCOPE, type_info[0]);
                    break;
                }

    
                // ENDPOINTS / ALIASES
                case BinaryCode.PERSON_ALIAS: 
                case BinaryCode.PERSON_ALIAS_WILDCARD:
                case BinaryCode.INSTITUTION_ALIAS:
                case BinaryCode.INSTITUTION_ALIAS_WILDCARD:
                case BinaryCode.BOT:
                case BinaryCode.BOT_WILDCARD:
                case BinaryCode.ENDPOINT:
                case BinaryCode.ENDPOINT_WILDCARD:
                {
                    const f = this.runtime_actions.constructFilterElement(SCOPE, token);
                    if (f === false) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    await this.runtime_actions.insertToScope(SCOPE, f);
                    break;
                }
               
                // POINTER
                case BinaryCode.POINTER: {
                    /** wait for buffer */
                    if (SCOPE.current_index+Pointer.MAX_POINTER_ID_SIZE > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    const id = SCOPE.buffer_views.uint8.slice(SCOPE.current_index, SCOPE.current_index+=Pointer.MAX_POINTER_ID_SIZE);
                    const [knows_pointer, has_hash] = this.convertByteToNumbers([1,1,6], SCOPE.buffer_views.uint8[SCOPE.current_index++])

                    const ptr = await Pointer.load(id, SCOPE, false, knows_pointer?true:false);
                    await this.runtime_actions.insertToScope(SCOPE, ptr);

                    break;
                }


                // SET_POINTER
                case BinaryCode.SET_POINTER: {

                    /** wait for buffer */
                    if (SCOPE.current_index+Pointer.MAX_POINTER_ID_SIZE > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    const id = SCOPE.buffer_views.uint8.slice(SCOPE.current_index, SCOPE.current_index+=Pointer.MAX_POINTER_ID_SIZE);
                    const [knows_pointer, has_hash] = this.convertByteToNumbers([1,1,6], SCOPE.buffer_views.uint8[SCOPE.current_index++])

                    try {
                        const pointer = await Pointer.load(id, SCOPE, false, knows_pointer?true:false);

                        if (!SCOPE.inner_scope.waiting_ptrs) SCOPE.inner_scope.waiting_ptrs = new Set();
                        SCOPE.inner_scope.waiting_ptrs.add([pointer]); // assign next value to pointer;
                    }
                    catch (e) {
                        throw new PointerError("Could not get or create pointer: $" + Pointer.normalizePointerId(id));
                    }

                    break;
                }

                // INIT_POINTER
                case BinaryCode.INIT_POINTER: {

                    /** wait for buffer */
                    if (SCOPE.current_index+Pointer.MAX_POINTER_ID_SIZE > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/

                    const id = SCOPE.buffer_views.uint8.slice(SCOPE.current_index, SCOPE.current_index+=Pointer.MAX_POINTER_ID_SIZE);
                    const [knows_pointer, has_hash] = this.convertByteToNumbers([1,1,6], SCOPE.buffer_views.uint8[SCOPE.current_index++])


                    const init_block_size = SCOPE.buffer_views.data_view.getUint32(SCOPE.current_index, true);
					SCOPE.current_index += Uint32Array.BYTES_PER_ELEMENT;

                    // pointer exists
                    try {
                        let pointer = Pointer.create(id);
                        // when remote pointer is initialized by owner endpoint, it does not have to be loaded here from the remote endpoint, because the content is loaded in the initialization
                        // TODO: currently the initialization block is always used, even if it was not sent by the pointer owner, because SCOPE.sender?.equals(pointer.origin) does not work with ids and aliases of remote endpoints
                        const only_load_local = true; //pointer.is_origin || SCOPE.sender?.equals(pointer.origin);
                        pointer = await Pointer.load(id, SCOPE, only_load_local, knows_pointer?true:false);
                        // console.log("has $" + Pointer.normalizePointerId(id), jmp_index, buffer2hex(SCOPE.buffer_views.uint8.slice(jmp_index), " "));
                        // pointer.is_persistent = true;
                        SCOPE.current_index += init_block_size; // jump to end of init block
                    }
                    // does not exist: init, or no permission
                    catch (e) {

                        // pointer does exist but no permission
                        if (e instanceof PermissionError) {
                            throw e;
                        }

                        // pointer does not exist
                        else {
                            if (!SCOPE.inner_scope.waiting_ptrs) SCOPE.inner_scope.waiting_ptrs = new Set();
                            const tmp_ptr = Pointer.create(id);
                            // add pointer init promise for recursive init
                            const {promise, resolve, reject} = Promise.withResolvers<Pointer>();
                            Pointer.addLoadingPointerPromise(id, promise, SCOPE);
                            // TODO: make sure resolve or reject is called at some point or the promise is removed
                            SCOPE.inner_scope.waiting_ptrs.add([tmp_ptr, {resolve, reject}]); // assign next value to pointer;
                        }

                    }

                    break;
                }

                // // DELETE_POINTER TODO remove?
                // case BinaryCode.DELETE_POINTER: {
                //     SCOPE.inner_scope.delete_pointer = true;
                //     break;
                // }

                // SYNC
                case BinaryCode.SYNC: {
                    SCOPE.inner_scope.sync = true;
                    SCOPE.sync = true; // to know if currently waiting for subscribe anywhere in parent
                    break;
                }

                // _SYNC_SILENT
                case BinaryCode._SYNC_SILENT: {
                    SCOPE.inner_scope.sync = 'silent';
                    SCOPE.sync = true; // to know if currently waiting for subscribe anywhere in parent
                    break;
                }

                // STOP_SYNC
                case BinaryCode.STOP_SYNC: {
                    SCOPE.inner_scope.stop_sync = true;
                    break;
                }

                // COPY
                case BinaryCode.COPY: {
                    SCOPE.inner_scope.copy = true;
                    break;
                }
                // CLONE
                case BinaryCode.CLONE: {
                    SCOPE.inner_scope.clone = true;
                    break;
                }
                // CLONE_COLLAPSE
                case BinaryCode.CLONE_COLLAPSE: {
                    SCOPE.inner_scope.clone_collapse = true;
                    break;
                }

                // COLLAPSE
                case BinaryCode.COLLAPSE: {
                    SCOPE.inner_scope.collapse = true;
                    break;
                }

                // GET_TYPE
                case BinaryCode.GET_TYPE: {
                    SCOPE.inner_scope.get_type = true;
                    break;
                }
                // ORIGIN
                case BinaryCode.ORIGIN: {
                    SCOPE.inner_scope.get_origin = true;
                    break;
                }
                // SUBSCRIBERS
                case BinaryCode.SUBSCRIBERS: {
                    SCOPE.inner_scope.get_subscribers = true;
                    break;
                }

                // POINTER_ACTION
                case BinaryCode.POINTER_ACTION: {
                    /** wait for buffer */
                    if (SCOPE.current_index+1+Pointer.MAX_POINTER_ID_SIZE > SCOPE.buffer_views.uint8.byteLength) return Runtime.runtime_actions.waitForBuffer(SCOPE);
                    /********************/
                    const action = SCOPE.buffer_views.uint8[SCOPE.current_index++];

                    const id = SCOPE.buffer_views.uint8.slice(SCOPE.current_index, SCOPE.current_index+=Pointer.MAX_POINTER_ID_SIZE);
                    const [knows_pointer, has_hash] = this.convertByteToNumbers([1,1,6], SCOPE.buffer_views.uint8[SCOPE.current_index++])

                    // get pointer
                    const ptr = await Pointer.load(id, SCOPE, false, knows_pointer?true:false);
                    // let ptr = Pointer.get(id);
                    // if (!ptr) throw new PointerError("Pointer does not exist", SCOPE);

                    if (!SCOPE.inner_scope.waiting_ptrs) SCOPE.inner_scope.waiting_ptrs = new Set();
                    SCOPE.inner_scope.waiting_ptrs.add([ptr, action]); // assign next value to pointer;
                    break;
                }

                // CREATE_POINTER ($ ())
                case BinaryCode.CREATE_POINTER: {
                    SCOPE.inner_scope.create_pointer = true;
                    break;
                }

                
                
                // STREAM (<<)
                case BinaryCode.STREAM: {

                    // if not already has a stream_consumer, set the active value as a stream_consumer
                    if (!SCOPE.inner_scope.stream_consumer) {
                        if (!SCOPE.inner_scope.active_value) throw new RuntimeError("Missing stream consumer", SCOPE)
                        // implements StreamConsumer
                        if (!Type.std.StreamConsumer.matches(SCOPE.inner_scope.active_value)) throw new TypeError("<StreamConsumer> expected");

                        SCOPE.inner_scope.stream_consumer = SCOPE.inner_scope.active_value;
                        delete SCOPE.inner_scope.active_value;
                    }
                  
                    break;
                }


                default: {
                    //logger.error("Invalid Binary Token at index "+SCOPE.current_index+": " + token)
                    console.log(MessageLogger.decompile(SCOPE.buffer_views.buffer, false, true));
                    throw new DatexError("Invalid Binary Token: " + token.toString(16), SCOPE);
                }

            }
                    
        }

    }
}

try {
    Runtime.VERSION = (await import("../VERSION.ts")).default
}
catch {
    console.error("Could not determine DATEX version")
}

// if (globalThis.HTMLImageElement) {
//     Runtime.MIME_TYPE_MAPPING["image/*"] = <mime_type_definition<globalThis.HTMLImageElement>>{
//         class:globalThis.HTMLImageElement, 
//         generator(value) {
//             const image = new Image();
//             image.src = URL.createObjectURL(value);
//             return image
//         }
//     }
// }



Logger.setRuntime(Runtime); // workaround to prevent circular imports
Logger.setType(Type); // workaround to prevent circular imports
Logger.setPointer(Pointer); // workaround to prevent circular imports



Runtime.onEndpointChanged(initPublicStaticClasses)




// @ts-ignore
if (globalThis.navigator?.userAgentData?.brands) {
    // @ts-ignore
    for (let brand of globalThis.navigator.userAgentData.brands) {
        if (!brand.brand.startsWith("Not")) {
            Runtime.HOST_ENV = (brand.brand??"") + " " + (brand.version??"");
            break;
        }
    }
}
else {
    if (globalThis.navigator?.userAgent?.match(/firefox|fxios/i)) Runtime.HOST_ENV = "Firefox";
    else if(globalThis.navigator?.userAgent?.match(/safari/i)) Runtime.HOST_ENV = "Safari";
    else if(globalThis.navigator?.userAgent?.match(/opr\//i)) Runtime.HOST_ENV = "Opera";
    else if(globalThis.navigator?.userAgent?.match(/edg/i)) Runtime.HOST_ENV = "Edge";
    else if (client_type === "deno") Runtime.HOST_ENV = "Deno";
}
// version
// @ts-ignore
if (globalThis.navigator?.userAgentData) Runtime.HOST_ENV += (Runtime.HOST_ENV?' / ':'') + globalThis.navigator.userAgentData.platform;
else if (globalThis.navigator?.platform) Runtime.HOST_ENV += (Runtime.HOST_ENV?' / ':'') + globalThis.navigator?.platform;

// TODO node.js env version

globalThis.parseDatexData = Runtime.parseDatexData;


globalThis.DatexRuntime = Runtime;
/** end DatexRuntime static initializations*/

RuntimePerformance.marker("main runtime loading time", "main_runtime_loaded", "modules_loaded");



// define measurement groups
RuntimePerformance.createMeasureGroup("compile time", [
    "header",
    "body"
])


// automatically sync newly added pointers if they are in the storage
Pointer.onPointerAdded(async (pointer)=>{
    // assume that already synced if createdInContext and stored in storage
    if (!pointer.createdInContext && await Storage.hasPointer(pointer)) {
        Storage.syncPointer(pointer);
    }
})

RuntimePerformance.marker("pseudoclass loading time", "pseudo_classes_loaded", "main_runtime_loaded");
RuntimePerformance.marker("runtime initialization time", "initialized", "main_runtime_loaded");
RuntimePerformance.marker("startup time", "runtime_ready", "runtime_start");



// currently not working in unit.ts file

Type.std.quantity.setJSInterface({

    class: Quantity,

    cast(value, type, context, origin) {
        console.log("cast",value,type);

        if (typeof value != "number" && typeof value != "bigint" && value != VOID) {
            throw new TypeError("Cannot cast value to quantity"); // TODO: generalize for cast method (special return values)
        }

        if (type.parameters.length == 1) {
            if (!(type.parameters[0] instanceof Quantity)) {
                throw new TypeError("Invalid param for quantity value"); // TODO: generalize for cast method (special return values)
            }
            else {
                return new Quantity(value, type.parameters?.[0].unit);
            }
        }
        else if (type.parameters.length > 1) {
            throw new TypeError("Invalid params for quantity value"); // TODO: generalize for cast method (special return values)
        }
        else return new Quantity(value);
    },

    get_type(value:Quantity) {
        return Type.std.quantity.getParametrized([value.base_value]);
    },


    type_params_match(params, against_params) {
        return params.length == 1 && 
            against_params.length == 1 && 
            params[0] instanceof Quantity && 
            against_params[0] instanceof Quantity &&
            params[0].equals(against_params[0]);
    },

    override_silently(ref, value) {
        console.log("os",ref,value)
        ref.value = value.value;
    },

    operator_add(first, second) {
        console.log("add",first,second)
        if (first instanceof Quantity && second instanceof Quantity) return first.sum(second)
        else return INVALID;
    },

    operator_subtract(first, second) {
        if (first instanceof Quantity && second instanceof Quantity) return first.difference(second)
        else return INVALID;
    },

    operator_multiply(first, second) {
        if (first instanceof Quantity && (typeof second == "number"||typeof second == "bigint")) return first.product(second)
        else if (second instanceof Quantity && (typeof first == "number"||typeof first == "bigint")) return second.product(first);
        else if (first instanceof Quantity && second instanceof Quantity) return first.product(second)
        else return INVALID;
    },

    operator_divide(first, second) {
        if (first instanceof Quantity && (typeof second == "number"||typeof second == "bigint")) return first.quotient(second)
        else if (second instanceof Quantity && (typeof first == "number"||typeof first == "bigint")) return new Quantity(first, 'x').quotient(second);
        else if (first instanceof Quantity && second instanceof Quantity) return first.quotient(second)
        else return INVALID;
    },

    operator_power(first, second) {
        if (first instanceof Quantity && (typeof second == "number"||typeof second == "bigint")) return first.power(second)
        else return INVALID;
    },

    compare(first:Quantity, second:Quantity) {
        return Quantity.compare(first, second);
    },

    action_add(value:Quantity, second, silently) { // TODO silent/not silent update handling
        if (second instanceof Quantity) value.add(second)
        else return INVALID;
    },

    action_subtract(value:Quantity, second, silently) {
        if (second instanceof Quantity) value.subtract(second)
        else return INVALID;
    },

    action_multiply(value:Quantity, second, silently) {
        if (typeof second == "number" || typeof second == "bigint") value.multiply(second)
        else return INVALID;
    },

    action_divide(value:Quantity, second, silently) {
        if (typeof second == "number" || typeof second == "bigint") value.divide(second)
        else return INVALID;
    },


});


Type.std.time.setJSInterface({

    class: Time,

    operator_add(first, second) {
        if (first instanceof Time && second instanceof Quantity) return first.plus(second)
        if (second instanceof Time && first instanceof Quantity) return second.plus(first)
        else return INVALID;
    },

    operator_subtract(first, second) {
        if (first instanceof Time && second instanceof Quantity) return first.minus(second)
        if (second instanceof Time && first instanceof Quantity) return second.minus(first)
        else return INVALID;
    },


    action_add(value:Time, second, silently) { // TODO silent/not silent update handling
        if (second instanceof Quantity && (second.hasBaseUnit('s')||second.hasBaseUnit('Cmo'))) value.add(second)
        else return INVALID;
    },
    action_subtract(value:Time, second, silently) { // TODO silent/not silent update handling
        if (second instanceof Quantity && (second.hasBaseUnit('s')||second.hasBaseUnit('Cmo'))) value.subtract(second)
        else return INVALID;
    },

})

Type.std.MatchCondition.setJSInterface({
    class: MatchCondition,
    visible_children: new Set([
        "type",
        "data"
    ])
})


Type.get<JSTransferableFunction>("js:Function").setJSInterface({

    class: JSTransferableFunction,
    visible_children: new Set([
        "source",
        "deps"
    ]),
    cast(value,type,context,origin) {
        return JSTransferableFunction.recreate(value.source, value.deps)
    },

    apply_value(parent, args = []) {
        if (args instanceof Tuple) return parent.handleCall(...args.toArray())
        else return parent.handleCall(args)
    },

});



Type.get("std:Iterator").setJSInterface({
    class: Iterator,
    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(['val', 'next']),
})

// displayClear();
