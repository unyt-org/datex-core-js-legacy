import { DATEX_FILE_TYPE, FILE_TYPE } from "../compiler/compiler.ts";
import { Runtime } from "../runtime/runtime.ts";
import { decompile } from "../wasm/adapter/pkg/datex_wasm.js";

export async function uploadDatexFile(){
	const pickerOpts = {
		types: [
			{
				description: 'DATEX or JSON Files',
				accept: {
					'application/datex': ['.dxb'],
					'text/datex': ['.dx'],
					'text/dxb': ['.dxb'],

					'application/json': ['.json'],
					'application/json5': [ '.json5'],
				}
			}
		],
		excludeAcceptAllOption: true,
		multiple: false
	};
	
	// open file picker
	// @ts-ignore new api
	const [fileHandle] = await window.showOpenFilePicker(pickerOpts);
	return getDatexContentFromFileHandle(fileHandle);
}

export type datex_file_data = {type: DATEX_FILE_TYPE, text:string, binary?:ArrayBuffer, fileHandle:any};

export async function getDatexContentFromFileHandle(fileHandle:any) {
	const fileData = <File> await fileHandle.getFile();

	const data:datex_file_data = {
		type: FILE_TYPE.DATEX_SCRIPT,
		fileHandle,
		text: await fileData.text() // assume DATEX script or JSON
	}

	if (fileData.type == "application/datex" || fileData.type == "text/dxb" || fileHandle.name?.endsWith(".dxb") || fileData.name?.endsWith(".dxb") || data.text.startsWith('\u0001\u0064') /* dxb magic number*/) {
		const buffer = await fileData.arrayBuffer(); // DXB
		data.binary = buffer;
		data.type = FILE_TYPE.DATEX_BINARY;
		data.text = generateDecompiled(fileHandle.name??fileData.name??'unknown file', buffer);	
	} 

	return data;
}

function generateDecompiled(filename:string, buffer:ArrayBuffer) {
	try {
		// remove header
		const res = Runtime.parseHeaderSynchronousPart(buffer);
		if (!(res instanceof Array)) return `# Invalid DATEX binary file: ${filename} - could not decompile (invalid header)`
		const dxb_without_header = res[1];
		const decompiled = decompile(dxb_without_header, true, false, true);
		return `# Decompiled from ${filename}\n\n${decompiled}`
	}
	catch (e){ 
		console.log(e);
		return `# Invalid DATEX binary file: ${filename} - could not decompile (${e})`
	} 
}