import { dc } from "../js_adapter/js_class_adapter.ts";
import type { ObjectRef } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
import { Class } from "../utils/global_types.ts";
import { sha256 } from "../utils/sha256.ts";
import { Type } from "./type.ts";

type StructuralTypeDefIn = {
	[key: string]: Type|(new () => unknown)|StructuralTypeDefIn
}
type StructuralTypeDef = {
	[key: string]: Type|StructuralTypeDef
}

type collapseType<Def extends StructuralTypeDefIn> = {
		[K in keyof Def]: 
			Def[K] extends Type<infer T> ? T : (
				Def[K] extends (new () => infer T) ? T : (
					Def[K] extends StructuralTypeDefIn ? collapseType<Def[K]> : never
				)
			)
}

export type inferType<DXTypeOrClass extends Type|Class> = 
	DXTypeOrClass extends Type<infer Def> ? 
		ObjectRef<Def> : 
	DXTypeOrClass extends Class ? 
		InstanceType<DXTypeOrClass> : 
	never;

/**
 * Define a structural type without a class or prototype.
 * Instanes are plain objects mapped with DATEX type mapping and
 * DATEX runtime type validation.
 * 
 * This is more efficient than just using plain objects, because
 * the properties are known at creation time.
 * 
 * ```ts
 * 
 * // struct definition
 * const MyStruct = struct({
 *    a: string,
 *    b: Set,
 *    c: Array<number>,
 *    x: {
 *       xx: string,
 *       yy: Set<string>
 *    }
 * })
 * // inferred TS definition
 * type MyStruct = inferType<typeof MyStruct>
 * 
 * // instantiation
 * const myStruct: MyStruct = MyStruct({
 *    a: "aaaaaa",
 *    b: new Set(),
 *    c: [1,2,3],
 *    x: {
 *       xx: "xxxxxxx",
 *       yy: new Set(['1','2'])
 *    }
 * })
 * ```
 */

export function struct<T extends Record<string, any> & Class>(classDefinition: T): dc<T>
export function struct<Def extends StructuralTypeDefIn>(def: Def): Type<collapseType<Def>> & ((val: collapseType<Def>)=>ObjectRef<collapseType<Def>>)
export function struct(def: StructuralTypeDefIn|Class): any {
	// create unique type name from template hash

	// is class definition
	if (typeof def == "function") {
		throw new Error("todo struct class")
	}

	// is struct definition
	if (!def || typeof def !== "object") throw new Error("Struct definition must of type object");

	const template:StructuralTypeDef = {};
	for (const [key, val] of Object.entries(def)) {
		// Datex type
		if (val instanceof Type) {
			template[key] = val
		}
		// constructor
		else if (typeof val == "function") {
			const type = Type.getClassDatexType(val);
			template[key] = type;
		}
		// object
		else if (val && typeof val == "object") {
			const type = struct(val);
			template[key] = type;
		}
		else {
			throw new Error("Invalid struct definition value for property '"+key+"' (type " + (typeof val) + ")")
		}
	}

	const hash = sha256(Runtime.valueToDatexStringExperimental(template))
	const type = new Type("struct", hash).setTemplate(template);
	type.proxify_children = true;
	return type as any
}