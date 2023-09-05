# DATEX-compatible classes

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

Instances of a class marked with `@sync` are also automatically bound to a pointer when created (The value does not have to be explicitly wrapped in `$$()`).

For more customization, you can directly use the [JavaScript interface API]() which allows you to define custom DATEX mapping behaviours for specific JavaScript types.
