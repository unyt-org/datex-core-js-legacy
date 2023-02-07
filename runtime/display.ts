
/**
 * used to display error and reset page to user
 */

// @ts-ignore
globalThis.errorReset = ()=> {
	try {
		// @ts-ignore
		if (globalThis.reset) reset()
		else throw ""
	}
	catch {
		localStorage.clear(); // last resort, clear localStorage - TODO: also clear indexeddb?
	}
}

function setup() {
	// @ts-ignore
	if (!globalThis.Deno && globalThis.window && globalThis.document) {
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
	// @ts-ignore
	if (!globalThis.Deno && globalThis.window && globalThis.document) {
		// @ts-ignore
		const document = globalThis.document;
		setup();

		document.body.innerHTML = `
<div style="display:flex;flex-direction:column;width:100%;height:100%;background:#0f0f0f;font-family:sans-serif;text-align:center;padding:5px;box-sizing:border-box">
	<div style="flex:1;display:flex;flex-direction:column;width:100%;justify-content:center;align-items:center;color:#ddd;">
		<h3>Oh no, something bad happened :/</h3>
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
Cannot restore the current state. Please delete all caches (.datex-cache) and restart.
		`
	}
}

export function displayInit() {
	// @ts-ignore
	if (!globalThis.Deno && globalThis.window && globalThis.document) {
		// @ts-ignore
		const document = globalThis.document;
		setup();
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
	<div class="stage filter-contrast">
		<div class="dot-gathering"></div>
	</div>
</div>`;
	}
}

export function displayClear() {
	// @ts-ignore
	if (!globalThis.Deno && globalThis.window && globalThis.document) {
		// @ts-ignore
		globalThis.document.body.innerHTML = "";;
	}
}