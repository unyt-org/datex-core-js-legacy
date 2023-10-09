# Threads

The DATEX JS Library supports multi-threading with [Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API).
DATEX-compatible values like functions or complex objects can also be shared between threads.
The library provides a way to use threads in a type-safe way.

## Usage

The following example demonstrates the creation of a new thread with exports that can be accessed
from the parent thread.

```ts
/// file: thread.ts
export function exportedFunction(x: number, y:nuumber) {
  return x + y
}
export const exportedValue = $$([1,2,3]);
```

```ts
/// file: main.ts
import { spawnThread } from "datex-core-legacy/threads/threads.ts";

// spawn a new thread and load the 'thread.ts' module
using thread = await spawnThread<typeof import('./thread.ts')>('./thread.ts');
// access exported values:
const res = await thread.exportedFunction(1,2);
thread.exportedValue.push(4);
```

## Thread disposal

When a new thread is created with the `using` specifier, it is automatically disposed on scope exit.
Alternatively, you can explicitly dispose a thread with the `disposeThread` function:

```ts
import { spawnThread, disposeThread } from "datex-core-legacy/threads/threads.ts";

// spawn a new thread and load the 'thread.ts' module
const thread = await spawnThread<typeof import('./thread.ts')>('./thread.ts');
// do some stuff with this thread
disposeThread(thread)
// thread is no longer accessible
```


## Immediately evaluated tasks

Instead of declaring a thread module in a separate file, a function can be passed to `run` to be executed in a new thread immediately.
Values from the parent scope can be passed to the thread by explicitly adding them to the `using()` declaration at the beginning of the
function body.

In the following example, a function calculates the nth fibonacci number in a thread.
The `n` index variable is accessed from the parent scope.

```ts
import { run } from "datex-core-legacy/threads/threads.ts";

let n = 10000n;

// calculate fibonacci number in a separate thread
let fibonacciNumber = await run(() => {
  using (n);

  let n1 = 0n;
  let n2 = 1n;
  let nextTerm = 0n;

  for (let i = 1; i < n; i++) {
      console.log(n1);
      nextTerm = n1 + n2;
      n1 = n2;
      n2 = nextTerm;
  }
  return n1;
});
```


### Executing DATEX Script

The `run` function can also be used to run a DATEX Script in a separate thread:

```ts
import { run } from "datex-core-legacy/threads/threads.ts";

let n = 10000n;

// calculate fibonacci number in a separate thread
let fibonacciNumber = await run `
  val n1 = 0;
  val n2 = 1;
  val nextTerm = 0;
  val i = 0;

  iterate (i..${n}) (
    print n1;
    nextTerm = n1 + n2;
    n1 = n2;
    n2 = nextTerm;
  );
  n1;
`
```

Values from the parent scope can be injected in template string as with the [`datex` function](./5%20The%20DATEX%20API.md#the-datex-template-function)

### Running multiple concurrent tasks

With the `runConcurrent` functions, multiple threads can be spawned to run a task concurrently.
Per default, `runConcurrent` returns an array of Promises containing the results of all the threads.

Optionally, a Promise mapping function (e.g. `Promise.all`) can be passed to `runConcurrent` to return a mapped result


```ts
import { runConcurrent } from "datex-core-legacy/threads/threads.ts";

// spawn 10 threads to find a random number >= 0.999
// 'results' is an Array<Promise<number>>
let results = await runConcurrent(() => {
  let value = 0
  while (value < 0.999) {
    value = Math.random();
  }
  return value;
}, 10);
```

```ts
import { runConcurrent } from "datex-core-legacy/threads/threads.ts";

// spawn 10 threads to find a random number >= 0.999
// and stop if one thread is finished
// 'result' is a number
let result = await runConcurrent(() => {
  let value = 0;
  while (value < 0.999) {
    value = Math.random();
  }
  return value;
}, 10, Promise.any);
```

> [!NOTE]
> Passing `Promise.any` to `runConcurrent` produces the same outcome as calling 
> `Promise.any` on the result returned from `runConcurrent`.
> 
> However, there is a significant performance improvement when passing `Promise.any` as a 
> parameter to `runConcurrent`: When one of the threads returns a result, 
> all other threads are automatically prematurely terminated, instead of continuing until they are
> finished. 


## Thread pools

TODO
