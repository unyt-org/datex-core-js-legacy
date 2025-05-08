# Storage Collections

The native `Set` and `Map` objects can be used with DATEX cross-network and as persistent values, 
but because their entries are completely stored in RAM, they are not ideal for large amounts of data.

For this reason, DATEX provides special collection types (`StorageMap`/`StorageSet`) that handle large amounts of data more efficiently by outsourcing entries to a pointer storage location instead of keeping everything in RAM.

The API is similar to `Set`/`Map` with the major difference that the instance methods are asynchronous.

> [!NOTE]
> Storage collections are not stored persistently by default as their name might imply. To store storage collections persistently, use [Eternal Pointers](./05%20Eternal%20Pointers.md).

## StorageSets

```ts
import { StorageSet } from "datex-core-legacy/types/storage-set.ts";

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
import { StorageMap } from "datex-core-legacy/types/storage-map.ts";

const myMap = new StorageMap<string, number>();
await myMap.set("myKey", 123); // Add key 'myKey' with value 123 to the StorageMap

for await (const [key, value] of myMap) { // Iterate over entries
    console.log(key, value);
}

await myMap.getSize(); // Returns the size of the StorageMap (1)
await myMap.clear(); // Clear StorageMap
```


## Pattern Matching

Entries of a `StorageSet` can be efficiently queried by using the builtin pattern matcher.
For supported storage locations (e.g. sql storage), the pattern matching is directly performed in storage and non-matching entries are never loaded into RAM.

> [!NOTE]
> Pattern matching currently only works with struct objects.

### Selecting by property

The easiest way to match entries in a storage set is to provide one or multiple required property values:

```ts
import { StorageSet } from "datex-core-legacy/types/storage-set.ts";
import { inferType } from "datex-core-legacy/types/struct.ts";
import { Time } from "datex-core-legacy/types/time.ts";

const User = struct({
    name: string,
    age: number,
    created: Time
})
type User = inferType<typeof User>

// using StorageSet.of instead of new StorageSet to get a typed StorageSet
const users = StorageSet.of(User);

// get all users with age == 18
const usersAge18 = await users.match({
    age: 18
});
```

### Match Conditions

Besides exact matches, you can also match properties with certain constraints using match conditions:

Match between to numbers/dates:
```ts
import { MatchCondition } from "unyt_core/storage/storage.ts";

// all users where the "created" timestamp is between now and 7 days ago:
const newUsersLastWeek = users.match({
    created: MatchCondition.between(
        new Time().minus(7, "d"),
        new Time()
    )
})
```

Match not equal:
```ts
// all users which do not have the name "John":
const notJohn = users.match({
    name: MatchCondition.notEqual("John")
})
```


### Return value customization

#### Limiting

You can limit the maximum number of returned entries by setting the `limit` option to a number:

```ts
// get all users with name "Josh", limit to 10
const joshes = await users.match(
    {
        name: "Josh"
    }, 
    {limit: 10}
);
```

#### Sorting

You can sort the returned entries by setting the `sortBy` option to a property path:

```ts
// get all users with age == 18, sorted by their creation timestamp
const usersAge18 = await users.match(
    {
        age: 18
    }, 
    {sortBy: 'created'}
);
```

Directly sorting values this way in the match query has two significant advantages over sorting
the returned values afterwards, e.g. using `Array.sort`:
 * The sorting is normally faster
 * When using the `limit` option, sorting is done before applying the `limit`, otherwise only the values remaining within the limit would be sorted


#### Returning additional metadata

When the `returnAdvanced` option is set to `true`, the `match` function returns an object with additional metadata:

```ts
const {matches, total} = await users.match(
    {
        name: "Josh"
    }, 
    {
        limit: 10, 
        returnAdvanced: true
    }
);

matches // matching entries: Set<User>
total // total number of matches that would be returned without the limit
```


### Computed properties

Computed properties provide a way to efficiently match entries in the StorageSet with more complex conditions.
One or multiple computed properties can be specified in the `computedProperties` option.

#### Geographic Distance

Calculates the geographic distance of two points provided from literal values or properties:

Example:
```ts
import { ComputedProperty } from "datex-core-legacy/storage/storage.ts";

const Location = struct({
    lat: number,
    lon: number
});
type Location = inferType<typeof Location>


const User = struct({
    name: string,
    location: Location
})
type User = inferType<typeof User>


const myPosition = {lat: 70.48, lon: -21.96}

// computed geographic distance between myPosition and a user position
const distance = ComputedProperty.geographicDistance(
    // point A (user position)
    {
        lat: 'location.lat', 
        lon: 'location.lon'
    },
    // point B (my position)
    {
        lat: myPosition.lat, 
        lon: myPosition.lon
    }
)

const nearbyJoshes = await users.match(
    {
        name: "Josh", // name = "Josh"
        distance: MatchCondition.lessThan(1000) // distance < 1000m
    }, 
    {
        computedProperties: { distance }
    }
);
```

#### Sum

Calculates the sum of multiple properties or literal values

Example:
```ts
const TodoItem = struct({
    completedTaskCount: number,
    openTaskCount: number
})
type TodoItem = inferType<typeof TodoItem>

const todoItems = StorageSet.of(TodoItem)

// sum of completedTaskCount and openTaskCount for a given TodoItem
const totalTaskCount = ComputedProperty.sum(
    'completedTaskCount',
    'openTaskCount'
)

// match all todo items where the total task count is > 100
const bigTodoItems = await todoItems.match(
    {
        totalTaskCount: MatchCondition.greaterThan(100) // totalTaskCount > 100
    }, 
    {
        computedProperties: { totalTaskCount }
    }
);
```
