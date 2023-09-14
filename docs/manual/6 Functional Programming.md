# Functional Programming (Transform Functions)

The DATEX JavaScript Library supports functional programming concepts in combination with DATEX references (pointers).
Utility transform functions can be imported from `"unyt_core/functions.ts"`.

All transform functions are pure functions.

## The `always` Transform Function

The `always` function can be used to define a custom pure transform:
```ts
const colorA = $$("red");
const colorB = $$("green");
const c = $$(1);

const result: Datex.Ref<string> = always(()=>{
	if (c > 0) return `The color is ${colorA}`;
	else return `The color is ${colorB}`
})
```

As can be seen in the example above, the `always` function supports
all common JavaScript operations like comparisons and mathematical operations
as well as control flows like `if`/`else` branching.

The only restriction is that the function must be [pure](#appendix-the-definition-of-pure-functions-in-datex), meaning:
  1) External values (variables defined outside the scope of the function) should never be modified
  2) With the exception of `Datex.Ref` values, only constant external values should be used inside the function



## Creating Custom Optimized Transform Functions


## Appendix: The definition of 'pure' functions in DATEX