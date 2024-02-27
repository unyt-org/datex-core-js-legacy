import { endpoint_name, target_clause } from "../datex_all.ts";
import type { Type } from "../types/type.ts";
import type { Class } from "../utils/global_types.ts";
import { Decorators } from "./js_class_adapter.ts";


export function handleClassFieldDecoratorWithOptionalArgs<C extends ClassFieldDecoratorContext, const T extends unknown[], R>(args:T, context: C|undefined, callback: (arg: T, context: C)=>R): ((value: undefined, context: C) => R)|R {
	if (!isDecoratorContext(context)) return (_value: undefined, context: C) => callback(args, context)
	else return callback([] as unknown as T, context!)
}
export function handleClassFieldDecoratorWithArgs<C extends ClassFieldDecoratorContext, const T extends unknown[], R>(args:T, callback: (arg: T, context: C)=>R): ((value: undefined, context: C) => R) {
	return (_value: undefined, context: C) => callback(args, context)
}
export function handleClassDecoratorWithOptionalArgs<_Class extends Class, C extends ClassDecoratorContext<_Class>, const T extends unknown[], R>(args:T, value: _Class, context: C|undefined, callback: (arg: T, value: _Class, context: C)=>R): ((value: _Class, context: C) => R)|R {
	if (!isDecoratorContext(context)) return (value: _Class, context: C) => callback(args, value, context)
	else return callback([] as unknown as T, value, context!)
}
export function handleClassDecoratorWithArgs<_Class extends Class, C extends ClassDecoratorContext<_Class>, const T extends unknown[], R>(args:T, callback: (arg: T, value: _Class, context: C)=>R): ((value: _Class, context: C) => R) {
	return (value: _Class, context: C) => callback(args, value, context)
}


function isDecoratorContext(context: unknown) {
	return context && typeof context === "object" && "kind" in context
}



type PropertyDecoratorContext<T=unknown> = ClassFieldDecoratorContext<unknown, T|undefined>|ClassGetterDecoratorContext<unknown, T|undefined>|ClassMethodDecoratorContext<unknown, T&((...args: any[])=>any)>

export function property<T>(type: string|Type<T>|Class<T>): (value: ((...args: any[])=>any)|undefined, context: PropertyDecoratorContext<T>)=>void
export function property(value: ((...args: any[])=>any)|undefined, context: PropertyDecoratorContext): void
export function property(type: ((...args: any[])=>any)|undefined|string|Type|Class, context?: PropertyDecoratorContext) {
    return handleClassFieldDecoratorWithOptionalArgs([type], context as ClassFieldDecoratorContext, ([type], context:PropertyDecoratorContext) => {
		return Decorators.property(type as Type, context)
	})
}


export function assert<T>(assertion:(val:T)=>boolean|string|undefined): (value: undefined, context: ClassFieldDecoratorContext<unknown, T|undefined>)=>void {
	return handleClassFieldDecoratorWithArgs([assertion], ([assertion], context) => {
		return Decorators.assert(assertion, context)
	})
}


export function endpoint(endpoint:target_clause|endpoint_name, scope_name?:string): (value: Class, context: ClassDecoratorContext)=>void
export function endpoint(value: Class, context: ClassDecoratorContext): void
export function endpoint(value: Class|target_clause|endpoint_name, context?: ClassDecoratorContext|string) {
	return handleClassDecoratorWithOptionalArgs([value as target_clause|endpoint_name, context as string], value as Class, context as ClassDecoratorContext, ([endpoint, scope_name], value, context) => {
		return Decorators.endpoint(endpoint, scope_name, value, context)
	})
}

/**
 * @deprecated Use struct(class {...}) instead;
 */
export function sync(type: string): (value: Class, context: ClassDecoratorContext)=>void
export function sync(value: Class, context: ClassDecoratorContext): void
export function sync(value: Class|string, context?: ClassDecoratorContext) {
	return handleClassDecoratorWithOptionalArgs([value as string], value as Class, context as ClassDecoratorContext, ([type], value, context) => {
		return Decorators.sync(type, value, context)
	})
}