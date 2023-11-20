import { getCookie, setCookie } from "./cookies.ts";

export function hasDebugCookie() {
	return getCookie("datex-debug") == "true";
}

export function debugMode(enable = true) {
	console.log("[debug mode " + (enable ? "enabled" : "disabled") + "]");
	if (enable) setCookie("datex-debug", "true")
	else setCookie("datex-debug", "");
	window.location.reload()
}


// @ts-ignore
globalThis.debugMode = debugMode;