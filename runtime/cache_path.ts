import { client_type, cwdURL } from "../utils/global_values.ts";


let _cache_path:string|URL = new URL('./.datex-cache/', cwdURL);
let _ptr_cache_path:string|URL = new URL('./pointers/', _cache_path);

// command line args (--watch-backend)
if (client_type == "deno") {

	const commandLineOptions = (await import("../utils/args.ts")).commandLineOptions

	let custom_cache_path = commandLineOptions.option("cache-path", {aliases: ["c"], type: "string",  description: "Overrides the default path for datex cache files (.datex-cache)"})
 
	if (custom_cache_path) {
		if (custom_cache_path?.startsWith("/")) custom_cache_path = `file://${custom_cache_path}`;
		if (!custom_cache_path?.endsWith("/")) custom_cache_path += '/';
		if (custom_cache_path) {
			_cache_path = new URL(custom_cache_path, cwdURL);
			_ptr_cache_path = new URL('./pointers/', _cache_path);
		}
	}

	// check if write permission for configured datex cache dir
	
	try {
		const testUrl = new URL("write_test", _cache_path.toString());
		Deno.mkdirSync(testUrl, {recursive: true})
		Deno.removeSync(testUrl);
	}
	catch (e) {
		const prev = _cache_path;
		_cache_path = new URL(await Deno.makeTempDir()+"/", "file:///");
		_ptr_cache_path = new URL('./pointers/', _cache_path);
		console.log("(!) cache directory "+prev+" is readonly, using temporary directory " + _cache_path);
	}
}

export const cache_path = _cache_path;
export const ptr_cache_path = _ptr_cache_path;
