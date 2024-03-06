import type { Type } from "../types/type.ts"
import type { Pointer, Ref } from "../runtime/pointers.ts"
import type { BinaryCode } from "../compiler/binary_codes.ts"
import type { StreamConsumer } from "../types/abstract_types.ts"
import { ProtocolDataType } from "../compiler/protocol_types.ts"
import { Endpoint, Target, target_clause } from "../types/addressing.ts"
import { compiler_options, PrecompiledDXB, DatexResponse } from "../compiler/compiler.ts"
import { cnf, Connective, Disjunction } from "../types/logic.ts"
import { NOT_EXISTING } from "../runtime/constants.ts";
import { CommunicationInterfaceSocket } from "../network/communication-interface.ts";


// return type for remote function calls
export type Return<T=void> = Promise<T|void>|T|void;
// export type Return<T=void> = Promise<T|void|DatexResponse<T>>|T|void|DatexResponse<T>;

export interface PointerSource {
    getPointer(pointer_id:string, pointerify?:boolean, localOnly?: boolean): Promise<any|typeof NOT_EXISTING>|any|typeof NOT_EXISTING
    syncPointer?(pointer:Pointer):Promise<void>|void
}

export type ExecConditions = {
    onlyLocalPointers?: boolean // if true, throws an error if local pointers are accessed
}



export type datex_sub_scope = {    
    result?: any, // 'global' sub scope variable (-> return value), corresponds to __scope_global internal variable

    is_outer_scope?:boolean // is outer scope?

    type_casts?: Type[],

    ctx_intern?: any, // use as __this internal variable pointing to a parent object for <Functions>

    last_insert_value?: any, // last inserted value (+)
    active_object?: object|any[],
    auto_obj_index?: number, // increment index for auto object indexation (0,1,2,3,...)
    active_object_new?: boolean, // is true at the beginning when no previous element inside the object exists
    waiting_key?: number|bigint|string, // key of an object waiting to be assigned, null if currently in array
    waiting_internal_slot?: number, // index of internal slot waiting to be assigned
    waiting_vars?: Set<[name:string|number,action?:BinaryCode]>, // variable waiting for a value
    waiting_ptrs?: Set<[ptr:Pointer,action?:BinaryCode|{resolve:(r:Pointer)=>void, reject:(e:unknown)=>void}]>, // new Pointer waiting for a value
    waiting_internal_vars?: Set<[name:string|number,action?:BinaryCode,persistant_meory?:boolean]>, // internal variable waiting for a value

    waiting_ext_type?: Type, // waiting for type parameters 
    waiting_labels?: Set<string|number>,

    waiting_for_child?: 0|1|2, // next value is key for active value, 1 = normal get, 2 = ref get
    waiting_for_child_action?: BinaryCode, // next vaule is key for active value, treat as assignment

    return?:boolean, // return current #scope_result after subscope closed

    waiting_range?: [any?, any?], // range (x..y)

    waiting_collapse?: boolean, // ... operator
    inner_spread?: boolean, // ... operator, inside element, pass to parent subscope

    compare_type?: BinaryCode, // for comparisons (==, <=, ~=, ...)

    about?: boolean, // 'about' command (docs)
    count?: boolean, // get count for next value
    keys?: boolean, // get keys for next value
    get?: boolean, // get url (next value)
    template?: boolean|Type, // set type template
    observe?: boolean|Ref, // observe value
    scope_block_for?: BinaryCode, // type of scope block
    scope_block_vars?: any[], // #0, #1, ... for scope block
    wait_await?: boolean, // await
    wait_iterator?: boolean, // iterator x
    wait_next?: boolean, // next x
    wait_extends?:boolean, // x extends y
    wait_implements?:boolean, // x implements y
    wait_matches?:boolean, // x matches y
    wait_new?:boolean, // new <xy> ()
    new_type?:Type,
    wait_freeze?:boolean, // freeze x
    wait_seal?:boolean, // seal x
    has?: boolean, // x has y
    wait_dynamic_key?: boolean, // (x):y

    waiting_for_action?: [type:BinaryCode, parent:any, key:any][], // path waiting for a value
    create_pointer?: boolean, // proxify next value to pointer
    delete_pointer?: boolean, // delete next pointer
    sync?: boolean, // sync next pointer to active value
    stop_sync?: boolean, // stop sync next pointer to active value
    unsubscribe?: boolean, // unsubscribe from next pointer
    copy?: boolean, // copy next value
    clone?: boolean, // deep copy value
    collapse?: boolean, // collapse next value
    get_type?: boolean, // get type of value
    get_origin?: boolean, // get next pointer origin
    get_subscribers?: boolean, // get next pointer subscribers

    waiting_for_key_perm?: boolean, // waiting for key permission followed by key
    key_perm?: any, // permission value for key

    active_value?:any // last assigned value
    
    auto_exit?:1|2, // auto exit from this scope at next possibility (end code), needed for child paths, 1 initializes auto_exit, is 2 after next value

    stream_consumer?: StreamConsumer, // active stream reader

    jmp?: number, // jump to index if next value is true
    jmp_true?: boolean, // is jtr or jfa

    operator?: BinaryCode // current active operator (+, ...)
    negate_operator?: boolean // has active ~ operator
    connective?: Connective<any>, // conjunction or disjunction
    connective_size?:number, // number of remaining conjunction/disjunction elements
} 

export type dxb_header = {
    sid?:number, 
    return_index?: number,
    inc?:number,
    type?:ProtocolDataType,
    version?:number,
    sender?:Endpoint,
    timestamp?:Date,
    signed?:boolean,
    executable?:boolean,
    encrypted?:boolean,
    end_of_scope?:boolean,
    routing?: routing_info,
    redirect?: boolean
}
export type routing_info = {
    sender?: Endpoint,
    ttl?: number,
    prio?: number,
    receivers?: target_clause,
    flood?: boolean
}


export type datex_variables_scope = { [key: string]: any } & { // all available variables in the scope, including defaults
    __current: Target,
    __sender: Target,
    __timestamp: Date, 
    __signed: boolean,
    __encrypted: boolean,
}

export type datex_meta = {
    /**
     * indicates if the datex block initiating the function call was encrypted
     */
    encrypted?:boolean, 
    /**
     * indicates if the datex block initiating the function call was signed
     */
    signed?:boolean, 
    /**
     * @deprecated use caller instead
     */
    sender:Endpoint,
    /**
     * the endpoint that initiated the function call
     */
    caller: Endpoint,
    /**
     * the time when the function call was initiated on the caller
     */
    timestamp:Date, 
    /**
     * the type of the datex block initiating the function call
     */
    type:ProtocolDataType, 
    /**
     * indicates if the function was called from the local endpoint
     */
    local?:boolean
};

export type trace = {
    endpoint: Endpoint, 
    timestamp: Date, 
    destReached?: boolean,
    socket: {
        type: string, 
        name?:string
    }
}

export type datex_scope = {
    sid: number,
    header: dxb_header,
    sender: Endpoint, // sender of the scope
    origin: Endpoint, // origin to use for pointers / casting (default is sender)

    socket?: CommunicationInterfaceSocket // original socket (com interface) from which this scope was received

    current_index: number,
    start_index: number, // keep track of index to jump back to
    index_offset: number, // current_index + index_offset = actual index, everything left of the index_offset is no longer cached in the buffer
    cache_previous?: boolean // if set to true, the current block will remain in the dxb buffer for the next run() iteration

    cache_after_index?: number, // cache all blocks if they are after this index

    internal_vars:  { [key: string]: any },
    persistent_vars: (string|number)[]

    context?: any, // parent object (context), e.g. in Function
    it?: any, // referenced value (iterator, item, it)

    context_location?: URL, // location of the dxb/dx script file, used for error messages, ...

    execution_permission: boolean, // can execute functions
    impersonation_permission: boolean, // can do everything the current endpoint can do: make requests to other endpoints

    sync?:boolean, // anywhere waiting for subscribe?
    unsubscribe?:boolean, // anywhere waiting for unsubscribe?

    sub_scopes: datex_sub_scope[],
    inner_scope: datex_sub_scope, // current sub scope

    result?: any, // result value (__result internal variable)

    outer_serialized?: boolean, // if true, the outer value is not casted to a type, just the serialized value is returned

    exec_conditions?: ExecConditions

    meta: datex_meta,
    remote: {insert?:object, sign?:boolean, encrypt?:boolean, eos?:boolean, type?:ProtocolDataType, timeout?:number|bigint}, // outgoing remote configuration

    buffer_views: {data_view?:DataView, uint8?:Uint8Array, buffer?:ArrayBuffer}

    closed?: boolean // is scope completely closed?
}

export type Class<T=any> = (new (...args: any[]) => T); // type for a JS class

export type compile_info = [datex:string|PrecompiledDXB, data?:any[], options?:compiler_options, add_header?:boolean, is_child_scope_block?:boolean, extract_pointers?:boolean, save_precompiled?:PrecompiledDXB, max_block_size?:number];

export type any_class<V> = (new (...args: any[]) => V)|((...args: any[]) => V)|StringConstructor|NumberConstructor|BigIntConstructor|BooleanConstructor;

export type Equals<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends
    (<T>() => T extends Y ? 1 : 2) ? true : false;