/**
 * Run a weak action (function that is called once with weak dependencies).
 * If one of the weak dependencies is garbage collected, an optional deinit function is called.
 * @param weakRefs
 * @param action 
 * @param deinit 
 */
export function weakAction<T extends Record<string, WeakKey>, R>(weakDependencies: T, action: (values: {[K in keyof T]: WeakRef<T[K]>}) => R, deinit?: (actionResult: R, collectedVariable: keyof T) => unknown) {
	const weakRefs = Object.fromEntries(
		Object.entries(weakDependencies)
			.map(([k, v]) => [k, new WeakRef(v)])
	) as {[K in keyof T]: WeakRef<T[K]>};

	let result:R;

	// optional deinit
	if (deinit) {
		const registry = new FinalizationRegistry((k: string) => {
			console.log("deinitalized weak action (variable '" + k + "' was garbage collected)")
			deinit(result, k);
		});
	
		for (const [k, v] of Object.entries(weakDependencies)) {
			registry.register(v, k);
		}
	}
	
	// call action once
	result = action(weakRefs);
}