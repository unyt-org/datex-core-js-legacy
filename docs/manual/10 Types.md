# Types

The DATEX Runtime comes with its own type system which can be mapped to JavaScript types.
DATEX types can be access via `Datex.Type`.

## Std types 
The `Datex.Type.std` namespace contains all the builtin (*std*) DATEX types, e.g.:
```ts
// primitive types
Datex.Type.std.text
Datex.Type.std.integer
Datex.Type.std.integer_8
Datex.Type.std.integer_64

// complex types
Datex.Type.std.Array
Datex.Type.std.Array_8
Datex.Type.std.Function
```

There also exist globally accessible short names for some of the types, matching their respective typescript names:
```ts
Datex.Type.std.text === string
Datex.Type.std.decimal === number
Datex.Type.std.integer === bigint
Datex.Type.std.boolean === boolean
Datex.Type.std.Any === any
```

## Special JS types

Most builtin JavaScript types, like Map, Set or Array have equivalent types in the DATEX std library.
There are only a few types that are implemented specifically to match JS types:

### js:TransferableFunction

The `js:TransferableFunction` (`Datex.Type.js.TransferableFunction`) is a special wrapper
around a JavaScript function that can be transferred between endpoints.

In contrast to a normal function (`std:Function`) that can also be mapped to a JavaScript function,
a `js:TransferableFunction` is always executed on the endpoint where it is called, not on the origin endpoint.

A transferable functions can be created from a normal JS function. Dependencies from the parent scope can be declared with a `use()` statement:

```ts
import { JSTransferableFunction } from "datex-core-legacy/types/js-function.ts";

const data = $$([1,2,3]);

// create a js:TransferableFunction
const transferableFn = JSTransferableFunction.create(() => {
	use (data);

	console.log(data);
	// ...
})

// call function on another endpoint (endpoint must have arbitrary source code execution permission)
await datex `@example :: ${transferableFn}()`
```

### js:Object

In contrast to `std:Object`, `js:Object` is used for JavaScript object with a prototype other than `Object.prototype` or `null` (e.g. a class instance). 

Examples for `std:Object`s:
 * A plain object like `{x: 1, y: new Set()}`
 * Object with `null` prototype `{__proto__: null, x: 1}`

Examples for `js:Object`s:
 * A builtin object like `console`
 * A class instance like `new WebSocket("ws://example.com")`

The property values of a `js:Object` are never automatically bound to pointers when the object is bound to a pointer.

## Structs

The `struct` helper function allows you to define DATEX types with a
fixed structure.
All `struct` values are represented as plain objects in JavaScripts.
They can take any DATEX compatible value as properties.

Datex runtime type validation is enabled for struct instances per default.
Because all the properties are known at construction time,
structs are more efficient than plain objects.

**Usage**:

```ts
import { struct } from "datex-core-legacy/types/struct.ts";

// struct definition
const MyStruct = struct({
	a: string, // short name for Datex.Type.std.text
	b: Set, // JavaScript 'Set' class, equivalent to Datex.Type.std.Set
	c: Array<number>, // generic Array class (generic type argument has no effect at runtime!)
	// nested struct
	x: {
		xx: string,
		yy: Map<string, string>
	}
})

// inferred TS definition:
type MyStruct = inferType<typeof MyStruct>
// -----------------------------------------------
//      | 
//      V
{
	a: string,
	b: Set<any>,
	c: Array<number>,
	x: {
		xx: string,
		yy: Map<string, string>
	}
}
// -------------------------------------------------
 
// instantiation (throws a runtime error if it doesn't match the struct definition)
const myStruct: MyStruct = MyStruct({
	a: "aaaaaa",
	b: new Set(),
	c: [1,2,3],
	x: {
		xx: "xxxxxxx",
		yy: new Set(['1','2'])
	}
})
```

With the `inferType` helper, the TypeScript type
for the struct definition can be inferred.

A struct definition accepts strings a keys and `Datex.Type`s,
JavaScript classes or other struct definitions as values.


## Mapping JS classes to DATEX types

Check out the chapter [11 Classes](./11%20Classes.md) for more information.