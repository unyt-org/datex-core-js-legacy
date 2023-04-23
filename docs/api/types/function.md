## interface **Callable**

## class **ExtensibleFunction**
### Constructors
 **constructor**(f: globalThis.Function)



## class **Function**\<T extends unknown - todo = unknown - todo>
### Constructors
### Properties
**context**?: object | Pointer<br>
**body**?: Scope<br>
**ntarget**?: T<br>
**location**: Endpoint<br>
**fn**?: unknown - todo<br>
**allowed_callers**?: target_clause<br>
**serialize_result**: boolean<br>
**anonymize_result**: boolean<br>
**params**: Tuple<br>
**params_keys**: string[]<br>
**is_async**: boolean<br>
**meta_index**?: number<br>
**datex_timeout**?: number<br>
**about**?: Markdown<br>

function - execute datex or js code - use for normal functions, not for static scope functions

## function **getDefaultLocalMeta** ()


inject meta info to stack trace

