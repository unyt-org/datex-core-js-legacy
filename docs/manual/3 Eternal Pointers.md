# Eternal Pointers

The concept of eternal pointers allows DATEX-based applications to keep persistent data without
the need for any third-party databases or other storage methods.

## Pointer Lifetime

Pointers can exist beyond the scope of their origin endpoint both in **space** and **time**.

This means that a pointer can exist on other endpoints and keeps existing even if the original endpoint is
deleted or offline, as long as there is still a reference somewhere.

Since pointers are identfied globally by a unique id, a pointer value can always be retrieved again from any truested endpoint that still has a reference to the value.

## Ensuring an eternal lifetime for local pointers

Pointers are not shared with the network per default, only when they are also used by another endpoint.
This means that per default, pointers only exist in the local memory of an endpoint and are gone after the endpoint proccess is stopped.

## Using the `eternal` label

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

*The expression followed by the `eternal` value must be always enclosed with `$$()`. This ensures that a new pointer is created and is also necessary to bind the eternal pointer to the correct value within the JavaScript module.*

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