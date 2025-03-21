# Introduction to DATEX JS

> [!WARNING]
> The current implementation of the DATEX JavaScript Library is still a beta version.
> We are actively working on a new stable [Rust implementation](https://github.com/unyt-org/datex-core) that will be much more performant.

The DATEX JavaScript Library (*DATEX JS*) enables fine-grained reactivity with cross-device processing including data synchronisation.

This library is a great fit for various usecases:
 * Client-side reactivity (e.g. reactive web apps like [React](https://react.dev/))
 * Cross-device reactivity (e.g. multiplayer games)
 * Secure end-to-end data exchange and synchronisation (e.g. end-to-end encrypted messengers)
 * distributed computing (e.g. blockchain algorithms)

The [UIX framework](https://uix.unyt.org/) provides a developer-friendly abstraction around DATEX JS to create reactive fullstack web applications.

DATEX JS implements a JavaScript interface on top of a DATEX Runtime environment.
If you want to learn more about the DATEX, check out the  [Specification](https://github.com/unyt-org/datex-specification)

> [!NOTE]  
> We will use the term "*JavaScript*" throughout in this manual. This should be regarded as 
> interchangable with "*TypeScript*", since this library is designed as a TypeScript library.


## Using DATEX JS

### Creating pointers


To create a pointer for any JS value, just use the `$$` helper function:

```tsx
const refA = $$(5);
const refB = $$(0);
const refSum = always(() => refA + refB);

refB.val = 5;
console.log(refSum.val) // 10
```

When you compare this code with the [example code](./02%20Important%20DATEX%20Concepts.md#references-and-pointers) from the DATEX introduction chapter, 
you can see how the DATEX concepts are adopted in JavaScript in a very straightforward way.

To learn more about DATEX pointers in JavaScript, check out the chapter [Pointers](./03%20Pointers.md).
In the chapter [Functional Programming](./09%20Functional%20Programming.md), you can read more about `always` and other transform functions.

### Pointer synchronisation

Check out the chapter [Pointer Synchronisation](./04%20Pointer%20Synchronisation.md) to understand
how pointers are synchronized between endpoints.

### Creating DATEX-compatible classes

With the `struct` wrapper, a class can be bound to a new DATEX type.

All instance properties decorated with `@property` are bound to the DATEX value and also visible when the value is shared between endpoints. 
Per default, the properties are local and only available in the current JavaScript context.

```ts
const MyObject = struct(
  class {
    @property a = 10
    @property b = 20
    localProp = 4
  }
)

const obj = new MyObject();
```

Instances of a class wrapped with `struct` are also automatically bound to a pointer when created (The value does not have to be explicitly wrapped in `$$()`).

Read more about `struct` classes [here](./12%20Classes.md).

### Persistent data

DATEX JS allows you to access data from remote endpoints as normal JavaScript values.

With [eternal pointers](./04%20Eternal%20Pointers.md), DATEX-based applications can also access persistent data stored in their local storage in the same way - 
without the need for any third-party databases or other storage types.


### Connecting to the Supranet

When the DATEX JS library is initialized, an anonymous endpoint is automatically created.
To connect to the network, call:
```ts
await Datex.Supranet.connect()
```
Per default, the endpoint joins the Supranet by connecting to a unyt.org relay endpoint with a websocket connection.
You can always add custom connection channels and also connect over multiple channels like WebRTC at the same time.
For more information, check out the chapter [Supranet Networking](./05%20Supranet%20Networking.md).


### Executing DATEX directly from JavaScript

DATEX Script code can also be directly executed from JavaScript:

```ts
const refHello = await datex `@example :: helloWorld()`
const refArray = await datex `[1,2,3]`
```

To execute functions on remote endpoints or do any other network related stuff, you always need to connect to the supranet first.

Read more about the advanced DATEX APIs in the [DATEX API Chapter](./08%20The%20DATEX%20API.md).
