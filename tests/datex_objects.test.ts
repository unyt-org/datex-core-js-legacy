import { Assert, Test } from "unyt-tests/testing/test.ts"
import { Datex } from "../mod.ts";
import { $$ } from "../datex_short.ts"

/**
 * Tests for JS Objects initialized with DATEX mappings
 */

/**
 * JSON objects
 */

const a = {
	a: 1,
	b: 'text',
	c: true,
	d: [1,2,3,4,5],
	e: new Map(),
	f: new Set(),
	g: {a:1,b:2,c:[1,2,3]},
}


@Test export class DatexJSONObjects {


	@Test objectsAreInitializedCorrectly(){
		const ref_a = $$(a);
		// ref_a is proxy, not same JS reference
		Assert.false(ref_a === a);

		// DX_PTR is defined
		Assert.hasProperty(ref_a, Datex.DX_PTR);
		Assert.hasProperty(a, Datex.DX_PTR);

		// pointer type is <Object>
		Assert.equalsStrict(ref_a[Datex.DX_PTR].type, Datex.Type.std.Object)
		
	}

	@Test objectPropertiesAreInitializedCorrectly(){
		
	}

}