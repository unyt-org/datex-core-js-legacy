# Introduction to the DATEX JavaScript Library

## Important DATEX concepts

### Pointers
In DATEX, every value can be bound to a reference.
A reference can be either a local reference or a global reference (*pointer*).

Pointers can be accessed and modified across the network from multiple endpoints at once
(the creator of a pointer can configure read and write permissions for other enpoints).

Pointers can also be transformed into new pointers. A transformed pointer is always updated to
hold the value defined by a *transform function*.

In DATEX, every value (including primitives) can be assigned to a pointer.

```datex
ref a = 5; // create a new pointer with the value '10'
ref b = 0; // create a new pointer with the value '32'
ref sum = always a + b; // create a pointer with the transformed value of 'a + b'

b = 5; 	   // update the value of the pointer 'b'
print sum; // the pointer 'sum' now has the value '10'
```
----
Throughout this tutorial, we will use DATEX Script (like in the example above) to explain some DATEX specific concepts - but you don't need to write your code with DATEX - all important features are also available in the DATEX JavaScript API. If you want to try out DATEX Script, check out the [DATEX Playground](https://playground.unyt.org/)

----


### Endpoints

An *endpoint* in the DATEX world is an entity that is participating in the network. 
Endpoints can be associated with people or institutions, but they can also be completely anonymous.

Each endpoint can connet multiple *endpoint instances* to the network simulataneously.
Endpoints communicate via DATEX, either with relays or over direct connections.

Endpoint identifiers always start with an '@' symbol and contain alphanumeric characters or a hex id in
the case of anonymous endpoints.

```datex
val hello = @example :: helloWorld(); // execute 'helloWorld' on example and save the value in the 'hello' variable
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

Due to the limitations of the JavaScript language, there are just some pitfalls that you should be aware of:

#### Pitfall 1: References in JavaScript

JavaScript does not support references for primitive values (e.g. numbers, strings, booleans).
Because of this, primitive pointers must always be passed on with a wrapper object to keep the reference intact:
```ts
const refA: Datex.Pointer<number> = $$(5);
```
The advantage of having the `Datex.Pointer` interface always exposed as a primitive value wrapper is, that utility methods like `observe` can be easily accessed:

```ts
refA.observe(a => console.log(`refA was updated: ${a}`)); // called every time the value of refA is changed
```
Primitive pointers are still automatically converted to their primitive representation in some contexts, but keep in mind that the references are lost at this point:
```ts
const refX = $$(2);
const refY = $$(3);
const result = (refX * refY) + 6; // = 12 (a normal JS primitive value)
```
Primitive pointers can also be compared with a weak equality operator (`==`), but we do not encourage this,
because type coercion of the weak equality operator can lead to unexpected results. To compare pointer values, always compare their `.val` properties with a strict equality operator:
```ts
const refString1 = $$("hello");
const refString2 = $$("hello");

console.log(refString1.val === refString2.val); // true
console.log(refString1 === refString2); // false, not the same reference
```

-----
**Comparison to DATEX comparison operators**

DATEX also has a `==` and `===` comparison operator.
The `===` operator also compares the identity of the operands,
while the `==` operator, in contrast to JavaScript, always checks for value equality.

This means that `(1 == 1)` and `([1,2,3] == [1,2,3])` are `true`, but `(1 == "1")` is `false`.

-----


Non-primitive values exists in the JavaScript space as normal objects, because they don't have the reference problem:
```ts
const refArray1: string[] = $$(['some', 'example', 'values']);
```
This value provides the same interface a a normal JavaScript array. You can access the
indices and use array operations like `push`, `shift`, etc..
Non-primitive values never expose the `Datex.Pointer` interface per default.
This also applies for pointer properties:
```ts
const refObject: Record<string, number> = $$({a: 123});
const refNum = $$(789);

refObject.b = 456;
console.log(refObject.b); // 456

refObject.c = refNum;
console.log(refObject.c); // 789 (not Datex.Pointer<789>)
```
To get the underlying references for a pointer object, use the special `$` property:
```ts
console.log(refObject.$.c) // Datex.Pointer<789>
refObject.$.c = $$(100); // update the underlying reference for refObject.c
```
To access the `Datex.Pointer` interface of a pointer object, use the `Datex.Pointer.getByValue` function:
```ts
Datex.Pointer.getByValue(refObject)
    .observe(() => console.log("the value of refObject has changed"))
```


### Connecting to the Supranet

When the DATEX JS library is initialized, an anonymous endpoint is automatically created.
To connect to the network, call:
```ts
await Datex.Supranet.connect()
```
Per default, the endpoint joins the supranet by connecting to a unyt relay endpoint with a websocket connection.
You can always add custom connection channels and also connect over multiple channels at the same time.
For more information, check out the chapter [Supranet Networking](todo).


### Executing DATEX directly from JavaScript

DATEX Script code can also be directly executed from JavaScript:

```ts
const refHello = await datex `@example :: helloWorld()`
const refArray = await datex `[1,2,3]`
```
(To execute the `helloWorld` function on the `@example` endpoint, or do any other network related stuff, you always need to connect to the supranet first)