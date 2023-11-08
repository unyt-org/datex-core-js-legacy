# Pointer Synchronisation

Every DATEX pointer can be shared and synchronized between multiple endpoints.

This chapter serves as an introduction to shared pointers and explains the concepts behind pointer synchronisation.


## Learn by example: Pointer synchronisation between two clients

### Setup

For this demonstration, you need two separate browser clients with a developer console.
Alternatively, you can start a Deno CLI process by running the `deno` command.

To initialize the endpoints, first import the DATEX runtime:
```ts
await import("https://cdn.unyt.org/datex-core-js-legacy/datex.js")
```

Now, you can connect to the supranet:
```ts
await Datex.Supranet.connect()
```
After a successful initialization, you should see the connection info printed to the console:

![Supranet connection info](./assets/supranet-init.png)


> [!INFO] You can learn more about supranet connections in the chapter [Supranet Networking](./06%20Supranet%20Networking.md).

### Creating a pointer

As explained in the chapter [Pointers](./03%20Pointers.md),
you can now create a new pointer with a number value.

```ts
const x = $$(42)
x.val // -> 42
```

This pointer is now accessible on any other endpoint in the supranet.

> [!NOTE]
> Per default, pointers have no read/write restrictions and can be accessed by any endpoint. This can be prevented by defining pointer permissions. This behaviour might also change in the future.

### Pointer IDs

Each DATEX pointer has a globally unique address (*pointer id*) that
is linked to an endpoint.
With this id, a pointer can be found in the supranet.

The pointer id can be accessed via the `id` property of a pointer instance:

```ts
x.id // -> e.g. "D5A3CB02310Dx480B651422749F9x40C85600300"
```

### Accessing remote pointers

Now that we know the id of the pointer, we can access it from another
endpoint.

Open a new browser tab or Deno CLI and follow the same steps
to load the DATEX runtime and connect to the supranet:
```ts
await import("https://cdn.unyt.org/datex-core-js-legacy/datex.js")
await Datex.Supranet.connect()
```

Now, we can use the `$` shortcut to load the pointer with the id:

```ts
const x = await $.D5A3CB02310Dx480B651422749F9x40C85600300
```

The variable `x` now holds a reference to the same pointer that we
created on the other client before.

You can verify this by reading the pointer value:
```ts
x.val // -> 42
```

### Synchronisation

The pointer that we stored in the variable `x` is not just a static value - its value is updated bidirectionally.

That means that any changes on the original client are reflected
on the second client, and vice-versa - try it out for yourself:

**Update value on first client:**
```ts
x.val = 10
```

**Read value on second client:**
```ts
x.val // -> 10
```

Pointer synchronisation does not just work with primitive values,
but also with objects, maps, sets, etc.


## Global Garbage Collection (GGC)

DATEX has a global garbage collection mechanism that handles shared pointers across the network.

Global garbage collection works with both primitive and complex pointers.

### Garbage collection rules

1. If a pointer was loaded from a *remote* endpoint, it is garbage collected if there are no local references to the pointer

2. If a pointer was created by the *local* endpoint, it is only garbage collected if the following conditions are fulfilled:
   * There are no local references to the pointer
   * There are no references to the pointer on other endpoints


## Unique Pointers

The DATEX JS Runtime guarantees that two pointers with the same
id are always pointing to the same instance:

```ts
const x1 = await $.ABCDEF
const x2 = await $.ABCDEF
assert (x1 === x2)
```
