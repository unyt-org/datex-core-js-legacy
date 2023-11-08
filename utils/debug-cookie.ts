import { client_type } from "../utils/constants.ts";

export function hasDebugCookie() {
	return getCookie("datex-debug") == "true";
}

export function debugMode(enable = true) {
	console.log("[debug mode " + (enable ? "enabled" : "disabled") + "]");
	if (enable) setCookie("datex-debug", "true")
	else setCookie("datex-debug", "");
}


function setCookie(name: string, value: string, expDays?: number) {
	if (client_type !== "browser") {
		throw new Error("cannot set cookies for non-browser environment");
	}

	value = encodeURIComponent(value)
	let expiryDate = new Date("Fri, 31 Dec 9999 21:10:10 GMT");
	if (expDays) {
		expiryDate = new Date();
		expiryDate.setTime(expiryDate.getTime() + (expDays * 24 * 60 * 60 * 1000));
	}
	const expires = "expires=" + expiryDate.toUTCString() + ";";
	document.cookie = name + "=" + value + "; " + expires + " path=/; SameSite=None; Secure;";
}

function getCookie(name: string) {
	if (client_type !== "browser") return;

	const cname = name + "=";
	const cookies = decodeURIComponent(document.cookie);
	const cookieArray = cookies.split('; ');
	let res: string|undefined;
	cookieArray.forEach(val => {
		if (val.indexOf(cname) === 0) res = val.substring(cname.length);
	})
	return res;
}

// @ts-ignore
globalThis.debugMode = debugMode;