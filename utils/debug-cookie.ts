import { getCookie, setCookie } from "./cookies.ts";
import { LOG_LEVEL, Logger } from "./logger.ts";

export function hasDebugCookie() {
	return getCookie("datex-debug") == "true";
}

export function debugMode(enable = true) {
	console.log("[debug mode " + (enable ? "enabled" : "disabled") + "]");
	Logger.development_log_level = enable ? LOG_LEVEL.VERBOSE : LOG_LEVEL.DEFAULT;
	if (enable) setCookie("datex-debug", "true")
	else setCookie("datex-debug", "");
}


// @ts-ignore
globalThis.debugMode = debugMode;