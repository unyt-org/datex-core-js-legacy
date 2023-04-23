## type **compiler_scope** = {_is_extract_var_scope: false,datex: string,return_data?: {datex: string,},data?: unknown[],options: compiler_options,preemptive_pointers: Set,jmp_label_indices: {},indices_waiting_for_jmp_lbl: {},assignment_end_indices: Set,inserted_values: Map,used_lbls: string[],last_cache_point?: number,add_header: boolean,is_child_scope_block?: boolean,extract_pointers?: boolean,extract_var_index?: number,extract_var_indices?: Map,extract_var_scope?: extract_var_scope,precompiled?: PrecompiledDXB,last_precompiled?: number,var_index?: number,buffer: ArrayBuffer,uint8: Uint8Array,data_view: DataView,receiver_buffer?: ArrayBuffer,sender_buffer?: ArrayBuffer,full_dxb_size?: number,pre_header_size?: number,signed_header_size?: number,stack: [Endpoint, unknown - todo][],unused_plugins?: Set,b_index: number,streaming?: ReadableStreamDefaultReader,max_block_size?: number,internal_var_index: number,internal_vars: WeakMap,internal_primitive_vars: WeakMap,serialized_values: WeakMap,dynamic_indices: [number][],jmp_indices: [number][],current_data_index?: number,current_line_nr: number,end: boolean,is_outer_insert?: boolean,last_command_end?: boolean,subscopes: compiler_sub_scope[],inner_scope: compiler_sub_scope,compile_datex_scope?: datex_scope,compile_compiler_scope?: compiler_scope,_code_block_type?: number,}

## type **compiler_options** = {sid?: number,return_index?: number,inc?: number,end_of_scope?: boolean,from?: Endpoint,to?: target_clause | Pointer,flood?: boolean,type?: ProtocolDataType,sign?: boolean,encrypt?: boolean,sym_encrypt_key?: CryptoKey,send_sym_encrypt_key?: boolean,allow_execute?: boolean,plugins?: string[],required_plugins?: string[],__routing_ttl?: number,__routing_prio?: number,__routing_to?: endpoints | Pointer,inserted_ptrs?: Set,force_id?: boolean,collapse_pointers?: boolean,collapse_injected_pointers?: boolean,collapse_first_inserted?: boolean,_first_insert_done?: boolean,keep_first_transform?: boolean,no_create_pointers?: boolean,parent_scope?: compiler_scope,pseudo_parent?: boolean,only_leak_inserts?: boolean,preemptive_pointer_init?: boolean,init_scope?: boolean,context_location?: URL,insert_header?: {buffer: ArrayBuffer,index: number,cache: Map,vars?: {},var_index: number,root_scope: compiler_scope,},__v2?: boolean,}

## type **DATEX_FILE_TYPE** = unknown - todo

## class **DatexResponse**\<T>
### Constructors
 **constructor**(datex: string | URL | Scope, data?: unknown[])



## class **Compiler**
### Properties
**VERSION_NUMBER**: number<br>
**SIGN_DEFAULT**: boolean<br>
**BIG_BANG_TIME**: any<br>
**MAX_INT_32**: number<br>
**MIN_INT_32**: any<br>
**MAX_INT_8**: number<br>
**MIN_INT_8**: any<br>
**MAX_INT_16**: number<br>
**MIN_INT_16**: any<br>
**MAX_UINT_16**: number<br>
**signature_size**: number<br>
**_buffer_block_size**: number<br>
**MAX_SID**: number<br>
**MAX_BLOCK**: number<br>
**MAX_DXB_BLOCK_SIZE**: any<br>
**DEFAULT_TTL**: number<br>
Add a header to a Datex block
**builder**: {resizeBuffer: unknown - todo,handleRequiredBufferSize: unknown - todo,compilerInsert: unknown - todo,urlToDXB: unknown - todo,blobToDXB: unknown - todo,scriptToDXB: unknown - todo,getAssignAction: unknown - todo,valueIndex: unknown - todo,commaIndex: unknown - todo,assignmentEndIndex: unknown - todo,getDynamicIndex: unknown - todo,shiftDynamicIndices: unknown - todo,insertByteAtIndex: unknown - todo,createInternalVariableAtIndex: unknown - todo,resolveInternalProxyName: unknown - todo,insertValVarRef: unknown - todo,resolveValVarRef: unknown - todo,getExtractedVariable: unknown - todo,insertExtractedVariable: unknown - todo,insertVariable: unknown - todo,handleStream: unknown - todo,addJmp: unknown - todo,addText: unknown - todo,addDisjunction: unknown - todo,addConjunction: unknown - todo,addConnective: unknown - todo,addUrl: unknown - todo,addRelativePath: unknown - todo,addBoolean: unknown - todo,addInt: unknown - todo,addInt8: unknown - todo,addInt16: unknown - todo,addInt32: unknown - todo,addInt64: unknown - todo,addQuantity: unknown - todo,addTime: unknown - todo,addFloat64: unknown - todo,addFloatAsInt: unknown - todo,tryPlusOrMinus: unknown - todo,addFloat: unknown - todo,addScopeBlock: unknown - todo,insertScopeBlock: unknown - todo,addKey: unknown - todo,addObjectSlot: unknown - todo,addNull: unknown - todo,addVoid: unknown - todo,addFilterTargetFromParts: unknown - todo,addPersonByNameAndChannel: unknown - todo,addInstitutionByNameAndChannel: unknown - todo,addIdEndpointByIdAndChannel: unknown - todo,addBuffer: unknown - todo,addTarget: unknown - todo,addTypeByNamespaceAndName: unknown - todo,addPointerBodyByID: unknown - todo,addInitBlock: unknown - todo,addInitBlockForValue: unknown - todo,insertInitBlock: unknown - todo,addValVarRefDeclaration: unknown - todo,addPointerByID: unknown - todo,addPointerNormal: unknown - todo,addPreemptivePointer: unknown - todo,addPointer: unknown - todo,addArray: unknown - todo,addTuple: unknown - todo,addObject: unknown - todo,addChildrenAssignments: unknown - todo,check_perm_prefix: unknown - todo,detect_record: unknown - todo,insert_exports: unknown - todo,enter_subscope: unknown - todo,has_open_subscopes: unknown - todo,exit_subscope: unknown - todo,change_inner_scope_parent_type: unknown - todo,unescape_string: unknown - todo,serializeValue: unknown - todo,insert: unknown - todo,getFullObject(obj: Record): any,}<br>
compiler builder functions


## class **PrecompiledDXB**
### Constructors

! nested PrecompiledDXB (appendPrecompiledDXB): recursive self-reference not allowed!

## const **ProtocolDataTypesMap**: string[]

## const **INSERT_MARK**: \uddddꪪ

## const **FILE_TYPE**: {DATEX_SCRIPT: string[],DATEX_BINARY: string[],JSON: string[],}

