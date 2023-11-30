/**
 * Send DATEX blocks to a server with a HTTPComInterface
 * (listening to POST requests on /datex-http).
 * No response is returned.
 * 
 * This is not the same as datex-over-http implemented in UIX
 * that send unsigned/unencrypted DATEX scripts to an HTTP server
 */
export function sendDatexViaHTTPChannel(dxb: ArrayBuffer, origin = window.location.origin) {

	// fallback to sendBeacon for firefox until fetch keepalive implemented
	if (navigator.userAgent.includes("Firefox/")) {
		navigator.sendBeacon(origin + "/datex-http", dxb);
	}
	else {
		fetch(origin + "/datex-http", {
			method: 'post',
			headers: {
				'Content-Type': 'application/datex',
			},
			body: dxb,
			keepalive: true
		})
	}
}