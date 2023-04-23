## type **filter_target_name_person** = ${target_prefix_person}${string}

## type **filter_target_name_id** = ${target_prefix_id}${string}

## type **filter_target_name_institution** = ${target_prefix_institution}${string}

## type **endpoint_name** = ${_endpoint_name}${_endpoint_name | ""}

## type **endpoint_by_endpoint_name**\<name extends endpoint_name> = name extends filter_target_name_id ? IdEndpoint : unknown - todo

## type **target_clause** = clause

## type **endpoints** = Endpoint | Disjunction

## enum **ElType**

## class **Target**
### Properties
**prefix**: target_prefix<br>
**type**: BinaryCode<br>
`protected` **targets**: Map<br>


## class **Endpoint**
### Constructors
 **constructor**(name: string | Uint8Array, instance?: string | number | Uint8Array)

### Properties
`protected` **DEFAULT_INSTANCE**: Uint8Array<br>

parent class for all filters (@user, ...)

## class **UnresolvedEndpointProperty**
### Constructors
 **constructor**(parent: Endpoint, property: any)



## class **WildcardTarget**
### Constructors
 **constructor**(target: Endpoint)

### Properties


## class **Person**
### Properties
`override` **prefix**: target_prefix<br>
`override` **type**: any<br>


## class **Institution**
### Properties
`override` **prefix**: target_prefix<br>
`override` **type**: any<br>


## class **IdEndpoint**
### Properties
`override` **prefix**: target_prefix<br>
`override` **type**: any<br>


## const **LOCAL_ENDPOINT**: any

## const **BROADCAST**: any

