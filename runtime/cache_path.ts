import { client_type } from "../utils/constants.ts";
import { projectRootURL } from "../utils/global_values.ts";
import { normalizePath } from "../utils/normalize-path.ts";
import { commandLineOptions } from "../utils/args.ts";

let custom_cache_path = commandLineOptions.option("cache-path", {aliases: ["c"], type: "string",  description: "Overrides the default path for datex cache files (.datex-cache)"})

export async function _updateCachePaths() {

	let _cache_path:string|URL = new URL('./.datex-cache/', projectRootURL);
	let _ptr_cache_path:string|URL = new URL('./pointers/', _cache_path);

	// command line args (--watch-backend)
	if (client_type == "deno") {
	
		if (custom_cache_path) {
			if (custom_cache_path?.startsWith("/")) custom_cache_path = `file://${custom_cache_path}`;
			if (!custom_cache_path?.endsWith("/")) custom_cache_path += '/';
			if (custom_cache_path) {
				_cache_path = new URL(custom_cache_path, projectRootURL);
				_ptr_cache_path = new URL('./pointers/', _cache_path);
			}
		}

		// check if write permission for configured datex cache dir
		
		try {
			const testUrl = new URL("write_test", _cache_path.toString());
			Deno.mkdirSync(normalizePath(testUrl), {recursive: true})
			Deno.removeSync(testUrl);
		}
		catch {
			const prev = _cache_path;
			_cache_path = new URL(normalizePath(await Deno.makeTempDir()+"/"), "file:///");
			_ptr_cache_path = new URL('./pointers/', _cache_path);
			console.log("(!) cache directory "+prev+" is readonly, using temporary directory " + _cache_path);
		}
	}

	cache_path = _cache_path;
	ptr_cache_path = _ptr_cache_path;
}

export let cache_path: URL;
export let ptr_cache_path: URL;

await _updateCachePaths();