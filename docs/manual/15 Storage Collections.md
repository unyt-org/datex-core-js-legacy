# Storage Collections
DATEX allows the usage of native Set and Map objects. Those types are stored in RAM and may impact performance when it's data is getting to large.
For this reason DATEX provides special storage collections that allow the handling of massive amounts of data more efficiently.

The API is similar to the native JavaScript collections with the major difference that their instance methods are asynchronous.
To get the size of the collection it is recommended to use the asynchronous `getSize` method.

> [!NOTE]
> The storage collections are not stored persistently by default. To store persistent data refer to [Eternal Pointers](./05%20Eternal%20Pointers.md).

## StorageSet
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

## StorageMap
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
