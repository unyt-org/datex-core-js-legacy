# Functional Programming (Transform Functions)

The DATEX JavaScript Library supports functional programming concepts in combination with DATEX references (pointers).

All transform functions are pure functions.
They return a live reference value that gets recalculated when one of the dependency values changes.

All standard transform functions can be imported from `"datex-core-legacy/functions.ts"`.

## Generic transform functions

### The `always` transform function

The `always` function can be used to define a custom transform:

```ts
const number = $(2);
const square = always(() => number**2)
square.val // -> 4
number.val = 3;
square.val // -> 9
```

```ts
const colorA = $("red");
const colorB = $("green");
const c = $(1);

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
  
  1) External variables defined outside the scope of the function should never be reassigned to a new value or modified.
  3) With the exception of `Datex.Ref` values, only constant external values should be used inside the function. To be on the safe side, only use
     external `const` variables.

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
const c = $(5);
const product: Datex.Ref<number> = always(() => c * 10);

// ✅ observer gets triggered when c is updated
product.observe((v) => console.log(v))
c.val = 20;
```

> [!NOTE]
> The `always` transform function must always be synchronous and must not return a Promise


#### Caching `always` output values

Since `always` functions are always required to be pure functions, it is possible to
cache the result of a calculation with given input values and return it at a later point in time.

This can be particularly useful when 
 * a calculation is very time-consuming
 * the `always` function is triggered very often but returns a limited set of output values

To enable output caching, set `cache` to `true` in the `always` options that are passed in as a second parameter:

```ts
const n = $(0);

const fibN = always(() => {
  console.log("calculating fibonacci nr " + n)
  return fibonacciNr(n.val);
}, {cache: true});

// triggered each time n/fibN is updated
effect(() => console.log(`fibonacci nr ${n} = ${fibN}`))

n.val = 42; 
// -> "calculating fibonacci nr 42"
// -> "fibonacci nr 42 = 267914296"

n.val = 1; 
// -> "calculating fibonacci nr 1"
// -> "fibonacci nr 1 = 1"

n.val = 42;
// calculation is not triggered again, cached result is used
// -> "fibonacci nr 42 = 267914296"
```

> [!WARNING]
> This feature is still experimental.
> It is not guaranteed that caches will be correctly used in every scenario.
> There is currently no way to limit the cache size, which could lead to memory leaks.


### The `asyncAlways` transform function

The `asyncAlways` function is similar to the `always` function, but can be used for async transforms.
The `asyncAlways` function awaits the result of the promise returned by the transform function and returns a `Ref` with the resolved value.

> [!WARNING] When using `asyncAlways`, only values that are captured before or in the first `await` statement are recorded as dependencies.

This means that the following code will *not* work as expected:
```tsx
const input = $(10);

const output = await asyncAlways(async () => {
    const res = await asyncOperation();
    return res + input.val // input is not captured here!
}) // ❌ 'output' is not recalculated when 'input' changes!
```

To fix this, you can capture the value of `input` before the `await` statement:
```tsx
const input = $(10);

const output = await asyncAlways(async () => {
    const val = input.val;
    const res = await asyncOperation();
    return res + val
}) // ✅ Correct usage
```

To make sure that all dependencies are captured, we recommend creating a separate async function and passing the dependencies as arguments:
```tsx
const input = $(10);

async function doAsyncStuff(input: number) {
    const res = await asyncOperation();
    return res + input
}

const output = await asyncAlways(() => doAsyncStuff(input.val)) // ✅ Correct usage
```

When you don't return a promise, the `asyncAlways` function will display a runtime warning:
```tsx
const output = await asyncAlways(() => input.val * 10) // 🔶 Runtime warning: use 'always' instead
```


### The `always` template function

Instead of providing a JavaScript callback function, you can also provide a DATEX Script as a template string to an `always` function:
```ts
let c = $(5);
const product: Datex.Ref<number> = await always `${c} * 10`
```

> [!NOTE]  
> When using a DATEX script template, the `always` function returns a Promise that has to be awaited.


In this form, the transform function can also be serialized and restored later, in contrast to normal JavaScript callback functions which cannot be serialized to DATEX.

### The `transform` function

The `transform` function works similar to `always`, with the difference that all dependency
value need to be explicitly specified:

```ts
const x = $(40);
const y = $(2);
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
const url = $("https://example.com/x");
const urlContent = transformAsync([url], async url => (await fetch(url)).json());
```

The same restrictions as for `transform` functions apply


## Reactive functions

The `always` transform function is useful for inline transforms, but sometimes you might want to define
reusable reactive functions.

One way to achieve this is by wrapping the body of a normal function with `always`:

```ts
// normal function
const getGreetingMessage = (country: string) => {
    switch (country) {
        case "de": return "Hallo";
        case "fr": return "Bonjour";
        case "es": return "Hola";
        default: return "Hello";
    }
}

// reactive version
const getGreetingMessageReactive = (country: RefOrValue<string>) => {
    // returns a Ref<string> that gets updated reactively
    return always(() => {
        switch (country) {
            case "de": return "Hallo";
            case "fr": return "Bonjour";
            case "es": return "Hola";
            default: return "Hello";
        }
    })
}
```

You can simplify this by just wrapping a normal function with `reactiveFn`.
Although the created reactive function is called with `Ref` values, you don't need to set the input argument types to `Ref` or `RefOrValue`:

```ts
// reactive function, returns a Ref<string> that gets updated reactively when 'country' changes
const getGreetingMessageReactive = reactiveFn((country: string) => {
    switch (country) {
        case "de": return "Hallo";
        case "fr": return "Bonjour";
        case "es": return "Hola";
        default: return "Hello";
    }
})

const country: Ref<string> = $("de");
const greetingMessage: Ref<string> = getGreetingMessageReactive(country);

console.log(greetingMessage.val) // "Hallo"

country.val = "fr";
console.log(greetingMessage.val) // "Bonjour"
```

## Dedicated transform functions

The DATEX JavaSccript Library provides some standard transform functions for common operations.

### add
Calculates the sum of multiple numbers.
```ts
const a = $(1);
const b = $(2);
const c = $(3);

const sum = add(a,b,c); // equivalent to always(() => a + b + c)
```

### sub
Calculates the difference of multiple numbers.
```ts
const a = $(44);
const b = $(2);

const difference = sub(a,b); // equivalent to always(() => a - b)
```

### mul
Calculates the product of multiple numbers.
```ts
const a = $(7);
const b = $(6);

const product = mul(a,b); // equivalent to always(() => a * b)
```

### div
Calculates the quotient of multiple numbers.
```ts
const a = $(84);
const b = $(2);

const quotient = div(a,b); // equivalent to always(() => a / b)
```

### pow
Calculates the result of a number raised to another number.
```ts
const a = $(10);
const b = $(2);

const raised = pow(a,b); // equivalent to always(() => a ** b)
```


### and
Calculates the logical conjunction of multiple boolean values.
```ts
const a = $(true);
const b = $(false);

const conjunction = and(a,b); // equivalent to always(() => a.val && b.val)
```

### or
Calculates the logical disjunction of multiple boolean values.
```ts
const a = $(true);
const b = $(false);

const disjunction = or(a,b); // equivalent to always(() => a.val || b.val)
```

### not
Calculates the negation of a boolean value.
```ts
const a = $(true);

const notA = not(a); // equivalent to always(() => !a.val)
```


### select
Switches between two values depending on the truthiness of another value.

```ts
const lightSwitchOn = $(false);

const sum = select(lightSwitchOn, "Yei light", "It's dark in here"); // equivalent to always(() => lightSwitchOn.val ? "Yei light" : "It's dark in here")
```

### selectProperty
Selects a property value from an object depending on a string reference.

```ts
const potato = {
    de: "Kartoffel",
    en: "potato",
    fr: "pomme de terre",
    kr: "비행기",
    schwä: 'Gromber'
};

const lang = $("de");

const translatedPotato = selectProperty(lang, potato); // equivalent to always(() => potato[lang])
```

### map
Maps an iterable to an array using a callback function (same API as Array.map).
```ts
const array = $([1,2,3]);
const double = map(array, v => v*2) // equivalent to always(() => array.map(v => v*2))
```



<!-- ## Appendix: The definition of 'pure' functions in DATEX

TODO -->
