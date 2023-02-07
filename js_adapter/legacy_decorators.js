import { Decorators, METADATA } from "./js_class_adapter.ts";
import { Pointer } from "../runtime/pointers.ts";
const __metadataPrivate = new WeakMap();
const createObjectWithPrototype = (obj, key) => Object.hasOwnProperty.call(obj, key) ? obj[key] : Object.create(obj[key] || Object.prototype);
function getContextKind(args) {
    if (typeof args[0] == "function" && args[1] == null && args[2] == null)
        return 'class';
    if ((typeof args[0] == "function" || typeof args[0] == "object") && (typeof args[2] == "function" || typeof args[2]?.value == "function"))
        return 'method';
    if ((typeof args[0] == "function" || typeof args[0] == "object") && typeof args[1] == "string")
        return 'field';
}
function isContextStatic(args) {
    return typeof args[0] == "function" && args[1] != null;
}
export function handleDecoratorArgs(args, method, first_argument_is_function = false) {
    let kind = getContextKind(args);
    if (!kind || first_argument_is_function) {
        const params = args;
        return (...args) => {
            let kind = getContextKind(args);
            let is_static = isContextStatic(args);
            let target = args[0];
            let name = kind == 'class' ? args[0].name : args[1];
            let value = kind == 'class' ? args[0] : args[2]?.value;
            let meta_setter = createMetadataSetter(target, name, kind == 'class');
            let meta_getter = createMetadataGetter(target, name, kind == 'class');
            return method(value, name, kind, is_static, false, meta_setter, meta_getter, params);
        };
    }
    else {
        let is_static = isContextStatic(args);
        let target = args[0];
        let name = kind == 'class' ? args[0].name : args[1];
        let value = kind == 'class' ? args[0] : args[2]?.value;
        let meta_setter = createMetadataSetter(target, name, kind == 'class');
        let meta_getter = createMetadataGetter(target, name, kind == 'class');
        return method(value, name, kind, is_static, false, meta_setter, meta_getter);
    }
}
function createMetadataSetter(target, name, is_constructor = false, is_private = false) {
    return (key, value) => {
        if (typeof key !== "symbol") {
            throw new TypeError("the key must be a Symbol");
        }
        target[METADATA] = createObjectWithPrototype(target, METADATA);
        target[METADATA][key] = createObjectWithPrototype(target[METADATA], key);
        target[METADATA][key].public = createObjectWithPrototype(target[METADATA][key], "public");
        if (!Object.hasOwnProperty.call(target[METADATA][key], "private")) {
            Object.defineProperty(target[METADATA][key], "private", {
                get() {
                    return Object.values(__metadataPrivate.get(target[METADATA][key]) || {}).concat(Object.getPrototypeOf(target[METADATA][key])?.private || []);
                }
            });
        }
        if (is_constructor) {
            target[METADATA][key].constructor = value;
        }
        else if (is_private) {
            if (!__metadataPrivate.has(target[METADATA][key])) {
                __metadataPrivate.set(target[METADATA][key], {});
            }
            __metadataPrivate.get(target[METADATA][key])[name] = value;
        }
        else {
            target[METADATA][key].public[name] = value;
        }
    };
}
function createMetadataGetter(target, name, is_constructor = false, is_private = false) {
    return (key) => {
        if (target[METADATA] && target[METADATA][key]) {
            if (is_constructor)
                return target[METADATA][key]["constructor"]?.[name];
            else if (is_private)
                return (__metadataPrivate.has(target[METADATA][key]) ? __metadataPrivate.get(target[METADATA][key])?.[name] : undefined);
            else
                return target[METADATA][key].public?.[name];
        }
    };
}
export function expose(...args) {
    return handleDecoratorArgs(args, Decorators.expose);
}
export function scope(...args) {
    return handleDecoratorArgs(args, Decorators.namespace);
}
export function namespace(...args) {
    return handleDecoratorArgs(args, Decorators.namespace);
}
export function endpoint_default(...args) {
    return handleDecoratorArgs(args, Decorators.default);
}
export function default_property(...args) {
    return handleDecoratorArgs(args, Decorators.default_property);
}
export function remote(...args) {
    return handleDecoratorArgs(args, Decorators.remote);
}
export function docs(...args) {
    return handleDecoratorArgs(args, Decorators.docs);
}
export function meta(...args) {
    return handleDecoratorArgs(args, Decorators.meta);
}
export function sign(...args) {
    return handleDecoratorArgs(args, Decorators.sign);
}
export function encrypt(...args) {
    return handleDecoratorArgs(args, Decorators.encrypt);
}
export function no_result(...args) {
    return handleDecoratorArgs(args, Decorators.no_result);
}
export function timeout(...args) {
    return handleDecoratorArgs(args, Decorators.timeout);
}
export function allow(...args) {
    return handleDecoratorArgs(args, Decorators.allow);
}
export function to(...args) {
    return handleDecoratorArgs(args, Decorators.to);
}
export function sealed(...args) {
    return handleDecoratorArgs(args, Decorators.sealed);
}
export function each(...args) {
    return handleDecoratorArgs(args, Decorators.each);
}
export function sync(...args) {
    return handleDecoratorArgs(args, Decorators.sync);
}
export function template(...args) {
    return handleDecoratorArgs(args, Decorators.template);
}
export function property(...args) {
    return handleDecoratorArgs(args, Decorators.property);
}
export function serialize(...args) {
    return handleDecoratorArgs(args, Decorators.serialize, true);
}
export function observe(...args) {
    return handleDecoratorArgs(args, Decorators.observe);
}
export function anonymize(...args) {
    return handleDecoratorArgs(args, Decorators.anonymize);
}
export function anonymous(...args) {
    if (args[0] == undefined || args[0] == null || (args[1] === undefined && args[0] && typeof args[0] == "object")) {
        return Pointer.create(null, args[0], false, undefined, false, true).val;
    }
    return handleDecoratorArgs(args, Decorators.anonymous);
}
export function type(...args) {
    return handleDecoratorArgs(args, Decorators.type);
}
export function from(...args) {
    return handleDecoratorArgs(args, Decorators.from);
}
export function update(...args) {
    return handleDecoratorArgs(args, Decorators.update);
}
export function constructor(...args) {
    return handleDecoratorArgs(args, Decorators.constructor);
}
export function replicator(...args) {
    return handleDecoratorArgs(args, Decorators.replicator);
}
export function destructor(...args) {
    return handleDecoratorArgs(args, Decorators.destructor);
}
