# The DATEX API

## The `datex` template function

With the `datex` template function, DATEX Script code can be directly executed from a JS context and the result can be read. 

```ts
const set = await datex `Set (1, 2, 'x', 'y')` // creates a Set {1,2,'x','y'}
const int = await datex `(100 + 50) / 10`; // integer calculation, returns 15n

```
### Dynamic Injections 

When executing a DATEX Script, values can be passed from the JS context.
Values passed into the script template string are always escaped to prevent injection attacks.

```ts
const val = $$(10);
const result = await datex `${val} + ${10}` // returns 20
```

## Loading Resources with `datex.get()`

The `datex.get()` function is completely comapatible with the native dynamic `import()` function.

Additionally, it supports importing DATEX scripts (.dx and .dxb files), as well as endpoint exports, pointers and other DATEX resources.

Examples:

```ts
const jsModule = await datex.get("./example.js")
const dxModule = await datex.get("./example.dx")
const endpointExports = await datex.get("@example")
condt pointer = await datex.get("$A3627E3737476859492")
```
