## class **StaticScope**
### Constructors
### Properties
**STD**: StaticScope<br>
**scopes**: Map<br>
**NAME**: unknown - todo<br>
**DOCS**: unknown - todo<br>


## class **TypedValue**\<T extends Type = Type>
### Constructors
 **constructor**(type: T, value?: T extends Type ? TT : unknown)

### Properties
**[DX_TYPE]**: Type<br>


## class **UnresolvedValue**
### Constructors
 **constructor**(type: Type, value: any)

### Properties
**[DX_TYPE]**: Type<br>
**[DX_VALUE]**: any<br>


## class **Runtime**
### Properties
**OPTIONS**: {DEFAULT_REQUEST_TIMEOUT: number,GARBAGE_COLLECTION_TIMEOUT: number,USE_BIGINTS: boolean,ERROR_STACK_TRACES: boolean,NATIVE_ERROR_STACK_TRACES: boolean,NATIVE_ERROR_DEBUG_STACK_TRACES: boolean,NATIVE_ERROR_MESSAGES: boolean,}<br>
**MIME_TYPE_MAPPING**: Record<br>
**mime_type_classes**: Map<br>
**ENV**: JSValueWith$<br>
**VERSION**: string<br>
**PRECOMPILED_DXB**: {}<br>
**HOST_ENV**: string<br>
**main_node**: Endpoint<br>
**endpoint_entrypoint**: any<br>
**STD_STATIC_SCOPE**: Record<br>
**active_datex_scopes**: Map<br>
**persistent_memory**: Map<br>
**TEXT_KEY**: ^\w+$<br>
**runtime_actions**: {waitForBuffer: unknown - todo,constructFilterElement: unknown - todo,trimArray: unknown - todo,getTrimmedArrayLength: unknown - todo,returnValue: unknown - todo,enterSubScope: unknown - todo,exitSubScope: unknown - todo,newSubScope: unknown - todo,closeSubScopeAssignments: unknown - todo,handleAssignAction: unknown - todo,checkValueReadPermission: unknown - todo,checkValueUpdatePermission: unknown - todo,countValue: unknown - todo,getReferencedProperty: unknown - todo,getProperty: unknown - todo,has: unknown - todo,getKeys: unknown - todo,setProperty: unknown - todo,assignAction(SCOPE: datex_scope, action_type: BinaryCode, parent: any, key: any, value: any, current_val?: any): void,_removeItemFromArray(arr: any[], value: any): void,extractScopeBlock(SCOPE: datex_scope): ArrayBuffer | false,extractVariableName(SCOPE: datex_scope): string | number | false,extractType(SCOPE: datex_scope, is_extended_type?: boolean): [Type, boolean] | false | Type,forkScope(SCOPE: datex_scope): datex_scope,insertToScope(SCOPE: datex_scope, el: any, literal_value?: boolean): Promise,setInternalVarReference(SCOPE: datex_scope, name: number | string, reference: any, save_persistent?: boolean): void,setInternalVarValue(SCOPE: datex_scope, name: number | string, value: any, save_persistent?: boolean): void,}<br>


## const **ReadableStream**: any

