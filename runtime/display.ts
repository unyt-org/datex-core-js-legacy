import { client_type } from "../utils/constants.ts";

/**
 * used to display error and reset page to user
 */
const errorReset = async ()=> {
	try {
		// TODO: remove localStorage.clear here?
		localStorage.clear();
		// @ts-ignore
		if (globalThis.reset) await reset()
		else throw ""
	}
	catch {
		localStorage.clear(); // last resort, clear localStorage - TODO: also clear indexeddb?
	}
	if (globalThis.Deno) Deno.exit(1);
}
// @ts-ignore
globalThis.errorReset = errorReset

function setup() {
	if (client_type !== "deno" && globalThis.window && globalThis.document) {
		// @ts-ignore
		const document = globalThis.document;

		document.body.style.width = "100%"
		document.body.style.height = "100%"
		document.body.style.margin = "0"
		document.documentElement.style.width = "100%"
		document.documentElement.style.height = "100%"
		document.head.insertAdjacentHTML('beforeend', '<meta name="viewport" content="viewport-fit=cover, width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>')
	}
}


export function displayFatalError(code:string, reset_btn = true) {

	// disable error screen (at least for now, immediately reset page)
	errorReset();
	return;

	// @ts-ignore
	if (client_type !== "deno" && globalThis.window && globalThis.document) {
		// @ts-ignore
		const document = globalThis.document;
		setup();

		document.body.innerHTML = `
<div style="display:flex;flex-direction:column;width:100%;height:100%;background:#0f0f0f;font-family:sans-serif;text-align:center;padding:5px;box-sizing:border-box">
	<div style="flex:1;display:flex;flex-direction:column;width:100%;justify-content:center;align-items:center;color:#ddd;">
		<h3 style="color:#ddd">Oh no, something bad happened :/</h3>
		<div style="color:#bbb;margin-bottom:15px;">Your app data on this device might not be recoverable</div>
		${reset_btn ? `<button style="all:unset;background:#333;padding:8px;border-radius:10px;text-align:center;font-size:1.1em" onclick="errorReset()">
			Reset App
		</button>` : '' }
	</div>
<span style="text-align:center;margin:30px;color:#bfaaaa">error: ${code}</span>
</div>`;
	}
	else {
		console.log `
FATAL ERROR: ${code}
Cannot restore the current state. Deleting all caches (.datex-cache).
		`
		// @ts-ignore
		errorReset()
	}
}

let show_init_screen = true;

export function enableInitScreen(){
	show_init_screen = true;
}

export function disableInitScreen(){
	show_init_screen = false;
}

let keepScreen = false;
let showing_init_screen = false;

export function displayInit(message?:string) {
	if (showing_init_screen) return;
	if (!show_init_screen) return;
	// @ts-ignore
	if (client_type !== "deno" && globalThis.window && globalThis.document) {
		// @ts-ignore
		const document = globalThis.document;
		// already content there, don't show init page
		if (document.body.children.length) {
			keepScreen = true;
			return; 
		}
		setup();
		showing_init_screen = true;
		document.head.innerHTML += `<style>
		/**
		 * ==============================================
		 * Experimental: Gooey Effect
		 * Dot Gathering
		 * ==============================================
		 */
		.dot-gathering {
		  position: relative;
		  width: 12px;
		  height: 12px;
		  border-radius: 6px;
		  background-color: #999;
		  color: transparent;
		  margin: -1px 0;
		}
		.dot-gathering::before, .dot-gathering::after {
		  content: "";
		  display: inline-block;
		  position: absolute;
		  top: 0;
		  left: -50px;
		  width: 12px;
		  height: 12px;
		  border-radius: 6px;
		  background-color: #999;
		  color: transparent;
		  opacity: 0;
		  animation: dot-gathering 2s infinite ease-in;
		}
		.dot-gathering::after {
		  animation-delay: 0.5s;
		}
		
		@keyframes dot-gathering {
		  0% {
			opacity: 0;
			transform: translateX(0);
		  }
		  35%, 60% {
			opacity: 1;
			transform: translateX(50px);
		  }
		  100% {
			opacity: 0;
			transform: translateX(100px);
		  }
		}		
</style>`

		document.body.innerHTML = `
<div style="align-items:center;justify-content:center;display:flex;flex-direction:column;width:100%;height:100%;background:#0f0f0f;font-family:sans-serif;text-align:center;padding:5px;box-sizing:border-box">
	${message ? `<div style="margin:10px">${message}</div>` : ''}
	<div class="stage filter-contrast">
		<div class="dot-gathering"></div>
	</div>
</div>`;
	}
}

export function displayClear() {
	if (!show_init_screen || keepScreen) return;
	// @ts-ignore
	if (client_type != "deno" && globalThis.window && globalThis.document) {
		// @ts-ignore
		showing_init_screen = false;
		globalThis.document.body.innerHTML = "";
	}
}