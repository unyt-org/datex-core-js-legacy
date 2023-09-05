# Introduction to the DATEX JavaScript Library

The DATEX JavaScript Library provides a JavaScript interface on top of a [DATEX Runtime environment](https://github.com/unyt-org/datex-specification).

It can be used as a standalone library to get access to DATEX features like reactivity, synchronized network storage and endpoints, or in combination with extension libraries like [UIX](https://docs.unyt.org/manual/uix/getting-started) to develop full-stack web applications.

---
We will use the term "*JavaScript*" throughout in this manual. This should be regarded as interchangable with "*TypeScript*", since this library is designed as a TypeScript library.

---

## Important DATEX concepts

In this section, we will give you a quick introduction to DATEX.
If you want to dive deeper, check out the [DATEX Language Specification](https://github.com/unyt-org/datex-specification).

### Pointers
In DATEX, every value can be bound to a reference.
A reference can be either a local reference or a global reference (*pointer*).

Pointers can be accessed and modified across the network from multiple endpoints at once
(the creator of a pointer can configure read and write permissions for other enpoints).

Pointers can also be transformed into new pointers. A transformed pointer is always updated to
hold the value defined by a *transform function*.

In DATEX, every value (including primitives) can be assigned to a pointer.

```rust
ref a = 5; // create a new pointer with the value '10'
ref b = 0; // create a new pointer with the value '32'
ref sum = always a + b; // create a pointer with the transformed value of 'a + b'

b = 5; 	   // update the value of the pointer 'b'
print sum; // the pointer 'sum' now has the value '10'
```
----
Throughout this manual, we will use DATEX Script (like in the example above) to explain some DATEX specific concepts - but you don't need to write your code with DATEX - all important features are also available in the DATEX JavaScript API. If you want to try out DATEX Script, check out the [DATEX Playground](https://playground.unyt.org/)

----


### Endpoints

An *endpoint* in the DATEX world is an entity that is participating in the network. 
Endpoints can be associated with people or institutions, but they can also be completely anonymous.

Each endpoint can connect multiple *endpoint instances* to the network simulataneously.
Endpoints communicate via DATEX, either with relays or over direct connections.

Endpoint identifiers always start with an '@' symbol and contain alphanumeric characters or a hex id in
the case of anonymous endpoints.

```rust
ref hello = @example :: helloWorld(); // execute 'helloWorld' on example and save the value in the 'hello' variable
```

Endpoints can create pointers, expose public properties, handle permissions for pointers and much more. We won't go into to much detail at this point. You can always check out the [DATEX Specification](https://github.com/unyt-org/datex-specification) to learn more about DATEX and endpoints.

## Using the DATEX JavaScript API

### Creating pointers

To create a pointer for any JS value, just use the `$$` helper function:

```tsx
const refA = $$(5);
const refB = $$(0);
const refSum = always(() => refA + refB);

refB.val = 5;
console.log(refSum.val) // 10
```

This code is equivalent to the DATEX code above. 
As you can see, the DATEX concepts are adopted in JavaScript in a very straightforward way.

To learn more about DATEX pointers in JavaScript, check out the chapters [Pointers](2%20Pointers.md).

### Creating DATEX-compatible classes

Per default, most native JavaScript types (Arrays, Maps, Sets, primitive values, JSON Objects) are compatible with DATEX. This means that they can be converted to an equivalent DATEX representation and shared between endpoints.

Instances of custom classes are mapped to a generic DATEX object representation per default and thus loose their class type and prototypes.

With the `@sync` decorator, a class can be bound to a new DATEX type.

All instance properties decorated with `@property` are bound to the DATEX value and also visible when the value is shared between endpoints. 
Per default, the properties are local and only available in the current JavaScript context.

```ts
@sync class MyObject {
  @property a = 10
  @property b = 20
  localProp = 4
}

const obj = new MyObject();
```

Instances of a class marked with `@sync` are also automatically bound to a pointer when created (The value does not have to be explicitly wrapped in `$$()`).

Read more about `@sync` classes [here](./6%20Classes.md).

### Persistent data

The DATEX JavaScript API allows you to access data from remote endpoints as normal JavaScript values.

With eternal pointers, DATEX-based applications can also access persistent data stored in their local storage in the same way - without the need for any third-party databases or other storage methods.

Check out the chapter [Eternal Pointers](./3%20Eternal%20Pointers.md) to learn more about this feature.

### Connecting to the Supranet

When the DATEX JS library is initialized, an anonymous endpoint is automatically created.
To connect to the network, call:
```ts
await Datex.Supranet.connect()
```
Per default, the endpoint joins the supranet by connecting to a unyt relay endpoint with a websocket connection.
You can always add custom connection channels and also connect over multiple channels at the same time.
For more information, check out the chapter [Supranet Networking](./4%20Supranet%20Networking.md).


### Executing DATEX directly from JavaScript

DATEX Script code can also be directly executed from JavaScript:

```ts
const refHello = await datex `@example :: helloWorld()`
const refArray = await datex `[1,2,3]`
```

To execute functions on remote endpoints or do any other network related stuff, you always need to connect to the supranet first.

Read more about the advanced DATEX APIs in the [DATEX API Chapter](./5%20The%20DATEX%20API.md).
