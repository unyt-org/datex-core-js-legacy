// Util class to link observers methods
export class Observers {

    static #observers = new WeakMap<object, (Map<string|symbol,Set<Function>>)>();

    // register a new observer group for a parent and key
    public static register(parent:object, key:string|symbol) {
        if (!this.#observers.has(parent)) this.#observers.set(parent, new Map());
        const observers = this.#observers.get(parent)!;
        if (!observers.has(key)) observers.set(key, new Set());
    }


    // add a observer method
    public static add(parent:object, key:string|symbol, observer:Function) {
        if (!this.#observers.has(parent)) this.#observers.set(parent, new Map());
        const observers = this.#observers.get(parent)!;
        if (!observers.has(key)) observers.set(key, new Set());
        observers.get(key)!.add(observer);
    }

    // call all observer methods for a parent and key with args
    public static call(parent:object, key:string|symbol, ...args:any[]) {
        if (!this.#observers.has(parent)) throw Error("Observers for this object do not exist")
        const observers = this.#observers.get(parent)!;
        if (!observers.has(key)) throw Error("Observers for this key do not exist")
        for (const o of observers.get(key)!) o(...args);
    }

    // call all observer methods for a parent and key with args (async)
    public static callAsync(parent:object, key:string|symbol, ...args:any[]) {
        if (!this.#observers.has(parent)) throw Error("Observers for this object do not exist")
        const observers = this.#observers.get(parent)!;
        if (!observers.has(key)) throw Error("Observers for this key do not exist")
        const promises = [];
        for (const o of observers.get(key)!) promises.push(o(...args));
        return Promise.all(promises);
    }

    public static clear(parent:object, key?:string|symbol, observer?:Function) {
        if (!this.#observers.has(parent)) throw Error("Observers for this object do not exist")
        // delete all observers for parent object
        if (key === undefined) this.#observers.delete(parent);
        else {
            const observers = this.#observers.get(parent)!;
            if (!observers.has(key)) throw Error("Observers for this key do not exist")
            // delete method
            if (observer) {
                observers.get(key)!.delete(observer);
            }
            // delete all observer methods for key
            else {
                observers.delete(key);
            }
        }

    }
}
