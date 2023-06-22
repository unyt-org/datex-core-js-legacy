import { arrayBufferToBase64 } from "../utils/utils.ts";
import { Compiler } from "./compiler.ts";
import QrCreator from "./lib/qr-creator.js"

export async function datexScriptToQrCode(script: string, sign = false, encrypt = false) {

	const dxb = await Compiler.compile(script, [], {sign, encrypt}) as ArrayBuffer;
	const base64 = arrayBufferToBase64(dxb);
	console.log("base64", base64)

	const x = QrCreator.render({
		text: `https://portal.unyt.org/${base64}`,
		radius: 0,
		size: 400,
		ecLevel: 'L'

	});
	return x;
}

