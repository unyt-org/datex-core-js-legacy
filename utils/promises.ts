function sleepPromise(ms:number) {
	return new Promise(resolve=>setTimeout(resolve,ms));
}

// @ts-ignore
globalThis.sleep = sleepPromise;

declare global {
	const sleep: typeof sleepPromise
}