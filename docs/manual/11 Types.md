# Types

The DATEX Runtime comes with its own type system which can be mapped to JavaScript types.
DATEX types can be access via `Datex.Type`.

## Std types 
The `Datex.Type.std` namespace contains all the builtin (*std*) DATEX types that can be accessed as runtime values, e.g.:
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

## Supported built-in JS and Web types
| **JS Type**                    | **Support**           | **DATEX Type** | **Synchronizable** | **Limitations**                                                                           |
|:-------------------------------|:----------------------|:---------------|:-------------------|:------------------------------------------------------------------------------------------|
| **string**                     | Full                  | std:text       | Yes <sup>1)</sup>  | <sup>3)</sup>                                                                             |
| **number**                     | Full                  | std:decimal    | Yes <sup>1)</sup>  | <sup>3)</sup>                                                                             |
| **bigint**                     | Full                  | std:integer    | Yes <sup>1)</sup>  | <sup>3)</sup>                                                                             |
| **boolean**                    | Full                  | std:boolean    | Yes <sup>1)</sup>  | <sup>3)</sup>                                                                             |
| **null**                       | Full                  | std:null       | Yes <sup>1)</sup>  | -                                                                                         |
| **undefined**                  | Full                  | std:void       | Yes <sup>1)</sup>  | -                                                                                         |
| **symbol**                     | Partial               | js:Symbol      | Yes <sup>1)</sup>  | Registered and well-known symbols are not yet supported                                   |
| **Object (without prototype)** | Full                  | std:Object     | Yes                | Objects with prototypes other than `Object.prototype` or `null` are mapped to `js:Object` |
| **Object**                     | Sufficient            | js:Object      | Yes                | No synchronisation for nested objects per default                                         |
| **Array**                      | Full                  | std:Array      | Yes                | -                                                                                         |
| **Set**                        | Full                  | std:Set        | Yes                | -                                                                                         |
| **Map**                        | Full                  | std:Map        | Yes                | -                                                                                         |
| **WeakSet**                    | None                  | -              | -                  | Cannot be implemented because `WeakSet` internals are not accessible. Alternative: `StorageWeakSet` |
| **WeakMap**                    | None                  | -              | -                  | Cannot be implemented because `WeakMap` internals are not accessible. Alternative: `StorageWeakMap` |
| **Function**                   | Sufficient            | std:Function   | No (Immutable)     | Functions always return a Promise, even if they are synchronous                           |
| **AsyncFunction**              | Sufficient            | std:Function   | No (Immutable)     | -                                                                                         |
| **Generator**                  | Sufficient            | js:AsyncGenerator | -               | Generators are always mapped to AsyncGenerators                                           |
| **AsyncGenerator**             | Full                  | js:AsyncGenerator | -               | -                                                                                         |
| **ArrayBuffer**                | Partial               | std:buffer     | No                 | ArrayBuffer mutations are currently not synchronized                                      |
| **Uint8Array**                 | Partial               | js:TypedArray/u8  | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Uint16Array**                | Partial               | js:TypedArray/u16 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Uint32Array**                | Partial               | js:TypedArray/u32 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **BigUint64Array**             | Partial               | js:TypedArray/u64 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Int8Array**                  | Partial               | js:TypedArray/i8  | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Int16Array**                 | Partial               | js:TypedArray/i16 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Int32Array**                 | Partial               | js:TypedArray/i32 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **BigInt64Array**              | Partial               | js:TypedArray/i64 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Float32Array**               | Partial               | js:TypedArray/f32 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Float64Array**               | Partial               | js:TypedArray/f64 | No              | ArrayBuffer mutations are currently not synchronized                                      |
| **Promise**                    | Full                  | js:Promise        | No (Immutable)  | -                                                                                         |
| **URL**                        | Partial               | std:url        | No                 | URL mutations are currently not synchronized                                              |
| **Date**                       | Partial               | std:time       | No                 | `Date` objects are currently asymetrically mapped to DATEX `Time` objects                 |
| **Blob**                       | Full                  | std:*/*,       | No (Immutable)     | -                                                                                         |
| **File**                       | Full                  | js:File        | No (Immutable)     | -                                                                                         |
| **RegExp**                     | Partial               | js:RegExp      | No (Immutable)     | RegExp values wrapped in a Ref are currently not synchronized                             |
| **WeakRef**                    | Full                  | std:WeakRef    | No (Immutable)     | -                                                                                         |
| **MediaStream**                | Partial               | js:MediaStream | Yes                | MediaStreams are only supported in browsers that provide a [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API) |
| **Error**                      | Partial               | std:Error      | No                 | Error subclasses are not correctly mapped                                                 |
| **HTMLElement**                | Partial <sup>2)</sup> | std:html       | No                 | HTML element mutations are currently not synchronized                                     |
| **SVGElement**                 | Partial <sup>2)</sup> | std:svg        | No                 | SVG element mutations are currently not synchronized                                      |
| **MathMLElement**              | Partial <sup>2)</sup> | std:mathml     | No                 | MathML element mutations are currently not synchronized                                   |
| **Document**                   | Partial <sup>2)</sup> | std:htmldocument | No               | Document mutations are currently not synchronized                                         |
| **DocumentFragment**           | Partial <sup>2)</sup> | std:htmlfragment | No               | DocumentFragment mutations are currently not synchronized                                 |


<sup>1)</sup> Primitive JS values are immutable and cannot be synchronized on their own, but when wrapped in a Ref.<br>
<sup>2)</sup> [UIX-DOM](https://github.com/unyt-org/uix-dom) required<br>
<sup>3)</sup> The corresponding object values of primitive values (e.g. `new Number()` for `number`) are not supported<br>

## Special JS types

Most builtin JavaScript types, like Map, Set or Array have equivalent types in the DATEX std library.
There are only a few types that are implemented specifically to match JS types:

### js:Function

The `js:Function` (`Datex.Type.js.Function`) is a special wrapper
around a JavaScript function that can be transferred between endpoints.

In contrast to a normal function (`std:Function`) that can also be mapped to a JavaScript function,
a `js:Function` is always executed on the endpoint where it is called, not on the origin endpoint.

A transferable functions can be created from a normal JS function. Dependencies from the parent scope can be declared with a `use()` statement:

```ts
import { JSTransferableFunction } from "datex-core-legacy/types/js-function.ts";

const data = $$([1,2,3]);

// create a js:Function
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


### js:Symbol

DATEX has no native symbol type. JavaScript symbols are mapped to `js:Symbol` values.

### js:MediaStream

This type mapping allows sharing `MediaStream` objects with audio/video tracks between browser endpoints.
Backend (Deno) endpoints are not yet supported due to missing support for WebRTC. 


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


## Mapping your own JS classes to DATEX types

Check out the chapter [11 Classes](./11%20Classes.md) for more information.