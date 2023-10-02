# Functional Programming (Transform Functions)

The DATEX JavaScript Library supports functional programming concepts in combination with DATEX references (pointers).

All transform functions are pure functions.
They return a live reference value that gets recalculated when one of the dependency values changes.

All standard transform functions can be imported from `"unyt_core/functions.ts"`.

## Generic transform functions

### The `always` transform function

The `always` function can be used to define a custom transform:

```ts
const number = $$(2);
const square = always(() => number**2)
square.val // -> 4
number.val = 3;
square.val // -> 9
```

```ts
const colorA = $$("red");
const colorB = $$("green");
const c = $$(1);

const result: Datex.Ref<string> = always(()=>{
	if (c > 0) return `The color is ${colorA}`;
	else return `The color is ${colorB}`
})

// initial value
result.val; // -> "The color is red"

// update c
c.val = -1;
result.val; // -> "The color is green"

// update colorB
colorB.val = "blue";
result.val // -> "The color is blue"
```

As can be seen in the example above, the `always` function supports
all common JavaScript operations like comparisons and mathematical operations
as well as control flows like `if`/`else` branching.

The only restriction is that the function must be [pure](#appendix-the-definition-of-pure-functions-in-datex), meaning:
  
  1) External values (variables defined outside the scope of the function) should never be modified
  2) With the exception of `Datex.Ref` values, only constant external values should be used inside the function

Restriction (1) guarantees that there are no unintended sideffects when an `always` computation is invoked.
The following example illustrates why restriction (2) is useful:

```ts
let c = 5;
const product: Datex.Ref<number> = always(() => c * 10);

// ✅ getting the calculated value, this still works because the computation is triggered each time
product.val // -> 50
c = 10;
product.val // -> 100

// ❌ setting an observer, does not get triggered when c is updated
product.observe((v) => console.log(v))
c = 20;
```

The correct implementation for this example would be:
```ts
let c = $$(5);
const product: Datex.Ref<number> = always(() => c * 10);

// ✅ observer gets triggered when c is updated
product.observe((v) => console.log(v))
c = 20;
```

>  [!NOTE]  
>  The `always` transform function must always be synchronous and must not return a Promise

### The `always` template function

Instead of providing a JavaScript callback function, you can also provide a DATEX Script as a template string to an `always` function:
```ts
let c = $$(5);
const product: Datex.Ref<number> = await always `${c} * 10`
```

>  [!NOTE]  
>  When using a DATEX script template, the `always` function returns a Promise that has to be awaited.


In this form, the transform function can also be serialized and restored later, in contrast to normal JavaScript callback functions which cannot be serialized to DATEX.

### The `transform` function

The `transform` function works similar to `always`, with the difference that all dependency
value need to be explicitly specified:

```ts
const x = $$(40);
const y = $$(2);
const sum = transform([x,y], (x,y) => x + y);
```

In this case, the transform function still has to be pure, with one additional restriction:
  
  3) Only values specified in the dependencies array should be used in the transform function (Exception: constant values)

The transform function can be more efficient than the `always` function, but in most cases, the `always` function should be preffered.
A more relevant function is the `transformAsync` function explained in the next paragraph.

### The `transformAsync` function

The `always` function can only calculate values synchronously.
If `async` calculations are required, the `transformAsync` function can be used instead.

Example with an async `fetch` request:

```ts
const url = $$("https://example.com/x");
const urlContent = transformAsync([url], async url => (await fetch(url)).json());
```

The same restrictions as for `transform` functions apply

## Standard transform functions

The DATEX JavaSccript Library provides some standard transform functions for common operations.

### add
Calculates the sum of multiple number references.
```ts
const a = $$(1);
const b = $$(2);
const c = $$(3);

const sum = add(a,b,c); // equivalent to always(() => a + b + c)
```

### map
Maps an iterable to an array using a callback function (same API as Array.map).
```ts
const array = $$([1,2,3]);
const double = map(array, v => v*2) // equivalent to always(() => array.map(v => v*2))
```

## Appendix: The definition of 'pure' functions in DATEX

TODO
