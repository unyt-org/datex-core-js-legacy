import { StorageSet } from "../types/storage_set.ts";
import { Type } from "../types/type.ts";
import { Class } from "./global_types.ts";
import { MatchInput, Storage, comparatorKeys } from "../storage/storage.ts";

export type { MatchInput } from "../storage/storage.ts";

/**
 * Returns all entries of a StorageSet that match the given match descriptor.
 * @param inputSet 
 * @param match 
 * @param limit 
 * @returns 
 */
export async function match<T extends object>(inputSet: StorageSet<T>, valueType:Class<T>|Type<T>, match: MatchInput<T>, limit = Infinity) {
	const found = new Set<T>();
	const matchOrEntries = (match instanceof Array ? match : [match]).map(m => Object.entries(m)) as [keyof T, T[keyof T]][][];
	
	if (!(valueType instanceof Type)) valueType = Type.getClassDatexType(valueType);

	// match queries supported
	if (await Storage.supportsMatchQueries(valueType)) {
		return Storage.itemMatchQuery(inputSet._prefix, valueType, match, limit);
	}

	// fallback: match by iterating over all entries

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
			if (found.size >= limit) break;
		}
		
	}
	return found;
}

function _match(value: unknown, match: unknown) {
	const matchOrs = (match instanceof Array ? match : [match]);

	for (const matchEntry of matchOrs) {
		let isMatch = true;
		// is comparator object
		if (typeof matchEntry === "object" && Object.keys(matchEntry).some(key => comparatorKeys.includes(key as any))) {
			if (!compare(value, matchEntry)) {
				isMatch = false;
				break;
			}
		}
		// nested object
		else if (value && typeof value == "object") {
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


function compare(value: unknown, comparatorObj: Partial<Record<typeof comparatorKeys[number], unknown>>) {
	let isMatch = true;
	for (const [comparator, val] of Object.entries(comparatorObj)) {
		// special comparison keys
		if (comparator === "=") {
			if (value != val) {
				isMatch = false;
				break;
			}
			else continue;
		}
		else if (comparator === "!=") {
			if (value == val) {
				isMatch = false;
				break;
			}
			else continue;
		}
		else if (comparator === ">") {
			if ((value as any) <= (val as any)) {
				isMatch = false;
				break;
			}
			else continue;
		}
		else if (comparator === ">=") {
			if ((value as any) < (val as any)) {
				isMatch = false;
				break;
			}
			else continue;
		}
		else if (comparator === "<") {
			if ((value as any) >= (val as any)) {
				isMatch = false;
				break;
			}
			else continue;
		}
		else if (comparator === "<=") {
			if ((value as any) > (val as any)) {
				isMatch = false;
				break;
			}
			else continue;
		}
	}
	
	return isMatch;
}



// match(users, [{
// 	name: "John",
// 	age: [1,2,3],
// 	address: {
// 		email: "x@t"
// 	}
// }, {name: "yxyx"}])

/*
SELECT _ptr_id

FROM __datex_items
JOIN Person ON __datex_items._ptr_id = Person._ptr_id
JOIN Occupation ON Occupation._ptr_id = Person.occupation

WHERE `key` LIKE "dxset::$D505B7E7C20Ex4E0749C88DE8EB%"
AND `first_name` LIKE "S%"
AND Occupation.degree = "Diplom (FH)"
AND Occupation.degree = "Diplom (FH)"
AND Occupation.degree = "Diplom (FH)"
AND Occupation.degree = "Diplom (FH)"
*/