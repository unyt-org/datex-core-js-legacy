## type **type_clause**\<T = any> = clause

## class **Type**\<T = any>
### Constructors
 **constructor**(namespace?: string, name?: string, variation?: string, parameters?: any[])

### Properties
**fundamental_types**: string[]<br>
**primitive_types**: string[]<br>
**compact_rep_types**: string[]<br>
**serializable_not_complex_types**: string[]<br>
**pseudo_js_primitives**: string[]<br>
**types**: Map<br>
**type_templates**: Map<br>
**template_types**: WeakMap<br>
**namespace**: string<br>
**name**: string<br>
**variation**: string<br>
**parameters**: any[]<br>
**root_type**: Type<br>
**base_type**: Type<br>
**is_complex**: boolean<br>
**is_primitive**: boolean<br>
**is_js_pseudo_primitive**: boolean<br>
**has_compact_rep**: boolean<br>
**serializable_not_complex**: boolean<br>
**timeout**?: number<br>
**children_timeouts**?: Map<br>
**std**: {integer: any,integer_8: any,integer_16: any,integer_32: any,integer_64: any,integer_u8: any,integer_u16: any,integer_u32: any,integer_u64: any,text: any,text_plain: any,text_datex: any,text_markdown: any,image: any,video: any,audio: any,model: any,application: any,application_pdf: any,decimal: any,quantity: any,boolean: any,null: any,void: any,buffer: any,url: any,time: any,target: any,endpoint: any,Set: any,Map: any,Transaction: any,Object: any,Array: any,Tuple: any,ExtObject: any,Type: any,Function: any,Stream: any,Negation: any,Conjunction: any,Disjunction: any,Task: any,Assertion: any,Iterator: any,StorageMap: any,StorageWeakMap: any,StorageSet: any,Error: any,SyntaxError: any,CompilerError: any,PointerError: any,ValueError: any,PermissionError: any,TypeError: any,NetworkError: any,RuntimeError: any,SecurityError: any,AssertionError: any,Scope: any,Debugger: any,Any: any,SyncConsumer: any,ValueConsumer: any,StreamConsumer: any,}<br>
**short_types**: {}<br>

<ns:type>

