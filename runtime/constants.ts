export const WITH = 'w';


export const MAX_UINT_16 = 65535;

export const VOID = undefined; // corresponds to DATEX value 'void'
export const WILDCARD: unique symbol = Symbol("*"); // corresponds to wildcard (*)
export const INVALID: unique symbol = Symbol("Invalid"); // use for error propagation without throwing errors
export const NOT_EXISTING: unique symbol = Symbol("Not existing"); // use for marking non existing values (that are not void)
export const UNKNOWN_TYPE: unique symbol = Symbol("Unknown type") // return for unknown types when casting

export const DX_PTR: unique symbol = Symbol("DX_PTR"); // key for pointer objects to access the respective DatexPointer
export const DX_TYPE: unique symbol = Symbol("DX_TYPE");
export const DX_ROOT: unique symbol = Symbol("DX_ROOT");
export const DX_SERIALIZED: unique symbol = Symbol("DX_SERIALIZED");
export const DX_VALUE: unique symbol = Symbol("DX_VALUE");
export const DX_SOURCE: unique symbol = Symbol("DX_SOURCE"); // used to override the default loading behaviour for a pointer (fetching by id). Can be an arbitrary DATEX Script that can be resolved with datex.get. Currently only used by the interface generator for JS modules.
// TODO: remove? replaced with DX_SLOTS
export const DX_TEMPLATE: unique symbol = Symbol("DX_TEMPLATE");
export const DX_PERMISSIONS: unique symbol = Symbol("DX_PERMISSIONS");
export const DX_PERMISSIONS_R: unique symbol = Symbol("DX_PERMISSIONS_R");
export const DX_PERMISSIONS_U: unique symbol = Symbol("DX_PERMISSIONS_U");
export const DX_PERMISSIONS_X: unique symbol = Symbol("DX_PERMISSIONS_X");
export const DX_IGNORE: unique symbol = Symbol("DX_IGNORE"); // ignore in DX (when serializing, only works for elements in array-like values)
export const DX_PREEMPTIVE: unique symbol = Symbol("DX_PREEMPTIVE"); // used to override the default loading behaviour for a pointer (fetching by id). Can be an arbitrary DATEX Script that can be resolved with datex.get. Currently only used by the interface generator for JS modules.

export const DX_REACTIVE_METHODS: unique symbol = Symbol("DX_REACTIVE_METHODS"); // object containing reactive methods for this obj, used e.g. for x.$.map, x.$.filter, ...
export const INIT_PROPS: unique symbol = Symbol("INIT_PROPS"); // key for init props function passed to constructor to initialize properties of pointer immediately
export const DX_BOUND_LOCAL_SLOT: unique symbol = Symbol("DX_BOUND_SLOT"); // local slot (e.g. #env) to which this value always gets serialized, instead of the value/pointer
// -------------------------------------
export const DX_SLOTS: unique symbol = Symbol("DX_SLOTS");

export const SLOT_WRITE = 0xfef0;
export const SLOT_READ  = 0xfef1;
export const SLOT_EXEC  = 0xfef2;
export const SLOT_GET   = 0xfef3;
export const SLOT_SET   = 0xfef4;



export const EXTENDED_OBJECTS = Symbol("EXTENDED_OBJECTS");
export const INHERITED_PROPERTIES = Symbol("INHERITED_PROPERTIES");
export const SET_PROXY = Symbol("SET_PROXY");
export const SHADOW_OBJECT = Symbol("SHADOW_OBJECT");