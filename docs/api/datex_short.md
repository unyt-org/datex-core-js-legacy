## function **get** \<T = unknown>(dx: string | URL | Endpoint, assert_type?: Type | Class | string, context_location?: URL | string): Promise



## function **raw** \<T = unknown>(dx: TemplateStringsArray, param-todo): DatexResponse



## function **raw** \<T = unknown>(dx: string): DatexResponse



## function **raw** \<T = unknown>(script_url: URL): DatexResponse



## function **raw** \<T = unknown>(dx_or_url: string | URL | TemplateStringsArray): DatexResponse



## function **script** (dx: TemplateStringsArray, param-todo): Promise



## function **script** (dx: string | PrecompiledDXB, data?: any[], to?: Target | target_clause | endpoint_name, sign?: boolean, encrypt?: boolean): Promise



## function **script** (dx: string | TemplateStringsArray | PrecompiledDXB, data: any[], to: Target | target_clause | endpoint_name, sign: any, encrypt: any)



## function **instance** \<T>(fromClass: {new(param-todo): T,}, properties?: CompatPartial): T



## function **instance** \<T>(fromType: Type, properties?: CompatPartial): T



## function **instance** \<T>(fromClassOrType: {new(param-todo): T,} | Type, properties?: CompatPartial): T



## function **pointer** \<T>(value: CompatValue): MinimalJSRef



## function **decimal** (value: CompatValue): DecimalRef



## function **integer** (value: CompatValue): IntegerRef



## function **text** (string: TemplateStringsArray, param-todo): Promise



## function **text** (value?: CompatValue): TextRef



## function **text** (value: CompatValue | TemplateStringsArray, param-todo): TextRef | Promise



## function **boolean** (value: CompatValue): BooleanRef



## function **md** (string: TemplateStringsArray, param-todo): Promise



## function **md** (value?: CompatValue): Markdown



## function **md** (value: CompatValue | TemplateStringsArray, param-todo): Markdown | Promise



## function **local_text** (local_map: {})



## function **transform** \<T, V extends TransformFunctionInputs>(observe_values: V, transform: TransformFunction, persistent_datex_transform?: string)



## function **transformAsync** \<T, V extends TransformFunctionInputs>(observe_values: V, transform: AsyncTransformFunction, persistent_datex_transform?: string)



## function **map** \<K extends string | number, V>(value: CompatValue, map: Record): MinimalJSRef



## function **select** \<T extends primitive>(value: CompatValue, if_true: T, if_false: T): MinimalJSRef



## function **select** \<T>(value: CompatValue, if_true: T, if_false: T): MinimalJSRef



## function **select** \<T>(value: CompatValue, if_true: T, if_false: T)



## function **not** (value: CompatValue): BooleanRef



## function **and** (param-todo): BooleanRef



## function **or** (param-todo): BooleanRef



## function **add** \<T>(param-todo): MinimalJSRef



## function **add** (param-todo)



## function **sub** (param-todo): MinimalJSRef



## function **sub** (param-todo): MinimalJSRef



## function **sub** (param-todo)



## function **mul** (param-todo): MinimalJSRef



## function **mul** (param-todo): MinimalJSRef



## function **mul** (param-todo)



## function **div** (param-todo): MinimalJSRef



## function **div** (param-todo): MinimalJSRef



## function **div** (param-todo)



## function **pow** (param-todo): MinimalJSRef



## function **pow** (param-todo): MinimalJSRef



## function **pow** (param-todo)



## function **always** \<T, V extends TransformFunctionInputs>(transform: SmartTransformFunction): CollapsedValueAdvanced



## function **always** \<T = unknown>(script: TemplateStringsArray, param-todo): Promise


Shortcut for datex `always (...)`
 * @param script: undefined
 * @param vars: undefined

## function **always** (scriptOrJSTransform: TemplateStringsArray | SmartTransformFunction, param-todo)



## function **static_pointer** \<T>(value: CompatValue, endpoint: IdEndpoint, unique_id: number, label?: string | number)



## function **label** \<T>(label: string | number, value: CompatValue): T



## function **eternal** \<T>(type: Type): Promise



## function **eternal** \<T>(value_class: any_class): Promise



## function **eternal** \<T>(initial_value: T & primitive): Promise



## function **eternal** \<T>(create: unknown - todo): Promise



## function **eternal** \<T>(id_or_create_or_class: unknown - todo | unknown - todo, _create_or_class?: unknown - todo | any_class | Type)



## function **once** \<T>(init: unknown - todo): Promise



## function **once** \<T>(identifier: string, init: unknown - todo): Promise



## function **once** \<T>(id_or_init: string | unknown - todo, _init?: unknown - todo)



## function **loadEternalValues** ()



## function **getEternal** (info?: ReturnType, customIdentifier?: string, return_not_existing: any)



## function **getLazyEternal** (info?: ReturnType, customIdentifier?: string, return_not_existing: any)



## function **f** \<T extends endpoint_name>(name: [T] | T): endpoint_by_endpoint_name



## function **syncedValue** (parent: any | Pointer, key?: any): PointerProperty



## function **props** \<T extends object = object>(parent: CompatValue, strong_parent_bounding: any): ObjectWithDatexValues



## function **translocate** \<V extends unknown, T extends Record>(value: T): unknown - todo



## function **translocate** \<T extends Map | Set | Array | Record>(value: T): T



## const **datex**: any

## const **〱**: any

## const **$$**: any

