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

Other endpoints can call this function by accessing the `MyAPI` as an endpoint property:

```ts
// assuming the endpoint running my-api.ts is @example
// call exampleFunction and get the return value
const result = await datex `@example.MyAPI.exampleFunction(1.5, "xyz")`
```

Inside a public function (like in any function), the [`datex.meta` property](./08%20The%20DATEX%20API.md) can be used
to find out which endpoint called the function:

```ts
const admin = f `@exampleAdmin`

@endpoint class MyAPI {
	@property static exampleFunction(a: number, b: string) {
		// the endpoint that called with function:
		const callerEndpoint = datex.meta.sender;
		
		if (callerEndpoint === admin) {
			console.log("doing admin stuff")
		}
		else {
			// ...
		}
	}
}
```

This can be used to restrict permissions to certain functionalities to specific endpoints or implement rate limiting.