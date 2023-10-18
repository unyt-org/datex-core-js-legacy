import type { ObjectRef } from "../runtime/pointers.ts";
import { Runtime } from "../runtime/runtime.ts";
import { sha256 } from "../utils/sha256.ts";
import { Type } from "./type.ts";

type StructuralTypeDef = Record<string, Type>

type collapseType<Def extends StructuralTypeDef> = {
		[K in keyof Def]: Def[K] extends Type<infer T> ? T : never
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
 * // struct definition
 * const MyCustomStruct = struct({
 *     a: string,
 *     b: Type.std.Array_16,
 *     c: Map
 * })
 * 
 * // inferred TS definition
 * type MyCustomStruct = inferType<typeof MyCustomStruct>;
 * 
 * 
 * // instantiation
 * const x: MyCustomStruct = MyCustomStruct({
 *     a: "hello",
 *     b: [0,2,3,5,6],
 *     c: new Map()
 * });
 * 
 * ```
 */

export function struct<Def extends StructuralTypeDef>(def: Def): Type<collapseType<Def>> & ((val: collapseType<Def>)=>ObjectRef<collapseType<Def>>) {
	// create unique type name from template hash
	const hash = sha256(Runtime.valueToDatexStringExperimental(def))
	const type = new Type("struct", hash).setTemplate(def);
	type.proxify_children = true;
	return type as any
}