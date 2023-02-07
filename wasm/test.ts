import init, {init_runtime, compile, decompile, execute, cli} from "unyt_core/wasm/adapter/pkg/datex_wasm.js"
import {Datex} from "unyt_core"
import "uix"
import {Terminal} from "uix_std/terminal/main.ts"
import { GridGroup } from "uix/components/grid_group.ts"


// output
const stream = new Datex.Stream<string>();
const out_term = new Terminal({in:stream});

// cli
const _in_stream = new ReadableStream();
const _out_stream = new ReadableStream();
const in_stream = new Datex.Stream<string>();
const out_stream = new Datex.Stream<string>(_out_stream);
const cli_term = new Terminal({in:in_stream});


cli();
new GridGroup({columns:[1,1],rows:[1], auto_position:true, sealed:false, bg_color:'var(--bg_default)', padding: 10},{}, [out_term,cli_term]).anchor()


await init()


const datex = `
type <MyType>(1,4,6,7, 10:11);
<A/Bc> {a: 10, b: [1,2,3], "a-b":23, "1":1};
<std:Lol> <stdx:Lol>;
(a:123,2:12);
keys [1,2,3];
42 + 44 - 10 / 100 * 5 ^ 12.23 % 10;
true or false;
12.34;
\`c00ffeee4411\`;
infinity;
-infinity;
@example;
nan;
[1,2,3,4];
function (x:<string>) (
	1 * 10
);
<quantity(3€)>;
10.5m/s;
true false null void;
"abc\ndef";
"esac\\\\ped:\\"blab\\"";
val y = "Hello World";`

const _datex2 = `
(
	(
		(
			"Hello \\"World\\" and " 
			(<text> (42)) +
		) 
		" is it " +
	) 
	(<text> (true)) +
);`

const datex2 = `<text> 10 5 + 10 *` //`[1,2,3,400]`

//const datex = `<Set>["hello world\n",[[[[1]]]]]`


// compile
const _compiled = compile(datex);
console.log(_compiled);
const compiled = new Uint8Array(<ArrayBuffer> await Datex.Compiler.compile(datex, [], {sign:false}, false))
const compiled2 = new Uint8Array(<ArrayBuffer> await Datex.Compiler.compile(datex2, [], {sign:false}, false))


// decompile
const decompiled = decompile(compiled, true, true, true);
const decompiled2 = decompile(compiled2, true, true, true);
stream.write(decompiled)
stream.write(decompiled2)

// execute
const result = execute(compiled2)
console.log("RESULT:",result);
// in_stream.write(result)

// console.log(compiled, decompiled)