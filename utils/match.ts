import { StorageSet } from "../types/storage_set.ts";
import { Type } from "../types/type.ts";
import type { Class } from "./global_types.ts";
import { MatchInput, MatchResult, MatchOptions, Storage } from "../storage/storage.ts";

export type { MatchInput, MatchOptions, MatchResult } from "../storage/storage.ts";

/**
 * Returns all entries of a StorageSet that match the given match descriptor.
 * @param inputSet 
 * @param match 
 * @param limit 
 * @returns 
 */
export async function match<T extends object, Options extends MatchOptions>(inputSet: StorageSet<T>, valueType:Class<T>|Type<T>, match: MatchInput<T>, options?: Options): Promise<MatchResult<T, Options>> {
	options ??= {} as Options;
	const found = new Set<T>();
	const matchOrEntries = (match instanceof Array ? match : [match]).map(m => Object.entries(m)) as [keyof T, T[keyof T]][][];
	
	if (!(valueType instanceof Type)) valueType = Type.getClassDatexType(valueType);

	// match queries supported
	if (await Storage.supportsMatchQueries(valueType)) {
		return Storage.itemMatchQuery(inputSet._prefix, valueType, match, options);
	}

	// fallback: match by iterating over all entries
	// TODO: implement full match query support

	for await (const input of inputSet) {
		// ors
		for (const matchOrs of matchOrEntries) {
			let isMatch = true;
			for (const [key, value] of matchOrs) {
				if (!_match(input[key], value)) {
					isMatch = false;
					break;
				}
			}
			if (isMatch) found.add(input);
			if (found.size >= (options.limit??Infinity)) break;
		}
		
	}
	return found as MatchResult<T, Options>;
}

function _match(value: unknown, match: unknown) {
	const matchOrs = (match instanceof Array ? match : [match]);

	for (const matchEntry of matchOrs) {
		let isMatch = true;
		// nested object
		if (value && typeof value == "object") {
			// identical object
			if (value === matchEntry) isMatch = true;
			// nested match
			else if (matchEntry && typeof matchEntry === "object") {
				for (const [key, val] of Object.entries(matchEntry)) {
					// an object entry does not match
					if (!_match((value as any)[key], val)) {
						isMatch = false;
						break;
					}
				}
			}
			else isMatch = false;
		}
		// primitive, other value
		else isMatch = value === matchEntry;

		// match?
		if (isMatch) return true;
	}

	// no match found
	return false;
}