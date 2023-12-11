import { isolatedScope } from "./isolated-scope.ts";

/**
 * Run a weak action (function that is called once with weak dependencies).
 * If one of the weak dependencies is garbage collected, an optional deinit function is called.
 * @param weakRefs
 * @param action an isolated callback function that provides weak references. External dependency variable must be explicitly added with use()
 * @param deinit an isolated callback function that is callled on garbage collection. External dependency variable must be explicitly added with use()
 */
export function weakAction<T extends Record<string, WeakKey>, R>(weakDependencies: T, action: (values: {[K in keyof T]: WeakRef<T[K]>}) => R, deinit?: (actionResult: R, collectedVariable: keyof T) => unknown) {
	const weakRefs = _getWeakRefs(weakDependencies);

	let result:R;

	action = isolatedScope(action);

	// optional deinit
	if (deinit) {
		deinit = isolatedScope(deinit);

		const deinitFn = deinit;

		const deinitHandler = (k: string) => {
			registries.delete(registry)
			deinitFn(result, k);
		}
		const registry = new FinalizationRegistry(deinitHandler);
		registries.add(registry)
	
		for (const [k, v] of Object.entries(weakDependencies)) {
			// if (v.constructor.name.startsWith("Iterable")) {
			// 	const t =  "x".repeat(30)
			// 		.replace(/./g, c => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62) ] );
			// 	console.log(t);
			// 	v[Symbol()] = t;
			// }
			registry.register(v, k);
		}
	}
	
	// call action once
	result = action(weakRefs);
}

function _getWeakRefs<T extends Record<string, WeakKey>>(weakDependencies: T) {
	return Object.fromEntries(
		Object.entries(weakDependencies)
			.map(([k, v]) => [k, new WeakRef(v)])
	) as {[K in keyof T]: WeakRef<T[K]>};
}

const registries = new Set<FinalizationRegistry<string>>();