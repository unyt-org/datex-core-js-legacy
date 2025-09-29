import { Logger } from "../utils/logger.ts";
// if (globalThis.Deno && !globalThis.NO_INIT) enableCLI();

export async function enableCLI() {
	try {
		const InputLoop = (await import("https://deno.land/x/input@2.0.4/index.ts")).default;
		const logger = new Logger("CLI");
		const input = new InputLoop();
		
		while (true) {
			const cmd = await input.question('> ', false);
	
			if (cmd) {
				try {
					const res = await datex(cmd, undefined, undefined, false, false, 'datex://cli');
					logger.plain('?', res);
				}
				catch (e) {
					logger.plain('#color(red)',e);
				}
			}
		}
	}
	catch {
		// console.log("[cannot start CLI]")
	}
}