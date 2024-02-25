# Storage Collections

The native `Set` and `Map` objects can be used with DATEX cross-network and as persistent values, 
but because their entries are only stored in RAM, they are not ideal for large amounts of data.

For this reason, DATEX provides special collection types (`StorageMap`/`StorageSet`) that handle large amounts of data more efficiently by outsourcing entries to a pointer storage location instead of keeping everything in RAM.

The API is similar to `Set`/`Map` with the major difference that the instance methods are asynchronous.

> [!NOTE]
> Storage collections are not stored persistently by default as their name might imply. To store storage collections persistently, use [Eternal Pointers](./05%20Eternal%20Pointers.md).

## StorageSets

```ts
import "datex-core-legacy/types/storage-set.ts";
const mySet = new StorageSet<number>();
await mySet.add(123); // Add 123 to the StorageSet

for await (const entry of mySet) { // Iterate over values
    console.log(entry);
}

await mySet.getSize(); // Returns the size of the StorageSet (1)
await mySet.clear(); // Clear StorageSet
```

## StorageMaps

```ts
import "datex-core-legacy/types/storage-map.ts";
const myMap = new StorageMap<string, number>();
await myMap.set("myKey", 123); // Add key 'myKey' with value 123 to the StorageMap

for await (const [key, value] of myMap) { // Iterate over entries
    console.log(key, value);
}

await mySet.getSize(); // Returns the size of the StorageMap (1)
await myMap.clear(); // Clear StorageMap
```


## Pattern Matching

Entries of a `StorageSet` can be efficiently queried by using the builtin pattern matcher.
For supported storage locations, the pattern matching is directly performed in storage and non-matching entries are never loaded into RAM.

### Selecting by property

The easiest way to match entries in a storage set is to provide a required property:

```ts
@sync class User {
    @property(string) declare name: string
    @property(number) declare age: number
}

const users = new StorageSet<User>();
// get all users with age == 18
const usersAge18 = await users.match(User, {age: 18});
```