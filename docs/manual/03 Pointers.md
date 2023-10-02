# Pointers and References

## Creating Pointers

To create a pointer for any JS value, just use the `$$` helper function.

```ts
const refA = $$(5);
const refB = $$(0);
const refSum = always(() => refA + refB);

refB.val = 5;
console.log(refSum.val) // 10
```


## Pointers for object values and pointer properties.

Pointer can also be created for non-primitive values (JSON Objects, Maps, Sets, ...).

```ts
const refObj = $$({
    x: 100,
    y: 200
});
```

The created reference object can be used like a normal object:
```ts
refObj.x; // 100
refObj.x = 50;
```

Live references for the properties of an object can be accessed via the special `$` property:
```ts
refObj.$.x // Datex.Ref<number>
```

Alternatively, the `$$` function can be used:
```ts
$$(refObj, "x") // Datex.Ref<number>
```

### The `always` transform function

The `always` function automatically determines all dependency values and recalculates when one of the dependencies changes.
For this reason, this function is very flexible and can be used for simple calculations or more complex functions.
The `always` function is just one of a group of so-called *Transform functions*.

There exist multiple transform functions that are optimizied for specific use cases like mathematical calculations
and can be used instead of a generic `always` function.
Read more about transform functions in the chapter [Functional Programming](./6%20Functional%20Programming.md).

Due to the limitations of the JavaScript language, there are just some pitfalls that you should be aware of:


### References in JavaScript

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

## Collapsing references

Non-primitive pointer values are normally always passed in their collapsed form (normal JavaScript object representation). 

In contrast, primitive pointer values and pointer properties are always passed as `Datex.Ref` values and have to be collapsed to get the normal JavaScript represententation (e.g. `Datex.Ref<number>` -> `number`).

For this purpose, the `val()` helper
function can be used:

```ts
const refX: Datex.Ref<number> = $$(42);
const valX: number = val(refX);
```

If a non-reference value (e.g. a normal `number` or object) is passed to the `val` function, the value is just returned, so that it is guaranteed to always return a normal JavaScript value.
