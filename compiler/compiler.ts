// deno-lint-ignore-file no-cond-assign
/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  Datex Compiler                                                                      ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Compiles datex to binary                                                            ║
 ║  Visit https://docs.unyt.org/datex for more information                              ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2020 unyt.org                        ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */

import { Logger } from "../utils/logger.ts";
const logger = new Logger("datex compiler");

import { ReadableStream, Runtime, StaticScope} from "../runtime/runtime.ts";
import { Endpoint, IdEndpoint, Target, WildcardTarget, Institution, Person, BROADCAST, target_clause, endpoints, LOCAL_ENDPOINT } from "../types/addressing.ts";
import { Pointer, PointerProperty, Ref } from "../runtime/pointers.ts";
import { CompilerError, RuntimeError, Error as DatexError, ValueError } from "../types/errors.ts";
import { Function as DatexFunction } from "../types/function.ts";

import { crypto, Crypto } from "../runtime/crypto.ts";
import { Stream } from "../types/stream.ts";
import { Type } from "../types/type.ts";
import { Tuple } from "../types/tuple.ts";
import { BinaryCode } from "./binary_codes.ts";
import { Scope } from "../types/scope.ts";
import { ProtocolDataType } from "./protocol_types.ts";
import { Quantity } from "../types/quantity.ts";
import { EXTENDED_OBJECTS, INHERITED_PROPERTIES, VOID, SLOT_WRITE, SLOT_READ, SLOT_EXEC, NOT_EXISTING, SLOT_GET, SLOT_SET, DX_IGNORE, DX_BOUND_LOCAL_SLOT } from "../runtime/constants.ts";
import { arrayBufferToBase64, base64ToArrayBuffer, buffer2hex, hex2buffer } from "../utils/utils.ts";
import { RuntimePerformance } from "../runtime/performance_measure.ts";
import { Conjunction, Disjunction, Logical, Negation } from "../types/logic.ts";
import { Regex } from "./tokens_regex.ts";
import { baseURL, TypedArray } from "../utils/global_values.ts";
import type { datex_scope } from "../utils/global_types.ts";
import { unit_symbol } from "./unit_codes.ts";
import { Time } from "../types/time.ts";

// WASM
import wasm_init, {init_runtime as wasm_init_runtime, compile as wasm_compile, decompile as wasm_decompile} from "../wasm/adapter/pkg/datex_wasm.js";
import { MessageLogger } from "../utils/message_logger.ts";
import { JSTransferableFunction } from "../types/js-function.ts";
import { client_type } from "../utils/constants.ts";
import { normalizePath } from "../utils/normalize-path.ts";
import { VolatileMap } from "../utils/volatile-map.ts";

await wasm_init();
wasm_init_runtime();

export const activePlugins:string[] = [];

// for actions on variables, pointers, ...
enum ACTION_TYPE {
    GET, 
    SET, // =
    INIT, // :=
    OTHER, // +=, -=, ...
    SET_REFERENCE // $= for variables
}

// Raw DATEX as return type
export class DatexResponse<T> {
    constructor(public datex:string|URL|Scope, public data?:unknown[]) {}

    async evaluate():Promise<T> {
        if (this.datex instanceof URL) {
            return <T>(await Runtime.getURLContent(this.datex))[0]
        }
        else if (typeof this.datex == "string") {
            return <Promise<T>>Runtime.executeDatexLocally(this.datex, this.data);
        }
        else if (this.datex instanceof Scope) {
            return this.datex.execute(Runtime.endpoint);
        }
        else throw new Error("Invalid DATEX Response data");
    }
}



export const ProtocolDataTypesMap = [
    "REQUEST", "RESPONSE", "DATA", "TMP_SCOPE", "LOCAL", "HELLO", "DEBUGGER", "SOURCE_MAP", "UPDATE", "GOODBYE", "TRACE", "TRACE_BACK"
]


type compiler_sub_scope = {
    last_value_index: number,  // byte index of last, pointer, var, object, ...
    first_value_index?: number, // byte index of first value in subscope
    start_index: number, // index for the opening bracket of the subscope
    wait_for_add: boolean,
    in_template_string: boolean,
    path_info_index: number,
    while?: number, // start_index, indicate that currently in a while loop
    iterate?: 0|1, // indicate that currently in a iterate loop, two steps
    loop_start?: number, // index indicates loop start
    jfa_index?: number,
    if?: number, // start_index, indicate that currently in a if condition
    else?: boolean, // currently waiting for else
    value_count?: number, // count inserted values
    if_end_indices?: number[], // contains indices inside if statements to jump to the end
    param_type_close?: boolean, // wait for parameterized type end: )>
    function?: number,
    use_parent_index?: number, // use (x,y,z) declartion finish after sub scope close
    imported_vars?: [string, string?][],

    try_start?:number, // inner start index of try scope block
    try_close?:boolean, // auto close try scope block

    exports?:Object,

    object_slot_index?: number,
    object_slots?: Map<string, number>,

    comma_indices?: number[], // contains all indices where a comma was inserted

    has_ce?: boolean, // subscope contains ;
    ce_index?: number, // index of last ;
    first_element_pos?: number, // last element had key
    parent_type?: BinaryCode, // Array or Object or empty
    auto_close_scope?: BinaryCode, // does a tuple need to be auto-closed?

    vars?: {[name:string]: [type:'val'|'var'|'ref'|'const', slot:number]}
};


type extract_var_scope = {
    _is_extract_var_scope: true,

    buffer: ArrayBuffer,
    uint8: Uint8Array,
    data_view: DataView,
    b_index: number,
    inner_scope: compiler_sub_scope,
    inserted_values: Map<unknown, [number]>,
    dynamic_indices: [number][],
    preemptive_pointers: Map<string, compiler_scope|extract_var_scope>
    options: compiler_options,
    assignment_end_indices: Set<number>,
    var_index?: number,

    stack: [Endpoint, string?][]
}

export type compiler_scope = {

    _is_extract_var_scope: false,

    datex: string,

    return_data?: {datex:string},

    data?: unknown[],
    options: compiler_options,

    preemptive_pointers: Map<string, compiler_scope|extract_var_scope>,
    
    jmp_label_indices:  {[label:string]:[number]}, // jmp label -> binary index
    indices_waiting_for_jmp_lbl: {[label:string]:[number][]}, // jmp instructions waiting for resolved label indices

    assignment_end_indices: Set<number>, // contains a list of all indices at which a assignment ends (x = .), needed for inserted value indexing

    inserted_values: Map<unknown, [number]>, // save start indices of all inserted values

    used_lbls: string[], // already used lbls

    addJSTypeDefs?: boolean, // should add url() imports for types to load via JS modules

    last_cache_point?: number, // index of last cache point (at LBL)

    add_header: boolean,
    is_child_scope_block?: boolean, // allow \x,\y,\z, \(...), execute in parent scope during runtime
    extract_pointers?: boolean, // extract pointers/labels from scope, required for transform
    extract_var_index?: number
    extract_var_indices?: Map<BinaryCode, Map<string|number, number>>
    extract_var_scope?:extract_var_scope
    precompiled?: PrecompiledDXB, // save precompiled in precompiled object if provided
    last_precompiled?: number, // index from where to split last_precompiled buffer part

    var_index?:number,


    buffer: ArrayBuffer,
    uint8: Uint8Array,
    data_view: DataView,

    // pre-generated for header
    receiver_buffer?: ArrayBuffer, // already generated buffer containing the receivers filter
    sender_buffer?: ArrayBuffer, // already generated buffer containing the sender

    full_dxb_size?: number
    pre_header_size?: number
    signed_header_size?: number

    stack: [Endpoint, string?][],

    unused_plugins?: Set<string>, // set of all plugins used in the script, to check against options.required_plugins

    b_index: number,

    streaming?: ReadableStreamDefaultReader<unknown>,

    max_block_size?: number, // max size of each block, if not Infinity (default), dxb might be split into multiple blocks

    internal_var_index: number // count up for every new internal variable
    internal_vars: WeakMap<Record<string, unknown>, number> // save variables for values with an internal variable
    internal_primitive_vars: WeakMap<Record<string, unknown>, number> // save variables for primitive values with an internal variable

    serialized_values: WeakMap<Record<string, unknown>, unknown> // cache serialized versions of values (if they are used multiple times)
    dynamic_indices: [number][], // contains all dynamic index [number] arrays
    jmp_indices: [number][], // contains all positions (as dynamic indices) at which a jmp to xy index exists (and might need to be updated if a buffer shift occurs)

    current_data_index?: number,

    current_line_nr: number,
    end: boolean,

    is_outer_insert?: boolean,

    last_command_end?: boolean,

    subscopes: compiler_sub_scope[],
    inner_scope: compiler_sub_scope,

    // for compile instructions
    compile_datex_scope?: datex_scope
    compile_compiler_scope?: compiler_scope

    _code_block_type?: number // 0/undefined: no code block, 1: () code block, 2: single line code block
}

export type compiler_options = {
    /** Header options */
    sid?:number,     // scope id
    return_index?: number // unique block return index
    inc?: number, // incremenented block index (should not be changed)
    end_of_scope?:boolean, // is last block for this scope id
    from?: Endpoint,  // sender
    to?: target_clause|Pointer<target_clause>, // receivers
    flood?: boolean, // no receiver, flood to all
    type?: ProtocolDataType,    // what kind of data is in the body?
    sign?: boolean,  // sign the header + body
    encrypt?: boolean, // encrypt the body?
    sym_encrypt_key?: CryptoKey, // encrypt with the provided symmetric encryption key
    send_sym_encrypt_key?: boolean, // send the encrypted encryption key to all receivers (only send once for a session per default)
    allow_execute?:boolean, // allow calling functions, per default only allowed for datex requests
    
    plugins?: string[] // list of enabled plugins
    required_plugins?: string[] // list of enabled plugins that must be used

    // for routing header
    __routing_ttl?:number,
    __routing_prio?:number,
    __routing_to?: endpoints|Pointer<target_clause>

    // for special compiler info
    inserted_ptrs?: Set<Pointer>
    force_id?: boolean // use endpoint id as sender, also if other identifier available
    collapse_pointers?: boolean // collapse all pointers to their actual values (not pointers injected into a scope)
    keep_external_pointers?: boolean, // if true and collapse_pointers is true, non-origin pointers are not collapsed
    collapse_injected_pointers?: boolean // collapse pointers injected to a scope 
    collapse_first_inserted?: boolean // collapse outer pointer to actual value
    _first_insert_done?: boolean // set to true after first insert
    keep_first_transform?: boolean // if collapse_first_inserted is true, the outer transform is not collapsed (restored as transform)
    no_create_pointers?: boolean // don't add $$ to clone pointers (useful for value comparison)
    parent_scope?: compiler_scope, // reference to parent scope, required for val var ref
    pseudo_parent?: boolean, // if true, handle variables from parent_scope like normal variables (no reindexing), required for init blocks, ...
    only_leak_inserts?: boolean, // only __insert__ placeholder variables from parent scope are accessible
    no_duplicate_value_optimization?: boolean, // dont collapse multiple identical primitive ´´ values to a single reference (only relevant for rendering as datex script, mostly for strings)

    preemptive_pointer_init?: boolean, // directly sent the pointer values for owned pointers
    init_scope?: boolean, // is not a real subscope, only a init block
    context_location?: URL, // location of the dx file

    // used by insert commands, shared over multiple dx file compilations
    insert_header?: {
        buffer: ArrayBuffer,
        index: number,
        cache:  Map<string,string>, // insert value (url, enpoint string) -> variable
        vars?: {[name:string]: [type:'val'|'var'|'ref', slot:number]}, // reference to the vars of the most outer parent scope
        var_index: number,
        root_scope: compiler_scope // most outer parent scope
    }


    __v2?: boolean
}

const utf8_decoder = new TextDecoder();

export const INSERT_MARK = '\u0001\udddd\uaaaa\ueeee\u0001'

export class Compiler {

    static readonly VERSION_NUMBER = 1;

    static SIGN_DEFAULT = true; // can be changed

    static BIG_BANG_TIME = new Date(2022, 0, 22, 0, 0, 0, 0).getTime() // 1642806000000
    static MAX_INT_32 = 2_147_483_647;
    static MIN_INT_32 = -2_147_483_648;

    static MIN_INT_64 = -9223372036854775808n;
    static MAX_INT_64 = 9223372036854775807n;

    static MAX_INT_8 = 127;
    static MIN_INT_8 = -128;

    static MAX_INT_16 = 32_767;
    static MIN_INT_16 = -32_768;

    static MAX_UINT_16 = 65_535;

    static readonly signature_size = 96 // 256;

    static _buffer_block_size = 64;

    private static utf8_encoder = new TextEncoder();

    private static local_url = new URL('@@local', baseURL);

    private static getBaseStack(context_location:URL = this.local_url):[Endpoint, string] {
        return [Runtime.endpoint, 'compiler' + (context_location ? ': ' + context_location?.toString() : '')]
    }

    private static combineBuffers(buffer1:ArrayBuffer, buffer2:ArrayBuffer) {
        const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        tmp.set(new Uint8Array(buffer1), 0);
        tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
        return tmp.buffer;
    }

    private static sid_return_indices = new VolatileMap<number,number>();
    private static sid_incs = new VolatileMap<number,number>();
    private static sid_incs_remote:Map<Target, VolatileMap<number,number>> = new Map();

    public static readonly MAX_SID = 4_294_967_295;
    public static readonly MAX_BLOCK = 65_535;

    public static readonly MAX_DXB_BLOCK_SIZE = Compiler.MAX_UINT_16; // default max block size (Infinity)

    /** create a new random SID */
    public static generateSID(keepalive = false):number{
        let sid:number;
        // get unique SID
        do {
            sid = Math.round(Math.random() * this.MAX_SID);
        } while (this.sid_return_indices.has(sid));

        this.sid_return_indices.set(sid,0);
        this.sid_incs.set(sid,0);

        // TODO: alternative solution? at some point, the map max size will be reached
        if (keepalive) {
            this.sid_return_indices.keepalive(sid, Infinity)
            this.sid_incs.keepalive(sid, Infinity)
        }
        return sid;
    }

    /** get return index ++ for a specific SID */
    public static getNextReturnIndexForSID(sid:number):number {
        if (!this.sid_return_indices.has(sid)) {this.sid_return_indices.set(sid,0);this.sid_incs.set(sid,0);} // sid not yet loaded?
        let c = <number>this.sid_return_indices.keepalive(sid);
        if (c > this.MAX_BLOCK) c = 0;
        this.sid_return_indices.set(sid, c+1);
        return c; 
    }

    private static getBlockInc(sid:number):number {
        if (!this.sid_return_indices.has(sid)) {this.sid_return_indices.set(sid,0);this.sid_incs.set(sid,0);} // sid not yet loaded?

        let c = <number>this.sid_incs.keepalive(sid);
        if (c > this.MAX_BLOCK) c = 0;
        this.sid_incs.set(sid, c+1);
        return c;
    }

    // count up inc individually for different remote receivers (important for RESPONSE dxb)
    private static getBlockIncForRemoteSID(sid: number, remote_endpoint:Endpoint, reset_inc = false) {
        if (!(remote_endpoint instanceof Target)) throw new CompilerError("Can only send datex responses to endpoint targets");
        if (!this.sid_incs_remote.has(remote_endpoint)) this.sid_incs_remote.set(remote_endpoint, new VolatileMap());

        const sid_incs = this.sid_incs_remote.get(remote_endpoint)!;

        if (!sid_incs.has(sid)) {
            if (reset_inc) return 0; // don't even bother to create a 0-entry, just return 0 directly
            sid_incs.set(sid, 0); // sid not yet loaded?
        }

        let c = sid_incs.keepalive(sid)!;
        if (c > this.MAX_BLOCK) c = 0;
        sid_incs.set(sid, c+1);
        //logger.warn("INC for remote SID " + sid, c, (reset_inc?'RESET':''));

        // reset to 0 if scope is closed (responses are sent with the same scope id again and again, but the inc has to be reset each time)
        if (reset_inc) sid_incs.set(sid, 0);

        return c;
    }

    // 0 2 1 5 -> byte
    public static convertNumbersToByte(bit_distribution:number[], ...nrs:(boolean|number)[]):number {
        if (bit_distribution.reduce((a,b)=>a+b) > 8) throw Error("Bit size bigger than 8 bits");
        let binary = "";
        for (let s = bit_distribution.length-1; s>=0; s--) {
            const size = bit_distribution[s];
            const nr = Number(nrs[s])||0;
            if (nr > 2**size - 1) throw Error("Number " + nr + " is bigger than " + size + "  bits");
            binary = (nr?.toString(2)||'').padStart(size, '0') + binary;
        }

        return parseInt(binary, 2);
    }

    /** Set TTL of header of existing block */
    public static setHeaderTTL(dx_block:ArrayBuffer, ttl:number):ArrayBuffer {
        const uint8 = new Uint8Array(dx_block);
        uint8[4] = ttl;
        return uint8.buffer;
    }

    // get sender from header
    public static extractHeaderSender(dx_block: ArrayBuffer, last_byte?:[number], _appspace_byte = true, _start = 8): Endpoint|undefined {
        const header_uint8 = new Uint8Array(dx_block);
        let i = _start;

        const sender_type = header_uint8[i++];

        // not anonynmous?
        if (sender_type != 0) {
            
            const name_length = header_uint8[i++]; // get name length
            const subspace_number = header_uint8[i++]; // get subspace number
            let instance_length = header_uint8[i++]; // get instance length

            let has_appspace = false;
            if (_appspace_byte) has_appspace = !!header_uint8[i++];

            if (instance_length == 0) throw new RuntimeError("Invalid sender");
            else if (instance_length == 255) instance_length = 0;

            const name_binary = header_uint8.subarray(i, i+=name_length);
            const name = (sender_type == BinaryCode.ENDPOINT || sender_type == BinaryCode.ENDPOINT_WILDCARD) ? name_binary : utf8_decoder.decode(name_binary)  // get name

            const subspaces:string[]= [];
            for (let n=0; n<subspace_number; n++) {
                const length = header_uint8[i++];
                if (length == 0) {
                    throw new RuntimeError("Invalid sender");
                }
                else {
                    const subspace_name = utf8_decoder.decode(header_uint8.subarray(i, i+=length));
                    subspaces.push(subspace_name);
                }
            }

            const instance = utf8_decoder.decode(header_uint8.subarray(i, i+=instance_length))  // get instance
            
            if (last_byte) last_byte[0] = i;

            const appspace = has_appspace ? this.extractHeaderSender(dx_block, last_byte, false, i) : undefined;

            return <Endpoint> Target.get(name, instance, sender_type);
        }

        if (last_byte) last_byte[0] = i;
        return undefined;
    }

     // get sender from header
     public static extractHeaderSenderV2(dx_block: ArrayBuffer, last_byte?:[number], _appspace_byte = true, _start = 8): Endpoint|undefined {
        const header_uint8 = new Uint8Array(dx_block);
        const header_data_view = new DataView(header_uint8.buffer);

        let i = _start;

        const sender_type = header_uint8[i++];

        // not anonynmous?
        if (sender_type != 0xff) {
            
            const name_length = 18;
            const name_binary = header_uint8.subarray(i, i+=name_length);
            const name = (sender_type == BinaryCode.ENDPOINT || sender_type == BinaryCode.ENDPOINT_WILDCARD) ? name_binary : utf8_decoder.decode(name_binary).replaceAll("\x00", "")  // get name
            const instance = header_data_view.getUint16(i, true) || undefined;
            i += 2;

            if (last_byte) last_byte[0] = i;

            let bin_type = 0;
            if (sender_type == 0) bin_type = BinaryCode.ENDPOINT;
            else if (sender_type == 1) bin_type = BinaryCode.PERSON_ALIAS;
            else if (sender_type == 2) bin_type = BinaryCode.INSTITUTION_ALIAS;

            return <Endpoint> Target.get(name, instance, bin_type);
        }

        if (last_byte) last_byte[0] = i;
        return undefined;
    }

    // dx block can be header or full dxb
    protected static extractHeaderReceiverDataList(dx_block: ArrayBuffer, start_byte:number):Map<Endpoint, ArrayBuffer> {

        const header_uint8 = new Uint8Array(dx_block);
        let i = start_byte;

        const targets_map = new Map<Endpoint, ArrayBuffer>();
        const targets_nr = header_uint8[i++];
        const target_list = [];

        // same as in Runtime
        for (let n=0; n<targets_nr; n++) {
            const type = header_uint8[i++];

            // is pointer
            if (type == BinaryCode.POINTER) {
                // TODO get receivers from pointer
            }

            // filter target
            else {
                
                const name_length = header_uint8[i++]; // get name length
                const subspace_number = header_uint8[i++]; // get subspace number
                const instance_length = header_uint8[i++]; // get instance length
    
                const name_binary = header_uint8.subarray(i, i+=name_length);
                const name = type == BinaryCode.ENDPOINT ? name_binary : utf8_decoder.decode(name_binary)  // get name
    
                const subspaces = [];
                for (let n=0; n<subspace_number; n++) {
                    const length = header_uint8[i++];
                    const subspace_name = utf8_decoder.decode(header_uint8.subarray(i, i+=length));
                    subspaces.push(subspace_name);
                }
    
                const instance = utf8_decoder.decode(header_uint8.subarray(i, i+=instance_length))  // get instance

                const target = <Endpoint> Target.get(name, instance, type);

                target_list.push(target)
    
                // get attached symmetric key?
                const has_key = header_uint8[i++];
                if (has_key) {
                    // add to keys
                    targets_map.set(target, header_uint8.slice(i, i+512));
                    i += 512;
                }
            }
            
        }
        return targets_map;
    }

    /** Set receivers of header of existing block */
    public static updateHeaderReceiver(dx_block:ArrayBuffer, to:Disjunction<Endpoint>):ArrayBuffer|void {
        // create receiver buffer, create new
        // extract keys

        // TODO extract and recombine more efficient!
        // first get keys from old receiver header
        const last_byte:[number] = [0];
        const _sender = Compiler.extractHeaderSender(dx_block, last_byte);
        //console.log("> sender", sender, last_byte[0]);
        const keys = Compiler.extractHeaderReceiverDataList(dx_block, last_byte[0]+2);

        // now add the required keys back into the old header
        const receiver_buffer = Compiler.targetsToDXB(to, keys, true);
        
        if (!receiver_buffer) {
            logger.error("could not get receiver buffer");
            return;
        }

        const receiver_start_index = last_byte[0];

        // get dimensions - create new buffers
        const routing_header_size = receiver_start_index + Uint16Array.BYTES_PER_ELEMENT + new DataView(dx_block).getUint16(receiver_start_index, true);

        let uint8 = new Uint8Array(dx_block);
        const routing_part = uint8.slice(0, receiver_start_index);
        const main_part = uint8.slice(routing_header_size);

        // calculate new dimensions
        const total_header_size = receiver_start_index+Uint16Array.BYTES_PER_ELEMENT+receiver_buffer.byteLength;
        const total_size = total_header_size + main_part.byteLength;

        const new_dx_block = new ArrayBuffer(total_size);
        const data_view = new DataView(new_dx_block);
        uint8 = new Uint8Array(new_dx_block);
        
        // re-write to new buffer
        uint8.set(routing_part);
        uint8.set(main_part, total_header_size);

        data_view.setUint16(receiver_start_index, receiver_buffer.byteLength, true);
        uint8.set(new Uint8Array(receiver_buffer), receiver_start_index+Uint16Array.BYTES_PER_ELEMENT);

        return new_dx_block;
    }

    /** Add a header to a Datex block */
    public static DEFAULT_TTL = 64;

    private static device_types = {
        "default": 0,
        "mobile": 1,
        "network": 2,
        "embedded": 3,
        "virtual": 4
    }

    /** return the total size of the (not yet generated) block (including the header); also saves sizes and receiver_buffer to SCOPE */
    public static async getScopeBlockSize(SCOPE:compiler_scope) {
        if (SCOPE.full_dxb_size) return SCOPE.full_dxb_size; // alreadx calculated

        const [receiver_buffer, sender_buffer, pre_header_size, signed_header_size, full_dxb_size] = await this.generateScopeBlockMetaInfo(
            SCOPE.options.to,
            SCOPE.options.from,
            SCOPE.options.sign,
            SCOPE.options.encrypt,
            SCOPE.options.flood,
            SCOPE.options.send_sym_encrypt_key,
            SCOPE.options.sym_encrypt_key,
            SCOPE.buffer.byteLength,
            SCOPE.options.force_id
        );

        // save in scope
        SCOPE.receiver_buffer = receiver_buffer;
        SCOPE.sender_buffer = sender_buffer;
        SCOPE.pre_header_size = pre_header_size;
        SCOPE.signed_header_size = signed_header_size;
        SCOPE.full_dxb_size = full_dxb_size;

        return SCOPE.full_dxb_size;
    }

    public static async generateScopeBlockMetaInfo(
        to: target_clause|Pointer<target_clause>, // receivers
        from: Endpoint = Runtime.endpoint, // sender
        sign: boolean = Compiler.SIGN_DEFAULT,  // sign the header + body
        encrypt = false, // encrypt (sym_encrypt_key must be provided)
        flood = false, // flood to all
        send_sym_encrypt_key = true, // add encryption key info to header
        sym_encrypt_key: CryptoKey, // send encryption key to receivers
        dxb_block_length:number,
        force_id = false // force sender endpoint id
    ):Promise<[receiver_buffer:ArrayBuffer, sender_buffer:ArrayBuffer, pre_header_size:number, signed_header_size:number, full_dxb_size:number]> {
        let receiver_buffer: ArrayBuffer =  new ArrayBuffer(0);

        // generate dynamic receivers buffer
        if (!flood && to) {
            let evaluated_endpoints: Pointer<target_clause>|Disjunction<Endpoint>;

            // encrypted keys map
            const endpoint_key_map = new Map<Endpoint, ArrayBuffer>();
            
            // pointer
            if (to instanceof Pointer) evaluated_endpoints = to;
            
            // endpoint or list of endpoints
            else {
                evaluated_endpoints = <Disjunction<Endpoint>> Logical.collapse(to, Target);
                //console.log("evaluate", to, evaluated_endpoints);

                // get enc keys?
                if (send_sym_encrypt_key && sym_encrypt_key) {
                    for (const endpoint of evaluated_endpoints) {
                        endpoint_key_map.set(endpoint, await Crypto.encryptSymmetricKeyForEndpoint(sym_encrypt_key, endpoint));
                    }
                }
            }

            receiver_buffer = Compiler.targetsToDXB(evaluated_endpoints, endpoint_key_map, true);
        }

        // if (force_id && from) from = from.id_endpoint; 

        // generate sender buffer
        const sender_buffer = from ? this.endpointToDXB(from) : new ArrayBuffer(1);

        const pre_header_size = 10 + sender_buffer.byteLength + (receiver_buffer.byteLength??0) + (sign?Crypto.SIGN_BUFFER_SIZE:0);
        const signed_header_size = 18 + (encrypt ? Crypto.IV_BUFFER_SIZE : 0);
        
        const full_dxb_size = pre_header_size + signed_header_size + dxb_block_length;

        return [receiver_buffer, sender_buffer, pre_header_size, signed_header_size, full_dxb_size];
    }

    /** return a buffer containing the header and the scope dx_block */
    public static async appendHeader(
        dx_block:ArrayBuffer = new ArrayBuffer(0), 
        end_of_scope = true, // is last block for this scope id
        from: Endpoint = Runtime.endpoint,  // sender
        to?: target_clause|Pointer<target_clause>, // receivers
        flood = false, // flood to all
        type: ProtocolDataType = ProtocolDataType.REQUEST,    // what kind of data is in the body?
        sign: boolean = Compiler.SIGN_DEFAULT,  // sign the header + body
        encrypt = false, // encrypt (sym_encrypt_key must be provided)
        send_sym_encrypt_key = true, // add encryption key info to header
        sym_encrypt_key?: CryptoKey, // send encryption key to receivers
        allow_execute = type == ProtocolDataType.REQUEST || type == ProtocolDataType.LOCAL, // allow calling functions, per default only allowed for datex requests
       
        sid:number = type == ProtocolDataType.RESPONSE ? -1 : (type == ProtocolDataType.DATA ? 0 : this.generateSID()),     // scope id 
        return_index = 0,  // generated index or fixed value
        block_inc: number = type == ProtocolDataType.RESPONSE ? this.getBlockIncForRemoteSID(sid, <Endpoint>to, end_of_scope) : this.getBlockInc(sid), // should not be overriden; count up block for unique order, if response unique inc for different receivers

        force_id = false,

        // for routing header
        __routing_ttl:number = Compiler.DEFAULT_TTL,
        __routing_prio = 0,
        __routing_to?: endpoints|Pointer<target_clause>,

        // can be provided if it already exists in the SCOPE (gets generated otherwise)
        receiver_buffer?:ArrayBuffer,
        sender_buffer?: ArrayBuffer,
        pre_header_size?: number,
        signed_header_size?: number,
        full_dxb_size?: number
    ) {

        const compile_measure = RuntimePerformance.startMeasure("compile time", "header")

        // cannot generate new sid if type is RESPONSE
        if (sid == -1) throw new CompilerError("Cannot generate a new SID for a RESPONSE");

        // scope header data not yet generated
        if (full_dxb_size == undefined) {
            [receiver_buffer, sender_buffer, pre_header_size, signed_header_size, full_dxb_size] = await this.generateScopeBlockMetaInfo(
                to,
                from,
                sign,
                encrypt,
                flood, 
                send_sym_encrypt_key,
                sym_encrypt_key,
                dx_block.byteLength,
                force_id
            )
        }

        // get device type
        const device_type = this.device_types.mobile;

        // encryption
        let iv;
        if (encrypt) {
            if (!sym_encrypt_key) throw new CompilerError("No symmetric encryption key provided");
            [dx_block, iv] = await Crypto.encryptSymmetric(dx_block, sym_encrypt_key);
        }
       
        // init buffers
        // not-signed header part
        const pre_header = new ArrayBuffer(pre_header_size!); // unsigned part, includes 'dxb' and routing information
        const pre_header_data_view = new DataView(pre_header);
        const pre_header_uint8     = new Uint8Array(pre_header); 
        // potentially signed header part
       
        const header = new ArrayBuffer(signed_header_size!);
        const header_data_view = new DataView(header);
        const header_uint8     = new Uint8Array(header); 

        let i = 0;

        // Magic number (\01d)
        pre_header_uint8[i++] = 0x01;
        pre_header_uint8[i++] = 0x64;

        // version number
        pre_header_uint8[i++] = this.VERSION_NUMBER;
        
        // Full Block size (set at the end)
        i += 2;
     
        // ROUTING HEADER /////////////////////////////////////////////////
        // ttl
        pre_header_uint8[i++] = __routing_ttl;
        // priority
        pre_header_uint8[i++] = __routing_prio;

        // signed = 1, encrypted+signed = 2, encrypted = 3, others = 0
        pre_header_uint8[i++] = sign && !encrypt ? 1: (sign && encrypt ? 2 : (!sign && encrypt ? 3 : 0));

        // sender
        pre_header_uint8.set(new Uint8Array(sender_buffer!), i);
        i += sender_buffer!.byteLength;

        // receivers
        if (!flood && to) {
            // receivers buffer size
            pre_header_data_view.setUint16(i, receiver_buffer!.byteLength, true);
            i+=Uint16Array.BYTES_PER_ELEMENT;
      
            // add receiver buffer
            pre_header_uint8.set(new Uint8Array(receiver_buffer!), i);
            i+=receiver_buffer!.byteLength;
        }

        // flood to all, ignore receiver if provided
        else if (flood) {
            pre_header_data_view.setUint16(i, Compiler.MAX_UINT_16, true);
            i+=Uint16Array.BYTES_PER_ELEMENT;
        }

        // no receivers
        else {
            pre_header_data_view.setUint16(i, 0, true);
            i+=Uint16Array.BYTES_PER_ELEMENT;
        }

        ///////////////////////////////////////////////////////////////////
        

        const signature_index = i;

        i = 0;

        // sid
        header_data_view.setUint32(i, sid, true);
        i+=Uint32Array.BYTES_PER_ELEMENT

        // block index
        header_data_view.setUint16(i, return_index, true);
        i+=Uint16Array.BYTES_PER_ELEMENT

        // block inc
        header_data_view.setUint16(i, block_inc, true);
        i+=Uint16Array.BYTES_PER_ELEMENT

        // type 
        header_uint8[i++] = type;

        // flags encrypted - executable - end_of_scope - device_type (5 bits)
        header_uint8[i++] = this.convertNumbersToByte([1,1,1,5], encrypt, allow_execute, end_of_scope, device_type);
        
        // timestamp (current time)
        header_data_view.setBigUint64(i, BigInt(Date.now()-this.BIG_BANG_TIME), true);
        i+=BigUint64Array.BYTES_PER_ELEMENT
        
        // symmetric encryption initialization vector (if exists)
        if (encrypt && iv) {
            header_uint8.set(iv, i);
            i+=iv.byteLength;
        }
       
        const header_and_body = this.combineBuffers(header, dx_block);

        // signature
        if (sign) pre_header_uint8.set(new Uint8Array(await Crypto.sign(header_and_body)), signature_index)  // add signature to pre header

        // combine all header + body
        // set block size
        const block_size = pre_header.byteLength + header_and_body.byteLength;
        if (block_size > this.MAX_DXB_BLOCK_SIZE) {
            pre_header_data_view.setUint16(3, 0, true);
            logger.debug("DXB block size exceeds maximum size of " + this.MAX_DXB_BLOCK_SIZE + " bytes")
        }
        else pre_header_data_view.setUint16(3, block_size, true);

        // return as ArrayBuffer or [ArrayBuffer]
        const buffer = this.combineBuffers(pre_header, header_and_body);
        if (RuntimePerformance.enabled) RuntimePerformance.endMeasure(compile_measure)
        return buffer;
    }

    public static endpointToDXB(target:Endpoint) {
        // targets buffer part
        let target_buffer = new ArrayBuffer(50) // estimated size
        let target_uint8 = new Uint8Array(target_buffer);
        let i = 0;

        function handleRequiredBufferSize(size_in_bytes:number) {
            if (size_in_bytes>=target_buffer.byteLength-1) {
                const new_size = (target_buffer.byteLength??0) + Math.ceil((size_in_bytes-target_buffer.byteLength)/8)*8;
                const old_uint8 = target_uint8;
                target_buffer    = new ArrayBuffer(new_size);
                target_uint8    = new Uint8Array(target_buffer);  // default                 
                target_uint8.set(old_uint8); // copy from old buffer
            }
        }

        const name_bin = (target instanceof IdEndpoint) ? target.binary : this.utf8_encoder.encode(target.name); 
        const instance_bin = this.utf8_encoder.encode(target.instance); 

        target_uint8[i++] = target.type;
        target_uint8[i++] = name_bin.byteLength; // write name length to buffer
        target_uint8[i++] = 0//target.subspaces.length; // write subspace number to buffer
        target_uint8[i++] = instance_bin.byteLength == 0 ? 255 : instance_bin.byteLength;  // write instance length to buffer, 0 = wildcard, 255 = no instance
        target_uint8[i++] = 0; // has appspace?
        target_uint8.set(name_bin, i);  // write name to buffer
        i += name_bin.byteLength;

        // for (const subspace of target.subspaces ?? []) {
        //     const subspace_bin = Compiler.utf8_encoder.encode(subspace); 
        //     handleRequiredBufferSize(i+1+subspace_bin.byteLength);
        //     target_uint8[i++] = subspace_bin.length;  // write subspace length to buffer
        //     target_uint8.set(subspace_bin, i);  // write subspace_bin to buffer
        //     i += subspace_bin.byteLength;
        // }

        handleRequiredBufferSize(instance_bin.length);
        target_uint8.set(instance_bin, i);  // write channel to buffer
        i += instance_bin.byteLength;

        target_buffer = target_buffer.slice(0, i);

        
        return target_buffer;
    }
    
    // create binary representation of <Filter>, max 255 ands by 255 ors, max 127 different targets in total
    // also add encrypted keys at the end
    public static targetsToDXB(clause:Disjunction<Endpoint>|Pointer<target_clause>, keys_map?:Map<Endpoint,ArrayBuffer>, extended_keys = false): ArrayBuffer {
        const encrypted_key_size = 512;

        if (clause instanceof Pointer) {
            const buffer = new ArrayBuffer(1 + Pointer.MAX_POINTER_ID_SIZE) // estimated size
            const uint8 = new Uint8Array(buffer);
            uint8[0] = 1;
            uint8.set(clause.id_buffer, 1);   // write pointer id to buffer
            return clause.id_buffer;
        }

        else if (clause instanceof Disjunction) {
            const list = clause;
            
            let buffer = new ArrayBuffer(3 + list.size*30) // estimated size
            let dataview = new DataView(buffer);
            let uint8 = new Uint8Array(buffer);

            function handleRequiredBufferSize(size_in_bytes:number) {
                if (size_in_bytes>=buffer.byteLength-1) {
                    let new_size = (buffer.byteLength??0) + Math.ceil((size_in_bytes-buffer.byteLength)/8)*8;
                    let old_uint8 = uint8;
                    buffer    = new ArrayBuffer(new_size);
                    uint8    = new Uint8Array(buffer);  // default                 
                    uint8.set(old_uint8); // copy from old buffer
                }
            }


            // indicate endpoint list
            let i = 0;
            uint8[i++] = 0;

            // endpoint number
            dataview.setInt16(1, list.size, true);
            i += Int16Array.BYTES_PER_ELEMENT;

            for (let endpoint of list) {
                let key = (endpoint instanceof Endpoint) ? keys_map?.get(endpoint) : null;
                let name_bin = (endpoint instanceof IdEndpoint) ? endpoint.binary : this.utf8_encoder.encode(endpoint.name); 
                let instance_bin = this.utf8_encoder.encode(endpoint.instance); 
                handleRequiredBufferSize(i+4+name_bin.length)
                uint8[i++] = endpoint.type;
                uint8[i++] = name_bin.byteLength; // write name length to buffer
                uint8[i++] = 0//endpoint.subspaces.length; // write subspace number to buffer
                uint8[i++] = instance_bin.byteLength;  // write instance length to buffer
                uint8.set(name_bin, i);  // write name to buffer
                i += name_bin.byteLength;

                // for (let subspace of endpoint.subspaces ?? []) {
                //     let subspace_bin = Compiler.utf8_encoder.encode(subspace); 
                //     handleRequiredBufferSize(i+1+subspace_bin.byteLength);
                //     uint8[i++] = subspace_bin.length;  // write subspace length to buffer
                //     uint8.set(subspace_bin, i);  // write subspace_bin to buffer
                //     i += subspace_bin.byteLength;
                // }

                handleRequiredBufferSize(i+instance_bin.length+1+(key?encrypted_key_size+1:0));
                uint8.set(instance_bin, i);  // write channel to buffer
                i += instance_bin.byteLength;

                if (extended_keys) {
                    // has key?
                    uint8[i++] = key?1:0;  
                    if (key) { // add key
                        uint8.set(new Uint8Array(key), i);
                        i += key.byteLength;
                    }
                }
            }

            return buffer.slice(0, i); // slice target buffer
        }

        else throw new CompilerError("Invalid target list")

    }

    /** compiler builder functions */

    static builder = {

        // resize buffer by given amount of bytes, or create new
        resizeBuffer: (add_bytes:number=Compiler._buffer_block_size, SCOPE:compiler_scope|extract_var_scope) => {
            let new_size = (SCOPE.buffer?.byteLength??0)+add_bytes;
            //logger.info("extending buffer size to " + new_size + " bytes");
            let old_uint8 = SCOPE.uint8;
            SCOPE.buffer    = new ArrayBuffer(new_size);
            SCOPE.uint8     = new Uint8Array(SCOPE.buffer);  // default 
            SCOPE.data_view = new DataView(SCOPE.buffer);
            
            if (old_uint8) SCOPE.uint8.set(old_uint8); // copy from old buffer
        },

        // auto resize buffer it too smol
        handleRequiredBufferSize: (size_in_bytes:number, SCOPE:compiler_scope|extract_var_scope) => {
            if (size_in_bytes>=SCOPE.buffer.byteLength-1) 
                Compiler.builder.resizeBuffer(Math.max(Compiler._buffer_block_size, Math.ceil((size_in_bytes-SCOPE.buffer.byteLength)/8)*8), SCOPE);
        },



        // insert during compile time
        compilerInsert: async (SCOPE:compiler_scope, value:URL|Blob|DatexResponse<unknown>) => {

            let compiled_script:ArrayBuffer;
            let cache_var: string;
            // cache for internal variables of existing inserted values
            const insert_header = SCOPE.options.insert_header!;
            const cache = insert_header.cache;

            try {

                // raw datex url
                if (value instanceof DatexResponse && value.datex instanceof URL) value = value.datex;

                // URL already in insert cache
                if (value instanceof URL && cache.has(value.toString())) {
                    cache_var = cache.get(value.toString())!;
                    // logger.debug("insert cached: ? ?", value, cache_var);
                    await Compiler.builder.insertValVarRef(SCOPE, cache_var, ACTION_TYPE.GET);
                }

                // create new  
                else {
                    cache_var = `__insert__${cache.size}` // placeholder var __insert__
                    // logger.debug("insert: ?", cache_var);

                    const var_index = insert_header.var_index++;
                    cache.set(value.toString(), cache_var);
                    if (!insert_header.vars) throw new CompilerError("Insert resolution error");
                    insert_header.vars[cache_var] = ["var", var_index]; // points to the SCOPE.inner_scope.vars of the most outer parent scope
    
                    // get script/resource from url
                    if (value instanceof URL)  {
                        // logger.debug("url: ?", value);
                        compiled_script = await Compiler.builder.urlToDXB(value, insert_header);
                    }
                    // text/datex or application/json(5)
                    else if (value instanceof Blob) {
                        compiled_script = await Compiler.builder.blobToDXB(value, insert_header);
                    }
   
                    // raw datex script text
                    else if (value instanceof DatexResponse) {
                        if (typeof value.datex == "string") compiled_script = await Compiler.builder.scriptToDXB(value.datex, value.data, undefined, insert_header);
                        else throw new CompilerError("Invalid raw DATEX");
                    }
        
                    // TODO endpoint default?
    
                    else {
                        throw new CompilerError("Cannot insert value");
                    }

                    // insert compiled script into insert buffer
                    if (compiled_script) {

                        // special insert buffer that goes to the top of the dxb
                        let insert_buffer = insert_header.buffer;
                        let insert_uint8 = new Uint8Array(insert_buffer);
                        let insert_dataview = new DataView(insert_buffer);

                        const handleRequiredBufferSize = (size_in_bytes:number) => {
                            const add_bytes = Math.max(Compiler._buffer_block_size, Math.ceil((size_in_bytes-insert_buffer.byteLength)/8)*8);
                            if (size_in_bytes>=insert_buffer.byteLength-1) {
                                const new_size = (insert_buffer?.byteLength??0)+add_bytes;
                                const old_uint8 = insert_uint8;
                                insert_header.buffer = insert_buffer = new ArrayBuffer(new_size);
                                insert_uint8     = new Uint8Array(insert_buffer);  // default 
                                insert_dataview = new DataView(insert_buffer);
                                
                                if (old_uint8) insert_uint8.set(old_uint8); // copy from old buffer
                            }        
                        }

                        // create new entry in insert buffer
                        handleRequiredBufferSize(insert_header.index+20+compiled_script.byteLength);

                        // #x =
      
                        insert_uint8[insert_header.index++] = BinaryCode.SET_INTERNAL_VAR;
                        insert_uint8[insert_header.index++] = 0;
                        insert_dataview.setUint16(insert_header!.index, var_index, true);
                        insert_header.index += Uint16Array.BYTES_PER_ELEMENT;

                        // add do
                        insert_uint8[insert_header.index++] = BinaryCode.DO;

                        insert_uint8.set(new Uint8Array(compiled_script), insert_header.index)
                        insert_header.index += compiled_script.byteLength;
                        insert_uint8[insert_header.index++] = BinaryCode.CLOSE_AND_STORE;
                    }


                    // resolve from cache_var name
                    const [_type, index, _parent_var] = await Compiler.builder.resolveValVarRef(SCOPE, cache_var);
                    // variable not found
                    if (index == -1) throw new CompilerError("Error during insert resolution", SCOPE.stack);

                    // insert internal var containing insert value
                    Compiler.builder.insertVariable(SCOPE, index, ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR)

                }
                
            } catch (e) {
                    if (e instanceof DatexError) e.pushToStack(...SCOPE.stack);
                    throw e;
            }
        },

        // __ToDXB: used for compile time inserts from different resources

        /**
         * Resolve URL and compile content to dxb (if datex script or json), with references to parent scope
         * @param url URL to datex script or json
         * @param parent_scope
         * @returns compiled dxb array
         */
        urlToDXB: async (url:URL, insert_header:compiler_options["insert_header"]) => {
            const [data,type] = await Runtime.getURLContent(url, true);

            // DATEX Script file
            if (type?.startsWith("text/datex") || url.toString().endsWith(".dx")) return Compiler.builder.scriptToDXB(<string>data, [], url, insert_header);
            // JSON file
            else if (type?.startsWith("application/json") || url.toString().endsWith(".json")) return Compiler.builder.scriptToDXB(<string>data, [], url, insert_header);
            // DATEX Binary file
            else if (type == "application/datex" || url.toString().endsWith(".dxb")) {
                // remove header
                const res = Runtime.parseHeaderSynchronousPart(<ArrayBuffer>data);
                if (!(res instanceof Array)) throw new CompilerError("Invalid DATEX Binary resource");
                return res[1].buffer;
            }

            else throw new CompilerError("Cannot compile resource type to dxb: '" + type + "'");
        },

        /**
         * Compiles blob content to dxb (if datex or json), with references to parent scope
         * @param blob Blob containing JSON or DATEX Script data
         * @param parent_scope 
         * @returns compiled dxb array
         */
        blobToDXB: async (blob:Blob, insert_header:compiler_options["insert_header"]) => {
            // text/datex or application/json(5)
            if (blob.type == "text/datex" || blob.type.startsWith("application/json")) {
                const script = await blob.text();
                return Compiler.builder.scriptToDXB(script, [], undefined, insert_header);
            }
            else throw new CompilerError("Cannot compile mime type to dxb: <" + blob.type + ">");
        },

        /**
         * Compiles datex script to dxb, with references to parent scope
         * @param script DATEX Script text
         * @param data compiler insert data
         * @param context_location
         * @param parent_scope 
         * @returns compiled dxb array
         */
        scriptToDXB: (script:string, data:unknown[]|undefined, context_location:URL|undefined, insert_header:compiler_options["insert_header"]) => {
            return <Promise<ArrayBuffer>> this.compile(script, data, {context_location, insert_header, parent_scope:insert_header!.root_scope, only_leak_inserts:true}, false, true);
        },

        getAssignAction: (assign_string:string): [ACTION_TYPE, BinaryCode|undefined] => {
            let action_type = ACTION_TYPE.GET; 
            let action_specifier:BinaryCode|undefined;

            // is =, +=, -=
            if (assign_string) {
                assign_string = assign_string.replace(/ /g, '');

                if (assign_string == "=") action_type = ACTION_TYPE.SET;
                else if (assign_string == "$=") action_type = ACTION_TYPE.SET_REFERENCE; // only for variables
                else if (assign_string == ":=") action_type = ACTION_TYPE.INIT;
                
                else if (assign_string == "+=") {
                    action_type = ACTION_TYPE.OTHER;
                    action_specifier = BinaryCode.ADD
                }
                else if (assign_string == "-=") {
                    action_type = ACTION_TYPE.OTHER;
                    action_specifier = BinaryCode.SUBTRACT
                }
                else if (assign_string == "*=") {
                    action_type = ACTION_TYPE.OTHER;
                    action_specifier = BinaryCode.MULTIPLY
                }
                else if (assign_string == "/=") {
                    action_type = ACTION_TYPE.OTHER;
                    action_specifier = BinaryCode.DIVIDE
                }
                else if (assign_string == "&=") {
                    action_type = ACTION_TYPE.OTHER;
                    action_specifier = BinaryCode.AND
                }
                else if (assign_string == "|=") {
                    action_type = ACTION_TYPE.OTHER;
                    action_specifier = BinaryCode.OR
                }

            }

            return [action_type, action_specifier]
        },

        // getArgsTemplate(args_string: string, SCOPE:compiler_scope):Datex.code_block_args_template {
        //     const args_template = []
        //     const arg_names = []
        //     let in_multi_with = false;
        //     for (let arg of args_string.split(",")) {
        //         arg = arg.trim()
        //         if (in_multi_with || arg.match(/^with *\(/)) { // with multiple variables
        //             in_multi_with = true;
        //             // end of multi with?
        //             if (arg.includes(')')) in_multi_with = false;
        //             args_template.push([Datex.WITH, arg.replace('with', '').replace(/[() ]/g, '')])
        //         }
        //         else if (arg.startsWith('with ')) args_template.push([Datex.WITH, arg.replace('with ', '')]) // with
        //         else if (arg.startsWith('<')) {
        //             let m = arg.match(Regex.TYPE)
        //             if (!m) throw new SyntaxError("Invalid token on line "+SCOPE.current_line_nr);
        //             args_template.push([Type.get(m[1], m[2], m[3]), arg.replace(m[0],'').trim()])
        //         }
        //         else args_template.push([null, arg]);

        //         // last name double?
        //         if (arg_names.includes(args_template[args_template.length-1][1])) throw new CompilerError("Duplicate code block argument variable names are not allowed");
        //     }
        //     return args_template
        // },

        // update last_value_index / set first_value_index
        valueIndex: (SCOPE:compiler_scope|extract_var_scope) => {

            // if child value for path, it is not an actual value
            if (SCOPE.inner_scope.path_info_index != -1 && SCOPE.inner_scope.path_info_index === SCOPE.b_index-1) return;

            if ('value_count' in SCOPE.inner_scope) SCOPE.inner_scope.value_count!--; // update value count

            SCOPE.inner_scope.last_value_index = SCOPE.b_index;
            if (SCOPE.inner_scope.first_value_index === undefined) SCOPE.inner_scope.first_value_index = SCOPE.b_index;
        },

        // save all indices where commas (ELEMENT) where inserted (trailing commas can be removed on scope exit)
        commaIndex: (index:number, SCOPE:compiler_scope) => {
            if (!SCOPE.inner_scope.comma_indices) SCOPE.inner_scope.comma_indices = [];
            SCOPE.inner_scope.comma_indices.push(index);
        },

        // add index where an assignment ends
        assignmentEndIndex: (SCOPE:compiler_scope|extract_var_scope, index?:number) => {
            SCOPE.assignment_end_indices.add(index ?? SCOPE.b_index);
        },

        // index that gets updated if the buffer is shifted within

        getDynamicIndex: (index:number, SCOPE:compiler_scope): [number] => {
            const dyn_index:[number] = [index];
            SCOPE.dynamic_indices.push(dyn_index);
            return dyn_index;
        },


        // shift dynamic indices & jmp indices correctly (all indices after a specific index)
        shiftDynamicIndices: (SCOPE:compiler_scope, shift:number, after:number) => {
            // update dynamic indices
            for (const i of SCOPE.dynamic_indices) {
                if (i[0] > after) i[0] += shift;
            }

            // update jmp_indices
            for (const [i] of SCOPE.jmp_indices) {
                if (i > after) {
                    const jmp_to = SCOPE.data_view.getUint32(i, true);
                    if (jmp_to > after) SCOPE.data_view.setUint32(i, jmp_to + shift, true); // shift current jmp_to index in buffer
                }
            }

            // update assignment_end_indices
            const new_end_indices = new Set<number>();
            for (const i of SCOPE.assignment_end_indices) {
                 new_end_indices.add(i > after ? i+shift : i);
            }
            SCOPE.assignment_end_indices = new_end_indices;

            // shift other internal indices
            if (SCOPE.b_index > after) SCOPE.b_index += shift;
            if (SCOPE.inner_scope.last_value_index > after) SCOPE.inner_scope.last_value_index += shift;
            if (SCOPE.inner_scope.first_value_index > after) SCOPE.inner_scope.first_value_index += shift;
        },

        insertByteAtIndex: (byte:number, index:number|[number], SCOPE:compiler_scope) => {
            // get value from dynamic index
            if (index instanceof Array) index = index[0];

            // is current b_index (no shift needed, normal insert)
            if (index == SCOPE.b_index) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = byte;
                return;
            }

            // shift for gap
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE); // buffer overflowing to right
            SCOPE.uint8.copyWithin(index+1, index);

            SCOPE.uint8[index++] = byte;

            // update indices
            Compiler.builder.shiftDynamicIndices(SCOPE, 1, index-2); // shift starting at correct index
        },

        // add sub_result=_1234=... at a specific index (for recursive objects)
        createInternalVariableAtIndex: (index:number|[number], SCOPE:compiler_scope, val?:any):number => {

            if (!SCOPE.internal_vars) {
                // DEBUG message since CDN prod crashes here
                logger.error("Scope is missing internal_vars", SCOPE, val);
            }
            // already has an internal variable reference?
            if (SCOPE.internal_vars?.has((val))) return SCOPE.internal_vars.get(val)!;
            if (SCOPE.internal_primitive_vars?.has((val))) return SCOPE.internal_primitive_vars.get(val)!;

            // get value from dynamic index
            if (index instanceof Array) index = index[0];
            
            const var_number = SCOPE.internal_var_index++;
            const add_scope_global = !SCOPE.assignment_end_indices.has(index); // only add if not already an assignment before
            const gap = Uint16Array.BYTES_PER_ELEMENT + 2 + (add_scope_global?1:0);

            // shift for gap
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+gap, SCOPE); // buffer overflowing to right
            SCOPE.uint8.copyWithin(index+gap, index);

            // update indices
            Compiler.builder.shiftDynamicIndices(SCOPE, gap, index);

            // #sub_result = 
            if (add_scope_global) SCOPE.uint8[index++] = BinaryCode.SET_VAR_SUB_RESULT;
    
            // #1234 = 
            Compiler.builder.insertVariable(SCOPE, var_number, ACTION_TYPE.SET, undefined, BinaryCode.INTERNAL_VAR, index);

      

            // save for future requests
            // not primitive
            if (typeof val == "object" || typeof val == "function") SCOPE.internal_vars.set(val, var_number)
            // primitive
            else  SCOPE.internal_primitive_vars.set(val, var_number)

            return var_number;
        },


        resolveInternalProxyName: (SCOPE:compiler_scope, name:string):number => {
            // in current scope
            if (SCOPE.inner_scope.object_slots?.has(name)) return SCOPE.inner_scope.object_slots!.get(name)!;

            // check parent scope
            else if (SCOPE.options.parent_scope) {
                return Compiler.builder.resolveInternalProxyName(SCOPE.options.parent_scope, name); 
            }

            throw new CompilerError(`Internal variable #${name} does not exist in this context`, SCOPE.stack)
        },

        /******* Some recursive insanity to trace the correct var/ref/val names from parent compiler_scopes */

        insertValVarRef: async (SCOPE:compiler_scope, name:string, action_type:ACTION_TYPE = ACTION_TYPE.GET, action_specifier?:BinaryCode) => {
            // get variable or get proxy for parent variable
            const [type, index, parent_var] = await Compiler.builder.resolveValVarRef(SCOPE, <string>name);
                        
            // variable not found
            if (index == -1) {
                // readonly - #std variable? (#std.name)
                if (action_type == ACTION_TYPE.GET && Runtime.STD_STATIC_SCOPE && name in Runtime.STD_STATIC_SCOPE) {
                    Compiler.builder.insertVariable(SCOPE, undefined, ACTION_TYPE.GET, undefined, BinaryCode.VAR_STD, undefined);
                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CHILD_GET;
                    Compiler.builder.addText(name, SCOPE);
                    return;
                }
                // readonly - #std.type?
                if (action_type == ACTION_TYPE.GET && Type.has('std', name)) {
                    Compiler.builder.addTypeByNamespaceAndName(SCOPE, 'std', name);
                    return;
                }
                else throw new CompilerError("Variable '"+name+"' was not declared in scope", SCOPE.stack);
            }

            // cannot set reference ($=) of ref variable
            if (action_type == ACTION_TYPE.SET_REFERENCE && type === "ref") {
                throw new CompilerError("Cannot override the reference of the reference variable '"+name+"'")
            }

            // cannot set reference ($=) of val variable
            if (action_type == ACTION_TYPE.SET_REFERENCE && type === "val") {
                throw new CompilerError("Cannot override the reference of the value variable '"+name+"'")
            }

            // val variables from parent scope are readonly
            if (action_type != ACTION_TYPE.GET && parent_var && type === "val"){
                throw new CompilerError("The value variables '"+name+"' borrowed from the parent scope is readonly")
            }

            // const is readonly
            if ((action_type == ACTION_TYPE.SET_REFERENCE || action_type == ACTION_TYPE.SET) && type === "const") {
                throw new CompilerError("The const variable '"+name+"' is readonly")
            }

            // insert at current position of scope
            await Compiler.builder.insertVariable(SCOPE, index, action_type, action_specifier, BinaryCode.INTERNAL_VAR);
        },

        // recursively generates right variable index for val var ref
        // resolve pseudo variable var,ref,val, recursively update parents
        resolveValVarRef: async (SCOPE:compiler_scope, name:string): Promise<[type:'val'|'var'|'ref'|'const'|null, index:number, parent_var:boolean]> => {

            // is direct scope variable, can just insert
            if (SCOPE.inner_scope.vars && name in SCOPE.inner_scope.vars) {
                // return variable
                return [SCOPE.inner_scope.vars[name][0], SCOPE.inner_scope.vars[name][1], false]
            }
            // might be a parent variable, recurse TODO: better placeholder than __insert__, prevent accidental leaks
            else if (SCOPE.options.parent_scope && (!SCOPE.options.only_leak_inserts || name.startsWith("__insert__"))) {
                // variable index in parent scope
                const [type, index] = await Compiler.builder.resolveValVarRef(SCOPE.options.parent_scope, name); 
                // variable not found
                if (index == -1) return [null, -1, true];
                // map parent variable to scope variable (keep if pseudo_parent) and return
                else return [type, SCOPE.options.pseudo_parent ? index : Compiler.builder.getExtractedVariable(SCOPE, BinaryCode.INTERNAL_VAR, index), true]
            }
            // no parent scope, stop
            else return [null, -1, false];
            
        },

        getExtractedVariable: (SCOPE:compiler_scope, base_type:BinaryCode, v_name:string|number)=> {
            let index:number
            let insert_new = false;


            if (!SCOPE.extract_var_indices) throw new CompilerError("Cannot extract variable in non child scope block")
            if (!SCOPE.extract_var_scope) throw new CompilerError("Cannot extract variable in non child scope block")

            if (!SCOPE.extract_var_indices.has(base_type)) throw new CompilerError("Invalid variable base type");

            if (SCOPE.extract_var_indices.get(base_type)!.has(v_name)) {
                index = SCOPE.extract_var_indices.get(base_type)!.get(v_name)!;
            }
            else {
                index = SCOPE.extract_var_index!++;
                SCOPE.extract_var_indices.get(base_type)!.set(v_name, index);
                insert_new = true;
            }

            // insert at top of scope dxb if new
            if (insert_new) {
                // pointer
                if (base_type == BinaryCode.POINTER) Compiler.builder.addPointerByID(SCOPE.extract_var_scope, <string>v_name, ACTION_TYPE.GET); // sync
                // variable/label
                else Compiler.builder.insertVariable(SCOPE.extract_var_scope, v_name, ACTION_TYPE.GET, undefined, base_type)
            }

            return index;
        },

        // insert #0, #1, instead of variable/pointer/..., inserts variable into the extract_var_scope at the top of the dxb, returns index #0, #1, ...
        insertExtractedVariable: (SCOPE:compiler_scope, base_type:BinaryCode, v_name:string|number)=> {
            // create or get proxy internal var for the requested variable/pointer
            const index = Compiler.builder.getExtractedVariable(SCOPE, base_type, v_name);
            // insert at current position of scope
            Compiler.builder.insertVariable(SCOPE, index, ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
            return index;
        },

        // v: variable name or empty, action type: set/get/delete/other, action_specifier: for other actions (+=,-=,...), base_type: e.g. BinaryCode.VAR
        // returns promise if action_type is ACTION_TYPE.INIT (TODO probably could convert to sync)
        insertVariable: (SCOPE:compiler_scope|extract_var_scope, v?:string|number, action_type:ACTION_TYPE = ACTION_TYPE.GET, action_specifier?: BinaryCode, base_type:BinaryCode=BinaryCode.INTERNAL_VAR,  index:number=SCOPE.b_index, init_brackets = false, prefix_action?: BinaryCode):void|Promise<void> => {
            
            const is_b_index = index==SCOPE.b_index; // index is same as scope index

            if (is_b_index) Compiler.builder.handleRequiredBufferSize(index, SCOPE);
            SCOPE.uint8[index++] = base_type + action_type;

            if (action_specifier != undefined) {
                if (is_b_index) Compiler.builder.handleRequiredBufferSize(index, SCOPE);
                SCOPE.uint8[index++] = action_specifier;
            }
          
            // has a variable name/id (is empty for predefined internal variables with custom binary codes)
            if (v != undefined) {
                let v_name_bin:Uint8Array
                const is_number = typeof v == "number";
                if (!is_number) {
                    v_name_bin = this.utf8_encoder.encode(v);  // convert var name to binary
                    if (is_b_index) Compiler.builder.handleRequiredBufferSize(index+v_name_bin.byteLength+1, SCOPE);
                }
                else {
                    if (is_b_index) Compiler.builder.handleRequiredBufferSize(index+Uint16Array.BYTES_PER_ELEMENT+1, SCOPE);
                }

                SCOPE.uint8[index++] = is_number ? 0 : v_name_bin!.byteLength; // set length or 0 if hex variable

                if (is_number) { // write hex var name to buffer
                    if (v > 65535) { // does not fit in Uint16
                        throw new CompilerError("Invalid variable id: " + v + " (too big)", SCOPE.stack);
                    }
                    SCOPE.data_view.setUint16(index, v, true);
                    index += Uint16Array.BYTES_PER_ELEMENT;
                }
                else {
                    SCOPE.uint8.set(v_name_bin!, index);   // write var name to buffer
                    index+=v_name_bin!.byteLength;
                }
            }

            // is assignment end
            if (action_type != ACTION_TYPE.GET) Compiler.builder.assignmentEndIndex(SCOPE, index);

            if (is_b_index) SCOPE.b_index = index; // update scope index

            if (action_type == ACTION_TYPE.INIT) return Compiler.builder.addInitBlock(<compiler_scope>SCOPE, init_brackets); // might be a promise
            else if (prefix_action != undefined) SCOPE.uint8[SCOPE.b_index++] = prefix_action;
        },


        handleStream: (stream:Stream|ReadableStream, SCOPE:compiler_scope) => {
            SCOPE.streaming = stream.getReader();
        },

        // add jmp or jfa / jtr - auto change jmp index if buffer is shifted later on
        addJmp: (SCOPE:compiler_scope, type:BinaryCode.JMP|BinaryCode.JTR|BinaryCode.JFA, to_index?: number) => {
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+Uint32Array.BYTES_PER_ELEMENT, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = type;

            // already has a jmp index
            if (to_index != undefined) SCOPE.data_view.setUint32(SCOPE.b_index, to_index, true);  // set jmp index
            SCOPE.jmp_indices.push(Compiler.builder.getDynamicIndex(SCOPE.b_index, SCOPE)) // store current position of jmp index
            
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT;
        },

        // add data types
        addText: (s:string, SCOPE:compiler_scope|extract_var_scope) => {
            Compiler.builder.valueIndex(SCOPE);
            let str_bin = Compiler.utf8_encoder.encode(s);  // convert string to binary
            let short_string = str_bin.byteLength < 256;
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+str_bin.byteLength+(short_string?1:Uint32Array.BYTES_PER_ELEMENT)+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = short_string ? BinaryCode.SHORT_TEXT : BinaryCode.TEXT;
            // write string length to buffer
            if (short_string) {
                SCOPE.uint8[SCOPE.b_index++] = str_bin.byteLength // 1 byte length
            }
            else {
                SCOPE.data_view.setUint32(SCOPE.b_index, str_bin.byteLength, true); // 4 byte length
                SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT; 
            }
          
            SCOPE.uint8.set(str_bin, SCOPE.b_index);   // write string to buffer
            SCOPE.b_index+=str_bin.byteLength;
        },

        addDisjunction: (elements:Set<any>, SCOPE:compiler_scope) => {
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DISJUNCTION;
            Compiler.builder.addConnective(elements, SCOPE);
        },

        addConjunction: (elements:Set<any>, SCOPE:compiler_scope) => {
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CONJUNCTION;
            Compiler.builder.addConnective(elements, SCOPE);
        },

        addConnective: (elements:Set<any>, SCOPE:compiler_scope) => {
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+Uint32Array.BYTES_PER_ELEMENT, SCOPE);

            SCOPE.data_view.setUint32(SCOPE.b_index, elements.size, true);
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT;   // 4 byte length
            
            for (let el of elements) {
                Compiler.builder.insert(el, SCOPE);
            }
        },

        addUrl: (url_string:string, SCOPE:compiler_scope) => {
            Compiler.builder.valueIndex(SCOPE);
            let str_bin = Compiler.utf8_encoder.encode(url_string);  // convert string to binary
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+str_bin.byteLength+(Uint32Array.BYTES_PER_ELEMENT)+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.URL;
            // write url length to buffer
            SCOPE.data_view.setUint32(SCOPE.b_index, str_bin.byteLength, true); // 4 byte length
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT; 

            SCOPE.uint8.set(str_bin, SCOPE.b_index);   // write string to buffer
            SCOPE.b_index+=str_bin.byteLength;
        },

        addRelativePath: (path:string, SCOPE:compiler_scope) => {
            Compiler.builder.valueIndex(SCOPE);
            const str_bin = Compiler.utf8_encoder.encode(path);  // convert string to binary
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+str_bin.byteLength+(Uint32Array.BYTES_PER_ELEMENT)+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.RESOLVE_RELATIVE_PATH;
            // write url length to buffer
            SCOPE.data_view.setUint32(SCOPE.b_index, str_bin.byteLength, true); // 4 byte length
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT; 

            SCOPE.uint8.set(str_bin, SCOPE.b_index);   // write string to buffer
            SCOPE.b_index+=str_bin.byteLength;
        },

        addBoolean: (b:boolean, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = b ? BinaryCode.TRUE : BinaryCode.FALSE;
        },
        addInt: (i:bigint|number, SCOPE:compiler_scope) => {
            if (i<=Compiler.MAX_INT_8 && i>=Compiler.MIN_INT_8)   return Compiler.builder.addInt8(i, SCOPE); // INT8
            if (i<=Compiler.MAX_INT_16 && i>=Compiler.MIN_INT_16) return Compiler.builder.addInt16(i, SCOPE); // INT16
            if (i<=Compiler.MAX_INT_32 && i>=Compiler.MIN_INT_32) return Compiler.builder.addInt32(i, SCOPE); // INT32
            else if (i<=Compiler.MAX_INT_64 && i>=Compiler.MIN_INT_64) return Compiler.builder.addInt64(i, SCOPE); // INT64
            else return Compiler.builder.addBigInt(i, SCOPE); // BIG_INT
        },
        addInt8: (i:bigint|number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Int8Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.INT_8;
            SCOPE.data_view.setInt8(SCOPE.b_index, Number(i));
            SCOPE.b_index+=Int8Array.BYTES_PER_ELEMENT;
        },
        addInt16: (i:bigint|number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Int16Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.INT_16;
            SCOPE.data_view.setInt16(SCOPE.b_index, Number(i), true);
            SCOPE.b_index+=Int16Array.BYTES_PER_ELEMENT;
        },
        addInt32: (i:bigint|number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Int32Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.INT_32;
            SCOPE.data_view.setInt32(SCOPE.b_index, Number(i), true);
            SCOPE.b_index+=Int32Array.BYTES_PER_ELEMENT;
        },
        addInt64: (i:bigint|number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+BigInt64Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.INT_64;
            SCOPE.data_view.setBigInt64(SCOPE.b_index, BigInt(i), true);
            SCOPE.b_index+=BigInt64Array.BYTES_PER_ELEMENT;
        },
        addBigInt: (i:bigint|number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+BigInt64Array.BYTES_PER_ELEMENT+2, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.BIG_INT;
            
            SCOPE.uint8[SCOPE.b_index++] = i < 0 ? 0 : 1; // 0 for negative, 1 for positive (and 0)

            const bigint_buffer = Quantity.bigIntToBuffer(BigInt(i < 0 ? -i : i));
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+(Uint16Array.BYTES_PER_ELEMENT*2)+bigint_buffer.byteLength, SCOPE);

            // buffer size
            SCOPE.data_view.setUint16(SCOPE.b_index, bigint_buffer.byteLength, true)
            SCOPE.b_index+=Uint16Array.BYTES_PER_ELEMENT;

            // bigint
            SCOPE.uint8.set(bigint_buffer, SCOPE.b_index);
            SCOPE.b_index += bigint_buffer.byteLength;
        },
        addQuantity: (u:Quantity, SCOPE:compiler_scope) => {
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Float64Array.BYTES_PER_ELEMENT+2, SCOPE);
            Compiler.builder.valueIndex(SCOPE);

            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.QUANTITY;

            const sign = u.sign;
            SCOPE.uint8[SCOPE.b_index++] = sign == -1 ? 0 : 1; // 0 for negative, 1 for positive (and 0)

            const num_buffer = Quantity.bigIntToBuffer(u.numerator);
            const den_buffer = Quantity.bigIntToBuffer(u.denominator);

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+(Uint16Array.BYTES_PER_ELEMENT*2)+den_buffer.byteLength+num_buffer.byteLength, SCOPE);

            // buffer sizes
            SCOPE.data_view.setUint16(SCOPE.b_index, num_buffer.byteLength, true)
            SCOPE.b_index+=Uint16Array.BYTES_PER_ELEMENT;
            SCOPE.data_view.setUint16(SCOPE.b_index, den_buffer.byteLength, true)
            SCOPE.b_index+=Uint16Array.BYTES_PER_ELEMENT;

            // numerator
            SCOPE.uint8.set(num_buffer, SCOPE.b_index);
            SCOPE.b_index += num_buffer.byteLength;

            // denominator
            SCOPE.uint8.set(den_buffer, SCOPE.b_index);
            SCOPE.b_index += den_buffer.byteLength;

            // unit
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+u.unit_binary.byteLength, SCOPE);
            SCOPE.uint8.set(new Uint8Array(u.unit_binary), SCOPE.b_index)
            SCOPE.b_index+=u.unit_binary.byteLength;
        },

        // TODO
        addTime: (t:Time, SCOPE:compiler_scope) => {
            Compiler.builder.valueIndex(SCOPE);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+BigUint64Array.BYTES_PER_ELEMENT+1, SCOPE);

            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.TIME;

            SCOPE.data_view.setBigInt64(SCOPE.b_index, BigInt(isNaN(t.getTime()) ? 0 : Number(t.getTime())), true)
            SCOPE.b_index+=BigUint64Array.BYTES_PER_ELEMENT;
        },

        addFloat64: (f:number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Float64Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.FLOAT_64;
            SCOPE.data_view.setFloat64(SCOPE.b_index, f, true);
            SCOPE.b_index+=Float64Array.BYTES_PER_ELEMENT;
        },
        addFloatAsInt32: (f:number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Int32Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.FLOAT_AS_INT_32;
            SCOPE.data_view.setInt32(SCOPE.b_index, f, true);
            SCOPE.b_index+=Int32Array.BYTES_PER_ELEMENT;
        },
        addFloatAsInt8: (f:number, SCOPE:compiler_scope) => {    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Int8Array.BYTES_PER_ELEMENT+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.FLOAT_AS_INT_8;
            SCOPE.data_view.setInt8(SCOPE.b_index, f);
            SCOPE.b_index+=Int8Array.BYTES_PER_ELEMENT;
        },

        // get +/- as immediate operators (no space inbetween) before next token
        tryPlusOrMinus: (SCOPE:compiler_scope) => {
            // + but not ++
            if (SCOPE.datex[0] == "+" && SCOPE.datex[1] != "+") {
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ADD; 
                SCOPE.datex = SCOPE.datex.slice(1);
            }
            // - but not -> or --
            else if (SCOPE.datex[0] == "-" && SCOPE.datex[1] != "-" && SCOPE.datex[1] != ">") {
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBTRACT; 
                SCOPE.datex = SCOPE.datex.slice(1);
            }
        },

        addFloat: (f:number, SCOPE:compiler_scope) => {
            // can be saved as Int32 (is an integer within the Int32 bounds and not -0)
            const isInt = Number.isInteger(f) && !Object.is(f, -0);
            if (isInt && f<=Compiler.MAX_INT_8 && f>= Compiler.MIN_INT_8) return Compiler.builder.addFloatAsInt8(f, SCOPE); // float as int8
            else if (isInt && f<=Compiler.MAX_INT_32 && f>= Compiler.MIN_INT_32) return Compiler.builder.addFloatAsInt32(f, SCOPE); // float as int32
            else return Compiler.builder.addFloat64(f, SCOPE); // FLOAT_64
        },

        getFullObject(obj:Record<string, unknown>) {
            const fullObj:Record<string, unknown> = {};
            for (const prop in obj) {
                fullObj[prop] = obj[prop];
            }
            return fullObj;
        },

        addScopeBlock: async (type:BinaryCode, brackets:boolean, extract_pointers: boolean, SCOPE:compiler_scope) => {

            const return_data:{datex:string} = {datex: SCOPE.datex}; 

            const compiled = <ArrayBuffer> await this.compile(return_data, SCOPE.data, {parent_scope:SCOPE, to: Compiler.builder.getScopeReceiver(SCOPE)}, false, true, extract_pointers, undefined, Infinity, brackets?1:2, SCOPE.current_data_index);
            SCOPE.datex = return_data.datex; // update position in current datex script

            // insert scope block
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+compiled.byteLength, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = type;
            SCOPE.uint8.set(new Uint8Array(compiled), SCOPE.b_index)
            SCOPE.b_index += compiled.byteLength;
        },

        insertScopeBlock: (type:BinaryCode, value:Scope, SCOPE:compiler_scope)=>{
            // insert scope block
              
            SCOPE.uint8[SCOPE.b_index++] = type;

            // injected vars
            // collapse injected var pointers only if collapse_bound_pointers is true
            for (const v of value.internal_vars) {
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                Compiler.builder.insert(v, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
            }

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+Uint32Array.BYTES_PER_ELEMENT+(value.compiled?.byteLength??0), SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SCOPE_BLOCK;
            SCOPE.data_view.setUint32(SCOPE.b_index, value.compiled?.byteLength??0, true);
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT
            if (value.compiled) {
                SCOPE.uint8.set(new Uint8Array(value.compiled), SCOPE.b_index)
                SCOPE.b_index += value.compiled.byteLength;
            }
        },

        // addCodeBlock: (compiled:ArrayBuffer, args_template:Datex.code_block_args_template=[], SCOPE:compiler_scope) => {

        
        //     if (!compiled) {
        //         throw new CompilerError("Code block has no content");
        //     }
            
        //     DatexCompiler.builder.valueIndex(SCOPE);

        //     DatexCompiler.builder.handleRequiredBufferSize(SCOPE.b_index+Uint16Array.BYTES_PER_ELEMENT+1, SCOPE);

        //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SCOPE_BLOCK;
            
        //     // injected variables (args)
        //     SCOPE.data_view.setUint16(SCOPE.b_index, args_template.length, true);   // # of params
        //     SCOPE.b_index += Uint16Array.BYTES_PER_ELEMENT;

        //     for (let param of args_template) {
        //         DatexCompiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
        //         if (param[0] instanceof Type) {
        //             DatexCompiler.builder.addTypeByNamespaceAndName(SCOPE, param[0].namespace, param[0].name);
        //         }
        //         else if (param[0] == Datex.WITH) {SCOPE.uint8[SCOPE.b_index++] = 1} // use variable from outer scope ('with')
        //         else {SCOPE.uint8[SCOPE.b_index++] = 0} // no type specified

        //         let v_name_bin = DatexCompiler.utf8_encoder.encode(param[1]);  // convert var name to binary
        //         DatexCompiler.builder.handleRequiredBufferSize(SCOPE.b_index+v_name_bin.byteLength+2, SCOPE);
        //         SCOPE.uint8[SCOPE.b_index++] = v_name_bin.byteLength;
        //         SCOPE.uint8.set(v_name_bin, SCOPE.b_index);   // write var name to buffer
        //         SCOPE.b_index+=v_name_bin.byteLength;
        //     }

        //     // Buffer
        //     DatexCompiler.builder.handleRequiredBufferSize(SCOPE.b_index+Uint32Array.BYTES_PER_ELEMENT+compiled.byteLength, SCOPE);

        //     //console.log("codec " + codec, "buffer",buffer);
        //     SCOPE.data_view.setUint32(SCOPE.b_index, compiled.byteLength, true);   // buffer length
        //     SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT;

        //     SCOPE.uint8.set(new Uint8Array(compiled), SCOPE.b_index);
        //     SCOPE.b_index += compiled.byteLength;
        // },


        // insertGeneratedDatex: async (generator_function:()=>Promise<ArrayBuffer>, SCOPE:compiler_scope) => {
        //     // TODO improve
        //     DatexCompiler.builder.addCodeBlock(await generator_function(), [], SCOPE);
        // },


        addKey: (k:string|number|bigint, SCOPE:compiler_scope) => {
            
            // string key
            if (typeof k == "string") {
                const key_bin = Compiler.utf8_encoder.encode(k);  // convert key to binary
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+key_bin.byteLength+2, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT_WITH_KEY
                SCOPE.uint8[SCOPE.b_index++] = key_bin.byteLength;  // write key length to buffer
                SCOPE.uint8.set(key_bin, SCOPE.b_index);   // write key to buffer
                SCOPE.b_index+=key_bin.byteLength;
            }
            // int key
            else {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Uint32Array.BYTES_PER_ELEMENT+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT_WITH_INT_KEY
                SCOPE.data_view.setUint32(SCOPE.b_index, Number(k), true)
                SCOPE.b_index+=Uint32Array.BYTES_PER_ELEMENT;
            }

        },

        addObjectSlot:  (k:string, SCOPE:compiler_scope) => {
            if (!SCOPE.inner_scope.object_slot_index) SCOPE.inner_scope.object_slot_index = 0xfa00;
            if (!SCOPE.inner_scope.object_slots) SCOPE.inner_scope.object_slots = new Map();
            let slot:number;
            if (k == "write") slot = SLOT_WRITE;
            else if (k == "read")  slot = SLOT_READ;
            else if (k == "exec")  slot = SLOT_EXEC;
            else if (k == "get")  slot = SLOT_GET;
            else if (k == "set")  slot = SLOT_SET;
            else slot = SCOPE.inner_scope.object_slot_index++;

            SCOPE.inner_scope.object_slots.set(k, slot);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Uint16Array.BYTES_PER_ELEMENT+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.INTERNAL_OBJECT_SLOT;
            SCOPE.data_view.setUint16(SCOPE.b_index, slot, true)
            SCOPE.b_index+=Uint16Array.BYTES_PER_ELEMENT;
        },


        addNull: (SCOPE:compiler_scope) => {
            
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NULL;
        },
        addVoid: (SCOPE:compiler_scope) => {
            
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.VOID;
        },


        addFilterTargetFromParts: (type:BinaryCode, name:string|Uint8Array, instance:string, SCOPE:compiler_scope) => {
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+4, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            const type_index = SCOPE.b_index;
            SCOPE.uint8[SCOPE.b_index++] = instance == "*" ? type+1 : type;
            const name_bin = (name instanceof Uint8Array) ? name : Compiler.utf8_encoder.encode(name); 
            const instance_bin = Compiler.utf8_encoder.encode(instance); 
            SCOPE.uint8[SCOPE.b_index++] = name_bin.byteLength; // write name length to buffer
            SCOPE.uint8[SCOPE.b_index++] = 0;  // write subspace number to buffer
            // instance length == 0 => wildcard, instance length == 255 => any instance
            SCOPE.uint8[SCOPE.b_index++] = instance ? (instance == "*" ? 0 : instance_bin.byteLength) : 255;  // write instance length to buffer
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+name_bin.byteLength, SCOPE);
            SCOPE.uint8.set(name_bin, SCOPE.b_index);  // write name to buffer
            SCOPE.b_index+=name_bin.byteLength;

            // for (const subspace of subspaces ?? []) {
            //     // wildcard
            //     if (subspace == "*") {
            //         SCOPE.uint8[SCOPE.b_index++] = 0;
            //         SCOPE.uint8[type_index] = type + 1;
            //     }
            //     else {
            //         const subspace_bin = Compiler.utf8_encoder.encode(subspace); 
            //         Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+subspace_bin.byteLength, SCOPE);
            //         SCOPE.uint8[SCOPE.b_index++] = subspace_bin.byteLength;  // write subspace length to buffer
            //         SCOPE.uint8.set(subspace_bin, SCOPE.b_index);  // write subspace_bin to buffer
            //         SCOPE.b_index+=subspace_bin.byteLength;
            //     }
            // }

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+instance_bin.byteLength, SCOPE);

            // add instance if not wildcard
            if (instance != "*") {
                SCOPE.uint8.set(instance_bin, SCOPE.b_index);  // write instance to buffer
                SCOPE.b_index+=instance_bin.byteLength;
            }


            // // append appspace?
            // if (appspace) Compiler.builder.addTarget(appspace, SCOPE);
        },
        
        addPersonByNameAndChannel: (name:Uint8Array|string, instance:string, SCOPE:compiler_scope) => {
            Compiler.builder.addFilterTargetFromParts(BinaryCode.PERSON_ALIAS, name, instance, SCOPE);
        },
      
     
        addInstitutionByNameAndChannel: (name:Uint8Array|string, instance:string, SCOPE:compiler_scope) => {
            Compiler.builder.addFilterTargetFromParts(BinaryCode.INSTITUTION_ALIAS, name, instance, SCOPE);
        },
       
        addIdEndpointByIdAndChannel: (id:Uint8Array|string, instance:string, SCOPE:compiler_scope) => {
            Compiler.builder.addFilterTargetFromParts(BinaryCode.ENDPOINT, id, instance, SCOPE);
        },

        addBuffer: (buffer:Uint8Array, SCOPE:compiler_scope) => {
            
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+Uint32Array.BYTES_PER_ELEMENT+buffer.byteLength, SCOPE);

            //console.log("codec " + codec, "buffer",buffer);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.BUFFER; 
            SCOPE.data_view.setUint32(SCOPE.b_index, buffer.byteLength, true);   // buffer length
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT;

            SCOPE.uint8.set(buffer, SCOPE.b_index);
            SCOPE.b_index += buffer.byteLength;
        },

        addTarget: (el:Target, SCOPE:compiler_scope) => {
            if (el instanceof Institution) Compiler.builder.addInstitutionByNameAndChannel(el.binary, el.instance, SCOPE);
            else if (el instanceof Person) Compiler.builder.addPersonByNameAndChannel(el.binary, el.instance, SCOPE);
            else if (el instanceof IdEndpoint) Compiler.builder.addIdEndpointByIdAndChannel(el.binary, el.instance, SCOPE);
        },


        addTypeByNamespaceAndName: (SCOPE:compiler_scope, namespace:string, name:string, variation?:string, parameters?:any[]|true, jsTypeDefModule?:string|URL) => {
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);

            Compiler.builder.valueIndex(SCOPE);

            // remember if js type def modules should be added to this scope
            if (SCOPE.addJSTypeDefs == undefined) {
                const receiver = Compiler.builder.getScopeReceiver(SCOPE);
                SCOPE.addJSTypeDefs = receiver != Runtime.endpoint && receiver != LOCAL_ENDPOINT;
            }

            const addTypeDefs = SCOPE.addJSTypeDefs && jsTypeDefModule;

            if (addTypeDefs) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+4, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GET;
                if (jsTypeDefModule instanceof URL) Compiler.builder.addUrl(jsTypeDefModule.toString(), SCOPE);
                else {
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_URL;
                    Compiler.builder.addText(jsTypeDefModule.toString(), SCOPE);
                }
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;
            }

            const is_extended_type = !!(variation || parameters);

            // short binary codes for std types
            if ((namespace == "std" || !namespace) && !is_extended_type) {
                switch (name) {
                    case "text": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_TEXT;return;
                    case "integer": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_INT;return;
                    case "decimal": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_FLOAT;return;
                    case "boolean": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_BOOLEAN;return;
                    case "null": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_NULL;return;
                    case "void": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_VOID;return;
                    case "buffer": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_BUFFER;return;
                    case "datex": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_CODE_BLOCK;return;
                    case "unit": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_UNIT;return;
                    case "time": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_TIME;return;
                    case "url": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_URL;return;
                    case "Array": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_ARRAY;return;
                    case "Object": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_OBJECT;return;
                    case "Set": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_SET;return;
                    case "Map": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_MAP;return;
                    case "Tuple": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_TUPLE;return;
                    case "Function": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_FUNCTION;return;
                    case "Stream": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_STREAM;return;
                    case "Any": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_ANY;return;
                    case "Task": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_TASK;return;
                    case "Assertion": SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_ASSERTION;return;
                }
            }

            const name_bin = Compiler.utf8_encoder.encode(name);  // convert type name to binary
            const ns_bin = Compiler.utf8_encoder.encode(namespace);  // convert type namespace to binary
            const variation_bin = variation ? Compiler.utf8_encoder.encode(variation) : undefined;  // convert type namespace to binary

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+name_bin.byteLength+ns_bin.byteLength+4+(variation_bin ? variation_bin.byteLength : 0)+(is_extended_type?2:0), SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = is_extended_type ? BinaryCode.EXTENDED_TYPE : BinaryCode.TYPE;  
            SCOPE.uint8[SCOPE.b_index++] = ns_bin.byteLength;
            SCOPE.uint8[SCOPE.b_index++] = name_bin.byteLength;

            if (is_extended_type) {
                SCOPE.uint8[SCOPE.b_index++] = variation_bin ? variation_bin.byteLength : 0;
                SCOPE.uint8[SCOPE.b_index++] = parameters ? 1 : 0;
            }

            SCOPE.uint8.set(ns_bin, SCOPE.b_index);  // write type namespace to buffer
            SCOPE.b_index+=ns_bin.byteLength;
            SCOPE.uint8.set(name_bin, SCOPE.b_index);  // write type name to buffer
            SCOPE.b_index+=name_bin.byteLength;
            if (variation) {
                SCOPE.uint8.set(variation_bin!, SCOPE.b_index);  // write type variation to buffer
                SCOPE.b_index+=variation_bin!.byteLength;
            }
            // insert parameters directly
            if (parameters instanceof Array) {
                Compiler.builder.addTuple(new Tuple(parameters), SCOPE);
            }

            if (addTypeDefs) {
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
            }
        },

        
        addPointerBodyByID: (id:string|Uint8Array, SCOPE:compiler_scope|extract_var_scope) => {
            const id_bin = id instanceof Uint8Array ? id : hex2buffer(id, Pointer.MAX_POINTER_ID_SIZE, true);  // convert pointer name to binary
            if (id_bin.byteLength > Pointer.MAX_POINTER_ID_SIZE) {
                throw new CompilerError("Pointer ID size must not exceed " + Pointer.MAX_POINTER_ID_SIZE + " bytes", SCOPE.stack);
            }
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Pointer.MAX_POINTER_ID_SIZE+1, SCOPE);
            SCOPE.uint8.set(id_bin, SCOPE.b_index);   // write pointer name to buffer
            SCOPE.b_index+=Pointer.MAX_POINTER_ID_SIZE;

            // add flags
            const knows_pointer = Pointer.get(id)?.value_initialized ?? false;
            const has_hash = false
            SCOPE.uint8[SCOPE.b_index++] = this.convertNumbersToByte([1,1,6], knows_pointer, has_hash);
        },


        // for internal vars / pointers / labels init 
        // assumes that uint32 gap is left before b_index to be set to jmp index
        addInitBlock: async (SCOPE:compiler_scope, brackets = false) => {

            const return_data:{datex:string} = {datex: SCOPE.datex}; 
            const compiled = <ArrayBuffer> await this.compile(return_data, SCOPE.data, {parent_scope:SCOPE, preemptive_pointer_init:SCOPE.options.preemptive_pointer_init==false?false:true, pseudo_parent:true, to: Compiler.builder.getScopeReceiver(SCOPE)}, false, false, false, undefined, Infinity, brackets?1:2, SCOPE.current_data_index);
            SCOPE.datex = return_data.datex; // update position in current datex script

            // remove redundant ";"
            if (SCOPE.datex[0] == ';') SCOPE.datex = SCOPE.datex.slice(1);

            // insert scope block
            Compiler.builder.insertInitBlock(SCOPE, compiled);
        },

        addInitBlockForValue: (SCOPE:compiler_scope|extract_var_scope, value:any) => {

            //const compiled = <ArrayBuffer> this.compile("?", [value], {parent_scope:SCOPE, abs_offset, preemptive_pointer_init:SCOPE.options.preemptive_pointer_init==false?false:true, pseudo_parent:true, collapse_first_inserted:true}, false, false, false, undefined, Infinity); // sync           
            const compiled = this.compileValue(value, {parent_scope: SCOPE, preemptive_pointer_init:SCOPE.options.preemptive_pointer_init==false?false:true, pseudo_parent:true, collapse_first_inserted:true, to: Compiler.builder.getScopeReceiver(SCOPE)}, false);

            // insert scope block
            Compiler.builder.insertInitBlock(SCOPE, compiled);
        },

        insertInitBlock: (SCOPE:compiler_scope|extract_var_scope, compiled:ArrayBuffer) => {

            // > max uint8
            if (compiled.byteLength > 0xff_ff_ff_ff) throw new CompilerError("pointer init block it too large");
         
            // insert scope block
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+Uint32Array.BYTES_PER_ELEMENT+compiled.byteLength, SCOPE);
                            
            SCOPE.data_view.setUint32(SCOPE.b_index, compiled.byteLength, true);
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT; // leave space for JMP
            SCOPE.uint8.set(new Uint8Array(compiled), SCOPE.b_index)
            SCOPE.b_index += compiled.byteLength;

        },


        addValVarRefDeclaration: async (name:string, type:'val'|'var'|'ref'|'const', SCOPE:compiler_scope, init = false, init_brackets = false) => {
            const INNER_SCOPE = SCOPE.inner_scope;

            if (!INNER_SCOPE.vars) INNER_SCOPE.vars = {}

            // TODO replace with Object.hasOwn
            if (Object.hasOwn(INNER_SCOPE.vars, name)) throw new CompilerError("Cannot redeclare "+type+" '"+name + "'", SCOPE.stack);
            else {
                if (SCOPE.var_index==undefined) SCOPE.var_index = 0x0100; // 0x00 - 0xff reserved for extracted variables for function, do, ...
                const index = SCOPE.var_index++;
                if (name!=undefined) INNER_SCOPE.vars[name] = [type, index];

                let prefix_action: BinaryCode;
                if (type == "ref") prefix_action = BinaryCode.CREATE_POINTER;  
                else if (type == "val") prefix_action = BinaryCode.COPY;  

                await Compiler.builder.insertVariable(SCOPE, index, init ? ACTION_TYPE.INIT : ACTION_TYPE.SET_REFERENCE, undefined, BinaryCode.INTERNAL_VAR, undefined, init_brackets, prefix_action);

                return index;
            }
        },

        addPointerByID: (SCOPE:compiler_scope|extract_var_scope, id:string|Uint8Array, action_type:ACTION_TYPE = ACTION_TYPE.GET, action_specifier?:BinaryCode, init_brackets = false, value:any = NOT_EXISTING):Promise<void>|void => {

            // insert preemptive pointer
            const id_buffer = typeof id == "string" ? hex2buffer(id, Pointer.MAX_POINTER_ID_SIZE, true) : id;
            const pointer_origin = (id_buffer[0]==BinaryCode.ENDPOINT || id_buffer[0]==BinaryCode.PERSON_ALIAS || id_buffer[0]==BinaryCode.INSTITUTION_ALIAS) ? <IdEndpoint> Target.get(id_buffer.slice(1,19), id_buffer.slice(19,21), id_buffer[0]) : null;
            // preemptive_pointer_init enabled, is get, is own pointer, not sending to self
            if (pointer_origin && SCOPE.options.preemptive_pointer_init !== false && action_type == ACTION_TYPE.GET && Runtime.endpoint.equals(pointer_origin) && SCOPE.options.to != Runtime.endpoint) {
                return Compiler.builder.addPreemptivePointer(SCOPE, id)
            }

            // normal insert
            return Compiler.builder.addPointerNormal(SCOPE, id, action_type, action_specifier, init_brackets, value);
        },

        // just $aabbcc = 
        addPointerNormal: (SCOPE:compiler_scope|extract_var_scope, id:string|Uint8Array, action_type:ACTION_TYPE = ACTION_TYPE.GET, action_specifier?:BinaryCode, init_brackets = false, value:any = NOT_EXISTING, transform_scope?: Scope<any>):Promise<void>|void => {
        
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.POINTER + action_type;
            if (action_specifier != undefined) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = action_specifier;
            }
            Compiler.builder.addPointerBodyByID(id, SCOPE);
            
            if (action_type == ACTION_TYPE.INIT) {
                if (value == NOT_EXISTING) {
                    if (!SCOPE.datex) throw new CompilerError("cannot insert init block in scope, missing datex source code");
                    return Compiler.builder.addInitBlock(<compiler_scope>SCOPE, init_brackets) // async
                }
                else if (transform_scope) {
                    const temp_scope = <extract_var_scope>{
                        b_index: 0,
                        buffer: new ArrayBuffer(400),
                        inner_scope: {},
                        dynamic_indices: [],
                        inserted_values: new Map(),
                        preemptive_pointers: new Map(),
                        assignment_end_indices: new Set(),
                        options: SCOPE.options
                    }
                    temp_scope.uint8 = new Uint8Array(temp_scope.buffer);
                    temp_scope.data_view = new DataView(temp_scope.buffer);
                    Compiler.builder.insert_transform_scope(temp_scope, transform_scope);
                    const compiled = temp_scope.uint8.slice(0,temp_scope.b_index)

                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+compiled.byteLength+1, SCOPE);
                    Compiler.builder.insertInitBlock(SCOPE, compiled.buffer);
                }
                else return Compiler.builder.addInitBlockForValue(SCOPE, value) // sync
            }
        },

        // ($aabb := [...]; $aabb)
        addPreemptivePointer: (SCOPE:compiler_scope|extract_var_scope, id:string|Uint8Array)=>{
            const normalized_id = Pointer.normalizePointerId(id);
            const ptr = Pointer.get(normalized_id);

            let parentScope:compiler_scope|extract_var_scope = SCOPE;
            const ancestorScopes = new Set<compiler_scope|extract_var_scope>()
            while (parentScope.options.parent_scope) {
                parentScope = parentScope.options.parent_scope;
                ancestorScopes.add(parentScope)
            }
            const alreadyInitializing = parentScope.preemptive_pointers.has(normalized_id) ?? false;

            let deferSizeIndex = -1;

            // TODO: enable
            const defer = false // alreadyInitializing && ancestorScopes.has(parentScope.preemptive_pointers.get(normalized_id)!); // defer if already loading pointer in direct ancestor


            // preemptive value already exists and was not yet initialized in scope
            if (ptr?.value_initialized && !alreadyInitializing) {
                parentScope.preemptive_pointers.set(normalized_id, SCOPE);
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                Compiler.builder.addPointerNormal(SCOPE, id, ACTION_TYPE.INIT, undefined, true, ptr.val, (ptr.force_local_transform && ptr.transform_scope) ? ptr.transform_scope : undefined); // sync
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;
                Compiler.builder.addPointerNormal(SCOPE, id, ACTION_TYPE.GET); // sync
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
            }
            // just add normal pointer
            else {
                if (defer) {
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DEFER;
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SCOPE_BLOCK;
                    deferSizeIndex = SCOPE.b_index;
                    SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT;
                }
                Compiler.builder.addPointerNormal(SCOPE, id, ACTION_TYPE.GET); // sync
                if (defer) SCOPE.data_view.setUint32(deferSizeIndex, SCOPE.b_index-deferSizeIndex-Uint32Array.BYTES_PER_ELEMENT, true);
            }
        },

        addPointer: (p:Pointer, SCOPE:compiler_scope|extract_var_scope, action_type:ACTION_TYPE = ACTION_TYPE.GET, action_specifier?:BinaryCode):Promise<void>|void => {

            // ignore value - insert void
            if (p.value_initialized && p.val?.[DX_IGNORE]) {
                Compiler.builder.addVoid(SCOPE);
                return;
            }

            // pointer is sent to receiver, so he gets access (TODO: improve)
            if (Runtime.OPTIONS.PROTECT_POINTERS) {
                const receiver = Compiler.builder.getScopeReceiver(SCOPE);
                if (receiver !== Runtime.endpoint) {
                    p.grantAccessTo(receiver)
                }
            }
            
            // pre extract per default
            if ((<compiler_scope>SCOPE).extract_pointers && action_type == ACTION_TYPE.GET) {
                Compiler.builder.insertExtractedVariable(<compiler_scope>SCOPE, BinaryCode.POINTER, buffer2hex(p.id_buffer));
            }
            // add normally
            else return Compiler.builder.addPointerByID (SCOPE, p.id_buffer, action_type, action_specifier)
        },

        // add <Array>
        addArray: (a:Array<any>, SCOPE:compiler_scope, is_root=true, parents:Set<any>=new Set(), unassigned_children:[number, any, number][]=[], start_index:[number]=[0]) => {
    
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = a instanceof Tuple ? BinaryCode.TUPLE_START : BinaryCode.ARRAY_START;

            // trim array (don't send unnecessary empty elements)
            const trimmed_length = Runtime.runtime_actions.getTrimmedArrayLength(a);

            let parent_var:number|undefined;

            // shadow object?
            a = <Array<any>><unknown>Pointer.getByValue(a)?.shadow_object ?? a;

            // iterate over array elements
            for (let i = 0; i<trimmed_length; i++) {

                let val = a[i];

                // ignore in DATEX
                if (val?.[DX_IGNORE]) {
                    continue;
                }
            
                // is recursive value?
                if (SCOPE.inserted_values.has(val) && parents.has(val)) {
                    // make sure variable for parent exists
                    parent_var = parent_var ?? Compiler.builder.createInternalVariableAtIndex(start_index, SCOPE, a)
                    // get variable for the already-existing value
                    const value_index = SCOPE.inserted_values.get(val);
                    const existing_val_var = val == a ? parent_var : Compiler.builder.createInternalVariableAtIndex(value_index, SCOPE, val)
                    unassigned_children.push([parent_var, BigInt(i), existing_val_var])
                    val = VOID; // insert void instead (array has to be filled at the right indices, need to insert some value at this index)
                }
                
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT;  

                // TODO: // compress multiple identical values (at least 4)
                // if (i+4 < trimmed_length && a[i+1]===val && a[i+2]===val && a[i+3]===val && a[i+4]===val) {
                //     const start = i;
                //     let end = i+4;
                //     for (end; end<trimmed_length; end++) {
                //         if (a[end] !== val) break;
                //     }
                //     i = end;
                //     // ...(var x = []; iterate (0..10)(x+=0);x)
                //     /// ...(var x = [];
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.EXTEND;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                //     Compiler.builder.insertVariable(SCOPE, SCOPE.internal_var_index++, ACTION_TYPE.SET, undefined, BinaryCode.INTERNAL_VAR);
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ARRAY_START;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ARRAY_END;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;

                //     // (#iterator = $$<Iterator>
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                //     Compiler.builder.insertVariable(SCOPE, SCOPE.internal_var_index++, ACTION_TYPE.SET, undefined, BinaryCode.INTERNAL_VAR);
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CREATE_POINTER;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_ITERATOR;

                //     // (start..end);
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.RANGE;
                //     Compiler.builder.addInt(BigInt(start), SCOPE);
                //     Compiler.builder.addInt(BigInt(end), SCOPE);
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;

                //     Compiler.builder.addJmp(SCOPE,  BinaryCode.JFA);
                //     // index-
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NEXT;
                //     Compiler.builder.insertVariable(SCOPE, 'i', ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;  

                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;


                //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;

                //     console.log("compress",val,start,end)
                // }

                Compiler.builder.insert(val, SCOPE, false, new Set(parents), unassigned_children); // shallow clone parents set
            }
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = a instanceof Tuple ? BinaryCode.TUPLE_END : BinaryCode.ARRAY_END;

            if (is_root && unassigned_children.length) Compiler.builder.addChildrenAssignments(unassigned_children, SCOPE, start_index)
        },

        // add tuple
        addTuple: (o:Tuple, SCOPE:compiler_scope, is_root=true, parents:Set<any>=new Set(), unassigned_children:[number, any, number][]=[], start_index:[number]=[0]) => {

            const entries = o.entries();
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.TUPLE_START;

            let parent_var:number;
        

            for (const [key,val] of entries) {

                if (o[INHERITED_PROPERTIES]?.has(key)) continue; // ignore inherited properties

                // is recursive value?
                if (SCOPE.inserted_values.has(val) && parents.has(val)) {
                    // make sure variable for parent exists
                    parent_var = parent_var ?? Compiler.builder.createInternalVariableAtIndex(start_index, SCOPE, o)
                    // get variable for the already-existing value
                    let value_index = SCOPE.inserted_values.get(val);
                    let existing_val_var = val == o ? parent_var : Compiler.builder.createInternalVariableAtIndex(value_index, SCOPE, val)
                    unassigned_children.push([parent_var, key, existing_val_var])
                }
                else {
                    // non-key property (number index)
                    if (typeof key == "number" || typeof key == "bigint") SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT; 
                    // key property
                    else Compiler.builder.addKey(key, SCOPE);
                    Compiler.builder.insert(val, SCOPE, false, new Set(parents), unassigned_children); // shallow clone parents set
                }
               
            }
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.TUPLE_END;

            if (is_root && unassigned_children.length) Compiler.builder.addChildrenAssignments(unassigned_children, SCOPE, start_index)
        },

        // add object or tuple
        addObject: (o:Object, SCOPE:compiler_scope, is_root=true, parents:Set<any>=new Set(), unassigned_children:[number, any, number][]=[], start_index:[number]=[0]) => {

            const entries = Object.entries(Pointer.getByValue(o)?.shadow_object ?? o);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OBJECT_START;

            let parent_var:number;

            for (let i = 0; i<entries.length; i++) {
                const [key,val] = entries[i];

                if (o[INHERITED_PROPERTIES]?.has(key)) continue; // ignore inherited properties

                // is recursive value?
                if (SCOPE.inserted_values.has(val) && parents.has(val)) {
                    // make sure variable for parent exists
                    parent_var = parent_var ?? Compiler.builder.createInternalVariableAtIndex(start_index, SCOPE, o)
                    // get variable for the already-existing value
                    const value_index = SCOPE.inserted_values.get(val);
                    const existing_val_var = val == o ? parent_var : Compiler.builder.createInternalVariableAtIndex(value_index, SCOPE, val)
                    unassigned_children.push([parent_var, key, existing_val_var])
                }
                else {
                    Compiler.builder.addKey(key, SCOPE);
                    Compiler.builder.insert(val, SCOPE, false, new Set(parents), unassigned_children); // shallow clone parents set
                }
               
            }
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OBJECT_END;

            if (is_root && unassigned_children.length) Compiler.builder.addChildrenAssignments(unassigned_children, SCOPE, start_index)
        },

        addChildrenAssignments: (unassigned_children:[number, any, number][], SCOPE:compiler_scope, root_start_index:[number]) => {
            // adds __123.xy = _456 - if has recursive assignments
            
            Compiler.builder.insertByteAtIndex(BinaryCode.SUBSCOPE_START, root_start_index, SCOPE) // add (
            for (const assignment of unassigned_children) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;
                Compiler.builder.insertVariable(SCOPE, assignment[0], ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR); // parent
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CHILD_SET;
                Compiler.builder.insert(assignment[1], SCOPE, true, undefined, undefined, false);  // insert key (don't save insert index for key value)
                Compiler.builder.insertVariable(SCOPE, assignment[2], ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR); // value
            }
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;  // add )
        },


        check_perm_prefix: (SCOPE:compiler_scope) => {
            // check if permission prefix (@xy x: ...)
            // start index is either last comma index or scope start index if no comma
            const start_index = (SCOPE.inner_scope.comma_indices ? SCOPE.inner_scope.comma_indices[SCOPE.inner_scope.comma_indices.length-1] : SCOPE.inner_scope.start_index) + 1;
            const permission_prefix = (SCOPE.b_index - start_index) != 0 && SCOPE.uint8[SCOPE.b_index-1] != BinaryCode.CLOSE_AND_STORE; // not a permission_prefix if command before (;)

            // console.log(start_index, SCOPE.inner_scope.comma_indices, SCOPE.b_index)

            if (permission_prefix) {
                // replace ELEMENT byte (is not an element, but a permission prefix)
                if (SCOPE.uint8[start_index-1] == BinaryCode.ELEMENT) SCOPE.uint8[start_index-1] = BinaryCode.KEY_PERMISSION;
                // else insert byte (start of object/tuple)
                else Compiler.builder.insertByteAtIndex(BinaryCode.KEY_PERMISSION, start_index, SCOPE);
            }
            return permission_prefix;
        },


        // detect Record
        detect_record: (SCOPE:compiler_scope) => {
            if (SCOPE.inner_scope.parent_type==undefined || SCOPE.inner_scope.parent_type == BinaryCode.SUBSCOPE_START) {
                // last ( bracket can be replaced with record bracket (if no commands before)
                if (SCOPE.inner_scope.parent_type == BinaryCode.SUBSCOPE_START && !SCOPE.inner_scope.has_ce) {
                    Compiler.builder.change_inner_scope_parent_type(SCOPE, BinaryCode.TUPLE_START)
                }
                // create new subscope
                else {
                    Compiler.builder.enter_subscope(SCOPE, BinaryCode.TUPLE_START);
                    SCOPE.inner_scope.auto_close_scope = BinaryCode.TUPLE_END;
                }
            }
        },

        insert_exports: (SCOPE:compiler_scope) => {
            if (SCOPE.uint8[SCOPE.b_index-1] != BinaryCode.CLOSE_AND_STORE) SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE; // add ;
            // TODO: use tuple, object just workaround for better compatibility
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OBJECT_START;

            for (const [key, int] of Object.entries(SCOPE.inner_scope.exports)) {
                Compiler.builder.addKey(key, SCOPE);
                Compiler.builder.insertVariable(SCOPE, int, ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
            }

            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OBJECT_END;
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE; 
        },

        enter_subscope: (SCOPE:compiler_scope, type:BinaryCode|null = BinaryCode.SUBSCOPE_START, start_index?:number) => {

            // update parent scope value indices
            const parent_scope = SCOPE.subscopes[SCOPE.subscopes.length-1];
            parent_scope.last_value_index = SCOPE.b_index;  // last 'value' in parent scope is the new scope
            if (parent_scope.first_value_index == undefined) parent_scope.first_value_index = SCOPE.b_index;  // last 'value' in parent scope is the new scope
            if ('value_count' in parent_scope) parent_scope.value_count--; // update value count


            if (type !== null) {
                // start at current position
                if (start_index == undefined) {
                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = type;
                }
                // start at another position (earlier)
                else {
                    Compiler.builder.insertByteAtIndex(type, start_index, SCOPE);
                }
            }

            SCOPE.inner_scope = {
                last_value_index: -1,
                start_index: start_index !=undefined ? start_index : SCOPE.b_index-1,
                wait_for_add: false,
                in_template_string: false,
                path_info_index: -1,
                parent_type: type,
                vars: Object.create(parent_scope?.vars??{}),
                loop_start: parent_scope.loop_start // copy information from outer loop until overriden
            };
            SCOPE.subscopes.push(SCOPE.inner_scope);
        },

        has_open_subscopes: (SCOPE:compiler_scope) => {
            // check for missing object brackets
            for (const scope of SCOPE.subscopes) {
                if (scope.parent_type == BinaryCode.OBJECT_START) return true;
                if (scope.parent_type == BinaryCode.ARRAY_START) return true;
                if (scope.parent_type == BinaryCode.SUBSCOPE_START) return true;
            }
            return false;
        },

        exit_subscope: (SCOPE:compiler_scope, type:BinaryCode = BinaryCode.SUBSCOPE_END) => {


            // auto-close subscopes here?
            while (SCOPE.inner_scope.auto_close_scope!=undefined) {
                const type = SCOPE.inner_scope.auto_close_scope;
                delete SCOPE.inner_scope.auto_close_scope;
                Compiler.builder.exit_subscope(SCOPE, type);
            }


            
            // check if code block close after outer ')'
            if (type == BinaryCode.SUBSCOPE_END && SCOPE._code_block_type==1 && SCOPE.subscopes.length == 1) {
                SCOPE.end = true;
                return true;
            } 

            // override subscope with tuple/record end bracket
            if (SCOPE.inner_scope.parent_type == BinaryCode.TUPLE_START && type == BinaryCode.SUBSCOPE_END) type = BinaryCode.TUPLE_END;

            if (SCOPE.inner_scope.parent_type == BinaryCode.OBJECT_START && type != BinaryCode.OBJECT_END) throw new SyntaxError("Missing closing object bracket");
            if (SCOPE.inner_scope.parent_type == BinaryCode.ARRAY_START && type != BinaryCode.ARRAY_END)  throw new SyntaxError("Missing closing array bracket");
            if (SCOPE.inner_scope.parent_type == BinaryCode.SUBSCOPE_START && type != BinaryCode.SUBSCOPE_END)  throw new SyntaxError("Missing closing bracket");

            // cannot close subscope (already in outer scope)
            if (SCOPE.subscopes.length == 1) {
                if (type == BinaryCode.OBJECT_END) throw new SyntaxError("Invalid closing object bracket");
                if (type == BinaryCode.ARRAY_END)  throw new SyntaxError("Invalid closing array bracket");
                if (type == BinaryCode.SUBSCOPE_END)  throw new SyntaxError("Invalid closing bracket");
            }

            // exports
            if (SCOPE.inner_scope.exports) Compiler.builder.insert_exports(SCOPE);

            if (type !== null) {

                // override trailing comma(s) if <Array>, <Tuple>, <Record> or <Object>
                if (SCOPE.inner_scope.comma_indices?.length && type !== BinaryCode.SUBSCOPE_END) {
                    let _comma_index:number | undefined;
                    while ((_comma_index = SCOPE.inner_scope.comma_indices.pop()) == SCOPE.b_index-1) SCOPE.b_index--;
                }
                
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = type;
            }



            SCOPE.subscopes.pop();
            SCOPE.inner_scope = SCOPE.subscopes[SCOPE.subscopes.length-1];
        },

        change_inner_scope_parent_type: (SCOPE:compiler_scope, type:BinaryCode = BinaryCode.TUPLE_START) => {
            SCOPE.inner_scope.parent_type = type;
            SCOPE.uint8[SCOPE.inner_scope.start_index] = type;
        },

        // \n -> \u00A,  \ -> '',  \\ -> \
        unescape_string: (str:string):string => str
            // special escape characters
            .replace(Regex.ESCAPE_BACKSPACE, '\b') 
            .replace(Regex.ESCAPE_LINE_FEED, '\n')
            .replace(Regex.ESCAPE_FORM_FEED, '\f')
            .replace(Regex.ESCAPE_CARRIAGE_RETURN, '\r')
            .replace(Regex.ESCAPE_HORIZONTAL_TAB, '\t')
            .replace(Regex.ESCAPE_VERTICAL_TAB, '\v')
            
            .replace(Regex.ESCAPE_OCTAL, (_,x)=>{  // \nnn
                let code = parseInt(x,8);
                if (code >= 256) return x; // max octal representation, just return string (TODO not properly handled, should return valid part of octal escape code)
                return String.fromCharCode(code)
            })
            .replace(Regex.ESCAPE_UNICODE, (_,x)=>{  // \unnnn
                let code = parseInt(x,16);
                if (isNaN(code) || x.length!=4 || !x.match(Regex.HEX_STRING)) throw new SyntaxError("Invalid Unicode escape sequence");
                return String.fromCharCode(code)
            })
            .replace(Regex.ESCAPE_HEX, (_,x)=>{  // \xnn
                let code = parseInt(x,16);
                if (isNaN(code) || x.length!=2 || !x.match(Regex.HEX_STRING)) throw new SyntaxError("Invalid hexadecimal escape sequence");
                return String.fromCharCode(code)
            })
            // ignore all other sequences, just return the character
            .replace(Regex.ESCAPE_SEQUENCE, '$1'),


        // serialize values, but use cached values for this scope
        serializeValue: (v:any, SCOPE:compiler_scope):any => {
            if (SCOPE.serialized_values.has(v)) return SCOPE.serialized_values.get(v);
            else {
                const receiver = Compiler.builder.getScopeReceiver(SCOPE);
                const s = Runtime.serializeValue(v, receiver);
                SCOPE.serialized_values.set(v,s);
                return s;
            }
        },
        
        getScopeReceiver: (SCOPE: compiler_scope) => {
            let receiver:target_clause = Runtime.endpoint;
            let options:compiler_options | undefined = SCOPE.options;
            while(options) {
                if (options.to) {
                    receiver = options.to as target_clause;
                    break;
                }
                options = options.parent_scope?.options;
            }
            if (!SCOPE.options?.to) SCOPE.options.to = receiver;
            return receiver;
        },

        // // insert Maybe
        // insertMaybe: async (maybe:Maybe, SCOPE:compiler_scope) => {

        // },

        insert_transform_scope: (SCOPE: compiler_scope|extract_var_scope, transform_scope: Scope<any>) => {
            const compiled = transform_scope.compiled;

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);

            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.TRANSFORM;

            for (const v of transform_scope.internal_vars) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                Compiler.builder.insert(v, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
            }

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+Uint32Array.BYTES_PER_ELEMENT+compiled.byteLength, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SCOPE_BLOCK;
            SCOPE.data_view.setUint32(SCOPE.b_index, compiled.byteLength, true);
            SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT
            SCOPE.uint8.set(new Uint8Array(compiled), SCOPE.b_index)
            SCOPE.b_index += compiled.byteLength;
        },


        // insert any value besides Maybes

        insert: (value:any, SCOPE:compiler_scope, is_root=true, parents?:Set<any>, unassigned_children?:[number, any, number][], add_insert_index = true) => {

            // make sure normal pointers are collapsed (ignore error if uninitialized pointer is passed in)
            try {
                value = Ref.collapseValue(value);
            }
            catch {}

            const receiver = Compiler.builder.getScopeReceiver(SCOPE);
            // bound local slot? (eg. #env) - only when sending to remote
            const toRemote = receiver && receiver!==Runtime.endpoint && receiver !== LOCAL_ENDPOINT;

            if (toRemote && value?.[DX_BOUND_LOCAL_SLOT]) {
                const v_name = value[DX_BOUND_LOCAL_SLOT];
                if (typeof v_name !== "string") throw new Error("Invalid DX_BOUND_LOCAL_SLOT, must be of type string");
                const mapped = Compiler.builder.mapInternalVarNameToByteCode(v_name, ACTION_TYPE.GET, SCOPE);
                if (typeof mapped == "number") {
                    Compiler.builder.insertVariable(SCOPE, undefined, ACTION_TYPE.GET, undefined, mapped);
                }
                else {
                    throw new Error("Invalid DX_BOUND_LOCAL_SLOT: " + v_name);
                }
                return;
            }
            // bound pointer property (eg. #env->LANG) - only when sending to remote
            if (toRemote && value instanceof PointerProperty && value.pointer.val?.[DX_BOUND_LOCAL_SLOT]) {
                const v_name = value.pointer.val?.[DX_BOUND_LOCAL_SLOT];
                if (typeof v_name !== "string") throw new Error("Invalid DX_BOUND_LOCAL_SLOT, must be of type string");
                const mapped = Compiler.builder.mapInternalVarNameToByteCode(v_name, ACTION_TYPE.GET, SCOPE);
                if (typeof mapped == "number") {
                    Compiler.builder.insertVariable(SCOPE, undefined, ACTION_TYPE.GET, undefined, mapped);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CHILD_GET_REF
                    Compiler.builder.insert(value.key, SCOPE);
                }
                else {
                    throw new Error("Invalid DX_BOUND_LOCAL_SLOT: " + v_name);
                }
                return;
            }


            // handle <Stream> and ReadableStream, if streaming (<<)
            if ((value instanceof Stream || value instanceof ReadableStream) && SCOPE.uint8[SCOPE.b_index-1] == BinaryCode.STREAM) return Compiler.builder.handleStream(value, SCOPE); 
 
            // same value already inserted -> refer to the value with an internal variable
            if (add_insert_index && SCOPE.inserted_values?.has(value)) {
                // get variable for the already-existing value
                const value_index = SCOPE.inserted_values.get(value)!;
                const existing_val_var = Compiler.builder.createInternalVariableAtIndex(value_index, SCOPE, value)
                // set internal var at current index
                Compiler.builder.insertVariable(SCOPE, existing_val_var, ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
                SCOPE.options._first_insert_done = true;
                return;
            }
    
            // get dynamic index for start of value
            const start_index = Compiler.builder.getDynamicIndex(SCOPE.b_index, SCOPE);

            // add original value to inserted values map (only if useful, exclude short values like boolean and null)
            if (!(SCOPE.options.no_duplicate_value_optimization && (typeof value == "bigint" || typeof value == "number" || typeof value == "string")) && value!==VOID && 
                value !==null && 
                typeof value != "boolean" &&
                !((typeof value == "bigint" || typeof value == "number") && value<=Compiler.MAX_INT_32 && value>=Compiler.MIN_INT_32)
            ) {
                SCOPE.inserted_values.set(value, start_index) 
            }

            let type:Type|undefined
            const original_value = value;
 
            // exception for functions: convert to Datex.Function & create Pointer reference (proxifyValue required!)
            if (value instanceof Function && !(value instanceof DatexFunction) && !(value instanceof JSTransferableFunction)) value = Pointer.proxifyValue(DatexFunction.createFromJSFunction(value));

            // exception for Date: convert to Time (TODO: different approach?)
            if (value instanceof Date && !(value instanceof Time)) {
                try {
                    value = new Time(value);
                }
                catch (e) {
                    console.log("failed to convert Date to Time",e);
                }
            }

            // is not a Datex.Error -> convert to Datex.Error
            if (value instanceof Error && !(value instanceof DatexError)) {
                value = DatexError.fromJSError(value);
            }

            // proxify to pointer 
            value = Pointer.pointerifyValue(value);

            const skip_first_collapse = !SCOPE.options._first_insert_done&&SCOPE.options.collapse_first_inserted;

            const option_collapse = SCOPE.options.collapse_pointers && !(SCOPE.options.keep_external_pointers && value instanceof Pointer && !value.is_origin);
            const no_proxify = value instanceof Ref && (((value instanceof Pointer && value.is_anonymous) || option_collapse) || skip_first_collapse);

             
            // proxify pointer exceptions:
            if (no_proxify) {
               
                // handle pointers with transform (always ...)
 
                // only if not ignore_first_collapse or, if ignore_first_collapse and keep_first_transform is enabled
                if (!SCOPE.options.no_create_pointers && value instanceof Pointer && value.transform_scope && (value.force_local_transform || !skip_first_collapse || SCOPE.options.keep_first_transform)) {
                    SCOPE.options._first_insert_done = true; // set to true before next insert

                    Compiler.builder.insert_transform_scope(SCOPE, value.transform_scope);
                
                    return;
                }


                value = value.val; // don't proxify anonymous pointers or serialize ptr
                // add $$ operator, not if no_create_pointers enabled or skip_first_collapse
                if (option_collapse && !SCOPE.options.no_create_pointers && !skip_first_collapse) SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CREATE_POINTER;
            }

            // first value was collapsed (if no_proxify == false, it was still collapsed because it's not a pointer reference)
            // if (SCOPE.options.collapse_first_inserted)  SCOPE.options.collapse_first_inserted = false; // reset
            SCOPE.options._first_insert_done = true;

            // console.log("INS",value)
                
            // serialize if not pointer
            if (!(value instanceof Pointer)) {
                // Check for Complex types
                // get datex type first
                type = Type.ofValue(value);
                
                if (!type) throw new ValueError("Cannot get type for value " + value)

                // convert to <type> + serialized object ; also always for type variations
                // exception for explicit type quantity, type variation is always included in primitive representation without explicit cast
                if (type?.is_complex || type.root_type !== type && !Type.std.quantity.matchesType(type)) {
                    Compiler.builder.addTypeByNamespaceAndName(SCOPE, type.namespace, type.name, type.variation, type.parameters, type.jsTypeDefModule);
                    value = Compiler.builder.serializeValue(value, SCOPE);
                }
                else if (type?.serializable_not_complex) { // for UintArray Buffers
                    value = Compiler.builder.serializeValue(value, SCOPE);
                }

                // try to proxify serialized value again to pointer (proxify exceptions!) 
                if (!no_proxify) value = Pointer.pointerifyValue(value);
            }

            // ignore value - insert void
            if (value?.[DX_IGNORE]) {
                Compiler.builder.addVoid(SCOPE);
            }
            
            // only fundamentals here:
            else if (value instanceof Quantity)              Compiler.builder.addQuantity(value, SCOPE); // UNIT
            else if (value===VOID)                           Compiler.builder.addVoid(SCOPE); // Datex.VOID
            else if (value===null)                           Compiler.builder.addNull(SCOPE); // NULL
            else if (typeof value == 'bigint')               Compiler.builder.addInt(value, SCOPE); // INT
            else if (typeof value == 'number')               Compiler.builder.addFloat(value, SCOPE); // FLOAT
            else if (typeof value == "string")               Compiler.builder.addText(value, SCOPE); // STRING
            else if (typeof value == "boolean")              Compiler.builder.addBoolean(value, SCOPE); // BOOLEAN
            else if (value instanceof URL)                   Compiler.builder.addUrl(value.href, SCOPE); // URL
            else if (value instanceof Time)                  Compiler.builder.addTime(value, SCOPE); // Time
            else if (value instanceof Disjunction)           Compiler.builder.addDisjunction(value, SCOPE); // |
            else if (value instanceof Conjunction)           Compiler.builder.addConjunction(value, SCOPE); // &
            else if (value instanceof Negation) {
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NOT; 
                Compiler.builder.insert(value.not(), SCOPE, is_root, parents, unassigned_children); // shallow clone parents set
            }
            else if (value instanceof DatexResponse) {
                // raw datex script response not allowed in insert method, must use async compilerInsert method
                if (!(value.datex instanceof Scope)) throw new CompilerError("Insertion of non-compiled raw DATEX Response currently not possible when using optimized (synchronous) DATEX compilation");
                else Compiler.builder.insertScopeBlock(BinaryCode.DO, value.datex, SCOPE);
            }

            else if (value instanceof PointerProperty) {
                const _SCOPE = SCOPE.extract_pointers ? SCOPE.extract_var_scope! : SCOPE;
                // $pointer
                Compiler.builder.addPointer(value.pointer, _SCOPE);
                // ->
                Compiler.builder.handleRequiredBufferSize(_SCOPE.b_index, _SCOPE);
                _SCOPE.inner_scope.path_info_index = _SCOPE.b_index++;
                _SCOPE.uint8[_SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_GET_REF;
                // key
                Compiler.builder.insert(value.key, <compiler_scope>_SCOPE); // TODO cast to compiler_scope might ignore uninitialized scope properties
                
                // insert injected var if extract pointers
                if (SCOPE.extract_pointers) {
                    const index = SCOPE.extract_var_index!++;
                    Compiler.builder.insertVariable(SCOPE, index, ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
                }
            
            }
            else if (value instanceof Pointer)      {
                // pointer action follows (if not a path property)?
                if (SCOPE.inner_scope.path_info_index == -1) {
                    let m:RegExpMatchArray|null;
                    let action_type:ACTION_TYPE = ACTION_TYPE.GET;
                    let action_specifier:number|undefined = undefined;
                    SCOPE.datex = SCOPE.datex?.replace(/^[^\S\n]+/, ""); // clear whitespaces
                    // match =, +=, -=
                    if ((m = SCOPE.datex?.match(Regex.ASSIGN_SET)) && SCOPE.datex[1]!="=") { // make sure it is '=', not '=='
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.SET;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_ADD)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.ADD;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_SUB)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.SUBTRACT;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_MUTIPLY)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.MULTIPLY;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_DIVIDE)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.DIVIDE;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_AND)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.AND;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_OR)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.OR;
                    }
                    else if (m = SCOPE.datex?.match(Regex.ASSIGN_REFERENCE)) {
                        SCOPE.datex = SCOPE.datex.substring(m[0].length);
                        action_type = ACTION_TYPE.OTHER;
                        action_specifier = BinaryCode.CREATE_POINTER;
                    }
                    else {
                        // pointer get
                        if (SCOPE.options.inserted_ptrs) SCOPE.options.inserted_ptrs.add(value)
                    }
                    Compiler.builder.addPointer(value, SCOPE, action_type, action_specifier); // POINTER (assignment)
                }
                else {
                    if (SCOPE.options.inserted_ptrs) SCOPE.options.inserted_ptrs.add(value)
                    Compiler.builder.addPointer(value, SCOPE); // POINTER
                }
            }
            else if (value instanceof WildcardTarget)   Compiler.builder.addTarget(value.target, SCOPE); // Filter Target: ORG, APP, LABEL, ALIAS
            else if (value instanceof Endpoint)         Compiler.builder.addTarget(value, SCOPE); // Filter Target: ORG, APP, LABEL, ALIAS
            else if (value instanceof Type) {
                Compiler.builder.addTypeByNamespaceAndName(SCOPE, value.namespace, value.name, value.variation, value.parameters, value.jsTypeDefModule); // Type
            }
            else if (value instanceof Uint8Array)        Compiler.builder.addBuffer(value, SCOPE); // Uint8Array
            else if (value instanceof ArrayBuffer)       Compiler.builder.addBuffer(new Uint8Array(value), SCOPE); // Buffer
            else if (value instanceof Scope) { // Datex Scope
                // insert scope block
                Compiler.builder.insertScopeBlock(BinaryCode.PLAIN_SCOPE, value, SCOPE);
            }

            // complex objects (with recursion)
            else if (value instanceof Array) { 

                // byte array (optimized)
                if (type?.variation == "8") Compiler.builder.addBuffer(new Uint8Array(new Int8Array(value).buffer), SCOPE);
                else if (type?.variation == "16") Compiler.builder.addBuffer(new Uint8Array(new Int16Array(value).buffer), SCOPE);
                else if (type?.variation == "32") Compiler.builder.addBuffer(new Uint8Array(new Int32Array(value).buffer), SCOPE);
                else if (type?.variation == "64") Compiler.builder.addBuffer(new Uint8Array(new BigInt64Array(value).buffer), SCOPE);
                else if (type?.variation == "u8") Compiler.builder.addBuffer(new Uint8Array(value), SCOPE);
                else if (type?.variation == "u16") Compiler.builder.addBuffer(new Uint8Array(new Uint16Array(value).buffer), SCOPE);
                else if (type?.variation == "u32") Compiler.builder.addBuffer(new Uint8Array(new Uint32Array(value).buffer), SCOPE);
                else if (type?.variation == "u64") Compiler.builder.addBuffer(new Uint8Array(new BigUint64Array(value).buffer), SCOPE);

                // normal array
                else {
                    // add current value to parents list
                    if (!parents) parents = new Set();
                    parents.add(original_value);
                    Compiler.builder.addArray(value, SCOPE, is_root, parents, unassigned_children, start_index);
                }
            } 
            else if (value instanceof Tuple)  {
                // add current value to parents list
                if (!parents) parents = new Set();
                parents.add(original_value);         
                Compiler.builder.addTuple(value, SCOPE, is_root, parents, unassigned_children, start_index);
            }
            else if (typeof value == "object")  {
                // add current value to parents list
                if (!parents) parents = new Set();
                parents.add(original_value);         
                Compiler.builder.addObject(value, SCOPE, is_root, parents, unassigned_children, start_index);
            }

            // convert symbols to Datex.VOID (not supported) TODO create pointers for symbols (custom class)?
            else if (typeof value == "symbol") {
                Compiler.builder.addVoid(SCOPE); // Datex.VOID
            }
            else {
                console.error("Unsupported native value", value);
                throw new ValueError("Failed to compile an unsupported native type")
            }

            // add extended values
            // TODO handle correctly when extending frozen object
            // first add extended objects if extended object
            if (value?.[EXTENDED_OBJECTS]) {
                for (let ext of value[EXTENDED_OBJECTS]||[]){
                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.AND;
                    Compiler.builder.insert(ext, SCOPE, is_root, parents, unassigned_children); // shallow clone parents set
                }
            }
        },

        mapInternalVarNameToByteCode: (v_name: string, action_type: ACTION_TYPE, SCOPE: compiler_scope) => {
            if (v_name == "result") return BinaryCode.VAR_RESULT
            else if (v_name == "sub_result") return BinaryCode.VAR_SUB_RESULT
            else if (v_name == "_origin") return BinaryCode._VAR_ORIGIN
            else if (v_name == "it") return BinaryCode.VAR_IT
            else if (v_name == "void") return BinaryCode.VAR_VOID

            else if (v_name == "origin") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #origin", SCOPE.stack); return BinaryCode.VAR_ORIGIN}
            else if (v_name == "endpoint") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #endpoint", SCOPE.stack); return BinaryCode.VAR_ENDPOINT}
            else if (v_name == "location") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #location", SCOPE.stack); return BinaryCode.VAR_LOCATION}
            else if (v_name == "env") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #env", SCOPE.stack); return BinaryCode.VAR_ENV}
            // else if (v_name == "timestamp") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #timestamp", SCOPE.stack); base_type = BinaryCode.VAR_TIMESTAMP; v_name = undefined}
            // else if (v_name == "encrypted") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #encrypted", SCOPE.stack); base_type = BinaryCode.VAR_ENCRYPTED; v_name = undefined}
            // else if (v_name == "signed") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #signed", SCOPE.stack); base_type = BinaryCode.VAR_SIGNED; v_name = undefined}
            else if (v_name == "meta") {  if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #meta", SCOPE.stack); return BinaryCode.VAR_META}
            else if (v_name == "public") {  if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #public", SCOPE.stack); return BinaryCode.VAR_PUBLIC}
            else if (v_name == "this") {  if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #this", SCOPE.stack); return BinaryCode.VAR_THIS}
            else if (v_name == "remote") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #remote", SCOPE.stack); return BinaryCode.VAR_REMOTE}
            else if (v_name == "entrypoint") {if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #entrypoint", SCOPE.stack); return BinaryCode.VAR_ENTRYPOINT}
            else if (v_name == "std") {  if (action_type != ACTION_TYPE.GET) throw new CompilerError("Invalid action on internal variable #std", SCOPE.stack); return BinaryCode.VAR_STD}

            return v_name;
        }

    }


    static async parseNextExpression (SCOPE:compiler_scope) {
        let m:RegExpMatchArray|null;

        const last_command_end = SCOPE.last_command_end; // remember last command

        SCOPE.datex = SCOPE.datex.replace(/^[^\S\n]+/, ""); //(/^[^\S\r\n]+/
        SCOPE.last_command_end = false; // reset 'last command was ;'
        
        let isEffectiveValue = false;

        // END 
        if (!SCOPE.datex) {
            SCOPE.end = true;
            SCOPE.last_command_end = last_command_end; // last command still valid
        }

        else if (m = SCOPE.datex.match(Regex.URL)) {   
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const url = m[0].replace(/\\(.)/, '$1')
            Compiler.builder.addUrl(url, SCOPE);
            isEffectiveValue = true;
        }

        // SEPERATOR
        else if (m = SCOPE.datex.match(Regex.SEPERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
        }

        // INSERT data (?)
        else if (m = SCOPE.datex.match(Regex.INSERT)) {     
            SCOPE.datex = SCOPE.datex.substring(m[0].length); 

            if (SCOPE.current_data_index == undefined) SCOPE.current_data_index = 0;

            const d_index = m[1] ? parseInt(m[1]) : SCOPE.current_data_index++;

            // precompiling, don't insert a value
            if (SCOPE.precompiled) {
                // add buffer if not size 0
                if (SCOPE.b_index-(SCOPE.last_precompiled??0) != 0) SCOPE.precompiled.appendBufferPlaceholder(SCOPE.last_precompiled??0,SCOPE.b_index);
                SCOPE.precompiled.appendDataIndex(d_index);
                SCOPE.last_precompiled = SCOPE.b_index;
                return;
            }

            else {
                const d = SCOPE.data?.[d_index];

                // special exception: insert raw datex script (dxb Scope can be inserted normally (synchronous))
                if (d instanceof DatexResponse && !(d.datex instanceof Scope)) await Compiler.builder.compilerInsert(SCOPE, d);
                else Compiler.builder.insert(d, SCOPE);
            }
            isEffectiveValue = true;
        }
         
        /**
         * INSERT inline command
         * value resolution similar to 'get'
         *   * resolves URL value
         *   * resolve endpoint #default
         *   * inserts scope as script code
         * Similar to 'compile get', but actual datex script execution happens on receiver endpoint(s)
         */

        else if (m = SCOPE.datex.match(Regex.INSERT_COMMAND)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            // COMPILE:
            // TODO add a 'return' command somehow
            const return_data:{datex:string} = {datex: SCOPE.datex};
    
            // create compiler scope first time
            if (!SCOPE.compile_compiler_scope) {
                SCOPE.compile_compiler_scope = this.createCompilerScope(return_data, SCOPE.data, {}, false, false, false, undefined, Infinity, m[1]?1:2, SCOPE.current_data_index)
            }
            // reset scope for next DATEX script snippet
            else {
                this.resetScope(SCOPE.compile_compiler_scope, return_data, m[1]?1:2);
            }
            // compile snippet in compiler scope
            const compiled = <ArrayBuffer> await this.compileLoop(SCOPE.compile_compiler_scope);
            // update position in current datex script
            //console.log("new datex",return_data.datex)
            SCOPE.datex = return_data.datex;


            // RUN:

            try {
                // create datex scope to run
                if (!SCOPE.compile_datex_scope) {
                    SCOPE.compile_datex_scope = Runtime.createNewInitialScope(undefined, undefined, undefined, undefined, SCOPE.options.context_location, true);
                }
                // set dxb as scope buffer
                Runtime.updateScope(SCOPE.compile_datex_scope, compiled, {sender:Runtime.endpoint, executable:true})
                
                // execute scope -> get script from path                
                const value = await Runtime.simpleScopeExecution(SCOPE.compile_datex_scope);
                // insert
                await Compiler.builder.compilerInsert(SCOPE, value);

            } catch (e) {
                if (e instanceof DatexError) e.pushToStack(...SCOPE.stack);
                throw e;
            }
     
        }

        // COMPILE inline script
        // run at compile time
        // insert values literally, but collapse pointer references
        else if (m = SCOPE.datex.match(Regex.COMPILE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex


            // COMPILE:
            // compiles and injects result directly
            // if value is scope, the compiled scope value is injected
            // TODO add a 'return' command somehow
            let return_data:{datex:string} = {datex: SCOPE.datex};
    
            // create compiler scope first time
            if (!SCOPE.compile_compiler_scope) {
                SCOPE.compile_compiler_scope = this.createCompilerScope(return_data, SCOPE.data, {}, false, false, false, undefined, Infinity, !!m[1]?1:2, SCOPE.current_data_index)
            }
            // reset scope for next DATEX script snippet
            else {
                this.resetScope(SCOPE.compile_compiler_scope, return_data, !!m[1]?1:2);
            }
            // compile snippet in compiler scope
            let compiled = <ArrayBuffer> await this.compileLoop(SCOPE.compile_compiler_scope);
            // update position in current datex script
            //console.log("new datex",return_data.datex)
            SCOPE.datex = return_data.datex;

            try {
                // create datex scope to run
                if (!SCOPE.compile_datex_scope) {
                    SCOPE.compile_datex_scope = Runtime.createNewInitialScope(undefined, undefined, undefined, undefined, SCOPE.options.context_location, true);
                }
                // set dxb as scope buffer
                Runtime.updateScope(SCOPE.compile_datex_scope, compiled, {sender:Runtime.endpoint, executable:true})
                
                // execute scope -> get script from path
                let value:any
                
                value = await Runtime.simpleScopeExecution(SCOPE.compile_datex_scope)

                // already compiled in <Scope>
                if (value instanceof Scope) {
                    let compiled_script = value.compiled;

                    // add scope header
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DO;
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SCOPE_BLOCK;
                    SCOPE.data_view.setUint32(SCOPE.b_index, compiled_script.byteLength, true);
                    SCOPE.b_index += Uint32Array.BYTES_PER_ELEMENT;

                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+10+compiled_script.byteLength, SCOPE);
                    SCOPE.uint8.set(new Uint8Array(compiled_script), SCOPE.b_index)
                    SCOPE.b_index += compiled_script.byteLength;
                }
                else Compiler.builder.insert(value, SCOPE);

            } catch (e) {
                    if (e instanceof DatexError) e.pushToStack(...SCOPE.stack);
                    throw e;
            }

        }

        // KEY  (check before variable and keywords!, only if not in :: filter)
        else if (m = SCOPE.datex.match(Regex.KEY)) {   
            //if (SCOPE.inner_scope.parent_type == BinaryCode.ARRAY_START) throw new SyntaxError("Invalid key in <Array>");
            // // convert tuple to record
            // if (SCOPE.inner_scope.parent_type == BinaryCode.TUPLE_START) DatexCompiler.builder.change_inner_scope_parent_type(SCOPE, BinaryCode.RECORD_START)
            // if (SCOPE.inner_scope.auto_close_scope == BinaryCode.TUPLE_END) SCOPE.inner_scope.auto_close_scope = BinaryCode.RECORD_END;

            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            const key = m[0].substring(0,m[0].length-1).trim(); // get key
            const int_key = Number.isInteger(Number(key)) ? Number(key) : null;

            // check/add  permission prefix (@xy x: ...)
            const permission_prefix = false // TODO: Compiler.builder.check_perm_prefix(SCOPE);

            // override current BinaryCode.ELEMENT
            if (!permission_prefix && SCOPE.inner_scope.first_element_pos!=undefined) SCOPE.b_index = SCOPE.inner_scope.first_element_pos;

            Compiler.builder.detect_record(SCOPE);

            if (key.startsWith("#")) Compiler.builder.addObjectSlot(key.slice(1), SCOPE); // object slot
            else Compiler.builder.addKey(int_key??key, SCOPE); // normal key

            isEffectiveValue = true;
        }


        // EXIT
        else if (m = SCOPE.datex.match(Regex.EXIT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.EXIT;
        }

        // RESOLVE
        else if (m = SCOPE.datex.match(Regex.GET)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GET;
        }

        // COUNT
        else if (m = SCOPE.datex.match(Regex.COUNT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.COUNT;
        }

        // ABOUT
        else if (m = SCOPE.datex.match(Regex.ABOUT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ABOUT;
        }

        // RETURN
        else if (m = SCOPE.datex.match(Regex.RETURN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.RETURN;
        }

        // ITERATOR
        else if (m = SCOPE.datex.match(Regex.ITERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ITERATOR;
        }

        // SKIP
        else if (m = SCOPE.datex.match(Regex.SKIP)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            if (!('loop_start' in  SCOPE.inner_scope)) throw new CompilerError("Invalid 'skip' command", SCOPE.stack);
            Compiler.builder.addJmp(SCOPE, BinaryCode.JMP, SCOPE.inner_scope.loop_start);
            Compiler.builder.valueIndex(SCOPE);
        }

        // LEAVE
        else if (m = SCOPE.datex.match(Regex.LEAVE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            // TODO jump to end
        }

        // ITERATE
        else if (m = SCOPE.datex.match(Regex.ITERATE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            SCOPE.inner_scope.iterate = 0;
            SCOPE.inner_scope.value_count = 1; 

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;

            // #iter = iterator
            Compiler.builder.insertVariable(SCOPE, 'i', ACTION_TYPE.SET, undefined, BinaryCode.INTERNAL_VAR);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+2, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CREATE_POINTER;
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_ITERATOR;
        }

        // WHILE
        else if (m = SCOPE.datex.match(Regex.WHILE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            SCOPE.inner_scope.while = SCOPE.b_index+1;
            SCOPE.inner_scope.loop_start = SCOPE.b_index+1;
            SCOPE.inner_scope.value_count = 2; 

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
            // add jfa
            Compiler.builder.addJmp(SCOPE,  BinaryCode.JFA);
        }

        // IF
        else if (m = SCOPE.datex.match(Regex.ELSE_IF)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);

            // is else if 
            if (m[1]) {
                // no previous if
                if (!SCOPE.inner_scope.if_end_indices?.length) throw new CompilerError("Invalid else-if statement - no preceding if statement", SCOPE.stack);
                SCOPE.b_index--; // override SUBSCOPE_END
            }

            // is only if
            else {
                Compiler.builder.valueIndex(SCOPE); // new value start
            }

            SCOPE.inner_scope.value_count = 2;

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1+Uint32Array.BYTES_PER_ELEMENT, SCOPE);
            if (!m[1]) SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START; // start subscope only if first 'if'

            SCOPE.inner_scope.if = SCOPE.b_index;
 
            // add jfa
            Compiler.builder.addJmp(SCOPE,  BinaryCode.JFA);
        }

        // ELSE
        else if (m = SCOPE.datex.match(Regex.ELSE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);

            // is no previous if
            if (!SCOPE.inner_scope.if_end_indices?.length) throw new CompilerError("Invalid else statement - no preceding if statement", SCOPE.stack);

            SCOPE.b_index--; // override previous SUBSCOPE_END

            SCOPE.inner_scope.else = true;
            SCOPE.inner_scope.value_count = 1; 
        }

        // FUN
        else if (m = SCOPE.datex.match(Regex.FUN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // remove fun
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_FUNCTION;
            isEffectiveValue = true;
        }

        // \n
        else if (m = SCOPE.datex.match(/^\n/)) {
            SCOPE.current_line_nr++;
            SCOPE.datex = SCOPE.datex.substring(m[0].length);
            SCOPE.last_command_end = last_command_end; // last command still valid
        }           
     

        // DOC_COMMENT - before ASSIGN, ...
        else if (m = SCOPE.datex.match(Regex.DOC_COMMENT)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // remove comment
            SCOPE.current_line_nr += m[0].split(/\r\n|\r|\n/).length - 1 // add nr of lines
            SCOPE.last_command_end = last_command_end; // last command still valid

            const doc_comment = m[3]??m[2];
            // TODO: reenable? replace with markdown insertion
            // SCOPE.datex = `<text/markdown> '${doc_comment.replace(/\'/g, "\\'")}';\n` + SCOPE.datex;
        }

        // COMMENT - before ASSIGN, ...
        else if (m = SCOPE.datex.match(Regex.COMMENT)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // remove comment
            SCOPE.current_line_nr += m[0].split(/\r\n|\r|\n/).length - 1 // add nr of lines
            SCOPE.last_command_end = last_command_end; // last command still valid
        }

        
        // Datex.VOID (check before variable!)
        else if (m = SCOPE.datex.match(Regex.VOID)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addVoid(SCOPE);
            isEffectiveValue = true;
        }


        // REMOTE CALL (::) 
        else if (m = SCOPE.datex.match(Regex.REMOTE_CALL)) {
            if (SCOPE._code_block_type!>=2 && SCOPE.subscopes.length==1) { // in outer scope and single line block?
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            }

            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            await Compiler.builder.addScopeBlock(BinaryCode.REMOTE, !!m[1], false, SCOPE)
        }

        // TRANSFORM
        else if (m = SCOPE.datex.match(Regex.ALWAYS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.TRANSFORM, !!m[1], true, SCOPE)
        }


        // Datex.VOID (empty brackets)
        else if (m = SCOPE.datex.match(Regex.QUASI_VOID)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addVoid(SCOPE);
            isEffectiveValue = true;
        }

        // SUBSCOPE START
        else if (m = SCOPE.datex.match(Regex.SUBSCOPE_START)) {        
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
         
            Compiler.builder.enter_subscope(SCOPE);
        } 

    
        // SYNC_SILENT (<==:)
        else if (m = SCOPE.datex.match(Regex.SYNC_SILENT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode._SYNC_SILENT;
        }

        // SYNC (<==)
        else if (m = SCOPE.datex.match(Regex.SYNC)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SYNC;
        }


        // STOP_SYNC (</=)
        else if (m = SCOPE.datex.match(Regex.STOP_SYNC)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STOP_SYNC;
        }

        
        // STREAM (before type and <=)
        else if (m = SCOPE.datex.match(Regex.STREAM)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STREAM;
        }

        // STOP_STREAM
        else if (m = SCOPE.datex.match(Regex.STOP_STREAM)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STOP_STREAM;
        }

        // TYPE (before <)
        // if function arg parsing (42), don't allow type definitions
        else if (
            (SCOPE._code_block_type==42 && (m = SCOPE.datex.match(Regex.TYPE_FUNCTION_ARG_COMPAT))) || 
            (SCOPE._code_block_type!=42 && (m = SCOPE.datex.match(Regex.TYPE)))
        ) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            // is parameterized type
            if (m[4] == "(") {
                SCOPE.datex = "(" + SCOPE.datex;
                SCOPE.inner_scope.param_type_close = true;
                Compiler.builder.addTypeByNamespaceAndName(SCOPE, m[1], m[2], m[3]?.slice(1), true);
            }
            // is type definition
            else if (m[5]) {
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.TEMPLATE;  
                Compiler.builder.addTypeByNamespaceAndName(SCOPE, m[1], m[2], m[3]?.slice(1))
            }
            // normal type
            else Compiler.builder.addTypeByNamespaceAndName(SCOPE, m[1], m[2], m[3]?.slice(1))
        }

        // COMPARE 
        // ===
        else if (m = SCOPE.datex.match(Regex.EQUAL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.EQUAL;
        }
        // ~==
        else if (m = SCOPE.datex.match(Regex.NOT_EQUAL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NOT_EQUAL;
        }
        // ==
        else if (m = SCOPE.datex.match(Regex.EQUAL_VALUE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.EQUAL_VALUE;
        }
        // ~=
        else if (m = SCOPE.datex.match(Regex.NOT_EQUAL_VALUE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NOT_EQUAL_VALUE;
        }
        // >=
        else if (m = SCOPE.datex.match(Regex.GREATER_EQUAL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GREATER_EQUAL;
        }
        // <=
        else if (m = SCOPE.datex.match(Regex.LESS_EQUAL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.LESS_EQUAL;
        }
        // >
        else if (m = SCOPE.datex.match(Regex.GREATER)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            // is type close )>, ignore
            if (SCOPE.inner_scope.param_type_close) {
                SCOPE.inner_scope.param_type_close = false;
            }
            // is greater >
            else {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GREATER;
            }
        }
      
        // <
        else if (m = SCOPE.datex.match(Regex.LESS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.LESS;
        }
      
        // YEET
        else if (m = SCOPE.datex.match(Regex.YEET)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.YEET;  
        }
        
        
        // TRY
        else if (m = SCOPE.datex.match(Regex.TRY)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            // no opening scope, add closing
            if (!m[1]) SCOPE.inner_scope.try_close = true;

            Compiler.builder.enter_subscope(SCOPE);
            SCOPE.inner_scope.try_start = SCOPE.b_index
        }

        // ACCEPT
        else if (m = SCOPE.datex.match(Regex.ACCEPT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            // TODO
        }


        // RELATIVE_PATH (before ..)
        else if (m = SCOPE.datex.match(Regex.RELATIVE_PATH)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const path = m[0].replace(/\\(.)/, '$1')
            Compiler.builder.addRelativePath(path, SCOPE);
        }

        // SPREAD (...) = <Tuple>/<Record>
        else if (m = SCOPE.datex.match(Regex.SPREAD)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.EXTEND;
        }

        // Range (..) => <Tuple>
        else if (m = SCOPE.datex.match(Regex.RANGE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.insertByteAtIndex(BinaryCode.RANGE, SCOPE.inner_scope.last_value_index, SCOPE)
        }
  
        // PATH_SEPERATOR (.)
        else if (m = SCOPE.datex.match(Regex.PATH_SEPERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
         
            //SCOPE.inner_scope.current_path_depth++;
            //DatexCompiler.builder.handle_path(SCOPE);

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.inner_scope.path_info_index = SCOPE.b_index++;
            SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_GET;

            // if '.' before:  WILDCARD (.*)
            if (m = SCOPE.datex.match(Regex.WILDCARD)) {               
                SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
                
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.WILDCARD;
                isEffectiveValue = true;
            }
            // default property key (string)
            else if (m = SCOPE.datex.match(Regex.PROPERTY)) {               
                SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
                
                Compiler.builder.addText(m[0], SCOPE);
                isEffectiveValue = true;
            }
        }

        // PATH_REF_SEPERATOR (->)
        else if (m = SCOPE.datex.match(Regex.PATH_REF_SEPERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            const wildcard = SCOPE.datex.match(Regex.WILDCARD);

            // normal scope or extract_var_scope
            const _SCOPE = (SCOPE.extract_pointers && !wildcard) ? SCOPE.extract_var_scope! : SCOPE;

            Compiler.builder.handleRequiredBufferSize(_SCOPE.b_index, _SCOPE);
            _SCOPE.inner_scope.path_info_index = _SCOPE.b_index++;
            _SCOPE.uint8[_SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_GET_REF;

            // if '->' before:  WILDCARD (->*)
            if (wildcard) {               
                SCOPE.datex = SCOPE.datex.substring(wildcard[0].length);  // pop datex
                
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.WILDCARD;
            }
            // default property key (string)
            else if (m = SCOPE.datex.match(Regex.PROPERTY)) {               
                SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
                
                Compiler.builder.addText(m[0], _SCOPE);
            }
        }


        // JMP instructions
        else if (m = SCOPE.datex.match(Regex.JUMP)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            let jmp_label = m[2]

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+5, SCOPE);
            
            Compiler.builder.valueIndex(SCOPE);

            let jmp_to:number|undefined;
            let type = m[1] == "jmp" ?  BinaryCode.JMP : ( m[1] == "jtr" ? BinaryCode.JTR : BinaryCode.JFA);

            // label was before
            if (Object.keys(SCOPE.jmp_label_indices).includes(jmp_label)) {
                SCOPE.used_lbls.push(jmp_label)
                jmp_to = SCOPE.jmp_label_indices[jmp_label][0];
            }
            // wait until label index resolved
            else { 
                if (!SCOPE.indices_waiting_for_jmp_lbl[jmp_label]) SCOPE.indices_waiting_for_jmp_lbl[jmp_label] = []
                SCOPE.indices_waiting_for_jmp_lbl[jmp_label].push(Compiler.builder.getDynamicIndex(SCOPE.b_index+1, SCOPE)); 
            }
            
            // add jmp
            Compiler.builder.addJmp(SCOPE, type, jmp_to);
        }

        // JMP label
        else if (m = SCOPE.datex.match(Regex.JUMP_LBL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            let jmp_label = m[1]
            SCOPE.jmp_label_indices[jmp_label] = Compiler.builder.getDynamicIndex(SCOPE.b_index, SCOPE);

            if (SCOPE.used_lbls.includes(jmp_label)) throw new CompilerError("Multiple use of label: " + jmp_label, SCOPE.stack);
            
            // resolve index for earlier jumps
            if (SCOPE.indices_waiting_for_jmp_lbl[jmp_label]) {
                for (let [i] of SCOPE.indices_waiting_for_jmp_lbl[jmp_label]) {
                    SCOPE.data_view.setUint32(i, SCOPE.b_index, true); // insert label index  
                }
                delete SCOPE.indices_waiting_for_jmp_lbl[jmp_label];
                SCOPE.used_lbls.push(jmp_label)
            }

            // cache dxb from here on when executing (might need to jump to this position later on)
            if (SCOPE.last_cache_point == undefined) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.last_cache_point = SCOPE.b_index
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CACHE_POINT;
            }

        }

        // USE static scope (check before variable!)
        else if (m = SCOPE.datex.match(Regex.USE_PROPS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            SCOPE.inner_scope.use_parent_index = await Compiler.builder.addValVarRefDeclaration(undefined, 'var', SCOPE);
            SCOPE.inner_scope.imported_vars = <[string, string?][]> m[1].split(",").map(v=>v.trim().split(/ +as +/))

            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GET;
        }


        else if (m = SCOPE.datex.match(Regex.USE_ALL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const name = m[1]

            await Compiler.builder.addValVarRefDeclaration(name, 'var', SCOPE)

            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GET;
        }

        else if (m = SCOPE.datex.match(Regex.USE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.insertVariable(SCOPE, 'void', ACTION_TYPE.SET, undefined, BinaryCode.INTERNAL_VAR);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GET;
        }

        
        // BOOLEAN (check before variable!)
        else if (m = SCOPE.datex.match(Regex.BOOLEAN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addBoolean(m[0] == "true" ? true : false, SCOPE);
            isEffectiveValue = true;
        }

        // NULL (check before variable!)
        else if (m = SCOPE.datex.match(Regex.NULL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addNull(SCOPE);
            isEffectiveValue = true;
        }

        // EMPTY_ARRAY (shortcut)
        else if (m = SCOPE.datex.match(Regex.EMPTY_ARRAY)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+2, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_ARRAY;
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.VOID;
            isEffectiveValue = true;
        }

        // EMPTY_OBJECT (shortcut)
        else if (m = SCOPE.datex.match(Regex.EMPTY_OBJECT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+2, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.STD_TYPE_OBJECT;
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.VOID;
            isEffectiveValue = true;
        }


        // ARRAY_START
        else if (m = SCOPE.datex.match(Regex.ARRAY_START)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.enter_subscope(SCOPE, BinaryCode.ARRAY_START);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.inner_scope.first_element_pos = SCOPE.b_index;
            Compiler.builder.commaIndex(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT;  

        }

        // ARRAY_END
        else if (m = SCOPE.datex.match(Regex.ARRAY_END)) {
            if (SCOPE._code_block_type!>=2 && SCOPE.subscopes.length==1) { // in outer scope and single line block?
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            } 
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            Compiler.builder.exit_subscope(SCOPE, BinaryCode.ARRAY_END);
            isEffectiveValue = true;
            //DatexCompiler.builder.close_current_path(SCOPE); // new path scope
        }


        // TEMPLATE STRING (before OBJECT_END) '... (
        else if (!SCOPE.inner_scope.in_template_string && (m = SCOPE.datex.match(Regex.TSTRING_START))) {                            
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            const escaped_string = m[0].substring(1,m[0].length-1);
            SCOPE.current_line_nr += escaped_string.split(/\r\n|\r|\n/).length - 1 // add nr of lines
            const str = Compiler.builder.unescape_string(escaped_string);
            

            SCOPE.inner_scope.in_template_string = true;

            Compiler.builder.enter_subscope(SCOPE); // outer subscope

            // add string if it is not empty
            if (str.length) {
                Compiler.builder.addText(str, SCOPE);
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ADD;
            }
  
            Compiler.builder.addTypeByNamespaceAndName(SCOPE, "std", "text");
            Compiler.builder.enter_subscope(SCOPE);
        }

        // ) ... (
        else if (SCOPE.subscopes[SCOPE.subscopes.length-3]?.in_template_string && (m = SCOPE.datex.match(Regex.TSTRING_B_CLOSE))) {                            
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            const escaped_string = m[0].substring(1,m[0].length-1);
            SCOPE.current_line_nr += escaped_string.split(/\r\n|\r|\n/).length - 1 // add nr of lines
            const str = Compiler.builder.unescape_string(escaped_string);

            Compiler.builder.exit_subscope(SCOPE);

            if (str.length) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ADD;
                Compiler.builder.addText(str, SCOPE);
            }

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ADD;
            Compiler.builder.addTypeByNamespaceAndName(SCOPE, "std", "text");

            Compiler.builder.enter_subscope(SCOPE);
        }

        // ) ... '
        else if (SCOPE.subscopes[SCOPE.subscopes.length-3]?.in_template_string && (m = SCOPE.datex.match(Regex.TSTRING_END))) {                            
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            const escaped_string = m[0].substring(1,m[0].length-1);
            SCOPE.current_line_nr += escaped_string.split(/\r\n|\r|\n/).length - 1 // add nr of lines
            const str = Compiler.builder.unescape_string(escaped_string);

            Compiler.builder.exit_subscope(SCOPE);

            // only add string if not empty
            if (str.length) {
                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ADD;
            
                Compiler.builder.addText(str, SCOPE);
            }
          

            Compiler.builder.exit_subscope(SCOPE); // outer subscope

            SCOPE.inner_scope.in_template_string = false;
            isEffectiveValue = true;
        }


        // OBJECT_START
        else if (m = SCOPE.datex.match(Regex.OBJECT_START)) {           
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.enter_subscope(SCOPE, BinaryCode.OBJECT_START);
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.inner_scope.first_element_pos = SCOPE.b_index;
            Compiler.builder.commaIndex(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT;  
        }

        // OBJECT_END
        else if (m = SCOPE.datex.match(Regex.OBJECT_END)) {
            if (SCOPE._code_block_type!>=2 && SCOPE.subscopes.length==1) { // in outer scope and single line block?
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            }
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.exit_subscope(SCOPE, BinaryCode.OBJECT_END);
            isEffectiveValue = true;
            //DatexCompiler.builder.close_current_path(SCOPE); // new path scope
        }

        // COMMA
        else if (m = SCOPE.datex.match(Regex.COMMA)) {      
            if (SCOPE._code_block_type!>=2 && SCOPE.subscopes.length==1) { // in outer scope and single line block?
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            }
            
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            
            // detect TUPLE
            if (SCOPE.inner_scope.parent_type==undefined || SCOPE.inner_scope.parent_type == BinaryCode.SUBSCOPE_START) {
                // last ( bracket can be replaced with tuple bracket
                if (SCOPE.inner_scope.parent_type == BinaryCode.SUBSCOPE_START && SCOPE.inner_scope.start_index == SCOPE.inner_scope.first_value_index-1) {
                    Compiler.builder.change_inner_scope_parent_type(SCOPE, BinaryCode.TUPLE_START)
                    Compiler.builder.commaIndex(SCOPE.inner_scope.start_index+1, SCOPE);
                    Compiler.builder.insertByteAtIndex(BinaryCode.ELEMENT, SCOPE.inner_scope.start_index+1, SCOPE); // also add first ELEMENT
                }
                // create new subscope
                else {

                    const index = Math.max(SCOPE.inner_scope.ce_index??0, SCOPE.inner_scope.first_value_index); // save index from current sub scope
                    if (index === -1) throw new SyntaxError("Invalid leading comma") // value must exist before
                    Compiler.builder.commaIndex(index, SCOPE);
                    Compiler.builder.insertByteAtIndex(BinaryCode.ELEMENT, index, SCOPE); // also add first ELEMENT
                    Compiler.builder.enter_subscope(SCOPE, BinaryCode.TUPLE_START, index);
                    SCOPE.inner_scope.auto_close_scope = BinaryCode.TUPLE_END;
                }
            }

            // always add BinaryCode.ELEMENT (migh be overriden with BinaryCode.ELEMENT_WITH_KEY)
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.inner_scope.first_element_pos = SCOPE.b_index; // set first element index
            Compiler.builder.commaIndex(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT;  
        }


        // BUFFER
        else if (m = SCOPE.datex.match(Regex.BUFFER)) {              

            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            let content = m[1];
            let buffer:Uint8Array;

            try {
                buffer = hex2buffer(content);
            }
            catch(e) {
                throw new ValueError("Invalid <Buffer> format (base 16)");
            }

            Compiler.builder.addBuffer(buffer, SCOPE);
            isEffectiveValue = true;
        }

       

        // CLOSE_AND_STORE
        else if ((m = SCOPE.datex.match(Regex.CLOSE_AND_STORE)) !== null) {     
            if (SCOPE._code_block_type>=2 && !Compiler.builder.has_open_subscopes(SCOPE)) {
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            }

            SCOPE.current_line_nr += m[0].split(/\r\n|\r|\n/).length - 1 // add nr of lines

            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            // auto-close subscopes here?
            while (SCOPE.inner_scope.auto_close_scope!=undefined) {
                const type = SCOPE.inner_scope.auto_close_scope;
                delete SCOPE.inner_scope.auto_close_scope;
                Compiler.builder.exit_subscope(SCOPE, type);
            }

            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;  

            // remember ; in inner scope
            SCOPE.inner_scope.has_ce = true;
            SCOPE.inner_scope.ce_index = SCOPE.b_index;

            SCOPE.last_command_end = true;

            // finish 'use' command (TODO just temporary position)
            if (SCOPE.inner_scope.imported_vars && SCOPE.inner_scope.use_parent_index!=undefined) {
                for (let v of SCOPE.inner_scope.imported_vars) {
    
                    await Compiler.builder.addValVarRefDeclaration(v[1]??v[0], 'var', SCOPE)
                    Compiler.builder.insertVariable(SCOPE, SCOPE.inner_scope.use_parent_index, ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CHILD_GET;
                    Compiler.builder.addText(v[0], SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;
                }
                delete SCOPE.inner_scope.imported_vars;
                delete SCOPE.inner_scope.use_parent_index;

            }
           
        }

        // INFINITY
        else if (m = SCOPE.datex.match(Regex.INFINITY)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addFloat(m[1]?.[0]=='-' ? -Infinity : +Infinity, SCOPE)
            isEffectiveValue = true;
        }
                
        // NAN
        else if (m = SCOPE.datex.match(Regex.NAN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addFloat(NaN, SCOPE)
            isEffectiveValue = true;
        }

        // PERSON
        else if (m = SCOPE.datex.match(Regex.PERSON_ALIAS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            // const subspace_string = m[2].substring(1);
            // const subspaces = subspace_string ? subspace_string.split(":") : null;
            Compiler.builder.addPersonByNameAndChannel(m[1], m[3], SCOPE);
            isEffectiveValue = true;
        }

        // INSTITUTION
        else if (m = SCOPE.datex.match(Regex.INSTITUTION_ALIAS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            // const subspace_string = m[2].substring(1);
            // const subspaces = subspace_string ? subspace_string.split(":") : null;
            Compiler.builder.addInstitutionByNameAndChannel(m[1], m[3], SCOPE);
            isEffectiveValue = true;
        }

        // ID_ENDPOINT
        else if (m = SCOPE.datex.match(Regex.ENDPOINT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            // const subspace_string = m[2].substring(1);
            // const subspaces = subspace_string ? subspace_string.split(":") : null;
            const endpoint = IdEndpoint.get('@@'+m[1])
            Compiler.builder.addIdEndpointByIdAndChannel(endpoint.binary, m[3], SCOPE);
            isEffectiveValue = true;
        }

        // BROADCAST_ENDPOINT TODO: how to use this with new subspaces?
        else if (m = SCOPE.datex.match(Regex.BROADCAST_ENDPOINT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const subspace_string = m[2].substring(1);
            const subspaces = subspace_string ? subspace_string.split(":") : null;
            Compiler.builder.addIdEndpointByIdAndChannel(BROADCAST.binary, m[6], SCOPE);
            isEffectiveValue = true;
        }

        // STRING or ESCAPED_KEY
        else if (m = SCOPE.datex.match(Regex.STRING_OR_ESCAPED_KEY)) {                                  
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const escaped_string = m[1].substring(1,m[1].length-1);
            SCOPE.current_line_nr += escaped_string.split(/\r\n|\r|\n/).length - 1 // add nr of lines
            let string_or_key = Compiler.builder.unescape_string(escaped_string) // get key and format

            // is escaped key
            if (m[2]) {
                if (SCOPE.inner_scope.parent_type == BinaryCode.ARRAY_START) throw new SyntaxError("Invalid key in <Array>");
                // // convert tuple to record
                // if (SCOPE.inner_scope.parent_type == BinaryCode.TUPLE_START) DatexCompiler.builder.change_inner_scope_parent_type(SCOPE, BinaryCode.RECORD_START)
                // if (SCOPE.inner_scope.auto_close_scope == BinaryCode.TUPLE_END) SCOPE.inner_scope.auto_close_scope = BinaryCode.RECORD_END;
                
                // check/add  permission prefix (@xy x: ...)
                const permission_prefix = false // TODO: Compiler.builder.check_perm_prefix(SCOPE);

                // override current BinaryCode.ELEMENT
                if (!permission_prefix && SCOPE.inner_scope.first_element_pos!=undefined) SCOPE.b_index = SCOPE.inner_scope.first_element_pos;
                Compiler.builder.detect_record(SCOPE);
                Compiler.builder.addKey(string_or_key, SCOPE);
            }
            // is string
            else Compiler.builder.addText(string_or_key, SCOPE);
            isEffectiveValue = true;
        }

        // DYNAMIC_KEY_END
        else if (m = SCOPE.datex.match(Regex.DYNAMIC_KEY_END)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            // closing )
            Compiler.builder.exit_subscope(SCOPE);

            // override current BinaryCode.ELEMENT
            const current_b_index = SCOPE.b_index;
            if (SCOPE.inner_scope.first_element_pos!=undefined) SCOPE.b_index = SCOPE.inner_scope.first_element_pos;
            Compiler.builder.detect_record(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ELEMENT_WITH_DYNAMIC_KEY;
            SCOPE.b_index = current_b_index;
        }

        // SUBSCOPE_END
        else if (m = SCOPE.datex.match(Regex.SUBSCOPE_END)) {
            if (SCOPE._code_block_type>=2 && SCOPE.subscopes.length==1) { // in outer scope and single line block?
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            } 

            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            let end = Compiler.builder.exit_subscope(SCOPE);
            // was block close -> end compilation at this point
            if (end && last_command_end) SCOPE.last_command_end = true; // last command is still the last command

            // block close (TODO still required?)
            /*else if (SCOPE.subscopes.length == 1) {

                DatexCompiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);

                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.COMMAND_END;
                SCOPE.last_command_end = true;
                // reset
                DatexCompiler.builder.close_current_path(SCOPE); // new path scope
            }*/
            isEffectiveValue = true;
        }

        // FREEZE
        else if (m = SCOPE.datex.match(Regex.FREEZE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.FREEZE;  
        }

        // SEAL
        else if (m = SCOPE.datex.match(Regex.SEAL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SEAL;  
        }

        // HAS
        else if (m = SCOPE.datex.match(Regex.HAS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.HAS;  
        }

        // KEYS
        else if (m = SCOPE.datex.match(Regex.KEYS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.KEYS;  
        }

        // DELETE pointer (before VARIABLE)
        else if (m = SCOPE.datex.match(Regex.DELETE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DELETE_POINTER;  
        }

        // // SUBSCRIBE to pointer
        // else if (m = SCOPE.datex.match(Regex.SUBSCRIBE)) {
        //     SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
        //     Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
        //     Compiler.builder.valueIndex(SCOPE);
        //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCRIBE;  
        // }

        // // UNSUBSCRIBE from pointer
        // else if (m = SCOPE.datex.match(Regex.UNSUBSCRIBE)) {
        //     SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
        //     Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
        //     Compiler.builder.valueIndex(SCOPE);
        //     SCOPE.uint8[SCOPE.b_index++] = BinaryCode.UNSUBSCRIBE;  
        // }
        
        // COPY value
        else if (m = SCOPE.datex.match(Regex.COPY)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.COPY;  
        }

        // CLONE value
        else if (m = SCOPE.datex.match(Regex.CLONE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLONE;  
        }

        // CLONE_COLLAPSE value
        else if (m = SCOPE.datex.match(Regex.CLONE_COLLAPSE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLONE_COLLAPSE;  
        }
        

        // COLLAPSE logical value
        else if (m = SCOPE.datex.match(Regex.COLLAPSE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.COLLAPSE;  
        }

        // create new type short command
        else if (m = SCOPE.datex.match(Regex.CREATE_TYPE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            console.log("create type",m)

            const exporting = !!m[1];
            const type = "ref";
            const name = m[3];
            const init_eternal = true;
            const init_brackets = !!m[4];

            // restore "("
            if (!init_eternal && init_brackets) SCOPE.datex = "(" + SCOPE.datex;

            if (exporting) {
                if (!SCOPE.inner_scope.exports) SCOPE.inner_scope.exports = {};
                // remember internal variable for exports
                SCOPE.inner_scope.exports[name] = await Compiler.builder.addValVarRefDeclaration(name, type, SCOPE, init_eternal, init_brackets);
            }

            else await Compiler.builder.addValVarRefDeclaration(name, type, SCOPE, init_eternal, init_brackets);
        }

        // typeof
        else if (m = SCOPE.datex.match(Regex.TYPEOF)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.GET_TYPE;  
        }
            
        // ORIGIN of pointer
        else if (m = SCOPE.datex.match(Regex.ORIGIN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ORIGIN;  
        }

        // SUBSCRIBERS of pointer
        else if (m = SCOPE.datex.match(Regex.SUBSCRIBERS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCRIBERS;  
        }

        // NEXT
        else if (m = SCOPE.datex.match(Regex.NEXT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NEXT;  
        }

        // TEMPLATE
        else if (m = SCOPE.datex.match(Regex.TEMPLATE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.TEMPLATE;  
        }
        
        // EXTENDS
        else if (m = SCOPE.datex.match(Regex.EXTENDS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.EXTENDS;  
        }

        // IMPLEMENTS
        else if (m = SCOPE.datex.match(Regex.IMPLEMENTS)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.IMPLEMENTS;  
        }

        // MATCHES
        else if (m = SCOPE.datex.match(Regex.MATCHES)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.MATCHES;  
        }
        

        // DEFAULT
        else if (m = SCOPE.datex.match(Regex.DEFAULT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            const brackets = !!m[1];
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DEFAULT;  

            await Compiler.builder.addInitBlock(SCOPE, brackets);
            Compiler.builder.valueIndex(SCOPE);
        }

        // DEBUGGER
        else if (m = SCOPE.datex.match(Regex.DEBUGGER)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DEBUGGER;  
        }

        // NEW
        else if (m = SCOPE.datex.match(Regex.NEW)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NEW;  
        }

        // CONSTRUCTOR_METHOD
        else if (m = SCOPE.datex.match(Regex.CONSTRUCTOR_METHOD)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            console.log("constructor", m[0]);
        }

        // SCOPE (plain DATEX Scope)
        else if (m = SCOPE.datex.match(Regex.SCOPE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.PLAIN_SCOPE, !!m[1], false, SCOPE)  
        }

        // OBSERVE value
        else if (m = SCOPE.datex.match(Regex.OBSERVE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OBSERVE;  
        }

        // FUNCTION
        else if (m = SCOPE.datex.match(Regex.FUNCTION)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const exporting = !!m[1]
            const name = m[2];
            if (name) {
                if (exporting) {
                    if (!SCOPE.inner_scope.exports) SCOPE.inner_scope.exports = {};
                    // remember internal variable for exports
                    SCOPE.inner_scope.exports[name] = await Compiler.builder.addValVarRefDeclaration(name, 'ref', SCOPE);
                }
    
                else await Compiler.builder.addValVarRefDeclaration(name, 'ref', SCOPE);
            }
            else if (exporting) {
                throw new CompilerError("Invalid function declaration: cannot export a function without a name (use 'export function NAME()')")
            }

            const params:{[name:string]: [named:boolean, type:'val'|'var'|'ref'|'const', type_init:string, default_init:string, exporting:boolean]} = {}

            while (true) {
                const param = SCOPE.datex.match(Regex.FUNCTION_PARAM);

                if (!param) break; // no param match

                SCOPE.datex = SCOPE.datex.substring(param[0].length);
                const param_modifiers = param[1]?.trim().split(" ").map(v=>v.trim()) ?? '';
                const param_name = param[2];
                let param_end = param[3]

                if (param_name in params) throw new CompilerError("Function variable '"+param_name+"' was already declared")
                params[param_name] = [param_modifiers.includes("named"), (param_modifiers.includes("ref") ? "ref" : (param_modifiers.includes("val") ? "val" : "var")), "<Any>", "", param_modifiers.includes("export")];

                if (param_end == ",") {
                    continue;
                }

                if (param_end == ":") {
                    // veryyy inefficient way of doing things TODO
                    let return_data:{datex:string} = {datex: SCOPE.datex}; 
                    // ignore result - very bad
                    await this.compile(return_data, SCOPE.data, {parent_scope:SCOPE, pseudo_parent:true, to: Compiler.builder.getScopeReceiver(SCOPE)}, false, false, false, undefined, Infinity, 42 /*illegal*/, SCOPE.current_data_index);
                    params[param_name][2] = SCOPE.datex.replace(return_data.datex, "");
                    if (return_data.datex[0] == ")") {
                        SCOPE.datex = return_data.datex;
                        break;
                    } // end of parameter list
                    else if (return_data.datex[0] == "=") param_end = "=";
                    SCOPE.datex = return_data.datex.slice(1).trimStart()
                }
                
                
                if (param_end == "=") {
                    // veryyy inefficient way of doing things TODO
                    let return_data:{datex:string} = {datex: SCOPE.datex}; 
                    // ignore result - very bad
                    await this.compile(return_data, SCOPE.data, {parent_scope:SCOPE, pseudo_parent:true, to: Compiler.builder.getScopeReceiver(SCOPE)}, false, false, false, undefined, Infinity, 2, SCOPE.current_data_index);
                    params[param_name][3] = SCOPE.datex.replace(return_data.datex, "");
                    if (return_data.datex[0] == ")") {
                        SCOPE.datex = return_data.datex;
                        break;
                    } // end of parameter list
                    SCOPE.datex = return_data.datex.slice(1).trimStart();
                }

                if (param_end == ")") {
                    SCOPE.datex = ")" + SCOPE.datex; // fake )
                    break; // end of parameter list
                }
          
            }

            // remove )
            SCOPE.datex = SCOPE.datex.slice(1).replace(/^(\s*\=\>)?\s*/, ''); // trim and ignore '=>'

            let has_bracket = SCOPE.datex[0] == "(";
            if (has_bracket) SCOPE.datex = SCOPE.datex.slice(1).trimStart();

            let i = 0;

            let type_signature = '<Function((';

            let init = "scope (";
            for (let [name, [named,type,type_init,default_init,exporting]] of Object.entries(params)) {
                init += `\n${exporting?'export ':''}${type} ${name} = (#it.${i++}${default_init ? ' default '+default_init : ''});`
                type_signature += `${named?name+': ':''}${type_init},`
            }
            init += ";";

            type_signature += '),)>';

            SCOPE.datex = type_signature + init + SCOPE.datex;
        }

        // PLUGIN
        else if (m = SCOPE.datex.match(Regex.PLUGIN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const name = m[1];

            
            // plugin enabled?
            if (SCOPE.options.plugins?.includes(name) || activePlugins.includes(name) || SCOPE.options.required_plugins?.includes(name)) {
                SCOPE.unused_plugins?.delete(name);
                SCOPE.datex = `export const ${name} = (` + SCOPE.datex;
            }

            // not enabled, ignore
            else {
                // compile and ignore (required to find closing bracket)
                // TODO: optimize this, no full compilation required
                const brackets = true;
                const return_data:{datex:string} = {datex: SCOPE.datex}; 
                await this.compile(return_data, SCOPE.data, {parent_scope:SCOPE, to: Compiler.builder.getScopeReceiver(SCOPE)}, false, true, false, undefined, Infinity, brackets?1:2, SCOPE.current_data_index);

                SCOPE.datex = return_data.datex; // update position in current datex script
            }

        }

        // RUN
        else if (m = SCOPE.datex.match(Regex.RUN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.RUN, !!m[1], false, SCOPE)  
        }

        // DO
        else if (m = SCOPE.datex.match(Regex.DO)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.DO, !!m[1], false, SCOPE)  
        }

        // ASSERT
        else if (m = SCOPE.datex.match(Regex.ASSERT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.ASSERT, !!m[1], false, SCOPE)  
        }

        // RESPONSE
        else if (m = SCOPE.datex.match(Regex.RESPONSE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.RESPONSE, !!m[1], false, SCOPE)  
        }

        // DEFER
        else if (m = SCOPE.datex.match(Regex.DEFER)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            await Compiler.builder.addScopeBlock(BinaryCode.DEFER, !!m[1], false, SCOPE)     
        }

        // AWAIT
        else if (m = SCOPE.datex.match(Regex.AWAIT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            Compiler.builder.valueIndex(SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.AWAIT;  
        }

        // OR_OPERATOR
        else if (m = SCOPE.datex.match(Regex.OR_OPERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
         
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OR;  
        }

        // AND_OPERATOR
        else if (m = SCOPE.datex.match(Regex.AND_OPERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.AND;  
        }

        // NOT_OPERATOR
        else if (m = SCOPE.datex.match(Regex.NOT_OPERATOR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NOT;  
        }

        // POINTER
        else if (m = SCOPE.datex.match(Regex.POINTER)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            let [action_type, action_specifier] = Compiler.builder.getAssignAction(m[2]);

            const id = m[1].replace(/_/g, "");
            const init_brackets = !!m[3];

            // restore "("
            if (action_type!=ACTION_TYPE.INIT && init_brackets) SCOPE.datex = "(" + SCOPE.datex;

            // pre extract
            if (SCOPE.extract_pointers && action_type == ACTION_TYPE.GET) {
                // TODO handle := INIT here?
                Compiler.builder.insertExtractedVariable(SCOPE, BinaryCode.POINTER, id)
            }
            // insert normally
            else await Compiler.builder.addPointerByID(SCOPE, id, action_type, action_specifier, init_brackets)
            isEffectiveValue = true;
        }

        // var, ref, (export) val
        else if (m = SCOPE.datex.match(Regex.VAR_REF_VAL)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const exporting = !!m[1];
            const type = <"val" | "var" | "ref" | "const"> m[2];
            const name = m[3];
            const init_eternal = !!m[4];
            const init_brackets = !!m[5];

            // restore "("
            if (!init_eternal && init_brackets) SCOPE.datex = "(" + SCOPE.datex;

            if (exporting) {
                if (!SCOPE.inner_scope.exports) SCOPE.inner_scope.exports = {};
                // remember internal variable for exports
                SCOPE.inner_scope.exports[name] = await Compiler.builder.addValVarRefDeclaration(name, type, SCOPE, init_eternal, init_brackets);
            }

            else await Compiler.builder.addValVarRefDeclaration(name, type, SCOPE, init_eternal, init_brackets);
        }


        // export x
        else if (m = SCOPE.datex.match(Regex.DIRECT_EXPORT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const name = m[1];
            // TODO replace with Object.hasOwn
            if (!SCOPE.inner_scope.vars.hasOwnProperty(name)) throw new CompilerError("Cannot export undeclared variable '"+name+"'");

            if (!SCOPE.inner_scope.exports) SCOPE.inner_scope.exports = {};
            // remember internal variable index for exports
            SCOPE.inner_scope.exports[name] = SCOPE.inner_scope.vars[name][1];

        }
        

        // INTERNAL_VAR or ROOT_VARIABLE or LABELED_POINTER
        else if ((m = SCOPE.datex.match(Regex.INTERNAL_VAR)) || (m = SCOPE.datex.match(Regex.ROOT_VARIABLE)) || (m = SCOPE.datex.match(Regex.LABELED_POINTER))) {
            let v_name:string|number|undefined = m[2]; // get var name
            const is_internal = m[1] == "#"; // is internal variable (#)?
            const is_label = m[1] == "$";
            const is_hex = v_name.match(Regex.HEX_VARIABLE) && (is_internal || is_label);
            const init_brackets = !!m[4];

            // variable options
            let base_type = is_internal ? BinaryCode.INTERNAL_VAR : (is_label ? BinaryCode.LABEL : -1); // var or internal var
    
            // SCOPE.inner_scope.path_info_index == -1: is child property -> GET action
            // TODO re-enable is_property? example: 'c = count x;' is not working with this enabled!!?
            const is_property = false // (SCOPE.inner_scope.path_info_index !== -1);

            if (is_property) SCOPE.datex = SCOPE.datex.substring(m[1].length + m[2].length + m[3].length);  // pop datex (not "=" or "+=")
            else SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex (also "=" or "+=")

            const [action_type, action_specifier] = is_property ? [ACTION_TYPE.GET] : Compiler.builder.getAssignAction(m[3]);

            if (is_hex) v_name = parseInt(v_name.replace(/[-_]/g,''),16) || 0;

            // restore "("
            if (action_type!=ACTION_TYPE.INIT && init_brackets) SCOPE.datex = "(" + SCOPE.datex;

            // is a value
            if (action_type == ACTION_TYPE.GET) Compiler.builder.valueIndex(SCOPE);

            // default internal variable shorthands
            if (is_internal) {
                const mapped = typeof v_name == "string" ? Compiler.builder.mapInternalVarNameToByteCode(v_name, action_type, SCOPE) : undefined;
                if (typeof mapped == "number") {
                    base_type = mapped;
                    v_name = undefined;
                }
                // resolve internal var proxy name
                else if (typeof v_name == "string") {
                    v_name = Compiler.builder.resolveInternalProxyName(SCOPE, <string>v_name);
                }
            }

            // is var,val,ref
            if (base_type == -1) {
                await Compiler.builder.insertValVarRef(SCOPE, <string>v_name, action_type, action_specifier);
            }

            // force extract label/pointer (for transform), recursion not required
            else if (SCOPE.extract_pointers && action_type == ACTION_TYPE.GET && (base_type == BinaryCode.LABEL || base_type == BinaryCode.POINTER)) {
                Compiler.builder.insertExtractedVariable(SCOPE, base_type, v_name)
            }
            // // '->' property follows (property is handled afterwards)
            // else if (SCOPE.extract_pointers && action_type == ACTION_TYPE.GET &&  SCOPE.datex.trim().startsWith("->")) {
            //     Compiler.builder.insertExtractedVariable(SCOPE, base_type, v_name)
            // }

            // insert normally (pointer,label,internal var)
            else await Compiler.builder.insertVariable(SCOPE, v_name, action_type, action_specifier, base_type, undefined, init_brackets);
            
            isEffectiveValue = true;
        }


        // CREATE_POINTER
        else if (m = SCOPE.datex.match(Regex.CREATE_POINTER)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CREATE_POINTER;
        }

        // HEX (before UNIT)
        else if (m = SCOPE.datex.match(Regex.HEX)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addInt(parseInt(m[1].replaceAll('_',''), 16), SCOPE)
            isEffectiveValue = true;
        }

        // BIN (before UNIT)
        else if (m = SCOPE.datex.match(Regex.BIN)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addInt(parseInt(m[1].replaceAll('_',''), 2), SCOPE)
            isEffectiveValue = true;
        }

        // OCT (before UNIT)
        else if (m = SCOPE.datex.match(Regex.OCT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addInt(parseInt(m[1].replaceAll('_',''), 8), SCOPE)
            isEffectiveValue = true;
        }


        // QUANTITY (before FLOAT)
        else if (m = SCOPE.datex.match(Regex.QUANTITY)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const value = m[1];
            const unit = <unit_symbol>m[2];
            try {
                Compiler.builder.addQuantity(new Quantity(value, unit), SCOPE)
            }
            catch (e){
                if (e instanceof DatexError) e.setStack(...SCOPE.stack);
                throw e;
            }
            isEffectiveValue = true;
        }

        
        // TIME
        else if (m = SCOPE.datex.match(Regex.TIME)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            try {
                Compiler.builder.addTime(new Time(m[0]), SCOPE)
            }
            catch (e){
                if (e instanceof DatexError) e.setStack(...SCOPE.stack);
                throw e;
            }
            isEffectiveValue = true;
        }

        // FLOAT (before INT)
        else if (m = SCOPE.datex.match(Regex.FLOAT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.addFloat(parseFloat(m[0].replace(/[_ ]/g, "")), SCOPE)
            isEffectiveValue = true;
        }

        // INT   
        else if (m = SCOPE.datex.match(Regex.INT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            const intString = m[0].replace(/[_ ]/g, "");
            let int:number|bigint = parseInt(intString);
            // use bigint if int is out of range
            if (!Number.isSafeInteger(int)) int = BigInt(intString);
            Compiler.builder.addInt(int, SCOPE)
            isEffectiveValue = true;
        }


        // ASSIGN (=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_SET)) {
            if (SCOPE._code_block_type==42 && SCOPE.subscopes.length==1) { // in outer scope and single line block?
                SCOPE.end = true;
                if (last_command_end) SCOPE.last_command_end = true; // last command is still the last command
                return;
            }
            
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_SET;
        }
        
        // ASSIGN_ADD (+=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_ADD)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.ADD, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_SUBTRACT (-=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_SUB)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.SUBTRACT, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_MUTIPLY (*=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_MUTIPLY)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.MULTIPLY, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_DIVIDE (/=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_DIVIDE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.DIVIDE, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_POWER (^=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_POWER)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.POWER, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_AND (&=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_AND)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.AND, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_OR (|=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_OR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else {
                SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_ACTION;
                Compiler.builder.insertByteAtIndex(BinaryCode.OR, SCOPE.inner_scope.path_info_index+1, SCOPE); // add action specifier
            }
        }

        // ASSIGN_REFERENCE ($=)
        else if (m = SCOPE.datex.match(Regex.ASSIGN_REFERENCE)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex

            if (SCOPE.inner_scope.path_info_index == -1) throw new CompilerError("Invalid assignment", SCOPE.stack);
            else SCOPE.uint8[SCOPE.inner_scope.path_info_index] = BinaryCode.CHILD_SET_REFERENCE;
        }

        // INCREMENT
        else if (m = SCOPE.datex.match(Regex.INCREMENT)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.datex = "+=1" + SCOPE.datex;
            // TODO
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.INCREMENT;  
        }

        // DECREMENT
        else if (m = SCOPE.datex.match(Regex.DECREMENT)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            // TODO
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DECREMENT;  
        }

        // ADD
        else if (m = SCOPE.datex.match(Regex.ADD)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.ADD;  
        }

        // SUBTRACT
        else if (m = SCOPE.datex.match(Regex.SUBTRACT)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBTRACT;  
        }

        // MULTIPLY
        else if (m = SCOPE.datex.match(Regex.MULTIPLY)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.MULTIPLY;  
        }

        // POWER ^
        else if (m = SCOPE.datex.match(Regex.POWER)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.POWER;  
        }

        // MODULO ^
        else if (m = SCOPE.datex.match(Regex.MODULO)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.MODULO;  
        }

        // DIVIDE
        else if (m = SCOPE.datex.match(Regex.DIVIDE)) {               
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.DIVIDE;  
        }
    
        // OR
        else if (m = SCOPE.datex.match(Regex.OR)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
         
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.OR;  
        }

        // AND
        else if (m = SCOPE.datex.match(Regex.AND)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.AND;  
        }

        // NOT
        else if (m = SCOPE.datex.match(Regex.NOT)) {
            SCOPE.datex = SCOPE.datex.substring(m[0].length);  // pop datex
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NOT;  
        }

       

        else {
            throw new SyntaxError("Invalid token on line "+SCOPE.current_line_nr+" near '" + SCOPE.datex.split("\n")[0] + "'");
        }

        // immediate +/- operation possible
        if (isEffectiveValue) Compiler.builder.tryPlusOrMinus(SCOPE);


        // after inserted last value for value_count
        if (!SCOPE.inner_scope?.value_count) {

            let end_index:number;

            if ('iterate' in SCOPE.inner_scope) {
                // insert initialisation
                if (SCOPE.inner_scope.iterate == 0) {
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;  
                    SCOPE.inner_scope.loop_start = SCOPE.b_index;

                    // ... jtr loop_start (next #i);
                    SCOPE.inner_scope.jfa_index = SCOPE.b_index+1;
                    Compiler.builder.addJmp(SCOPE,  BinaryCode.JFA);

                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_START;
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.NEXT;
                    Compiler.builder.insertVariable(SCOPE, 'i', ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;  

                    // // #it = #iter->val;
                    // Compiler.builder.insertVariable(SCOPE, 'it', ACTION_TYPE.SET, undefined, BinaryCode.INTERNAL_VAR);
                    // Compiler.builder.handleRequiredBufferSize(SCOPE.b_index+1, SCOPE);
                    // Compiler.builder.insertVariable(SCOPE, 'i', ACTION_TYPE.GET, undefined, BinaryCode.INTERNAL_VAR);
                    // SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CHILD_GET;
                    // Compiler.builder.addString('val', SCOPE);
                    // SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE;  

                    // now wait for iterate block
                    SCOPE.inner_scope.iterate = 1;
                    SCOPE.inner_scope.value_count = 1;
                }
                // next() + jump instrution at the end
                else {
                    // jmp to start
                    Compiler.builder.addJmp(SCOPE, BinaryCode.JMP, SCOPE.inner_scope.loop_start)

                    // insert end index for jfa end
                    SCOPE.data_view.setUint32(SCOPE.inner_scope.jfa_index, SCOPE.b_index, true);
                    
                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
                            
                    delete SCOPE.inner_scope.loop_start;
                    delete SCOPE.inner_scope.iterate;
                }
                
            }

            else if ('while' in SCOPE.inner_scope) {
                // jmp start
                Compiler.builder.addJmp(SCOPE, BinaryCode.JMP, SCOPE.inner_scope.loop_start)

                // insert end index for jfa end
                SCOPE.data_view.setUint32(SCOPE.inner_scope.loop_start+1, SCOPE.b_index, true);

                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;

                delete SCOPE.inner_scope.loop_start;
                delete SCOPE.inner_scope.while;
            }
            else if ('if' in SCOPE.inner_scope) {

                // add if_end_indices
                if (!SCOPE.inner_scope.if_end_indices) SCOPE.inner_scope.if_end_indices = [];
                SCOPE.inner_scope.if_end_indices.push(SCOPE.b_index+1);
                
                // jmp start
                Compiler.builder.addJmp(SCOPE, BinaryCode.JMP)

                // insert end index for jfa end -> jump to next else (if) or end
                SCOPE.data_view.setUint32(SCOPE.inner_scope.if+1, SCOPE.b_index, true);
                end_index = SCOPE.b_index; // set end_index to before SUBSCOPE_END

                Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END; // assume already end of 'if'-subscope - might be overidden
            }

            // update end index for all current if/else clauses
            if ('else' in SCOPE.inner_scope || 'if' in SCOPE.inner_scope) {
                // set end index for all previous ifs/else ifs
                end_index = end_index ?? SCOPE.b_index;
                for (let index of SCOPE.inner_scope.if_end_indices??[]) {
                    SCOPE.data_view.setUint32(index, end_index, true);
                }

                // handle only 'else'
                if ('else' in SCOPE.inner_scope) {
                    delete SCOPE.inner_scope.if_end_indices;
                    delete SCOPE.inner_scope.else;

                    // definitly end of 'if'-subscope
                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.SUBSCOPE_END;
                }
                // delete 'if'
                else delete SCOPE.inner_scope.if;
            
            }

            // reset value_count
            delete SCOPE.inner_scope.value_count;
        }


        // handle function scope block
        if (SCOPE.inner_scope.function != null && SCOPE.b_index != SCOPE.inner_scope.function) {
            // block with brackets ?
            let has_brackets = false;
            SCOPE.datex = SCOPE.datex.replace(/^[^\S\n]+/, ""); //(/^[^\S\r\n]+/
            if (SCOPE.datex[0] == "(") {
                has_brackets = true;
                SCOPE.datex = SCOPE.datex.slice(1);
            }
            await Compiler.builder.addScopeBlock(BinaryCode.FUNCTION, has_brackets, false, SCOPE);
            SCOPE.inner_scope.function = null;
        }
    }

    static async createBlockFromScope(SCOPE:compiler_scope):Promise<ArrayBuffer> {

        return SCOPE.add_header ? await this.appendHeader(
            SCOPE.buffer,
            SCOPE.options.end_of_scope,
            SCOPE.options.from, //sender
            SCOPE.options.to, // to
            SCOPE.options.flood, // flood
            SCOPE.options.type, // type
            SCOPE.options.sign, 
            SCOPE.options.encrypt, // encrypt
            SCOPE.options.send_sym_encrypt_key,
            SCOPE.options.sym_encrypt_key, // encryption key
            SCOPE.options.allow_execute, // allow execute

            SCOPE.options.sid,
            SCOPE.options.return_index,
            SCOPE.options.inc,

            SCOPE.options.force_id,

            SCOPE.options.__routing_ttl,
            SCOPE.options.__routing_prio,
            SCOPE.options.__routing_to,

            SCOPE.receiver_buffer,
            SCOPE.sender_buffer,
            SCOPE.pre_header_size,
            SCOPE.signed_header_size,
            SCOPE.full_dxb_size
        ) : SCOPE.buffer;
    }


    // compile loop
    static async compileLoop(SCOPE:compiler_scope):Promise<ArrayBuffer|ReadableStream<ArrayBuffer>>  {

        const body_compile_measure = RuntimePerformance.enabled ? RuntimePerformance.startMeasure("compile time", "body") : undefined;

        if (!SCOPE.datex) SCOPE.datex = ";";//throw new CompilerError("DATEX Script is empty");

        // iterate over all tokens / commands, stop if end not reached after 1000 tokens
        for (let i=0;i<500_000;i++) {            
            await this.parseNextExpression(SCOPE); // parse and update index in binary

            // streaming, generate multiple blocks as ReadableStream
            if (SCOPE.streaming) {

                const _end_of_scope = SCOPE.options.end_of_scope;
                
                SCOPE.buffer = SCOPE.buffer.slice(0, SCOPE.b_index);  // slice until current index
                return new ReadableStream<ArrayBuffer>({
                    async start(controller:ReadableStreamDefaultController<ArrayBuffer>) {
                        SCOPE.options.end_of_scope = false;

                        // first part of scope until the stream starts
                        controller.enqueue(await Compiler.createBlockFromScope(SCOPE));
                       
                        
                        // read stream and insert
                        const reader = SCOPE.streaming!;
                        let next:ReadableStreamReadResult<any>,
                            value: any;
                        while (true) {
                            next = await reader.read()
                            if (next.done) break;
                            value = next.value;
                                                
                            // optimized: create array buffer dxb
                            if (value instanceof ArrayBuffer || value instanceof TypedArray) {
                                SCOPE.buffer = new ArrayBuffer(value.byteLength+1+Uint32Array.BYTES_PER_ELEMENT);
                                SCOPE.uint8 = new Uint8Array(SCOPE.buffer);
                                SCOPE.data_view = new DataView(SCOPE.buffer);
                                SCOPE.uint8[0] = BinaryCode.BUFFER;
                                SCOPE.data_view.setUint32(1, value.byteLength, true);   // buffer length
                                SCOPE.uint8.set(value instanceof Uint8Array ? value : new Uint8Array(value), 1+Uint32Array.BYTES_PER_ELEMENT);
                            }
                            // insert another value
                            else SCOPE.buffer = Compiler.compileValue(value, {}, false);

                            controller.enqueue(await Compiler.createBlockFromScope(SCOPE));
                        }

                        // continue after stream, reset SCOPE to previous state
                        // TODO not working properly with jumps, buffers and indices are reset
                        SCOPE.b_index = 0;
                        SCOPE.buffer = new ArrayBuffer(400);
                        SCOPE.uint8 = new Uint8Array(SCOPE.buffer);
                        SCOPE.data_view = new DataView(SCOPE.buffer);
                        SCOPE.options.end_of_scope = _end_of_scope;
                        SCOPE.streaming = null;

                        let res = await Compiler.compileLoop(SCOPE);

                        // is single block
                        if (res instanceof ArrayBuffer) {
                            if (SCOPE.options.end_of_scope) controller.enqueue(new ArrayBuffer(0)); // indicate last block following
                            controller.enqueue(res);
                        }
                        // is another stream of blocks
                        else {
                            const reader = res.getReader();
                            let next:ReadableStreamReadResult<ArrayBuffer>;
                            while (true) {
                                next = await reader.read()
                                if (next.done) break;
                                controller.enqueue(next.value);
                            }
                        }

                        controller.close();
                    }
                })
            }

            // end of scope reached
            if (SCOPE.end || !SCOPE.datex) { 

                // check for required plugins
                if (SCOPE.unused_plugins?.size) {
                    const ext = [...SCOPE.unused_plugins];
                    if (SCOPE.unused_plugins.size == 1) throw new CompilerError(`Plugin "${ext[0]}" is required, but not found in script`);
                    else throw new CompilerError(`Plugins "${ext.join(",")}" are required, but not found in script`);
                }

                // check for missing object brackets
                for (const scope of SCOPE.subscopes) {
                    if (scope.parent_type == BinaryCode.OBJECT_START) {
                        console.warn(SCOPE.datex)
                        throw new SyntaxError("Missing closing object bracket");
                    }
                    if (scope.parent_type == BinaryCode.ARRAY_START) throw new SyntaxError("Missing closing array bracket");
                    if (scope.parent_type == BinaryCode.SUBSCOPE_START) throw new SyntaxError("Missing closing bracket");
                }

                if (Object.keys(SCOPE.indices_waiting_for_jmp_lbl).length) {
                    throw new CompilerError("Jump to non-existing lbl: " + Object.keys(SCOPE.indices_waiting_for_jmp_lbl), SCOPE.stack);
                }

                if (SCOPE.return_data) SCOPE.return_data.datex = SCOPE.datex;

                // add ; if missing (only if end of scope)
                if (SCOPE.options.end_of_scope!==false && !SCOPE.last_command_end) {
                    // auto-close subscopes here?
                    while (SCOPE.inner_scope?.auto_close_scope!=undefined) {
                        const type = SCOPE.inner_scope.auto_close_scope;
                        delete SCOPE.inner_scope.auto_close_scope;
                        Compiler.builder.exit_subscope(SCOPE, type);
                    }

                    Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
                    SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE; 
                }

                
                // insert preemptive pointer inits
                // console.log("PRREMITVE",SCOPE.preemptive_pointers)
                // if (SCOPE.preemptive_pointers.size) {
                //     for (const id of SCOPE.preemptive_pointers) {
                //         const ptr = Pointer.get(id);
                //         if (ptr) {
                //             await Compiler.builder.addPointerByID(SCOPE, id, ACTION_TYPE.INIT, undefined, true, ptr.val);
                //         }
                //         // otherwise pointer was not yet initialized, cannot be loaded preemptively
                //     }
                // }
                
                // exports tuple
                if (SCOPE.inner_scope.exports) Compiler.builder.insert_exports(SCOPE);

                SCOPE.buffer = SCOPE.buffer.slice(0, SCOPE.b_index);  // slice until current index (remove 0s at the end)

                // insert buffer for compile time insertions at top
                if (SCOPE.options.insert_header && SCOPE.is_outer_insert) {
                    SCOPE.options.insert_header.buffer = SCOPE.options.insert_header.buffer.slice(0, SCOPE.options.insert_header.index);  // slice until current index (remove 0s at the end)
                    SCOPE.buffer = Compiler.combineBuffers(SCOPE.options.insert_header.buffer, SCOPE.buffer);
                }

                // prefix extract_var_scope? -> scope block
                /*
                    var1 var2 var3 BinaryCode.SCOPE_BLOCK [SCOPE.buffer.byteLength] [SCOPE.buffer]
                */
                if (SCOPE.extract_var_scope) {
                    SCOPE.extract_var_scope.uint8[SCOPE.extract_var_scope.b_index++] = BinaryCode.SCOPE_BLOCK;
                    SCOPE.extract_var_scope.data_view.setUint32(SCOPE.extract_var_scope.b_index, SCOPE.buffer.byteLength, true);
                    SCOPE.extract_var_scope.b_index += Uint32Array.BYTES_PER_ELEMENT;

                    SCOPE.extract_var_scope.buffer = SCOPE.extract_var_scope.buffer.slice(0, SCOPE.extract_var_scope.b_index);  // slice until current index (remove 0s at the end)
                    SCOPE.buffer = Compiler.combineBuffers(SCOPE.extract_var_scope.buffer, SCOPE.buffer);
                }

                if (SCOPE.precompiled) {
                    // add last buffer part to precompiled dxb if available
                    SCOPE.precompiled.appendBufferPlaceholder(SCOPE.last_precompiled??0,SCOPE.b_index);
                    // now insert actual buffer data
                    SCOPE.precompiled.autoInsertBuffer(SCOPE.buffer);
                }

                // check if max block size exceeded -> return ReadableStream with multiple blocks (only if full block with header)
                if (SCOPE.add_header && (await this.getScopeBlockSize(SCOPE) >= SCOPE.max_block_size??Compiler.MAX_DXB_BLOCK_SIZE)) {
                    const original_buffer = SCOPE.buffer;
                    const total_header_size = SCOPE.pre_header_size + SCOPE.signed_header_size;
                    const max_body_size = SCOPE.max_block_size - total_header_size;
                    console.log("block too big ("+await this.getScopeBlockSize(SCOPE)+" bytes), splitting into parts with body size " + max_body_size)
                    let split_index = 0;
                    // return ReadableStream (could actually just be an array of ArrayBuffers, since all buffers are already known, but ReadableStream is needed anyways)
                    return new ReadableStream<ArrayBuffer>({
                        async start(controller:ReadableStreamDefaultController<ArrayBuffer>) {
                            let last_block = false;
                            // add block by block
                            while (!last_block) {
                                SCOPE.buffer = original_buffer.slice(split_index, split_index + max_body_size);
                                split_index += max_body_size
                                SCOPE.full_dxb_size = total_header_size + SCOPE.buffer.byteLength; // update full_dxb_size to new shortened size 
                                last_block = split_index>=original_buffer.byteLength;
                                SCOPE.options.end_of_scope = last_block // set EOS to true if no more blocks coming, else false
                                const block = await Compiler.createBlockFromScope(SCOPE);
                                if (last_block) controller.enqueue(new ArrayBuffer(0)); // indicate last block following
                                controller.enqueue(block);
                            }

                            controller.close();
                        }
                    })
                    
                }

                // return a single block (or split into multiple blocks if too big)
                else {
                    if (RuntimePerformance.enabled) RuntimePerformance.endMeasure(body_compile_measure); // compile time for a single block (dxb body) can be measure here
                    return Compiler.createBlockFromScope(SCOPE);
                }

            } // end reached
        }

        // end not reached after 500_000 iterations
        throw new SyntaxError("DATEX Script to big to compile");
    }



    /** create compiled dxb (stored as a string) from any value */
    static valueToBase64DXB(value:any, inserted_ptrs?:Set<Pointer>):string {
        const dxb = Compiler.compileValue(value, {inserted_ptrs})
        return arrayBufferToBase64(dxb);
    }

    /** create compiled dxb (stored as a string) from a DATEX Script string */
    static async datexScriptToBase64DXB(dx:string, type = ProtocolDataType.DATA, data = [], options:compiler_options={}):Promise<string> {
        const dxb = <ArrayBuffer> await Compiler.compile(dx, data, {sign:false, encrypt: false, type, ...options})
        return arrayBufferToBase64(dxb);
    }

    /**
     * Compile a DATEX Script to a DXB or DX file
     * The file is saved in storage if runnning on deno, and downloaded if running in a browser
     * @param script_or_url script or path to script file
     * @param output_name_or_path full output file path as url (only works with deno) or file name (extension is optional and automatically inferred by default)
     * @param file_type export file type (dx or dxb)
     * @param type export file protocol type (only relevant for DATEX Binary file export)
     * @param data insert data for script
     */
    static async compileAndExport(script_or_url:string|URL, output_name_or_path?:string|URL, file_type: DATEX_FILE_TYPE = FILE_TYPE.DATEX_BINARY, type = ProtocolDataType.DATA, data = []) {
        // compile
        const blob = await this.compileToFile(script_or_url, file_type, type, data);
        // export
        return this.export(blob, output_name_or_path, file_type, script_or_url instanceof URL ? script_or_url : undefined)
    }

    static async exportValue(value: any, output_name_or_path?:string|URL, file_type: DATEX_FILE_TYPE = FILE_TYPE.DATEX_BINARY, collapse_pointers = true, collapse_first_inserted = true, keep_external_pointers = true) {
        // compile value
        const buffer = await this.compile("?", [value], {collapse_pointers, collapse_first_inserted, keep_external_pointers, no_create_pointers: false}) as ArrayBuffer;

        if (file_type[0] == "application/datex") {
            // export
            return this.export(buffer, output_name_or_path, file_type)
        }
        else {
            return this.export(MessageLogger.decompile(buffer, true, false), output_name_or_path, file_type)
        }

    }

    protected static async export(dxb_or_datex_script:Blob|ArrayBuffer|string, output_name_or_path?:string|URL, file_type: DATEX_FILE_TYPE = FILE_TYPE.DATEX_BINARY, original_url?:URL) {
        // compile
        const blob = dxb_or_datex_script instanceof Blob ? dxb_or_datex_script : new Blob([dxb_or_datex_script], {type:file_type[0]});

        // export
        if (client_type == "deno") {
            let export_path:URL;
            // export url
            if (output_name_or_path instanceof URL) export_path = output_name_or_path;
            // auto infer export url from import url
            else if (original_url instanceof URL) {
                let name:string
                // name provided
                if (typeof output_name_or_path == "string") name = output_name_or_path;
                // default filename (remove extension from current url path)
                else name = original_url.pathname.split('/').pop()!.split('.').slice(0, -1).join('.');

                // normalize file name
                name = this.normalizeFileName(name, file_type);

                export_path = new URL(name, original_url);
            }
            // cannot find a url
            else throw new CompilerError("Cannot export file - import or export URL required");

            logger.success("exporting to " + export_path);

            await this.saveFile(blob, export_path)
        }
        else {
            let name:string
            // use filename if url provided
            if (output_name_or_path instanceof URL) name = output_name_or_path.pathname.split('/').pop()!;
            else if (output_name_or_path) {
                name = output_name_or_path;
            }
            // default filename
            else {
                const date = new Date();
                const timestamp = `${date.getFullYear()}_${date.getMonth()+1}_${date.getDate()}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}${date.getSeconds().toString().padStart(2,'0')}`
                name = `datex_script_${timestamp}`;
            }

            // normalize file name
            name = this.normalizeFileName(name, file_type);

            logger.success("downloading " + name);

            this.downloadFile(blob, name);
        }
    }

    private static normalizeFileName(name: string, file_type: DATEX_FILE_TYPE){
        if (!name.includes(".")) name += "." + file_type[1];  // auto add file extension

        const extension = name.split(".").pop()!;
        if (
            extension != file_type[1] && !(extension.startsWith("json") && file_type[1] == "dx") // exception: json  TODO: valid JSON output (JSON5 should be valid)
        ) 
            throw new CompilerError(`Output file extension ".${extension}" does not match output file type ".${file_type[1]}"`);
        return name;
    }

    /**
     * Compile a DATEX Script to a DXB or DX file blob
     * @param script_or_url Path to DATEX Script file or DATEX Script text
     * @param file_type export file type (dx or dxb)
     * @param type export file protocol type (only relevant for DATEX Binary file export)
     * @param data insert data for script
     * @returns Blob with compiled file
     */
    static async compileToFile(script_or_url:string|URL, file_type: DATEX_FILE_TYPE = FILE_TYPE.DATEX_BINARY, type = ProtocolDataType.DATA, data = []):Promise<Blob> {

        let script:string;
       
        // DATEX Script as string
        if (typeof script_or_url == "string") script = script_or_url;
        // Fetch Script from URL
        else {
            const [data, type] = await Runtime.getURLContent(script_or_url, true, false);
            // only DATEX Script and JSON allowed
            if (!(type?.startsWith("text/datex") || type?.startsWith("application/json") || script_or_url.toString().endsWith(".dx") || script_or_url.toString().endsWith(".json"))) throw new CompilerError("Invalid file type: Only DATEX Script and JSON files can be compiled");
            script = <string> data;

        }
        const context_location = (script_or_url instanceof URL) ? script_or_url : undefined;

        if (file_type[0] == "application/datex") {
            const dxb = <ArrayBuffer> await Compiler.compile(script, data, {sign:false, encrypt: false, type, context_location});
            return new Blob([dxb], {type: file_type[0]});
        }
        else if (file_type[0] == "text/datex") {
            const dxb_no_header = <ArrayBuffer> await Compiler.compile(script, data, {sign:false, encrypt: false, type, context_location}, false);
            return new Blob([wasm_decompile(new Uint8Array(dxb_no_header), true, false, false)], {type: file_type[0]});
        }
        else throw new CompilerError("Invalid DATEX File type");
    }

    /**
     * Download a blob file (only works in browsers)
     * @param file file as blob
     * @param file_name File name
     */
    private static downloadFile(file:Blob, file_name:string) {
        const a = document.createElement("a");
        const url = URL.createObjectURL(file);
        a.href = url;
        a.download = file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    /**
     * Save a file in storage (only works on deno)
     * @param file File name
     * @param file_path path where the file should be stored
     */
     private static async saveFile(file:Blob, file_path:string|URL) {
        return await Deno.writeFile(normalizePath(file_path), new Uint8Array(await file.arrayBuffer()));
    }


    /** create a dxb file created from a DATEX Script string and convert to data url */
    static async datexScriptToDataURL(dx:string, type = ProtocolDataType.DATA):Promise<string> {
        let dxb = <ArrayBuffer> await Compiler.compile(dx, [], {sign:false, encrypt: false, type})

        let blob = new Blob([dxb], {type: "text/dxb"}); // workaround to prevent download

        return new Promise(resolve=>{
            var a = new FileReader();
            a.onload = function(e) {resolve(<string>e.target.result);}
            a.readAsDataURL(blob);
        });
    }

    /** create a dxb file created from a DATEX Script string and convert to object url */
    static async datexScriptToObjectURL(dx:string, type = ProtocolDataType.DATA):Promise<string> {
        let dxb = <ArrayBuffer> await Compiler.compile(dx, [], {sign:false, encrypt: false, type})

        let blob = new Blob([dxb], {type: "text/dxb"}); // workaround to prevent download
        return URL.createObjectURL(blob);
    }

    /** does not create a full DXB block, only a buffer containing a dxb encoded value */
    static encodeValue(value:any, inserted_ptrs?:Set<Pointer>, add_command_end = true, deep_clone = false, collapse_first_inserted = false, no_create_pointers = false, keep_first_transform = true, collapse_injected_pointers = false, no_duplicate_value_optimization = false):ArrayBuffer {
        // add_command_end -> end_of_scope -> add ; at the end
        return this.compileValue(value, {inserted_ptrs, collapse_pointers:deep_clone, collapse_injected_pointers:collapse_injected_pointers, collapse_first_inserted:collapse_first_inserted, no_create_pointers:no_create_pointers, keep_first_transform:keep_first_transform, no_duplicate_value_optimization}, add_command_end)
    }

    /** also adds preemptive pointers */
    static encodeValueAsync(value:any, inserted_ptrs?:Set<Pointer>, add_command_end = true, deep_clone = false, collapse_first_inserted = false, no_create_pointers = false, keep_first_transform = true, collapse_injected_pointers = false, no_duplicate_value_optimization = false):ArrayBuffer {
        // add_command_end -> end_of_scope -> add ; at the end
        return this.compileValue(value, {preemptive_pointer_init: true, inserted_ptrs, collapse_pointers:deep_clone, collapse_injected_pointers:collapse_injected_pointers, collapse_first_inserted:collapse_first_inserted, no_create_pointers:no_create_pointers, keep_first_transform:keep_first_transform, no_duplicate_value_optimization}, add_command_end)
    }

    static encodeValueBase64(value:any, inserted_ptrs?:Set<Pointer>, add_command_end = true, deep_clone = false, collapse_first_inserted = false, no_create_pointers = false, keep_first_transform = true, collapse_injected_pointers = false):string {
        return arrayBufferToBase64(this.encodeValue(value, inserted_ptrs, add_command_end, deep_clone, collapse_first_inserted, no_create_pointers, keep_first_transform, collapse_injected_pointers));
    }

    /** also adds preemptive pointers */
    static async encodeValueBase64Async(value:any, inserted_ptrs?:Set<Pointer>, add_command_end = true, deep_clone = false, collapse_first_inserted = false, no_create_pointers = false, keep_first_transform = true, collapse_injected_pointers = false):string {
        return arrayBufferToBase64(await this.encodeValueAsync(value, inserted_ptrs, add_command_end, deep_clone, collapse_first_inserted, no_create_pointers, keep_first_transform, collapse_injected_pointers));
    }

    // creates a unique hash for a given value
    static getValueHash(value:any):Promise<ArrayBuffer> {
        return crypto.subtle.digest('SHA-256', Compiler.encodeValue(value, undefined, true, true, true, true));
    }

    static async getValueHashString(value:any):Promise<string> {
        return arrayBufferToBase64(await Compiler.getValueHash(value))
    }

    /**
     * returns pointer id for pointer values, hash for primitive values
     * @param value
     * @returns 
     */
    static getUniqueValueIdentifier(value:any): Promise<string>|string {
        // value is pointer - get id
        if (value instanceof Pointer) return value.idString();
        const ptr = Pointer.getByValue(value);
        if (ptr) return ptr.idString();
        // get value hash
        else return this.getValueHashString(value);
    }

    // same as compile, but accepts a precompiled dxb array instead of a Datex Script string -> faster compilation
    static compilePrecompiled(precompiled:PrecompiledDXB, data:any[] = [], options:compiler_options={}, add_header=true):Promise<ArrayBuffer>|ArrayBuffer {
        
        // get / compile all array buffers
        const buffers:ArrayBuffer[] = [];
        const compiled_cache = new Map<any,ArrayBuffer>();
        let buffer: ArrayBuffer;
        let total_size = 0;

        for (const part of precompiled) {
            if (part instanceof ArrayBuffer) buffer = part;
            else if (part instanceof Array) throw new Error("Invalid precompiled dxb");
            else if (part in data) {
                // already compiled, in cache
                if (compiled_cache.has(data[part])) buffer = compiled_cache.get(data[part])!;
                // compile value
                else compiled_cache.set(data[part], buffer = Compiler.compileValue(data[part], options, false));
            }
            else throw new CompilerError("Missing data value for precompiled dxb");

            buffers.push(buffer);
            total_size += buffer.byteLength;
        }

        // combine array buffers
        let i = 0;
        const finalBuffer = new ArrayBuffer(total_size);
        const finalBufferView = new Uint8Array(finalBuffer);

        for (const buffer of buffers) {
            finalBufferView.set(new Uint8Array(buffer), i);
            i += buffer.byteLength;
        }

        // console.log(MessageLogger.decompile(finalBuffer, false))

        // no header
        if (!add_header) return finalBuffer;

        // add header
        return Compiler.appendHeader(
            finalBuffer,
            options.end_of_scope,
            options.force_id ? (options.from??Runtime.endpoint) : options.from, //sender
            options.to, // to
            options.flood, // flood
            options.type, // type
            options.sign, 
            options.encrypt, // encrypt
            options.send_sym_encrypt_key,
            options.sym_encrypt_key, // encryption key
            options.allow_execute, // allow execute

            options.sid,
            options.return_index,
            options.inc,

            options.force_id,

            options.__routing_ttl,
            options.__routing_prio,
            options.__routing_to
        ) 

    }

    // force disable encryption + signatures for all blocks (e.g. when using a crypto proxy)
    static DISABLE_CRYPTO = false;

    /** compiles datex code to binary + adds  data (binary, strings, intergers,...) if provided */
    static compile(datex:string|{datex:string}|PrecompiledDXB, data:any[] = [], options:compiler_options={}, add_header=true, is_child_scope_block = false, extract_pointers = false, save_precompiled?:PrecompiledDXB, max_block_size?:number, _code_block_type?:0|1|2|42, _current_data_index=0): Promise<ArrayBuffer|ReadableStream<ArrayBuffer>>|ArrayBuffer {

        if (this.DISABLE_CRYPTO) {
            options.encrypt = false;
            options.sign = false;
        }

        // _datex is precompiled dxb
        if (datex instanceof PrecompiledDXB) {
            return Compiler.compilePrecompiled(datex, data, options, add_header);
        }

        // do optimized synchronous single value compilation
        if (datex === '?' && !add_header) {
            return Compiler.compileValue(data[0], options);
        }

        // replace insert marks with explicitly inserted (?) - also works inside strings
        if (typeof datex == "string") datex = datex.replaceAll(INSERT_MARK, '(?)');
        // @ts-ignore
        else if (typeof datex?.datex == "string") datex.datex = datex.datex.replaceAll(INSERT_MARK, '(?)');

        const SCOPE = this.createCompilerScope(datex, data, options, add_header, is_child_scope_block, extract_pointers, save_precompiled, max_block_size, _code_block_type, _current_data_index);

        return SCOPE.options.__v2 ? base64ToArrayBuffer(btoa(wasm_compile(SCOPE.datex))) : Compiler.compileLoop(SCOPE);
    }


    static createCompilerScope(datex:string|{datex:string}, data:any[] = [], options:compiler_options={}, add_header=true, is_child_scope_block = false, extract_pointers = false, save_precompiled?:PrecompiledDXB, max_block_size?:number, _code_block_type?:0|1|2|42, _current_data_index=0):compiler_scope{
        
        const stack = [Compiler.getBaseStack(options.context_location)];
        
        // get datex as string
        let return_data:{datex:string};
        if (typeof datex == "object" && datex) {
            return_data = datex;
            datex = datex.datex;
        }
        if (typeof datex != "string") throw new CompilerError("'datex' must be a string or a precompiled dxb", stack);

        // remove shebang
        datex = datex.replace(/^#!.*/,'');

        if (save_precompiled) save_precompiled.datex = datex;

        //globalThis.performance?.mark("compile_start");

        if (options.encrypt && !options.sym_encrypt_key) throw new CompilerError("Cannot encrypt without a symmetric encryption key", stack);


        // init scope - state variables
        const SCOPE:compiler_scope = {
            datex: datex,

            return_data: return_data,

            data: data,
            options: options,

            stack: stack,

            inserted_values: new Map(),

            jmp_label_indices: {},
            preemptive_pointers: new Map(),
            indices_waiting_for_jmp_lbl: {},
            assignment_end_indices: new Set(),
            used_lbls: [],
            
            jmp_indices: [],

            add_header: add_header,
            is_child_scope_block: is_child_scope_block,
            extract_pointers: extract_pointers,
            precompiled: save_precompiled,

            max_block_size: max_block_size, // might be bigger than MAX_BLOCK_SIZE

            buffer: new ArrayBuffer(400),
            uint8: null,
            data_view: null,

            b_index: 0,

            internal_var_index: 0,
            internal_vars: new WeakMap(),
            internal_primitive_vars: new Map(),

            serialized_values: new WeakMap(),
            dynamic_indices: [],

            current_data_index: _current_data_index,

            current_line_nr: 1,
            end: false,

            subscopes: [{
                start_index: -1, // has no brackets
                last_value_index: -1,  // byte index of last, pointer, var, object, ...
                wait_for_add: false,
                in_template_string: false,
                path_info_index: -1,
                vars: {}
            }],
            inner_scope: null,

            _code_block_type: _code_block_type
        };

        // keep track of used extensions
        if (SCOPE.options.required_plugins?.length) SCOPE.unused_plugins = new Set(SCOPE.options.required_plugins);

        if (!SCOPE.options.insert_header) {
            SCOPE.options.insert_header = {
                buffer: new ArrayBuffer(100),
                index: 0,
                cache: new Map(),
                vars: SCOPE.subscopes[0].vars,
                var_index: 0x0300,
                root_scope: SCOPE
            }
            SCOPE.is_outer_insert = true; // if true, add insert header to current compiled dxb
        }

        if (is_child_scope_block) {
            SCOPE.extract_var_index = 0;
            SCOPE.extract_var_indices = new Map();
            SCOPE.extract_var_scope = <extract_var_scope>{
                _is_extract_var_scope: true,
                b_index: 0,
                buffer: new ArrayBuffer(400),
                inner_scope: {},
                dynamic_indices: [],
                inserted_values: new Map(),
                preemptive_pointers: new Map(),
                assignment_end_indices: new Set(),
                options: {}
            }
            SCOPE.extract_var_scope.uint8 = new Uint8Array(SCOPE.extract_var_scope.buffer);
            SCOPE.extract_var_scope.data_view = new DataView(SCOPE.extract_var_scope.buffer);
            SCOPE.extract_var_indices.set(BinaryCode.LABEL, new Map());
            SCOPE.extract_var_indices.set(BinaryCode.POINTER, new Map());
            SCOPE.extract_var_indices.set(BinaryCode.INTERNAL_VAR, new Map()); // for parent internal var references
        }

        SCOPE.inner_scope = SCOPE.subscopes[0];
        SCOPE.uint8 = new Uint8Array(SCOPE.buffer);
        SCOPE.data_view = new DataView(SCOPE.buffer);

        return SCOPE;
    }

    // reset everything to compile a new datex snippet within the same compiler scope
    static resetScope(SCOPE:compiler_scope, datex:string|{datex:string}, _code_block_type?:0|1|2|42) {
        // get datex as string
        let return_data:{datex:string}|undefined;
        if (typeof datex == "object" && datex) {
            return_data = datex;
            datex = datex.datex;
        }
        if (typeof datex != "string") throw new CompilerError("'datex' must be a string or a precompiled dxb", SCOPE.stack);

        SCOPE.b_index = 0;
        SCOPE.datex = datex;
        SCOPE.return_data = return_data;
        SCOPE.end = false;
        SCOPE._code_block_type = _code_block_type;

        SCOPE.buffer = new ArrayBuffer(400);
        SCOPE.uint8 = new Uint8Array(SCOPE.buffer);
        SCOPE.data_view = new DataView(SCOPE.buffer);
    }



    /** optimized compiler for single value encoding (no header), synchronous! */
    static compileValue(value:any, options:compiler_options = {}, add_command_end = true):ArrayBuffer{

        if (options.preemptive_pointer_init != true) options.preemptive_pointer_init = false; // default is false

        const SCOPE:compiler_scope = {
            options: options,

            inserted_values: new Map(),

            jmp_label_indices: {},
            preemptive_pointers: new Map(),
            indices_waiting_for_jmp_lbl: {},
            assignment_end_indices: new Set(),
            used_lbls: [],
            
            stack: [Compiler.getBaseStack(options.context_location)],

            jmp_indices: [],

            is_child_scope_block: false,
            add_header: false,

            buffer: new ArrayBuffer(500),
            uint8: null,
            data_view: null,

            b_index: 0,

            internal_var_index: 0,
            internal_vars: new WeakMap(),
            internal_primitive_vars: new Map(),

            serialized_values: new WeakMap(),
            dynamic_indices: [],

            current_line_nr: 1,
            end: false,

            subscopes: [{
                start_index: -1, // has no brackets
                last_value_index: -1,  // byte index of last, pointer, var, object, ...
                wait_for_add: false,
                in_template_string: false,
                path_info_index: -1
            }],
            inner_scope: null
        };

        SCOPE.inner_scope = SCOPE.subscopes[0];
        SCOPE.uint8 = new Uint8Array(SCOPE.buffer);
        SCOPE.data_view = new DataView(SCOPE.buffer);

        // insert value
        Compiler.builder.insert(value, SCOPE);

        // ;
        if (add_command_end) {
            Compiler.builder.handleRequiredBufferSize(SCOPE.b_index, SCOPE);
            SCOPE.uint8[SCOPE.b_index++] = BinaryCode.CLOSE_AND_STORE; 
        }

        // slice until current index (remove 0s at the end)
        SCOPE.buffer = SCOPE.buffer.slice(0, SCOPE.b_index);  

        // directly return SCOPE buffer without header
        return SCOPE.buffer;
    }
}


/**
 * ! nested PrecompiledDXB (appendPrecompiledDXB): recursive self-reference not allowed!
 */
export class PrecompiledDXB extends Array<ArrayBuffer|number|[number,number]> {

    #datex?:string
    #appended_pdxb: PrecompiledDXB[] = [];

    set datex(datex:string){
        if (this.#datex == undefined) this.#datex = datex;
    }
    get datex(){
        let d = this.#datex??"";
        for (let a of this.#appended_pdxb) {
            d += "\n" + a.datex;
        }
        return d;
    }

    private constructor(){super()}


    appendBuffer(buffer:ArrayBuffer) {
        this.push(buffer);
    }

    // buffer not yet inserted, only remember buffer slice start/end
    appendBufferPlaceholder(start_index:number, end_index:number) {
        this.push([start_index, end_index]);
    }

    // insert buffer at placeholder positions
    autoInsertBuffer(buffer:ArrayBuffer) {
        for (let i=0;i<this.length;i++) {
            if (this[i] instanceof Array) this[i] = buffer.slice(this[i][0], this[i][1]);
        }
    }

    appendDataIndex(index:number) {
        this.push(index);
    }

    freeze(){
        Object.freeze(this);
    }

    // static

    public static async create(datex:string, options:compiler_options={}){
        const precompiled = new PrecompiledDXB();
        await Compiler.compile(datex, [], options, false, false, false, precompiled);
        precompiled.freeze(); // no more changes allowed 
        return precompiled;
    }

    public static combine(...precompiled_dxbs: PrecompiledDXB[]): PrecompiledDXB {
        const precompiled = new PrecompiledDXB();
        precompiled.#appended_pdxb = precompiled_dxbs;
        precompiled.freeze(); // no more changes allowed 
        return precompiled;
    }
 

    // custom iterator, also iterate over appended PrecompiledDXB

    *[Symbol.iterator](){

        // map data index of multiple combined precompileddxb (assuming the are all in order, eg. `?0 = ?1 + ?2`, `?0 = ?2 * x` => `?0 = ?1 + ?2; ?3 = ?4 * x`)
        let dataIndexShift = 0;
        let lastDataIndex = 0;
        // remember last data index of current section for shift
        const collectDataIndex = (val:number|[number, number]|ArrayBuffer) => {
            if (typeof val == "number") lastDataIndex = val;
            return val;
        }
        // add shift if data index
        const convertIndexShift = (val:number|[number, number]|ArrayBuffer) => {
            if (typeof val == "number") return collectDataIndex(val + dataIndexShift);
            return collectDataIndex(val);
        }

        // iterate over this
        for (let i = 0; i < this.length; i++) yield collectDataIndex(this[i]);
        dataIndexShift = lastDataIndex == 0 ? 0 : lastDataIndex+1;

        // iterate over appended PrecompiledDXB
        for (let a = 0; a < this.#appended_pdxb.length; a++) {
            const pdxb = this.#appended_pdxb[a];
            // iterate over self (no infinite recursion)
            if (pdxb == this) {
                for (let i = 0; i < pdxb.length; i++) yield convertIndexShift(pdxb[i]);
            }
            // iterate over another precompiled dxb
            else {
                // TODO: nested index shift supported?
                for (const p of pdxb) yield convertIndexShift(p);
            }
            dataIndexShift = lastDataIndex == 0 ? 0 : lastDataIndex+1;
        }
    }
}

// file types: TODO: move?

export const FILE_TYPE = {
    DATEX_SCRIPT: ["text/datex",        "dx"],
    DATEX_BINARY: ["application/datex", "dxb"],
    JSON:         ["application/json", "json"]
} as const;

export type DATEX_FILE_TYPE = typeof FILE_TYPE[keyof typeof FILE_TYPE];


// debug:
setInterval(()=> {
    logger.debug(
        "SID cache sizes (VolatileMap): " + 
        Compiler.sid_return_indices.size +  "- " +
        Compiler.sid_incs.size +  "- " +
        Compiler.sid_incs_remote.size +  "- "
    )
}, 1000*60*30 /*30min*/)