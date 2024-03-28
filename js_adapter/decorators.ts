import { endpoint_name, target_clause } from "../datex_all.ts";
import { Endpoint } from "../types/addressing.ts";
import { PermissionError } from "../types/errors.ts";
import { JSTransferableFunction } from "../types/js-function.ts";
import type { Type } from "../types/type.ts";
import type { Class, datex_meta } from "../utils/global_types.ts";
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
export function handleClassMethodDecoratorWithArgs<C extends ClassMethodDecoratorContext, const T extends unknown[], R>(args:T, callback: (arg: T, value:(...args:any[])=>any, context: C)=>R): ((value: (...args:any[])=>any, context: C) => R) {
	return (value: (...args:any[])=>any, context: C) => callback(args, value, context)
}

function isDecoratorContext(context: unknown) {
	return context && typeof context === "object" && "kind" in context
}



type PropertyDecoratorContext<T=unknown> = ClassFieldDecoratorContext<unknown, T|undefined>|ClassGetterDecoratorContext<unknown, T|undefined>|ClassMethodDecoratorContext<unknown, T&((...args: any[])=>any)>

/**
 * Marks a (static) class field as a property accessible by DATEX.
 * @param type optional type for the property, must match the declared TypeScript type
 */
export function property<T>(type: string|Type<T>|Class<T>): (value: ((...args: any[])=>any)|undefined, context: PropertyDecoratorContext<T>)=>void
export function property(value: ((...args: any[])=>any)|undefined, context: PropertyDecoratorContext): void
export function property(type: ((...args: any[])=>any)|undefined|string|Type|Class, context?: PropertyDecoratorContext) {
    return handleClassFieldDecoratorWithOptionalArgs([type], context as ClassFieldDecoratorContext, ([type], context:PropertyDecoratorContext) => {
		return Decorators.property(type as Type, context)
	})
}

// TODO: experimental alias for @property:
/**
 * Binds a (static) class property to a DATEX ref
 * @param type optional type for the ref, must match the declared TypeScript property type
 */
export function ref<T>(type: string|Type<T>|Class<T>): (value: ((...args: any[])=>any)|undefined, context: PropertyDecoratorContext<T>)=>void
export function ref(value: ((...args: any[])=>any)|undefined, context: PropertyDecoratorContext): void
export function ref(type: ((...args: any[])=>any)|undefined|string|Type|Class, context?: PropertyDecoratorContext) {
    return handleClassFieldDecoratorWithOptionalArgs([type], context as ClassFieldDecoratorContext, ([type], context:PropertyDecoratorContext) => {
		return Decorators.property(type as Type, context)
	})
}


/**
 * Adds an assertion to a class field that is checked before the field is set
 * @returns 
 */
export function assert<T>(assertion:(val:T)=>boolean|string|undefined): (value: undefined, context: ClassFieldDecoratorContext<unknown, T|undefined>)=>void {
	return handleClassFieldDecoratorWithArgs([assertion], ([assertion], context) => {
		return Decorators.assert(assertion, context)
	})
}

export function allow<T extends (...args:any)=>any>(assertion:(meta: datex_meta) => boolean|Promise<boolean>): (value: T, context: ClassMethodDecoratorContext<unknown, T>) => T {
	return handleClassMethodDecoratorWithArgs([assertion], ([assertion], fn, context) => {
		// async
		if (JSTransferableFunction.functionIsAsync(assertion as (...args:any)=>any)) {
			return async function(this:any, ...args:any) {
				if (!await assertion(datex.meta)) throw new PermissionError("Endpoint has no permission to call this function")
				return fn.apply(this, args)
			} as any
		}
		// sync
		else {
			return function(this:any, ...args:any) {
				if (!assertion(datex.meta)) throw new PermissionError("Endpoint has no permission to call this function")
				return fn.apply(this, args)
			} as any
		}
	})
}

/**
 * Make a class publicly accessible for an endpoint (only static methods and properties marked with @property are exposed)
 * Also enables calling static class methods on other endpoints
 * @param endpoint 
 * @param scope_name 
 */
export function endpoint(endpoint:target_clause|endpoint_name, scope_name?:string): (value: Class, context: ClassDecoratorContext)=>void
export function endpoint(value: Class, context: ClassDecoratorContext): void
export function endpoint(value: Class|target_clause|endpoint_name, context?: ClassDecoratorContext|string) {
	return handleClassDecoratorWithOptionalArgs([value as target_clause|endpoint_name, context as string], value as Class, context as ClassDecoratorContext, ([endpoint, scope_name], value, context) => {
		return Decorators.endpoint(endpoint, scope_name, value, context)
	})
}


/**
 * Sets a class as the entrypoint for the current endpoint
 */
export function entrypoint(value: Class, context: ClassDecoratorContext) {
	return Decorators.entrypoint(value, context)
}

/**
 * Adds a class as a property of entrypoint for the current endpoint
 */
export function entrypointProperty(value: Class, context: ClassDecoratorContext) {
	return Decorators.entrypointProperty(value, context)
}

/**
 * Sets the maximum allowed time (in ms) for a remote function execution 
 * before a timeout error is thrown (default: 5s)
 * @param timeMs timeout in ms
 * @returns 
 */
export function timeout(timeMs:number): (value: (...args:any[])=>any, context: ClassMethodDecoratorContext)=>void {
	return handleClassMethodDecoratorWithArgs([timeMs], ([timeMs], _value, context) => {
		return Decorators.timeout(timeMs, context)
	});
}

/**
 * Maps a class to a corresponding DATEX type
 */
export function sync(type: string): (value: Class, context: ClassDecoratorContext)=>void
export function sync(value: Class, context: ClassDecoratorContext): void
export function sync(value: Class|string, context?: ClassDecoratorContext) {
	return handleClassDecoratorWithOptionalArgs([value as string], value as Class, context as ClassDecoratorContext, ([type], value, context) => {
		return Decorators.sync(type, value, context)
	})
}