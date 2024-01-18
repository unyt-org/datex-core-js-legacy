// generates typescript code for @namespace JS classes with static @expose methods
// (matching code to call the methods on another endpoint)
import { $$, Datex } from "../mod.ts";
import { DX_SOURCE } from "../runtime/constants.ts";
import { indent } from "./indent.ts";

const logger = new Datex.Logger("ts interface generator")

export const BACKEND_EXPORT:unique symbol = Symbol("BACKEND_EXPORT");

type interf = {new(...args:unknown[]):unknown};

/**
 * Generates content for a TS module that can be imported to access a module remotly
 * @param module_path_or_datex_get module URL (for JS modules) or string for DATEX resource
 * @param exports list of exposed exports, all exports are exposed if not provided
 * @param caller caller identifier for logs
 * @param module_name human readable short name of the module for logs, default is module_path_or_datex_get
* @returns TS source code for the new module
 */
export async function generateTSModuleForRemoteAccess(module_path_or_datex_get:URL|string, exports?: Set<string>, types = true, module_name = module_path_or_datex_get.toString(), caller?:string, ignoreFailure:Set<string>|boolean = false){

	const values = await getModuleExports(
		module_path_or_datex_get, 
		caller, 
		exports ?? await getAllExportNames(module_path_or_datex_get),
		ignoreFailure
	)

	// TODO: is await Datex.Supranet.init(); required?

	// TODO: rename unyt_core to datex-core-legacy
	let code = indent `
		/*
			This Typescript/JavaScript interface code was auto-generated by the DATEX Core JS Library.
			Any external DATEX resources used to generate this source code are provided without warranty of any kind.
			${typeof module_path_or_datex_get == "string" ? `Original DATEX: ${module_path_or_datex_get}` :  `Original module: ${module_name}`}
			© ${new Date().getFullYear()} unyt.org
		*/

		import { Datex, datex, endpoint, property, meta, timeout, sync, sealed } from "unyt_core";
		const logger = new Datex.Logger("${module_name}");\n\n`;

	for (const [name, val, valid, no_pointer] of values) {
		if (!valid) code += `logger.warn('Another module tried to import "${name}", which does not exist in this module. You might need to restart the backend.');\n`
		else if (typeof val == "function" && val.constructor && (<any>val)[Datex.METADATA]) {
			// TODO: decroators for js only, currently fallback to getValueTSCode
			if (!types) {
				code += `\nlogger.warn('Exposed classes with decorators are not yet fully supported');\n`;
				code += getValueTSCode(module_name, name, val, no_pointer, types);
			}
			else code += getClassTSCode(name, <interf>val, no_pointer);
		}
		else code += getValueTSCode(module_name, name, val, no_pointer, types);
	}


	return code;
}

const implicitly_converted_primitives = new Map<string, Set<string>>().setAutoDefault(Set);
const implicitly_converted = new Map<string, Set<string>>().setAutoDefault(Set);


async function getModuleExports(path_or_specifier:URL|string, caller:string|undefined, exports:Set<string>, ignoreFailure:Set<string>|boolean = false) {
	const values:[string, unknown, boolean, boolean][] = [];

	try {
		const module = <any> await datex.get(path_or_specifier);
		const is_dx = typeof path_or_specifier == "string" || path_or_specifier.toString().endsWith(".dx") || path_or_specifier.toString().endsWith(".dxb");

		// add default export for imported dx
		const inject_default = exports.has("default") && is_dx;

		const dx_type = Datex.Type.ofValue(module)
		const module_is_collapsable_obj = dx_type == Datex.Type.std.Object || dx_type == Datex.Type.js.NativeObject
		
		if (module_is_collapsable_obj) {
			for (const exp of exports) {
				if (exp == "default" && inject_default) continue;
				const exists = !!exp && typeof module == "object" && exp in module;
				const ignoreForExp = ignoreFailure instanceof Set && ignoreFailure.has(exp);
				
				if (!exists && !ignoreForExp) {
					if (typeof path_or_specifier == "string") logger.error((caller ? caller + ": " : "") + "'" + exp + "' is currently not an exported value in " + path_or_specifier)
					else logger.error((caller ? caller + ": " : "") + "'" + exp + "' is currently not an exported value in module " + path_or_specifier + " - restart might be required")
				}
				// only add if exists
				if (exists) {
					const val = module[exp];
					values.push([exp, val, exists, dontConvertValueToPointer(exp, val)]);
				}
				
			}
		}

		if (inject_default) {
			values.push(["default", module, true, true]); // export default wrapper object, no pointer
		}
	}
	catch (e) {
		throw "error loading module:" + e?.message??e;
	} // network error, etc.., TODO: show warning somewhere
	

	return values;
}



// TODO: better solution (currently also targets other objects than uix default exports) exceptions for values that should not be converted to pointers when exported
function dontConvertValueToPointer(name:string, value:any){
	const type = Datex.Type.ofValue(value);
	return name == "default" && (type == Datex.Type.std.Object || type == Datex.Type.js.NativeObject);
}

/**
 * Returns a set of all export names for a module
 */
async function getAllExportNames(path:URL|string) {
	const module = await datex.get(path);
	const dx_type = Datex.Type.ofValue(module)
	const names = module && (dx_type == Datex.Type.std.Object || dx_type == Datex.Type.js.NativeObject) ? Object.keys(module) : [];
	return new Set(names);
	// try {
		
	// }
	// catch { // network error, etc., TODO: warning somewhere
	// 	return new Set<string>(); 
	// }
}


function getValueTSCode(module_name:string, name:string, value: any, no_pointer = false, types = true) {
	let code = "";

	const is_datex_module = module_name.endsWith(".dx") || module_name.endsWith(".dxb")

	const type = Datex.Type.ofValue(value)
	const is_pointer = (value instanceof Datex.Ref) || !!(Datex.Pointer.getByValue(value));

	// if (no_pointer) {
	// 	// no pointer
	// }

	// log warning for primitive non-pointer values (cannot be converted to pointer)
	if (type.is_primitive && (!is_pointer || implicitly_converted_primitives.get(module_name)?.has(name))) {
		if (!is_datex_module) code += name ? `logger.warn('The export "${name}" cannot be converted to a shared value. Consider explicitly converting it to a primitive pointer using $$().');\n` : `logger.warn('The default export cannot be converted to a shared value. Consider explicitly converting it to a primitive pointer using $$().');\n`
		implicitly_converted_primitives.getAuto(module_name).add(name);
	}

	// other value -> create pointers
	else {
		if (implicitly_converted.get(module_name)?.has(name)) {
			if (!is_datex_module)  code += name ? `logger.warn('The export "${name}" was implicitly converted to a shared pointer value. This might have unintended side effects. Consider explicitly converting it to a ${type} pointer using $$().');\n` : `logger.warn('The default export was implicitly converted to a shared pointer value. This might have unintended side effects. Consider explicitly converting it to a ${type} pointer using $$().');\n`
		}
		
		// special convertions for non-pointer values
		if (!is_pointer) {
			// convert es6 class with static properties
			if (typeof value == "function" && /^\s*class/.test(value.toString())) {
				// convert static class to normal object
				const original_value = value;
				original_value[BACKEND_EXPORT] = true;
				value = {}
				for (const prop of Object.getOwnPropertyNames(original_value)) {
					if (prop != "length" && prop != "name" && prop != "prototype") {
						value[prop] = typeof original_value[prop] == "function" ? $$(Datex.Function.createFromJSFunction(original_value[prop], original_value)) : $$(original_value[prop]);
						value[prop][BACKEND_EXPORT] = true;
						if (original_value[prop]!=undefined) original_value[prop][BACKEND_EXPORT] = true;
					}
				}
			}
			
			// convert Function to DATEX Function
			else if (value instanceof Function) {
				value[BACKEND_EXPORT] = true;
				value = Datex.Function.createFromJSFunction(value);
			}

			// log warning for non-pointer arrays and object (ignore defaults aka 'no_pointer')
			else if ((type == Datex.Type.std.Array || type == Datex.Type.std.Object || type == Datex.Type.js.NativeObject) && !no_pointer) {
				if (!is_datex_module) code += name ? `logger.warn('The export "${name}" was implicitly converted to a shared pointer value. This might have unintended side effects. Consider explicitly converting it to a ${type} pointer using $$().');\n` : `logger.warn('The default export was implicitly converted to a shared pointer value. This might have unintended side effects. Consider explicitly converting it to a ${type} pointer using $$().');\n`
				implicitly_converted.getAuto(module_name).add(name);
			}
		}

		value = $$(value);
		try {
			value[BACKEND_EXPORT] = true;
		}
		catch {}

		// add public permission
		const ptr = Datex.Pointer.pointerifyValue(value);
		if (ptr instanceof Datex.Pointer) ptr.grantPublicAccess(true)
	}

	// disable garbage collection
	const ptr = <Datex.Pointer> Datex.Pointer.getByValue(value);
	if (ptr) ptr.is_persistent = true;

	const loader = value?.[DX_SOURCE] ? `await datex.get('${value[DX_SOURCE]}')` : `await datex('${Datex.Runtime.valueToDatexStringExperimental(value)}')`
	code += `${name =='default' ? 'export default' : 'export const ' + name + ' ='} ${loader}${types ? ` as ${getValueTSType(value)}` : ''};\n`;
	return code;
}


function getValueDTSCode(module_name:string, name:string, value: any, no_pointer = false) {
	let code = "";

	if (name =='default') {
		name = `_default`;
		code += `declare const ${name}: ${getValueTSType(value)};\nexport default ${name};\n`
	}
	else {
		code += `export const ${name}: ${getValueTSType(value)}\n`
	}

	return code;
}


function getClassTSCode(name:string, interf: interf, no_pointer = false) {

	const metadata = (<any>interf)[Datex.METADATA];
	const meta_scope_name = metadata[Datex.Decorators.NAMESPACE]?.constructor;
	let meta_endpoint = metadata[Datex.Decorators.SEND_FILTER]?.constructor;
	if (meta_endpoint == true) meta_endpoint = Datex.Runtime.endpoint; // deafult is local endpoint
	const meta_is_sync = metadata[Datex.Decorators.IS_SYNC]?.constructor;
	const meta_is_sealed = metadata[Datex.Decorators.IS_SEALED]?.constructor;
    const meta_timeout = metadata[Datex.Decorators.TIMEOUT]?.public;
    const meta_meta_index = metadata[Datex.Decorators.META_INDEX]?.public;

	let fields = "";

	// static and non-static properties
	const properties = metadata[Datex.Decorators.PROPERTY]?.public;
	// console.log("props",metadata)
	
	for (const prop of Object.keys(properties??{})) {
		// console.log((<any>interf.prototype)[prop]?.toString());
		fields += `
	@property${meta_timeout?.[prop]?` @timeout(${meta_timeout[prop]})`:''} public ${prop}() {}
`
	}

	const static_properties = metadata[Datex.Decorators.STATIC_PROPERTY]?.public;
	
	for (const prop of Object.keys(static_properties??{})) {
		// console.log((<any>interf)[prop]?.toString());
		fields += `
	@property${meta_timeout?.[prop]?` @timeout(${meta_timeout[prop]})`:''} public static ${prop}() {}
`
	}	
	

	return `
${meta_endpoint?`@endpoint("${meta_endpoint.toString()}"${meta_scope_name?`, "${meta_scope_name}"`:''})`:''}${meta_is_sync?' @sync':''}${meta_is_sync?' @sealed':''} export ${name == 'default' ? 'default ' : ''}class ${(name == 'default')?'DatexValue' : name} {
${fields}
}
`
}


function getValueTSType(value:any) {
	const dx_type = Datex.Type.ofValue(value).root_type;
	const [ts_type, is_primitive] = DX_TS_TYPE_MAP.get(dx_type)??[];
	const is_pointer = (value instanceof Datex.Value) || !!(Datex.Pointer.getByValue(value));
	const wrap_pointer = is_pointer && is_primitive;

	if (wrap_pointer) return ts_type ? `Datex.Pointer<${ts_type}>` : 'any'
	else return ts_type ?? 'any';
}


// generate d.ts file (for DATEX module)
export async function generateDTSModuleForRemoteAccess(module_path_or_datex_get:URL|string, exports?: Set<string>, module_name = module_path_or_datex_get.toString(), reference?: string, ignoreFailure:Set<string>|boolean = false) {
	
	const values = await getModuleExports(
		module_path_or_datex_get, 
		reference, 
		exports ?? await getAllExportNames(module_path_or_datex_get),
		ignoreFailure
	)
	
	
	let code = indent `
		/*
			This TypeScript definition file was auto-generated by the DATEX Core JS Library.
			${typeof module_path_or_datex_get == "string" ? `Original DATEX: ${module_path_or_datex_get}` : `Original DATEX module: ${module_path_or_datex_get}`}
			© ${new Date().getFullYear()} unyt.org
		*/
		
		import { Datex } from "unyt_core";\n\n`

	for (const [name, val, valid, no_pointer] of values) {
		if (!valid) {}
		else if (typeof val == "function" && val.constructor && (<any>val)[Datex.METADATA]) code += getClassTSCode(name, <interf>val, no_pointer);
		else code += getValueDTSCode(module_name, name, val, no_pointer);
	}

	return code;
}


export const DX_TS_TYPE_MAP = new Map<Datex.Type,[string,boolean]>([
	[Datex.Type.std.text, ["string", true]],
	[Datex.Type.std.integer, ["bigint", true]],
	[Datex.Type.std.decimal, ["number", true]],
	[Datex.Type.std.quantity, ["Datex.Quantity<any>", false]],
	[Datex.Type.std.url, ["URL", false]],
	[Datex.Type.std.boolean, ["boolean", true]],
	[Datex.Type.std.void, ["undefined", true]],
	[Datex.Type.std.null, ["null", true]],
	[Datex.Type.std.time, ["Datex.Time", false]],
	[Datex.Type.std.endpoint, ["Datex.Endpoint", false]],
	[Datex.Type.std.Error, ["Datex.Error", false]],
	[Datex.Type.std.Tuple, ["Datex.Tuple", false]],
	[Datex.Type.std.Type, ["Datex.Type", false]],

	[Datex.Type.std.Any, ["any", false]],
	[Datex.Type.std.Object, ["Record<string,any>", false]],
	[Datex.Type.js.NativeObject, ["Record<string,any>", false]],
	[Datex.Type.std.Array, ["any[]", false]],
	[Datex.Type.std.Function, ["(...args:any[]) => Promise<any>", false]],
	[Datex.Type.std.Map, ["Map<any,any>", false]],
	[Datex.Type.std.Set, ["Set<any>", false]],

	[Datex.Type.get('std','html'), ["HTMLElement", false]],
	[Datex.Type.get('std','html','div'), ["HTMLDivElement", false]],
])