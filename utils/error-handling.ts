import { ESCAPE_SEQUENCES } from "./logger.ts";
import DATEX_VERSION from "../VERSION.ts"
import { sendReport } from "./error-reporting.ts";
import { logger as defaultLogger } from "./global_values.ts";

/**
 * Represents an error that the UIX developer community knows about.
 * The user might be able to fix it or ask for help.
 */
export class KnownError extends Error {
	constructor(message: string, public solutions: string[] = [], public quickFixes: {description: string, fix: () => void}[] = []) {
		super(message);
	}
}

/**
 * Formats and prints an error in a fashion that's readable and informative
 * for the user. If `exit` is enabled, the process exits afterwards.
 * @param error The error object to handle
 * @param logger Logger to print the information to
 * @param [exit=true] Specifies whether the process should exit, defaults to `true`
 * @param [exitCode=1] Code to exit with if `exit` is set to true, defaults to `1`
 */
export async function handleError(error: Error|string, logger = defaultLogger, exit = true, exitCode = 1) {
	if (typeof error === "string" || error instanceof String) {
		logger.error(error);
	} else if (error instanceof KnownError) {
		logger.error(error.message);
		if (error.solutions.length > 0) {
			console.log();
			logger.info(`Suggested Problem Solutions:\n${error.solutions.map(s => `- ${s}`).join("\n")}\n`);
		}
		if (error.quickFixes) {
			for (const fix of error.quickFixes) {
				console.log();
				const doFix = confirm(`${fix.description}`);
				if (doFix) fix.fix();
			}
		}
	} else {
		let details;
		if (error.stack) {
			const stack = error.stack.split("\n");
			stack[0] = `${ESCAPE_SEQUENCES.UNDERLINE}${stack[0]}${ESCAPE_SEQUENCES.RESET_UNDERLINE}`;
			details = stack.join("\n");
		} else details = error.toString();

		logger.error(`An unexpected error occured.\n${ESCAPE_SEQUENCES.BOLD}DATEX${ESCAPE_SEQUENCES.DEFAULT} Version: ${DATEX_VERSION}\n${ESCAPE_SEQUENCES.BOLD}Deno${ESCAPE_SEQUENCES.DEFAULT} Version: ${Deno.version.deno}\n\n${details}`);
		await sendReport("unexpectederror", {
			name: error.name,
			message: error.message,
			stack: error.stack
		});
	}

	if (exit) Deno.exit(exitCode);
}


let unhandledRejectionHandlerEnabled = false;

/**
 * Enables the unhandled rejection handler, which logs unhandled promise rejections
 * and prevents the program from crashing.
 * @param customLogger a custom logger to use for logging unhandled rejections
 */
export function enableUnhandledRejectionHandler(customLogger = defaultLogger) {
	if (unhandledRejectionHandlerEnabled) return;
	unhandledRejectionHandlerEnabled = true;
	// clean error presentation
	globalThis.addEventListener("unhandledrejection", async (event) => {
		try {
			event.preventDefault();
			const error = await event.promise.catch(error => error);
			await handleError(error, customLogger);
		}
		catch (e) {
			console.error(e);
		}
	});
}