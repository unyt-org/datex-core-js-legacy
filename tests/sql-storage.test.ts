import { Assert } from "unyt_tests/testing/assertions.ts";
import { Test } from "unyt_tests/testing/test.ts"

@Test export class SQLStorageTests {

	@Test([1,2,3]) 
	databaseIsCreated(x: number){
		console.log("x = " + x)
		Assert.equals(x, 1)
	}
}