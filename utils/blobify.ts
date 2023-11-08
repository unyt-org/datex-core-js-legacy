import { Datex } from "../mod.ts";
import { client_type } from "./constants.ts";

/**
 * Returns a blob URL for a file with the same content as the provided path
 * This can be used to surpass same-origin policies (only works for script files with no relative imports)
 * @param path 
 */
export async function blobifyFile(path: string|URL) {
	const [script] = await Datex.Runtime.getURLContent(path.toString(), true, true) as [string, string];
	console.log("script", script)
	return blobifyScript(script);
}

/**
 * Returns a blob URL for a script source code
 * This can be used to surpass same-origin policies (only works for script files with no relative imports)
 * @param path 
 */
export function blobifyScript(script: string) {
	const blob = new Blob(
		[script],
		{ type: client_type == 'deno' ?  'text/typescript' : 'text/javascript' }
	);
	return URL.createObjectURL(blob);
}