<h1>The Datex Runtime and the Datex JS Interface</h1>

- [Introduction](#introduction)
  - [DATEX](#datex)
  - [The DATEX Runtime](#the-datex-runtime)
  - [The DATEX Compiler](#the-datex-compiler)
  - [Connection to the DATEX Cloud](#connection-to-the-datex-cloud)
  - [Documention for DATEX Pseudo Classes and Static Scopes](#documention-for-datex-pseudo-classes-and-static-scopes)
  - [Debugging DATEX in the browser](#debugging-datex-in-the-browser)
- [The DATEX Runtime](#the-datex-runtime-1)
  - [Executing DATEX in the Runtime](#executing-datex-in-the-runtime)
- [The DATEX Standard Library](#the-datex-standard-library)
  - [`std:` Pseudo Classes](#std-pseudo-classes)
  - [* **`Buffer`**: Byte Array, corresponds to ArrayBuffers or other Typed Arrays in JavaScript](#-buffer-byte-array-corresponds-to-arraybuffers-or-other-typed-arrays-in-javascript)
  - [* **`Map`**: Same as a JavaScript Map](#-map-same-as-a-javascript-map)
  - [* **`Tuple`**: A special form of an Array which cannot be modified and is mainly used to pass multiple arguments to a datex `<Function>`](#-tuple-a-special-form-of-an-array-which-cannot-be-modified-and-is-mainly-used-to-pass-multiple-arguments-to-a-datex-function)
  - [* **`Optional`**: Indicates that a value is optional; used in Function declarations; JavaScript class: `DatexOptional`](#-optional-indicates-that-a-value-is-optional-used-in-function-declarations-javascript-class-datexoptional)
  - [* **`RuntimeError`**: A general, unspecified error while executing a DXB block](#-runtimeerror-a-general-unspecified-error-while-executing-a-dxb-block)
- [DATEX Types](#datex-types)
- [The DATEX JS Interface](#the-datex-js-interface)
  - [@sync classes](#sync-classes)
  - [Advanced Pseudo classes](#advanced-pseudo-classes)


# Introduction

## DATEX

The purpose of the DATEX protocol is to provide advanced, encrypted peer-to-peer data exchange on an abstract level.
We developed the DATEX Binary Format (DXB), which is optimized for low-latency, secure transmissions from one to one or more endpoints.
The DATEX Protocol Language (DX) compiles to dxb and serves as a human-readable variant of the DATEX protocol.
In general, the DATEX protocol is a flexible multi-layer protocol, that provides at least the functionality of an ‘Application layer’, but can also provide a Presentation, Session, Transport, and Network layer if needed – this depends on the type of the actual underlying channel that is used for communication.

DATEX includes a pointer and pseudo-type system, which is designed to support object-oriented approaches and enable synchronization of object states between multiple clients. 

The DATEX Specification does not define the reading and writing behavior from and to actual objects, it only defines the instructions that need to be translated to the corresponding language. See the DATEX Translator Guide for more information.

DATEX is very flexible about the way data is exchanged - besides the object-oriented approach, JSON objects or simple strings can also be used to transmit data in a more conventional way.




## The DATEX Runtime

The DATEX Runtime is responsible for executing DATEX Binary Code in realtime and handles interaction with the overlying execution level, which in the following will be a JavScript environment (that could be browser oder NodeJS based).

The Runtime is always initialized with an endpoint that is associated with all executed scopes.

Active pointers and their corresponding metadata are generated, managed, and garbage-collected by the Runtime. 
The actual process of garbage collection is quite complex, since the multi-endpoint garbage collection has to be coordinated with the local garbage collection mechanism of the JS Runtime (further explanation: [Garbage Collection](#garbage-collection))

An active Runtime also stores information about DATEX Pseudo Classes from the DATEX Standard Library (std:) and optionally from additional custom Pseudo Classes that can be dynamically loaded into the Runtime.
*Static scopes*, which can function like libraries in other programmning languages, can also be added to the Runtime and imported in Datex Execution Scopes when needed.

The DatexSec-module in the Runtime takes care of encrypting/decrypting and signing/verifying in- and outgoing datex blocks.

[TODO]

The Runtime can be imported from 'datex_runtime.js'

## The DATEX Compiler

The DATEX Compiler works hand in hand with the Runtime when a conversion from readable DX to the binary format is needed. The Runtime itself comes with a DXB Decompiler.

The Compiler can be imported from 'datex_compiler.js' [TODO]


## Connection to the DATEX Cloud

The Datex JavaScript Library includes a list of connection details for several main endpoints in the distributed DATEX network. A suitably endpoint can be automatically selected to join the network.
A connection can be established with the following command:
```ts
await DatexCloud.connect(endpoint?:datex_endpoint, sign_keys?:[any,any], enc_keys?:[any,any], via_node?:DatexNode);
```
After a successful connection, outgoing commands from the Datex Runtime will be sent to the right recipients if they are reachable within the DATEX Cloud and incoming commands from other endpoints will be processed appropriately.


## Documention for DATEX Pseudo Classes and Static Scopes

DATEX has a builtin documentation functionality to get help and information about specific features. 

Documentation for the Datex Standard Libary is included per default in the Datex JS Libary and located in the dx_data directory (type_info.dx).
Additional custom entries can be added in this file or dynamically at runtime.[TODO]

In a DATEX interactive command line, like the one included in the DATEX module for *UIX*, Documention about a Pseudo Class can be displayed using the special `<&>` casting operator. [TODO]


## Debugging DATEX in the browser

In most cases, it is not necessary to write raw DATEX code since the most solutions can be implemented via the DATEX-JS Interface.
Nevertheless, it is very helpful to be able to debug DATEX directly.

The recommended way to write and test DATEX code in the browser is via the DATEX *UIX* module, which includes an editor and an I/O-Console which shows the results of the `print` and `printf` functions from the std: library, the result of each scope execution, and accepts input for the `read` function.

Additionally, there is a View which shows all currently active pointers and their contents, as well as all loaded static scopes.
Executed Datex Blocks can also be viewed as raw DXB Binary for advanced debugging.

The JavasScript Developer Console can also be very helpful to debug DATEX.
Every DATEX pointer is accessible as a global variable by its unique id (e.g. `$333ea0ea348fdb73c1f4a7bae4e6206c00000000000f04a3`).
The `printn` function can be used to log values directly in the JS Console.
DATEX can also be executed from the console with `await dx('...')` and the result of the scope execution is returned to the console.




# The DATEX Runtime

## Executing DATEX in the Runtime





# The DATEX Standard Library

##  `std:` Pseudo Classes

All `std:` pseudo types are accessible via `DatexType.std.*`.

* **`Int`**: A signed integer
* **`Float`**: A floating point value (since JavaScript does not distinguish between floats and integers, all numbers are treated as floats per default)
* **`String`**: a string like in JavaScript
* **`Unit`**: an integer value, used as a currency value
* **`Boolean`**: true or false
* **`Null`**: null or undefined in JavaScript
* **`Void`**: indicates that nothing should be passed on or returned (no JS equivalent)
* **`Buffer`**: Byte Array, corresponds to ArrayBuffers or other Typed Arrays in JavaScript
------------------------
* **`Set`**: Same as a JavaScript Set
* **`Map`**: Same as a JavaScript Map
------------------------
* **`Object`**: A JSON Object (can be modified and extended as needed)
* **`Array`**: A JSON Array (can be modified and extended as needed)
* **`Tuple`**: A special form of an Array which cannot be modified and is mainly used to pass multiple arguments to a datex `<Function>`
------------------------
* **`Type`**: Has a corresponding class in JavaScript (`DatexType`)
* **`Function`**: Extension of the default JavaScript Function, also handles remote calls and argument type checking, JavaScript Class: `DatexFunction`
* **`Markdown`**: Contains raw markdown, required for the documentation functionality; JavaScript class: `Markdown`
* **`Filter`**: Contains a combination of filter targets to select specific endpoints, JavaScript class: `DatexFilter`
* **`Target`**: Corresponds to multiple JavaScript classes, e.g. `DatexAlias`, `DatexNode`, `DatexApp`
Time: DatexType.get("std:Time"),
* **`Not`**: Used to negate a filter target (JavaScript class: `DatexNot`)
* **`Optional`**: Indicates that a value is optional; used in Function declarations; JavaScript class: `DatexOptional`
------------------------
* **`Error`**: A general, unspecified error
* **`SyntaxError`**: Invalid syntax was detected during the compilation of a DX script
* **`CompilerError`**: Other error during compilation
* **`PointerError`**: Error with a pointer (e.g. does not exist, already exists, ...)
* **`ValueError`**: An invalid value was provided
* **`PermissionError`**: The endpoint does not have the required permission for a certain action
* **`TypeError`**: Invalid or wrong type, or an error while casting between types
* **`NetworkError`**: There is a problem with the connection to the network or similar
* **`RuntimeError`**: A general, unspecified error while executing a DXB block
------------------------
* **`Datex`**: Contains a complete executable DXB block (can be used e.g. as the content of a `<Function>`)

* **`#`**: special operator: returns the type of a value (as a `<Type>` value)
* **`?`**: special operator: shortcut for `<Optional>`
* **`&`**: special operator: returns the documentation for a pseudo type (as a `<Markdown>` value)


# DATEX Types



# The DATEX JS Interface

##  @sync classes

##  Advanced Pseudo classes
