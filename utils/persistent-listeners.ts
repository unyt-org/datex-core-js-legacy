import { IterableWeakMap } from "./iterable-weak-map.ts";

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
	listeners.set(target, {event, handler, options});
}

export function removePersistentListener(target: EventTarget, event: string, handler: EventListenerOrEventListenerObject|null, options?: boolean | AddEventListenerOptions) {
	originalRemoveEventListener.call(target, event, handler, options)
	for (const [possibleTarget] of listeners) {
		if (target === possibleTarget) listeners.delete(possibleTarget);
	}
}

export function recreatePersistentListeners() {
	for (const [target, {event, handler, options}] of listeners) {
		console.debug("recreated a persistent event listener for '" + event + "'")
		originalAddEventListener.call(target, event, handler, options)
	}
}

const listeners = new IterableWeakMap<EventTarget, {event: string, handler: EventListenerOrEventListenerObject|null, options?: boolean | AddEventListenerOptions}>()
