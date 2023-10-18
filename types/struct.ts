import type { ObjectRef } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
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

export type inferType<DXType extends Type> = DXType extends Type<infer Def> ? Def : never;

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


export function struct<Def extends StructuralTypeDefIn>(def: Def): Type<collapseType<Def>> & ((val: collapseType<Def>)=>ObjectRef<collapseType<Def>>) {
	// create unique type name from template hash

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