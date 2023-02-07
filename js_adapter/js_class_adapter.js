import "../lib/reflect-metadata/Reflect.js";
import { Runtime, StaticScope } from "../runtime/runtime.ts";
import { Logger } from "../utils/logger.ts";
import { Target } from "../types/addressing.ts";
import { Type } from "../types/type.ts";
import { getProxyFunction, getProxyStaticValue, Pointer, UpdateScheduler } from "../runtime/pointers.ts";
import { Error as DatexError, ValueError } from "../types/errors.ts";
import { Function as DatexFunction } from "../types/function.ts";
import { DatexObject } from "../types/object.ts";
import { Tuple } from "../types/tuple.ts";
import { DX_PERMISSIONS, DX_TYPE } from "../runtime/constants.ts";
import { Conjunction, Disjunction } from "../types/logic.ts";
const logger = new Logger("DATEX JS Adapter");
const CONSTRUCT_OPTIONS = Symbol("CONSTRUCT_OPTIONS");
if (!Symbol['metadata'])
    Symbol['metadata'] = Symbol('metadata');
export const METADATA = Symbol['metadata'];
export class Decorators {
    static IS_EXPOSED = Symbol("IS_EXPOSED");
    static IS_REMOTE = Symbol("IS_REMOTE");
    static IS_EACH = Symbol("IS_EACH");
    static IS_SYNC = Symbol("IS_SYNC");
    static IS_ANONYMOUS = Symbol("IS_ANONYMOUS");
    static IS_SEALED = Symbol("IS_SEALED");
    static ANONYMIZE = Symbol("ANONYMIZE");
    static PROPERTY = Symbol("PROPERTY");
    static SERIALIZE = Symbol("SERIALIZE");
    static ALLOW_FILTER = Symbol("ALLOW_FILTER");
    static SEND_FILTER = Symbol("SEND_FILTER");
    static NAMESPACE = Symbol("SCOPE_NAME");
    static DEFAULT = Symbol("ROOT_EXTENSION");
    static DEFAULT_PROPERTY = Symbol("ROOT_VARIABLE");
    static DOCS = Symbol("DOCS");
    static META_INDEX = Symbol("META_INDEX");
    static SIGN = Symbol("SIGN");
    static ENCRYPT = Symbol("ENCRYPT");
    static NO_RESULT = Symbol("NO_RESULT");
    static TIMEOUT = Symbol("TIMEOUT");
    static OBSERVER = Symbol("OBSERVER");
    static SCHEDULER = Symbol("SCHEDULER");
    static FORCE_TYPE = Symbol("FORCE_TYPE");
    static FROM_TYPE = Symbol("FROM_TYPE");
    static CONSTRUCTOR = Symbol("CONSTRUCTOR");
    static REPLICATOR = Symbol("REPLICATOR");
    static DESTRUCTOR = Symbol("DESTRUCTOR");
    static expose(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (kind != "method" && kind != "field")
            logger.error("Cannot use @expose for value '" + name.toString() + "'");
        else if (!is_static)
            logger.error("Cannot use @expose for non-static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.IS_EXPOSED, true);
            if (params.length)
                Decorators.addMetaFilter(params[0], setMetadata, getMetadata, Decorators.ALLOW_FILTER);
        }
    }
    static namespace(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (!is_static && kind != "class")
            logger.error("Cannot use @scope for non-static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.NAMESPACE, params[0] ?? value?.name);
            if (kind == "class")
                staticScopeClass(value);
            else {
                setMetadata(Decorators.IS_REMOTE, true);
                setMetadata(Decorators.IS_EXPOSED, true);
            }
        }
    }
    static default(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (!is_static && kind != "class")
            logger.error("Cannot use @root_extension for non-static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.DEFAULT, true);
            if (kind == "class")
                staticScopeClass(value);
        }
    }
    static default_property(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (!is_static && kind != "class")
            logger.error("Cannot use @root_variable for non-static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.DEFAULT_PROPERTY, true);
            if (kind == "class")
                staticScopeClass(value);
        }
    }
    static remote(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (kind == "class")
            logger.error("Cannot use @remote for a class");
        else if (!is_static)
            logger.error("Cannot use @remote for non-static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.IS_REMOTE, true);
            if (params.length)
                Decorators.addMetaFilter(params[0], setMetadata, getMetadata, Decorators.SEND_FILTER);
        }
    }
    static docs(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (kind != "class")
            logger.error("@docs can only be used for classes");
        else {
            setMetadata(Decorators.DOCS, params[0]);
        }
    }
    static meta(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (kind == "method") {
            setMetadata(Decorators.META_INDEX, params[0] ?? -1);
        }
        else
            logger.error("@meta can only be used for methods");
    }
    static sign(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        setMetadata(Decorators.SIGN, params[0]);
    }
    static encrypt(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        setMetadata(Decorators.ENCRYPT, params[0]);
    }
    static no_result(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        setMetadata(Decorators.NO_RESULT, true);
    }
    static timeout(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        setMetadata(Decorators.TIMEOUT, params[0]);
    }
    static allow(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        Decorators.addMetaFilter(params[0], setMetadata, getMetadata, Decorators.ALLOW_FILTER);
    }
    static to(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        Decorators.addMetaFilter(params[0], setMetadata, getMetadata, Decorators.SEND_FILTER);
    }
    static each(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("Cannot use @each for static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.IS_EACH, true);
        }
    }
    static property(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("@property decorator cannot be used for static fields");
        else if (kind != "field" && kind != "getter" && kind != "setter" && kind != "method")
            logger.error("Invalid use of @property decorator");
        else {
            setMetadata(Decorators.PROPERTY, params?.[0] ?? name);
        }
    }
    static serialize(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("@serialize decorator cannot be used for static fields");
        else if (kind != "field" && kind != "getter" && kind != "setter" && kind != "method")
            logger.error("Invalid use of @serialize decorator");
        else if (!params?.[0])
            logger.error("Missing serializer method on @serialize decorator");
        else {
            setMetadata(Decorators.SERIALIZE, params[0]);
        }
    }
    static template(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (kind != "class")
            logger.error("@template can only be used as a class decorator");
        else {
            const original_class = value;
            let type;
            if (typeof params[0] == "string")
                type = Type.get(params[0].replace(/^\</, '').replace(/\>$/, ''));
            else if (params[0] instanceof Type)
                type = params[0];
            else if (original_class[METADATA]?.[Decorators.FORCE_TYPE]?.constructor)
                type = original_class[METADATA]?.[Decorators.FORCE_TYPE]?.constructor;
            else
                type = Type.get("ext", original_class.name);
            return createTemplateClass(original_class, type);
        }
    }
    static sync(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (is_static)
            logger.error("Cannot use @sync for static field '" + name.toString() + "'");
        if (is_static)
            logger.error("Cannot use @sync for static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.IS_SYNC, true);
            if (kind == "class") {
                const original_class = value;
                let type;
                if (typeof params[0] == "string")
                    type = Type.get(params[0].replace(/^\</, '').replace(/\>$/, ''));
                else if (params[0] instanceof Type)
                    type = params[0];
                else if (original_class[METADATA]?.[Decorators.FORCE_TYPE]?.constructor)
                    type = original_class[METADATA]?.[Decorators.FORCE_TYPE]?.constructor;
                else
                    type = Type.get("ext", original_class.name);
                return createTemplateClass(original_class, type);
            }
        }
    }
    static sealed(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("Cannot use @sealed for static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.IS_SEALED, true);
        }
    }
    static anonymous(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("Cannot use @anonymous for static field '" + name.toString() + "'");
        else {
            setMetadata(Decorators.IS_ANONYMOUS, true);
        }
    }
    static observe(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        setMetadata(Decorators.OBSERVER, params[0]);
    }
    static anonymize(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (kind == "class")
            logger.error("Cannot use @anonymize for classes");
        else {
            setMetadata(Decorators.ANONYMIZE, true);
        }
    }
    static type(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (typeof params[0] == "string")
            setMetadata(Decorators.FORCE_TYPE, Type.get(params[0].replace(/^\</, '').replace(/\>$/, '')));
        else if (params[0] instanceof Type)
            setMetadata(Decorators.FORCE_TYPE, params[0]);
    }
    static from(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (kind !== "class")
            logger.error("Can use @from only for classes");
        else {
            setMetadata(Decorators.FROM_TYPE, params[0]);
        }
    }
    static update(value, name, kind, is_static, is_private, setMetadata, getMetadata, params = []) {
        if (params[0] instanceof UpdateScheduler)
            setMetadata(Decorators.SCHEDULER, params[0]);
        else
            setMetadata(Decorators.SCHEDULER, new UpdateScheduler(params[0]));
    }
    static ["constructor"](value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("Cannot use @constructor for static field '" + name.toString() + "'");
        else if (kind != "method")
            logger.error("Cannot only use @constructor for methods");
        else {
            setMetadata(Decorators.CONSTRUCTOR, true);
        }
    }
    static replicator(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("Cannot use @replicator for static field '" + name.toString() + "'");
        else if (kind != "method")
            logger.error("Cannot only use @replicator for methods");
        else {
            setMetadata(Decorators.REPLICATOR, true);
        }
    }
    static destructor(value, name, kind, is_static, is_private, setMetadata, getMetadata, params) {
        if (is_static)
            logger.error("Cannot use @destructor for static field '" + name.toString() + "'");
        else if (kind != "method")
            logger.error("Cannot only use @destructor for methods");
        else {
            setMetadata(Decorators.DESTRUCTOR, true);
        }
    }
    static addMetaFilter(new_filter, setMetadata, getMetadata, filter_symbol) {
        if (typeof new_filter == "string")
            setMetadata(filter_symbol, Target.get(new_filter));
        else
            setMetadata(filter_symbol, new_filter);
    }
}
globalThis.Decorators = Decorators;
const initialized_static_scope_classes = new Map();
function staticScopeClass(original_class) {
    if (initialized_static_scope_classes.has(original_class)) {
        if (original_class[METADATA]?.[Decorators.DEFAULT_PROPERTY]?.constructor) {
            const static_scope = initialized_static_scope_classes.get(original_class);
            if (!Runtime.endpoint_default || typeof Runtime.endpoint_default != "object")
                Runtime.endpoint_default = {};
            Runtime.endpoint_default[static_scope.name] = static_scope;
        }
        if (original_class[METADATA]?.[Decorators.DEFAULT]?.constructor) {
            const static_scope = initialized_static_scope_classes.get(original_class);
            Runtime.endpoint_default = static_scope;
        }
        return;
    }
    let static_properties = Object.getOwnPropertyNames(original_class);
    const metadata = original_class[METADATA];
    if (!metadata)
        return;
    let options_prototype = {};
    const static_scope_name = typeof metadata[Decorators.NAMESPACE]?.constructor == 'string' ? metadata[Decorators.NAMESPACE]?.constructor : original_class.name;
    let static_scope;
    Object.defineProperty(original_class, 'to', {
        value: function (...targets) {
            options_prototype.dynamic_filter = new Disjunction();
            for (let target of targets) {
                if (typeof target == "string")
                    options_prototype.dynamic_filter.add(Target.get(target));
                else
                    options_prototype.dynamic_filter.add(target);
            }
            return this;
        },
        configurable: false,
        enumerable: false,
        writable: false
    });
    let class_send_filter = metadata[Decorators.SEND_FILTER]?.constructor;
    if (class_send_filter == Object)
        class_send_filter = undefined;
    let class_allow_filter = metadata[Decorators.ALLOW_FILTER]?.constructor;
    if (class_allow_filter == Object)
        class_allow_filter = undefined;
    const exposed_public = metadata[Decorators.IS_EXPOSED]?.public;
    const exposed_private = metadata[Decorators.IS_EXPOSED]?.private;
    const remote_public = metadata[Decorators.IS_REMOTE]?.public;
    const remote_private = metadata[Decorators.IS_REMOTE]?.private;
    const timeout_public = metadata[Decorators.TIMEOUT]?.public;
    const timeout_private = metadata[Decorators.TIMEOUT]?.private;
    const send_filter = metadata[Decorators.SEND_FILTER]?.public;
    for (let name of static_properties) {
        const current_value = original_class[name];
        if ((exposed_public?.hasOwnProperty(name) && exposed_public[name]) || (exposed_private?.hasOwnProperty(name) && exposed_private[name])) {
            if (!static_scope)
                static_scope = StaticScope.get(static_scope_name);
            if (typeof current_value == "function") {
                let dx_function = Pointer.proxifyValue(DatexFunction.createFromJSFunction(current_value, original_class, name), true, undefined, false, true);
                static_scope.setVariable(name, dx_function);
            }
            else {
                let setProxifiedValue = (val) => static_scope.setVariable(name, Pointer.proxifyValue(val, true, undefined, false, true));
                setProxifiedValue(current_value);
                const property_descriptor = Object.getOwnPropertyDescriptor(original_class, name);
                if (property_descriptor?.set || property_descriptor?.get) {
                    Object.defineProperty(static_scope, name, {
                        set: val => {
                            property_descriptor.set?.call(original_class, val);
                        },
                        get: () => {
                            return property_descriptor.get?.call(original_class);
                        }
                    });
                }
                Object.defineProperty(original_class, name, {
                    get: () => static_scope.getVariable(name),
                    set: (val) => setProxifiedValue(val)
                });
            }
        }
        if ((remote_public?.hasOwnProperty(name) && remote_public[name]) || (remote_private?.hasOwnProperty(name) && remote_private[name])) {
            const timeout = timeout_public?.[name] ?? timeout_private?.[name];
            const filter = new Conjunction(class_send_filter, send_filter?.[name]);
            if (typeof current_value == "function") {
                const options = Object.create(options_prototype);
                Object.assign(options, { filter, sign: true, scope_name: static_scope_name, timeout });
                const proxy_fn = getProxyFunction(name, options);
                Object.defineProperty(original_class, name, { value: proxy_fn });
            }
            else {
                const options = Object.create(options_prototype);
                Object.assign(options, { filter, sign: true, scope_name: static_scope_name, timeout });
                const proxy_fn = getProxyStaticValue(name, options);
                Object.defineProperty(original_class, name, {
                    get: proxy_fn
                });
            }
        }
    }
    const each_public = original_class.prototype[METADATA]?.[Decorators.IS_EACH]?.public;
    let each_scope;
    for (let [name, is_each] of Object.entries(each_public ?? {})) {
        if (!is_each)
            continue;
        if (!static_scope)
            static_scope = StaticScope.get(static_scope_name);
        if (!each_scope) {
            each_scope = {};
            static_scope.setVariable("_e", each_scope);
        }
        let method = original_class.prototype[name];
        let type = Type.getClassDatexType(original_class);
        if (typeof method != "function")
            throw new DatexError("@each can only be used with functions");
        let proxy_method = function (_this, ...args) {
            if (!(_this instanceof original_class)) {
                console.warn(_this, args);
                throw new ValueError("Invalid argument 'this': type should be " + type);
            }
            return method.call(_this, ...args);
        };
        let dx_function = Pointer.proxifyValue(DatexFunction.createFromJSFunction(proxy_method, original_class, name), true, undefined, false, true);
        each_scope[name] = dx_function;
    }
    if (static_scope) {
        DatexObject.seal(static_scope);
        initialized_static_scope_classes.set(original_class, static_scope);
    }
}
const templated_classes = new Map();
export function createTemplateClass(original_class, type, sync = true) {
    if (templated_classes.has(original_class))
        return templated_classes.get(original_class);
    original_class[DX_TYPE] = type;
    type.setJSInterface({
        class: original_class,
        proxify_children: true,
        is_normal_object: true,
    });
    const constructor_name = Object.keys(original_class.prototype[METADATA]?.[Decorators.CONSTRUCTOR]?.public ?? {})[0];
    const replicator_name = Object.keys(original_class.prototype[METADATA]?.[Decorators.REPLICATOR]?.public ?? {})[0];
    const destructor_name = Object.keys(original_class.prototype[METADATA]?.[Decorators.DESTRUCTOR]?.public ?? {})[0];
    if (constructor_name)
        type.setConstructor(original_class.prototype[constructor_name]);
    if (replicator_name)
        type.setReplicator(original_class.prototype[replicator_name]);
    if (destructor_name)
        type.setDestructor(original_class.prototype[destructor_name]);
    const property_types = original_class.prototype[METADATA]?.[Decorators.FORCE_TYPE]?.public;
    const allow_filters = original_class.prototype[METADATA]?.[Decorators.ALLOW_FILTER]?.public;
    const template = {};
    template[DX_PERMISSIONS] = {};
    let prototype = original_class;
    while ((prototype = Object.getPrototypeOf(prototype)) != Object.prototype) {
        if ((prototype[DX_TYPE])?.template) {
            DatexObject.extend(template, prototype[DX_TYPE].template);
            break;
        }
    }
    for (let [name, dx_name] of Object.entries(original_class.prototype[METADATA]?.[Decorators.PROPERTY]?.public ?? {})) {
        template[name] = property_types?.[name] ?? Type.std.Any;
        if (allow_filters?.[name])
            template[DX_PERMISSIONS][name] = allow_filters[name];
    }
    type.setTemplate(template);
    staticScopeClass(original_class);
    const sync_auto_cast_class = proxyClass(original_class, type, original_class[METADATA]?.[Decorators.IS_SYNC]?.constructor ?? sync);
    globalThis[sync_auto_cast_class.name] = sync_auto_cast_class;
    templated_classes.set(original_class, sync_auto_cast_class);
    return sync_auto_cast_class;
}
function getMethodParams(target, method_name, meta_param_index) {
    if (!(method_name in target))
        return null;
    let tuple = new Tuple();
    let metadata = Reflect.getMetadata && Reflect.getMetadata("design:paramtypes", target, method_name);
    if (!metadata)
        return null;
    ;
    const function_body = target[method_name]?.toString();
    const args_strings = function_body?.match(/^[^(]*\(([^)]*)\)/)?.[1]?.split(",");
    if (args_strings) {
        for (let i = 0; i < args_strings.length; i++) {
            args_strings[i] = args_strings[i].trim().split(/[ =]/)[0];
        }
        let i = 0;
        for (let arg of args_strings) {
            if (meta_param_index != null && meta_param_index == i) {
                i++;
                continue;
            }
            tuple.set(arg, metadata[i] ? Type.getClassDatexType(metadata[i]) : Type.std.Any);
            i++;
        }
    }
    return tuple;
}
function getMetaParamIndex(target, method_name) {
    return target[METADATA]?.[Decorators.META_INDEX]?.public?.[method_name] ??
        (Reflect.getMetadata && Reflect.getMetadata("unyt:meta", target, method_name));
}
DatexFunction.setMethodParamsSource(getMethodParams);
DatexFunction.setMethodMetaIndexSource(getMetaParamIndex);
export function datex_advanced(_class) {
    return _class;
}
export function proxyClass(original_class, type, auto_sync = true) {
    type = type ?? Type.get("ext", original_class.name);
    const new_class = new Proxy(original_class, {
        construct(target, args, newTarget) {
            if (new_class == newTarget) {
                return type.cast(new Tuple(args), undefined, undefined, auto_sync);
            }
            else
                return Reflect.construct(target, args, newTarget);
        },
        getPrototypeOf(target) {
            return original_class;
        }
    });
    Object.defineProperty(new_class, 'options', { value: function (options) {
            original_class[CONSTRUCT_OPTIONS] = options;
            return new_class;
        } });
    Object.defineProperty(new_class, 'new', { value: function (...args) {
            return new new_class(...args);
        } });
    return new_class;
}
