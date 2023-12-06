# History

The History API provides a way to undo and redo state changes of one or multiple pointers.

The history for a pointer can be managed by creating a new `History` object and adding the pointer
to the history:

```ts
import { History } from "datex-core-legacy/utils/history.ts";

const entries = $$([]);
const history = new History();
history.add(entries);
```

Now, every state change of the `entries` array is recorded and can be undone or repeated:
```ts
entries.push("Entry 1");
entries.push("Entry 2");
entries.push("Entry 3");
console.log(entries) // ["Entry 1", "Entry 2", "Entry 3"]

// undo last change
history.back();
console.log(entries) // ["Entry 1", "Entry 2"]

// undo second last change
history.back();
console.log(entries) // ["Entry 1"]

// repeat second last change
history.forward();
console.log(entries) // ["Entry 1", "Entry 2"]
```

This works for all value types, e.g. for primitive pointers:
```ts
const name = $$("Max")
history.add(name);

name.val = "Tom"
console.log(name.val) // "Tom"

history.back();
console.log(name.val) // "Max"
```

The `back()` and `forward()` method both return a boolean indicating if the state change could be
executed. If the end or start of the recorded history is reached, `false` is returned.

The `backSteps` and `forwardSteps` properties indicate how many steps can currently be performed in both directions.

## Save Points

For some use cases, it is required to not undo and redo any atomic state change, but instead jump between manually defined *save points*.
This can be achieved by enabling the `explicitSavePoints` option:
```ts
const history = new History({explicitSavePoints: true});
```

Now, you can set save points at any point in time by calling
```ts
history.setSavePoint()
```

The `back()` and `forward()` methods can be used as before.
They now jump between the defined save point states.

When the `back()` method is called before a new save point was set after pointer changes occured, 
a new save point for the current state is automatically inserted.


## Enabling undo/redo shortcuts

The History API also provides a builtin way to go back or forward in history when the user
presses `CTRL+Z` / `CTRL+Y`.

This can be enabled with the `enableKeyboardShortcuts` option:

```ts
const history = new History({enableKeyboardShortcuts: true});
```