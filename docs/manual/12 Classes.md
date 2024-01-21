# DATEX-Compatible Classes

Per default, most native JavaScript types (Arrays, Maps, Sets, primitive values, JSON Objects) are compatible with DATEX. This means that they can be converted to an equivalent DATEX representation and shared between endpoints.

Instances of custom classes are mapped to a DATEX representation of the generic type `js:Object` per default and thus lose their class type and prototypes.

With the `@sync` decorator, a class can be bound to a new DATEX type.

All instance properties decorated with `@property` are bound to the DATEX value and also visible when the value is shared between endpoints. 
Per default, the properties are local and only available in the current JavaScript context.

```ts
@sync class MyObject {
  @property a = 10
  @property b = 20
  localProp = 4
}

const obj = new MyObject();
obj.a // 10
obj.$.a // Datex.Ref<10>
```

>  [!NOTE]  
>  A `@sync` class instance can only be reconstructed correctly on another endpoint or in a later session if the JavaScript class definition is already loaded. Otherwise, the DATEX Runtime can only map the value to a generic object.

## Automatic Pointer Binding

Instances of a class marked with `@sync` are also automatically bound to a pointer when created (The value does not have to be explicitly wrapped in `$$()`).

All non-primitive properties of an instance (that are decorated with `@property`) are automatically bound to a new pointer if they don't have a pointer yet.

## Reactive Getters

When a property getter is decorated with `@property`, it behaves like any other bound property at first glance.

But there is one significant difference: The calculated value returned by the getter function is converted to an observable DATEX pointer.
This has essentially the same effect as [using the `always()` function](./03%20Pointers.md#creating-pointers). Whenever a pointer value that is referenced in the getter function is updated, the pointer value of the property is also updated.

```ts
@sync class MyObject {
  @property a = 10
  @property b = 20
  @property get sum() {
    return this.a + this.b
  }
}

const obj = new MyObject();
obj.a // 10
obj.sum // 30

// set observer
obj.$.sum.observe(sum => console.log(`The current sum is ${s}`))

obj.a++; // triggers observer
obj.b = 15 // triggers observer
obj.sum // 26
```

## Constructors

The normal JavaScript class constructor gets called every time an instance of a sync class is created.
When an existing instance of a sync class is shared with another endpoint, the constructor is
called again locally on the endpoint, which is not intended but can't be prevented.

We recommend using DATEX-compatible constructors instead, which are only ever called once at the initial creation of a sync class instance.
The DATEX constructor method is named `construct` and must be decorated with `@constructor`:

```ts
@sync class MyObject {
  @property a = 0
  @property b = 0

  // DATEX-compatible constructor
  @constructor construct() {
    console.log("constructed a new MyObject")
  }
}

const obj = new MyObject() // "constructed a new MyObject" is logged
```

When the `obj` pointer is now accessed on a remote endpoint, the `construct` method
is not called again on the remote endpoint.

You can also access constructor arguments like in a normal constructor:
```ts
@sync class MyObject {
  @constructor construct(a: number, b: string) {
    console.log("a", a)
    console.log("b", a)
  }
}

const obj = new MyObject(42, 'text')
```

For correct typing, take a look at [this workaround](#workaround-to-get-correct-types).

## Creating instances without `new`

Class instances can also be created by calling the class as a function, passing
in an object with the initial property values:

```ts
@sync class MyObject {
  @property a = 0
  @property b = 0
}

const obj = MyObject({a: 1, b: 2}) 
```

Currently, this results in a TypeScript error, but it runs without problems.
You can use [this workaround](#workaround-to-get-correct-types) to get rid of the TypeScript errors.


## Workaround to get correct types

Currently, it is not possible to get the correct types for a sync class without some additional work.
You can add the following lines to a sync class to make the TypeScript compiler happy (this has no effect on the runtime behavior):
```ts
// sync class definition (private)
@sync class _MyObject {
  @property a = 0
  @property b = 0
}
// use these as public proxies for the actual class
export const MyObject = datexClass(_MyObject)
export type MyObject  = datexClassType<typeof _MyObject>

const obj1: MyObject = new MyObject() 
const obj2: MyObject = MyObject({a: 1, b: 2}) 
```

## Using the raw API
For more customization, you can directly use the [JavaScript interface API] which allows you to define custom DATEX mapping behaviours for specific JavaScript types.
