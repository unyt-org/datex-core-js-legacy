
// extends Map class to automatically create new empty entries when the getAuto() method is called and the entry does not exist

const DEFAULT_CLASS = Symbol('DEFAULT_CLASS')
const DEFAULT_IS_CLASS = Symbol('DEFAULT_IS_CLASS')
const DEFAULT_CLASS_PRIMITIVE = Symbol('DEFAULT_CLASS_PRIMITIVE')
const DEFAULT_CREATOR_FUNCTION = Symbol('DEFAULT_CREATOR_FUNCTION')
const DEFAULT_VALUE = Symbol('DEFAULT_VALUE')

export const _ = "_";

// TODO
declare global {
    interface Map<K, V> {
        setAutoDefault(default_class_or_creator_function_or_value:V|any_class<V>|(()=>V)):Map<K, V>;
        getAuto(key: K): V;
    }
}


Map.prototype.setAutoDefault = function<V>(default_class_or_creator_function_or_value:V|any_class<V>|(()=>V)) {
    // is class
    if (typeof default_class_or_creator_function_or_value === "function" && default_class_or_creator_function_or_value.prototype !== undefined) {
        this[DEFAULT_CLASS] = <any_class<V>>default_class_or_creator_function_or_value;
        this[DEFAULT_IS_CLASS] = true;
        this[DEFAULT_CLASS_PRIMITIVE] = this[DEFAULT_CLASS] == String || this[DEFAULT_CLASS] == Number  || this[DEFAULT_CLASS] == BigInt || this[DEFAULT_CLASS] == Boolean;
    }
    // is function
    else if (typeof default_class_or_creator_function_or_value === "function") {
        this[DEFAULT_CREATOR_FUNCTION] = <(()=>V)> default_class_or_creator_function_or_value;
    }
    // is value
    else this[DEFAULT_VALUE] = <V>default_class_or_creator_function_or_value;
    return this;
}

Map.prototype.getAuto = function<K,V>(key: K): V {
    if (!this.has(key)) this.set(key, 
        this[DEFAULT_CREATOR_FUNCTION] ? 
            this[DEFAULT_CREATOR_FUNCTION]() : 
            (this[DEFAULT_IS_CLASS] ? 
                (this[DEFAULT_CLASS_PRIMITIVE] ?
                    (this[DEFAULT_CLASS_PRIMITIVE] == BigInt ?
                    (<((n:number) => V)>this[DEFAULT_CLASS])(0) : 
                    (<(() => V)>this[DEFAULT_CLASS])()) : 
                    new (<(new () => V)>this[DEFAULT_CLASS])()) : 
                this[DEFAULT_VALUE]
            )
    );
    return this.get(key);
}