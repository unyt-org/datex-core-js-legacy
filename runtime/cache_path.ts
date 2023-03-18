import { cwdURL } from "../utils/global_values.ts";


let _cache_path:string|URL = new URL('./.datex-cache/', cwdURL);
let _ptr_cache_path:string|URL = new URL('./pointers/', _cache_path);

// command line args (--watch-backend)
if (globalThis.Deno) {

    const parse = (await import("https://deno.land/std@0.168.0/flags/mod.ts")).parse;
    const flags = parse(Deno.args, {
        string: ["cache-path"],
        alias: {
            c: "cache-path"
        }
    });
 
	if (flags["cache-path"]) {
		if (flags["cache-path"]?.startsWith("/")) flags["cache-path"] = `file://${flags["cache-path"]}`;
		if (!flags["cache-path"]?.endsWith("/")) flags["cache-path"] += '/';
		if (flags["cache-path"]) {
			_cache_path = new URL(flags["cache-path"], cwdURL);
			_ptr_cache_path = new URL('./pointers/', _cache_path);
		}
	}

	// check if write permission for configured datex cache dir
	
	try {
		Deno.mkdirSync(_cache_path.toString() + "write_test", {recursive: true})
		Deno.removeSync(_cache_path.toString() + "write_test")
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
