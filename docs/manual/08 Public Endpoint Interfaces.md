# Public Endpoint Interfaces

Endpoints can define publicly accessible values that can provide various functionalities.
Public functions and properties can be exposed under a namespace by creating a class with an `@endpoint` decorator:

```ts
// my-api.ts
await Datex.Supranet.connect();

@endpoint class MyAPI {
    @property static exampleFunction(a: number, b: string) {
        // ... do some stuff
        return c
    }

    @property static version = "0.1.1"
}
```


Inside a public function (like in any function), the [`datex.meta` property](./08%20The%20DATEX%20API.md) can be used
to find out which endpoint called the function:

```ts
const admin = f `@exampleAdmin`

@endpoint class MyAPI {
    @property static exampleFunction(a: number, b: string) {
        // the endpoint that called with function:
        const callerEndpoint = datex.meta.caller;
        
        if (callerEndpoint === admin) {
            console.log("doing admin stuff")
        }
        else {
            // ...
        }
    }
}
```

This can be used to restrict permissions for certain functionalities to specific endpoints or implement rate limiting.



## Calling public functions on remote endpoints

Methods defined in a public endpoint interface class can be called on other endpoints that also implement
the interface. 
To specify the receivers, chain a `.to()` method call together with the actual method call:

```ts

// call locally
const result1 = await MyAPI.exampleFunction(42, 'xyz');

// call on @example
const result2 = await MyAPI.exampleFunction.to('@example')(42, 'xyz');
```

You can call the function on multiple endpoint at once by passing an array or set of `Endpoint` objects
or endpoint identifier to the `to()` call.:

```ts
// call on @example1 and @example2
const result3 = await MyAPI.exampleFunction.to(['@example1', '@example2'])(42, 'xyz');
```


> [!WARNING]
> When calling a function on multiple endpoints in a single call,
> only the first received response is returned (similar to Promise.race).


Altenatively, you can access a public interface directly with DATEX Script code:

```ts
// assuming the endpoint running my-api.ts is @example
// call exampleFunction and get the return value
const result = await datex `@example.MyAPI.exampleFunction(1.5, "xyz")`
```
