
const originalAddEventListener = EventTarget.prototype.addEventListener
const originalRemoveEventListener = EventTarget.prototype.removeEventListener

export function overrideEventTargetPrototype() {
	EventTarget.prototype.addEventListener = function (event, handler, options) {
		addPersistentListener(this??globalThis, event, handler, options)
	}
	EventTarget.prototype.removeEventListener = function (event, handler, options) {
		removePersistentListener(this??globalThis, event, handler, options)
	}
	EventTarget.prototype.addEventListenerOnce = originalAddEventListener
	EventTarget.prototype.removeEventListenerOnce = originalRemoveEventListener
}

/**
 * Adds a event listener that gets reconstructed after document.write is called
 */
export function addPersistentListener(target: EventTarget, event: string, handler: EventListenerOrEventListenerObject|null, options?: boolean | AddEventListenerOptions) {
	originalAddEventListener.call(target, event, handler, options)
	listeners.set(new WeakRef(target), {event, handler, options});
}

export function removePersistentListener(target: EventTarget, event: string, handler: EventListenerOrEventListenerObject|null, options?: boolean | AddEventListenerOptions) {
	originalRemoveEventListener.call(target, event, handler, options)
	for (const [targetRef] of listeners) {
		const possibleTarget = targetRef.deref();
		if (!possibleTarget) {
			listeners.delete(targetRef);
			continue;
		}
		if (target === possibleTarget) listeners.delete(targetRef);
	}
}

export function recreatePersistentListeners() {
	for (const [targetRef, {event, handler, options}] of listeners) {
		const target = targetRef.deref();
		if (!target) {
			listeners.delete(targetRef);
			continue;
		}
		console.debug("recreated a persistent event listener for '" + event + "'")
		originalAddEventListener.call(target, event, handler, options)
	}
}

const listeners = new Map<WeakRef<EventTarget>, {event: string, handler: EventListenerOrEventListenerObject|null, options?: boolean | AddEventListenerOptions}>()
