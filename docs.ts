import { doc } from "https://deno.land/x/deno_doc/mod.ts";

const docs = await doc(new URL("./datex.ts", import.meta.url).toString());
Deno.writeTextFileSync("./docs.json", JSON.stringify(docs, null, "    "));