import {Test} from "../../../unyt_tests/testing/test.ts"
import {Assert} from "../../../unyt_tests/testing/assertions.ts"
import { Quantity } from "../../datex_all.ts"

/**
 * Tests for the Datex.Quantity Class
 */


const m1:Quantity.METRE = new Quantity(60,'km');
const m2:Quantity.METRE = new Quantity(60,'km');
const m3:Quantity.METRE = new Quantity('1/3','m');
const s1:Quantity.SECOND = new Quantity(60,'s');


@Test class QuantityTests {

	@Test unitsAreInitializedCorrectly(){
		// right base units
		Assert.true(m1.hasBaseUnit('m'));
		Assert.true(s1.hasBaseUnit('s'));
	}

	@Test valuesAreInitializedCorrectly(){
		// right values
		Assert.equals(m1.value, 60_000);
		Assert.equals(m3.value, 1/3);
	}

	@Test async comparisonsWorkCorrectly(){
		// js equality (no strict equality)
		Assert.true(m1.equals(m2)); // 60km equals 60km
		Assert.false(m1.equals(s1)); // 60km does not equal 60s

		// DATEX value equality
		await Assert.sameValueAsync(m1,m2)  // 60km == 60km
	}

	@Test additionWorksCorrectly(){
		const sum1 = m1.sum(m2);
		Assert.true(sum1.equals(new Quantity(120,'km'))); // 60km+60km equals 120km

		const sum2 = sum1.sum(new Quantity('2/3','nm'));
		Assert.true(sum2.equals(new Quantity('180000000000001/1500000000','m'))); // 120km + 2/3nm
	}

	@Test subtractionWorksCorrectly(){
		const diff1 = m1.difference(m2);
		Assert.true(diff1.equals(new Quantity(0,'km'))); // 60km-60km equals 0km

		const diff2 = diff1.difference(new Quantity('2/3','nm'));
		Assert.true(diff2.equals(new Quantity('-2/3','nm'))); // 0m - 2/3nm = -2/3nm

	}

}