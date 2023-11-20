import { client_type } from "./constants.ts";


export function deleteCookie(name: string) {
	if (client_type !== "browser") {
		throw new Error("cannot delete cookies for non-browser environment");
	}
    document.cookie = name +'=; Path=/;  Domain=' + location.host +  '; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}


export function setCookie(name: string, value: string, expDays?: number) {
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
	document.cookie = name + "=" + value + "; " + expires + " path=/;"
}

export function getCookie(name: string) {
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