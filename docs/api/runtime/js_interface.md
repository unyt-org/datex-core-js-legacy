## type **js_interface_configuration**\<T = any> = {__type?: Type,get_type?: unknown - todo,cast?: unknown - todo,cast_no_tuple?: unknown - todo,serialize?: unknown - todo,empty_generator?: unknown - todo,override_silently?: unknown - todo,class?: Class,prototype?: object,detect_class?: unknown - todo,is_normal_object?: boolean,type_params_match?: unknown - todo,set_property?: unknown - todo,get_property?: unknown - todo,has_property?: unknown - todo,delete_property?: unknown - todo,clear?: unknown - todo,apply_value?: unknown - todo,set_property_silently?: unknown - todo,get_property_silently?: unknown - todo,delete_property_silently?: unknown - todo,clear_silently?: unknown - todo,keys?: unknown - todo,values?: unknown - todo,count?: unknown - todo,proxify_children?: boolean,visible_children?: Set,create_proxy?: unknown - todo,operator_add?: unknown - todo,operator_subtract?: unknown - todo,operator_divide?: unknown - todo,operator_multiply?: unknown - todo,operator_power?: unknown - todo,operator_modulo?: unknown - todo,operator_and?: unknown - todo,operator_or?: unknown - todo,operator_not?: unknown - todo,action_add?: unknown - todo,action_subtract?: unknown - todo,action_divide?: unknown - todo,action_multiply?: unknown - todo,action_power?: unknown - todo,action_modulo?: unknown - todo,action_increment?: unknown - todo,action_decrement?: unknown - todo,action_and?: unknown - todo,action_or?: unknown - todo,compare?: unknown - todo,}
create a custom DATEX JS Interface for a type with handlers 
 
- serialize efficiently with the serialize function and de-serialize in the cast function
- do not use @sync classes in combination with an additional js_interface_configuration!; 

## class **JSInterface**
### Properties
**configurations_by_type**: Map<br>
**configurations_by_class**: Map<br>
**configurations_by_prototype**: Map<br>
**configurations_loaders_by_namespace**: Map<br>

handles (custom) type interfaces with custom JS methods

## function **DX_CLASS** (type: Type | string)



## const **typeConfigurationLoader**: any

## const **updateJSInterfaceConfiguration**: any

