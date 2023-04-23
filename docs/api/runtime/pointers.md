## type **observe_handler**\<K = any> = unknown - todo

## type **observe_options** = {types?: Value.UPDATE_TYPE[],ignore_transforms?: boolean,recursive?: boolean,}

## type **TransformSource** = {enableLive: unknown - todo,disableLive: unknown - todo,update: unknown - todo,}

## type **JSPrimitiveToDatexRef**\<T> = unknown - todo

## type **GenericValue**\<T> = JSPrimitiveToDatexRef | Value | Pointer | PointerProperty

## type **ValueReadonly**\<T> = Readonly

## type **CompatValue**\<T> = Value | T

## type **CompatPartial**\<T> = unknown - todo

## type **CollapsedValue**\<T extends CompatValue> = T extends IntegerRef ? bigint : T extends TextRef ? string : T extends DecimalRef ? number : T extends BooleanRef ? boolean : T extends TypeRef ? Type : T extends EndpointRef ? Endpoint : T extends URLRef ? URL : T extends PointerProperty ? TT : T extends Pointer ? TT : T extends Value ? TT : T

## type **CollapsedValueJSCompatible**\<T extends CompatValue> = T extends TypeRef ? Type : T extends EndpointRef ? Endpoint : T extends URLRef ? URL : T extends PointerProperty ? unknown - todo : T extends Pointer ? unknown - todo : T extends Value ? unknown - todo : T

## type **PrimitiveToClass**\<T> = T extends number ? Number : T extends string ? String : T extends boolean ? Boolean : T extends bigint ? BigInt : T

## type **Proxy$**\<T> = _Proxy$

## type **PropertyProxy$**\<T> = _PropertyProxy$

## type **JSValueWith$**\<T> = T & {$: Proxy$,$$: PropertyProxy$,}

## type **MinimalJSRefGeneralTypes**\<T, _C = CollapsedValue> = JSPrimitiveToDatexRef extends never ? JSValueWith$ : JSPrimitiveToDatexRef

## type **MinimalJSRef**\<T, _C = CollapsedValue> = JSPrimitiveToDatexRef extends never ? JSValueWith$ : unknown - todo

## type **CollapsedValueAdvanced**\<T extends CompatValue, COLLAPSE_POINTER_PROPERTY extends boolean | undefined = true, COLLAPSE_PRIMITIVE_POINTER extends boolean | undefined = true, _C = CollapsedValue> = _C extends primitive ? unknown - todo : T extends PointerProperty ? unknown - todo : JSValueWith$

## type **ProxifiedValue**\<T extends CompatValue> = T extends PointerProperty ? T : T extends Pointer ? T : T extends Value ? T : Value

## type **ObjectWithDatexValues**\<T> = unknown - todo

## type **CollapsedDatexObject**\<T> = unknown - todo

## type **CollapsedDatexObjectWithRequiredProperties**\<T> = unknown - todo

## type **CollapsedDatexArray**\<T extends Record> = CollapsedDatexObjectWithRequiredProperties

## type **DatexObjectInit**\<T> = unknown - todo

## type **DatexObjectPartialInit**\<T> = unknown - todo

## type **RestrictSameType**\<T extends CompatValue, _C = CollapsedValue> = _C extends string ? unknown - todo : _C extends number ? unknown - todo : _C extends bigint ? unknown - todo : _C extends boolean ? unknown - todo : _C extends null ? unknown - todo : _C extends undefined ? unknown - todo : T

## type **TransformFunctionInputs** = unknown - todo

## type **TransformFunction**\<Values extends TransformFunctionInputs, ReturnType> = unknown - todo

## type **AsyncTransformFunction**\<Values extends TransformFunctionInputs, ReturnType> = unknown - todo

## type **SmartTransformFunction**\<ReturnType> = unknown - todo

## type **pointer_type** = number

## enum **Value.UPDATE_TYPE**

## class **Value**\<T = any>
### Constructors
 **constructor**(value?: CompatValue)

### Properties
`protected` **capturedGetters**: Map<br>


## class **PointerProperty**\<T = any>
### Constructors
### Properties


## class **UpdateScheduler**
### Constructors
 **constructor**(update_interval?: number)

### Properties
**updates_per_receiver**: Map<br>
**update_interval**?: number<br>
**active**: boolean<br>
**datex_timeout**?: number<br>
**intermediate_updates_pointers**: Set<br>


## class **Pointer**\<T = any>
### Constructors
 **constructor**(id?: Uint8Array | string, value: T, sealed: boolean, origin?: Endpoint, persistant: any, anonymous: any, is_placeholder: any, allowed_access?: target_clause, timeout?: number)

END STATIC
### Properties
**pointers**: Map<br>
Pointer Storage
 stores all unique pointers + their values
**pointer_value_map**: WeakMap<br>
**pointer_label_map**: Map<br>
**MAX_POINTER_ID_SIZE**: number<br>
returns a unique pointer hash: HASH + UNIQUE TIME
**STATIC_POINTER_SIZE**: number<br>
**POINTER_TYPE**: {ENDPOINT: pointer_type,ENDPOINT_PERSONAL: pointer_type,ENDPOINT_INSTITUTION: pointer_type,IPV6_ID: pointer_type,STATIC: pointer_type,BLOCKCHAIN_PTR: pointer_type,PUBLIC: pointer_type,}<br>
**pointer_prefix**: Uint8Array<br>
**ANONYMOUS_ID**: Uint8Array<br>
**sealed**: boolean<br>
**extended_pointers**: Set<br>
**datex_timeout**?: number<br>
**visible_children**?: Set<br>
**sealed_properties**?: Set<br>
**anonymous_properties**?: Set<br>
**subscribers**: Disjunction<br>

Wrapper class for all pointer values ($xxxxxxxx)

## class **TextRef**\<T extends string = string>


## class **IntegerRef**


## class **DecimalRef**


## class **BooleanRef**


## class **TypeRef**


## class **EndpointRef**


## class **URLRef**


## function **getProxyFunction** (method_name: string, params: {filter: target_clause,dynamic_filter?: target_clause,sign?: boolean,scope_name?: string,timeout?: number,}): unknown - todo


proxy function (for remote calls)

## function **getProxyStaticValue** (name: string, params: {filter?: target_clause,dynamic_filter?: target_clause,sign?: boolean,scope_name?: string,timeout?: number,}): unknown - todo



