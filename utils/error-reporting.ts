import { Compiler } from "../compiler/compiler.ts";
import { sendDatexViaHTTPChannel } from "../network/datex-http-channel.ts";
import { Runtime } from "../runtime/runtime.ts";
import { getCallerInfo } from "../utils/caller_metadata.ts";
import { logger } from "./global_values.ts";

export async function sendReport(identifier: string, reportData:Record<string,any>) {
	if (!enabled) return;

	const report = {
		identifier,
		timestamp: new Date(),
		metadata: {
			endpoint: Runtime.endpoint.toString(),
			datexcoreVersion: Runtime.VERSION,
			uixVersion: globalThis.UIX?.version,
			denoVersion: globalThis.Deno?.version.deno,
			tsVersion: globalThis.Deno?.version.typescript,
			v8Version: globalThis.Deno?.version.v8,
			userAgent: JSON.parse(JSON.stringify(window.navigator.userAgentData ?? window.navigator.userAgent))
		},
		reportData,
		stack: getCallerInfo()
	}

	const dx = `#endpoint.Reporting.sendReport(?)`
	const dxb = <ArrayBuffer> await Compiler.compile(dx, [report], {sign: false, encrypt: false});
	sendDatexViaHTTPChannel(dxb, "https://status.unyt.org")
}

let enabled = false;

export function enableErrorReporting(enable = true) {
	logger.debug("error reporting to unyt.org " + (enable ? "enabled" : "disabled"));
	enabled = enable;
}