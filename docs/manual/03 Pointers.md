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

This creates the [pointers](#pointers-for-primitive-values) `refA`, `refB` and a reactive [transformed](#transform-functions)
`refSum` pointer that gets updated when `refA` or `refB` are changed.


## Pointers for object values and pointer properties.

Pointer can also be created for non-primitive values (JSON Objects, Maps, Sets, ...).

```ts
const refObj = $$({
    x: 100,
    y: 200
});
const refArray1: string[] = $$(['some', 'example', 'values']);
```

The created reference object can be used like a normal object. You can access all properties and methods.
```ts
refObj.x; // 100
refObj.x = 50;
refArray[0] // 'some'
refArray.push('more');
```

The underlying references for the properties of an object can be accessed via the special `$` property:
```ts
refObj.$.x // Datex.Ref<number>
```

With the `$$` property, a strong reference to the property (pointer property) can be created.
A pointer property will always point to the reference assigned to the property name.
```ts
const propX = refObj.$$.x; // Datex.PointerProperty<number>

refObj.x = 10; // update the value of refObj.x
propX.val // 10, same as with normal reference

refObj.$.x = $$(4); // assign a new reference to refObj.x
propX.val // 4, points to the newly assigned reference
```

Alternatively, the `$$` function can be used:
```ts
$$(refObj, "x") // Datex.PointerProperty<number>
```


## Pointers for primitive values

With DATEX, primitive values can also be used as references.

Since JavaScript does not support references for primitive values (e.g. numbers, strings, booleans), 
primitive references are always wrapped in a `Datex.Pointer` object to keep the reference intact:

```ts
const refA: Datex.Pointer<number> = $$(5);
```
The advantage of having the `Datex.Pointer` interface always exposed as a primitive value wrapper is that utility methods like `observe` can be easily accessed:

```ts
refA.observe(a => console.log(`refA was updated: ${a}`)); // called every time the value of refA is changed
```
Primitive pointers are still automatically converted to their primitive representation in some contexts, but keep in mind that the references are lost at this point:
```ts
const refX = $$(2);
const refY = $$(3);
const result = (refX * refY) + 6; // = 12 (a normal JS primitive value)
```

> [!WARNING]
> In certain cases, it is required to use the `.val` property because the type coercion does not behave as you might expect.
> 
> Primitive pointers can be compared with a weak equality operator (`==`), but we do not encourage this,
> because type coercion of the weak equality operator can lead to unexpected results.
> To compare pointer values, always compare their `.val` properties with a strict equality operator:
> ```ts
> const refString1 = $$("hello");
> const refString2 = $$("hello");
>
> console.log(refString1.val === refString2.val); // true
> console.log(refString1 === refString2); // false, not the same reference
>
> ```
> A similar problem occurs when using boolean operators like `!` on a non-collapsed boolean pointer:
> ```ts
> const refBool = $$(false);
> if (!refBool) console.log("bool is false") // expected branch to be executed
> else console.log("bool is true") // actually executed
> ```
> When using boolean operators, always compare their `.val` properties.
>
> Consider using dedicated [transform functions](./09%20Functional%20Programming.md) for boolean or comparison transforms.



### Transform functions

The `always` function automatically determines all dependency values and recalculates when one of the dependencies changes.
For this reason, this function is very flexible and can be used for simple calculations or more complex functions.
The `always` function is just one of a group of so-called *Transform functions*.

There exist multiple transform functions that are optimizied for specific use cases like mathematical calculations
and can be used instead of a generic `always` function.
Read more about transform functions in the chapter [Functional Programming](./09%20Functional%20Programming.md).


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
