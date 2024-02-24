import { isolatedScope } from "./isolated-scope.ts";

/**
 * Run a weak action (function that is called once with weak dependencies).
 * If one of the weak dependencies is garbage collected, an optional deinit function is called.
 * @param weakRefs
 * @param action an isolated callback function that provides weak references. External dependency variable must be explicitly added with use()
 * @param deinit an isolated callback function that is called on garbage collection. External dependency variable must be explicitly added with use()
 */
export function weakAction<T extends Record<string, WeakKey>, R, D extends Record<string, WeakKey>|undefined>(weakDependencies: T, action: (values: {[K in keyof T]: WeakRef<T[K]>}) => R, deinit?: (actionResult: R, collectedVariable: keyof T, weakDeinitDependencies: D) => unknown, weakDeinitDependencies?: D) {
	const weakRefs = _getWeakRefs(weakDependencies);
	const weakDeinitRefs = weakDeinitDependencies ? _getWeakRefs(weakDeinitDependencies) : undefined;

	let result:R|WeakRef<R&object>;

	action = isolatedScope(action);

	// optional deinit
	if (deinit) {
		deinit = isolatedScope(deinit);

		const deinitFn = deinit;

		const deinitHandler = (k: string) => {
			registries.delete(registry)

			// unwrap all deinit weak refs
			const weakDeinitDeps = weakDeinitRefs && Object.fromEntries(
				Object.entries(weakDeinitRefs).map(([k, v]) => [k, v.deref()])
			)
			// check if all deinit weak refs are still alive, otherwise return
			if (weakDeinitDeps) {
				for (const v of Object.values(weakDeinitDeps)) {
					if (v === undefined) {
						return;
					}
				}
			}

			const unwrappedResult = result instanceof WeakRef ? result.deref() : result;
			if (result instanceof WeakRef && unwrappedResult === undefined) {
				return;
			}

			deinitFn(unwrappedResult!, k, weakDeinitDeps as D);
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
	const actionResult = action(weakRefs);
	result = (actionResult && (typeof actionResult === "object" || typeof actionResult == "function")) ? new WeakRef(actionResult) : actionResult;
}

function _getWeakRefs<T extends Record<string, WeakKey>>(weakDependencies: T) {
	return Object.fromEntries(
		Object.entries(weakDependencies)
			.map(([k, v]) => [k, new WeakRef(v)])
	) as {[K in keyof T]: WeakRef<T[K]>};
}

const registries = new Set<FinalizationRegistry<string>>();