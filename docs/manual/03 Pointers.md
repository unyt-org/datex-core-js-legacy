# Pointers and References

## Creating Pointers

To create a pointer for any JavaScript value, you can use the `$$` helper function.
The `always` helper function lets you define a reactive pointer that depends on other
pointers.

```ts
const refA = $$(5);
const refB = $$(0);
const refSum = always(() => refA + refB);

refB.val = 5;
console.log(refSum.val) // 10
```

This creates the [pointers](#pointers-for-primitive-values) `refA`, `refB` and a reactive [transformed](#transform-functions)
`refSum` pointer that gets updated every time `refA` or `refB` are changed.


## Pointers for object values and pointer properties

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

### Recursive pointer initialization

In most cases, when an object is bound to a pointer, its property values are automatically bound to pointers recursively:

```ts
const map = new Map([
    ['y', {
        a: 10,
        b: 20
    }]
]);

Datex.Ref.isRef(map) // false, not bound to a pointer
Datex.Ref.isRef(map.get('y')) // false, not bound to a pointer

const nestedObject = $$({
    map: map
})

nestedObject.map // Map
Datex.Ref.isRef(map) // true, was implicitly bound to a pointer
Datex.Ref.isRef(map.get('y')) // true, was implicitly bound to a pointer
```

There are some exceptions to this behaviour:
1. Primitive property values are not converted to pointers per default
2. Normal [class instances](./10%20Types.md#jsobject) (`js:Object`) are not converted to pointers per default.
   Instances of [`@sync`](11%20Classes.md) classes are still converted to pointers
3. When a [class instances](./10%20Types.md#jsobject) is directly bound to a pointer with `$$()`, its
   properties are not converted to pointers per default (like 2., this does not affect `@sync` class instances 



## Pointers for primitive values

With DATEX, primitive values can also be used as references.

Since JavaScript does not support references for primitive values (e.g. numbers, strings, booleans), 
primitive references are always wrapped in a `Datex.Pointer` object to keep the reference intact:

```ts
const refA: Datex.Pointer<number> = $$(5);
```
The advantage of having the `Datex.Pointer` interface always exposed as a primitive value wrapper is that utility methods like [`observe`](#observing-pointer-changes) can be easily accessed:

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

The `always()` function automatically determines all dependency values and recalculates when one of the dependencies changes.
For this reason, this function is very flexible and can be used for simple calculations or more complex functions.
The `always()` function is just one of a group of so-called *Transform functions*.

There exist multiple transform functions that are optimizied for specific use cases like mathematical calculations
and can be used instead of a generic `always()` function.
Read more about transform functions in the chapter [Functional Programming](./09%20Functional%20Programming.md).

## Using effects

With transform functions, value can be defined declaratively.
Still, there are some scenarios where the actual pointer value change event must be handled with custom logic.
For this scenario, the `effect()` function can be used.

On the first glance, the `effect()` function works similarly to the `always()` function:

It is called every time a dependency value changes, 
but in contrast to the `always()` function, it does not create a new pointer.

An `effect()` handler can also have side-*effects* (hence the name).

```ts
const id = $$(42);

// define a new effect (is immediately invoked)
effect(() => {
    console.log("new id:" + id);
    fetch(`https://api.example.com?id=${id}`).then(...)
})

id.val = 35; // triggers the fetch effect again
```

> [!WARNING]
> Keep in mind that effect handler are only triggered by pointer updates.
> Updating the value of a plain JavaScript variable does not have an effect:
> ```ts
> let id = 10;
> effect(() => console.log("id: " + id));
> id = 12; // does not trigger the effect
> ```

### Clearing effects

The `effect` function returns an object with a `dispose()` method that can be called to clear the effect.

```ts
function task() {
    const x = $$(0);
    // effect is run every time x changes
    const {dispose} = effect(() => console.log("x = " + x));

    for await (x of y) {
        x.val++;
    }

    // dispose effect
    dispose();
}
```

Alternatively, effects can be restricted to the livetime of a scope with the `using` keyword.
```ts
function task() {
    const x = $$(0);
    // effect is run every time x changes
    using e1 = effect(() => console.log("x = " + x));

    for await (x of y) {
        x.val++;
    }

    // effect is automatically disposed at the end of this scope
}
```

## Observing pointer changes

For more fine grained control, the `observe()` function can be used to handle pointer value updates.
In contrast to `effect()`, the `observe()` function does not automatically determine dependency values -
they are explicitly specified. 

```ts
const ptr = $$(10);

// log on value change
observe(ptr, value => console.log(`ptr value is now ${value}`));

// equivalent: instance method for primitive pointers
ptr.observe(nr, value => console.log(`ptr value is now ${value}`));

ptr.val++; // logs "ptr value is now 11"
```

An observer callback function gets called with up to 5 arguments:
```ts
(
    value: any, // the new value
    key?: any, // if a property of the pointer was changed, key contains the property key
               // and value contains the property value
    type: Ref.UPDATE_TYPE, // update type that triggered the observer
    isTransform?: boolean, // true if the observer was triggered by a transform function
    isChildUpdate?: boolean // true if the observer was triggered recursively by a child update
) => {
    // ...
}
```

The following update types exist:
```ts
enum Ref.UPDATE_TYPE {
    INIT, // pointer value was set for the first time
    UPDATE, // pointer value was updated
    SET, // a property was set
    DELETE, // a property was deleted
    CLEAR, // the value was cleared (all properties removed)
    ADD, // a child value was added (e.g. for Sets)
    REMOVE, // a child value was removed
    BEFORE_DELETE, // called before DELETE, before the property gets deleted from the value
    BEFORE_REMOVE // called before REMOVE, before the property gets removed from the value
}
```



### Canceling observers
Calling `unobserve()` with the same callback function that was passed to `observe()`
removes the observer.

```ts
const ptr = $$(10);

const observer = value => console.log(`ptr value is now ${value}`);

// enable observer
observe(ptr, observer);
nr.val++; // logs "nr value is now 11"

// disable observer
unobserve(ptr, observer);
nr.val++; // observer not triggered
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




