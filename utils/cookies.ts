/**
 * Cookie utils - Only for use on the frontend:
 */
import { client_type } from "./constants.ts";

const port = globalThis.location?.port;
const browserIsSafariLocalhost = window.location?.hostname == "localhost" && (/^((?!chrome|android).)*safari/i.test(navigator.userAgent));

export function deleteCookie(name: string) {
	if (client_type !== "browser") {
		throw new Error("cannot delete cookies for non-browser environment");
	}
	if (port) name += "/" + port;
    document.cookie = name +'=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}


export function setCookie(name: string, value: string, expDays?: number) {
	if (client_type !== "browser") {
		throw new Error("cannot set cookies for non-browser environment");
	}
	if (port) name += "/" + port;

	value = encodeURIComponent(value)
	let expiryDate = new Date("Fri, 31 Dec 9999 21:10:10 GMT");
	if (expDays !== undefined) {
		expiryDate = new Date();
		expiryDate.setTime(expiryDate.getTime() + (expDays * 24 * 60 * 60 * 1000));
	}
	const expires = expDays == 0 ? "" : "expires=" + expiryDate.toUTCString() + ";";
	document.cookie = name + "=" + value + "; " + expires + " path=/; SameSite=None;"  + (browserIsSafariLocalhost ? "" :" Secure;")
}

export function getCookie(name: string) {
	if (client_type !== "browser") return;

	if (port) name += "/" + port;

	const cname = name + "=";
	const cookies = decodeURIComponent(document.cookie);
	const cookieArray = cookies.split('; ');
	let res: string|undefined;
	cookieArray.forEach(val => {
		if (val.indexOf(cname) === 0) res = val.substring(cname.length);
	})
	return res;
}