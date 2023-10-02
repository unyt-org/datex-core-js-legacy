# Endpoints

## Creating endpoint references

To create a new reference to an endpoint, you can use the `f` shortcut function:

```ts
const myFriend = f `@alice`;
const notMyFriend = f `@+facebook`;
```

## Accessing endpoint properties

Exposed endpoint properties can be accessed with the `getProperty` of an endpoint:

```ts
const myFriend = f `@alice`;
console.log(await myFriend.getProperty('name')); // Alice Here

// equivalent way with datex script:
console.log(await datex `@alice.name`) // Alice Here
```


## Getting the online state of an endpoint

The online state of an endpoint can be requested with the `isOnline()` method.
Alternatively, you can use the `.online` property of an endpoint object
which contains a `Pointer<boolean>`.


## Endpoint filters

Multiple endpoints can be combined in endpoint filters to define access permissions or
receivers of a message.

Filters are based on DATEX logic types, which include `Conjunction` (and), `Disjunction` (or) and `Negation` (not).
Those logical structures can be combined arbitrarily:

```ts
const mammals = new Datex.Disjunction(f`@mickymouse`, f`@bigfoot`, f`@leonmask`, f`@flipper`) // @mickymouse|@bigfoot|@leonmask|@flipper
const fish = new Datex.Disjunction(f`@nemo`, f`@dorie`) // @nemo|@dorie
const animals = new Datex.Disjunction(mammals, fish); // @mickymouse|@bigfoot|@leonmask|@flipper|@nemo|@dorie

const nonSwimmers = new Datex.Disjunction(f`@mickymouse`, f`@bigfoot`, f`@leonmask`) // @mickymouse|@bigfoot|@leonmask
const swimmers = new Datex.Conjunction(animals, new Datex.Negation(nonSwimmers)); // @flipper|@nemo|@dorie

giveDivingGoggles(swimmers);
giveSwimmmingRing(nonSwimmers);
```
