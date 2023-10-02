# Important DATEX Concepts

In this section, we will give you a quick introduction to DATEX.
If you want to dive deeper, check out the [DATEX Language Specification](https://github.com/unyt-org/datex-specification).


### Endpoints

An *endpoint* in the DATEX world is an entity that is participating in the network. 
Endpoints can be associated with people or institutions, but they can also be completely anonymous.

Each endpoint can connect multiple *endpoint instances* to the network simulataneously.
Endpoints communicate via DATEX, either with relays or over direct connections.

Endpoint identifiers always start with an '@' symbol and contain alphanumeric characters or a hex id in
the case of anonymous endpoints.

```datex
ref hello = @example.helloWorld(); // execute 'helloWorld' on example and save the value in the 'hello' variable
```

Endpoints can create pointers, expose public properties, handle permissions for pointers and much more.
You can read more about this in the chapters [Endpoints](./05%20Endpoints.md) and [Endpoint Configuration](./06%20Endpoint%20Configuration.md).

You can also find more details in the [DATEX Specification](https://github.com/unyt-org/datex-specification).

### References and Pointers

In DATEX, every value can be bound to a reference.
A reference can be either a local reference or a global reference (*pointer*).

Pointers can be accessed and modified across the network from multiple endpoints at once.
The creator of a pointer can configure read and write permissions for other enpoints.

Pointers can also be transformed into new pointers. A transformed pointer is always updated to
hold the value defined by a *transform function*.

In DATEX, every value (including primitives) can be assigned to a pointer.

```datex
ref a = 5; // create a new pointer with the value '10'
ref b = 0; // create a new pointer with the value '32'
ref sum = always a + b; // create a pointer with the transformed value of 'a + b'

b = 5; 	   // update the value of the pointer 'b'
print sum; // the pointer 'sum' now has the value '10'
```
----
Throughout this manual, we will use DATEX Script (like in the example above) to explain some DATEX specific concepts - but you don't need to write your code with DATEX - all important features are also available in the DATEX JavaScript API. If you want to try out DATEX Script, check out the [DATEX Playground](https://playground.unyt.org/)

----

