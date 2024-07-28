export type DisposableCallback<T extends (...args: any[]) => void> = T & { dispose: () => void; [Symbol.dispose]: () => void; };

/**
 * Helper class to manage disposable callbacks.
 * Assigns a `dispose` method to each callback that can be used to remove the callback from the handler.
 */
export class DisposableCallbackHandler<T extends (...args: any[]) => void = (...args: any[]) => void> {

	#callbacks = new Set<DisposableCallback<T>>();

	add(callback: T): DisposableCallback<T> {
		const disposableCallback = Object.assign(callback as any, {
			dispose: () => this.dispose(disposableCallback),
			[Symbol.dispose]: () => this.dispose(disposableCallback),
		});
		this.#callbacks.add(disposableCallback);
		return disposableCallback;
	}

	dispose(callback: DisposableCallback<T>) {
		this.#callbacks.delete(callback);
	}

	trigger(...args: Parameters<T>) {
		this.#callbacks.forEach(callback => callback(...args));
	}
}