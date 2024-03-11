# Eternal Pointers

The concept of eternal pointers allows DATEX-based applications to keep persistent data without
the need for any third-party databases or other storage methods.

## Pointer Lifetime

Pointers can exist beyond the scope of their origin endpoint both in **space** and **time**.

This means that a pointer can exist on other endpoints and keeps existing even if the original endpoint is
deleted or offline, as long as there is still a reference somewhere.

Since pointers are identfied globally by a unique id, a pointer value can always be retrieved again from any trusted endpoint that still has a reference to the value.

## Ensuring an eternal lifetime for local pointers

Pointers are not shared with the network per default, only when they are also used by another endpoint.
This means that per default, pointers only exist in the local memory of an endpoint and are gone after the endpoint process is stopped.

## Using the `eternal`/`eternalVar` label

To let a pointer exist beyond the lifetime of an endpoint, the `eternal` label can be used:

```ts
const users = eternal ?? $$(new Set<string>());

export function addUser(name: string) {
    users.add(name)
}
```

This guarantees that the `users` Set is only ever created once.

Even if the endpoint is restarted (page reload or deno process restart), the `users` variable will refer to the same pointer as before, meaning that any users added previously are still in the Set.

With the `eternal` label, pointers are not shared with the network. They are still only available on the origin endpoint per default, but also stored in the endpoint cache (`.datex-cache` directory or browser storage).

Using the `eternal` label can lead to problems when the source code is modified. 
For this reason, it is currently recommended to use the `eternalVar` function instead.
You can pass a unique identifier to `eternalVar` to guarantee that the eternal pointer is always correctly mapped:

```ts
const users = eternalVar('users') ?? $$(new Set<string>());
```


> [!NOTE]
> The expression followed by the `eternal` value must be always enclosed with `$$()`.
> This ensures that a new pointer is created and is also necessary to bind the eternal pointer to the correct value within the JavaScript module.

> [!WARNING]
> You should only use `eternal` for native values (e.g. primitive values, Arrays, Sets, Maps). For custom classes and types, use `lazyEternal`.

---
The DATEX Script equivalent to creating eternal values is the *init* operator (`:=`):
```rust
ref users := Set ();

export function addUser(name: text) (
    users += name
)
```
In contrast to the `eternal` label in JS, the init operator can also be used for non-pointer values.

---

## Using the `lazyEternal` label

Pointers created and restored with `eternal`/`eternalVar` are loaded at endpoint startup.
This guarantees that `eternal` can be used synchronously (without `await`).
For the following usecases, the asynchronous `lazyEternal`/`lazyEternalVar` label should be used instead of `eternal`/`eternalVar`:

 * A value that consumes lots of memory and is only actually needed when certain conditions are met
 * A value that requires custom JavaScript bindings (e.g. a `struct` class instance). JavaScript bindings cannnot be properly initialized at endpoint startup if the corresponding JavaScript class definition is not yet loaded.

The `lazyEternal`/`lazyEternalVar` label can be used the same was as the `eternal` label, only requiring an additional `await`:

```ts
import { User } from "user.ts";

const users = await lazyEternalVar('users') ?? $$(new Set<User>());
```

## Resetting eternal state

Delete the `.datex-cache` directory or clear your browser site data.
In UIX, this can also be achieved by running `uix --clear`.