## type **Return**\<T = void> = Promise | T | void

## type **datex_sub_scope** = {result?: any,is_outer_scope?: boolean,type_casts?: Type[],ctx_intern?: any,last_insert_value?: any,active_object?: object | any[],auto_obj_index?: number,active_object_new?: boolean,waiting_key?: number | bigint | string,waiting_internal_slot?: number,waiting_vars?: Set,waiting_ptrs?: Set,waiting_internal_vars?: Set,waiting_ext_type?: Type,waiting_labels?: Set,waiting_for_child?: 0 | 1 | 2,waiting_for_child_action?: BinaryCode,return?: boolean,waiting_range?: [unknown - todo, unknown - todo],waiting_collapse?: boolean,inner_spread?: boolean,compare_type?: BinaryCode,about?: boolean,count?: boolean,keys?: boolean,get?: boolean,template?: boolean | Type,observe?: boolean | Value,scope_block_for?: BinaryCode,scope_block_vars?: any[],wait_await?: boolean,wait_iterator?: boolean,wait_next?: boolean,wait_extends?: boolean,wait_implements?: boolean,wait_matches?: boolean,wait_new?: boolean,new_type?: Type,wait_freeze?: boolean,wait_seal?: boolean,has?: boolean,wait_dynamic_key?: boolean,waiting_for_action?: [BinaryCode, any, any][],create_pointer?: boolean,delete_pointer?: boolean,sync?: boolean,stop_sync?: boolean,unsubscribe?: boolean,copy?: boolean,clone?: boolean,collapse?: boolean,get_type?: boolean,get_origin?: boolean,get_subscribers?: boolean,waiting_for_key_perm?: boolean,key_perm?: any,active_value?: any,auto_exit?: 1 | 2,stream_consumer?: StreamConsumer,jmp?: number,jmp_true?: boolean,operator?: BinaryCode,negate_operator?: boolean,connective?: Connective,connective_size?: number,}

## type **dxb_header** = {sid?: number,return_index?: number,inc?: number,type?: ProtocolDataType,version?: number,sender?: Endpoint,timestamp?: Date,signed?: boolean,executable?: boolean,encrypted?: boolean,end_of_scope?: boolean,routing?: routing_info,redirect?: boolean,}

## type **routing_info** = {sender?: Endpoint,ttl?: number,prio?: number,receivers?: target_clause,flood?: boolean,}

## type **datex_variables_scope** = {} & {__current: Target,__sender: Target,__timestamp: Date,__signed: boolean,__encrypted: boolean,}

## type **datex_meta** = {encrypted?: boolean,signed?: boolean,sender: Endpoint,timestamp: Date,type: ProtocolDataType,}

## type **datex_scope** = {sid: number,header: dxb_header,sender: Endpoint,origin: Endpoint,current_index: number,start_index: number,index_offset: number,cache_previous?: boolean,cache_after_index?: number,internal_vars: {},persistent_vars: unknown - todo[],context?: any,it?: any,context_location?: URL,execution_permission: boolean,impersonation_permission: boolean,sync?: boolean,unsubscribe?: boolean,sub_scopes: datex_sub_scope[],inner_scope: datex_sub_scope,result?: any,outer_serialized?: boolean,meta: datex_meta,remote: {insert?: object,sign?: boolean,encrypt?: boolean,eos?: boolean,type?: ProtocolDataType,timeout?: number | bigint,},buffer_views: {data_view?: DataView,uint8?: Uint8Array,buffer?: ArrayBuffer,},closed?: boolean,}

## type **Class**\<T = any> = unknown - todo

## type **compile_info** = [string | PrecompiledDXB, any[], compiler_options, boolean, boolean, boolean, PrecompiledDXB, number]

## type **any_class**\<V> = unknown - todo | unknown - todo | StringConstructor | NumberConstructor | BigIntConstructor | BooleanConstructor

## interface **PointerSource**

