# DATEX-Compatible Classes

Per default, most native JavaScript types (Arrays, Maps, Sets, primitive values, JSON Objects) are compatible with DATEX. This means that they can be converted to an equivalent DATEX representation and shared between endpoints.

Instances of custom classes are mapped to a generic DATEX object representation per default and thus lose their class type and prototypes.

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

## Getters and setters

When a property getter is decorated with `@property`, it behaves like any other bound property at first glance.

But there is one significant difference: The calculated value returned by the getter function is converted to an observable DATEX pointer.
This has essentially the same effect as usinz the `always()` function. Whenever a pointer value used in the getter function is updated, the pointer value of the property is also updated.

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
obj.$.sum.observe(sum => console.log(`The current sum is ${s}`))

obj.a++; // triggers observer
obj.b = 15 // triggers observer
obj.sum // 26
```

## Using the raw API
For more customization, you can directly use the [JavaScript interface API]() which allows you to define custom DATEX mapping behaviours for specific JavaScript types.
