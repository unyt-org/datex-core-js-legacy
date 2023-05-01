# Pointers

## Creating Pointers

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

### Pitfall 1: References in JavaScript

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
