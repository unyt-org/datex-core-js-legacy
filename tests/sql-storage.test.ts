import { Assert, Test } from "unyt_tests/testing/test.ts"
import { Datex } from "../datex.ts"
import { SQLDBStorageLocation } from "../runtime/storage-locations/sql-db.ts"
import { type } from "../datex_all.ts";

const logger = new Datex.Logger("sql-test");

/**
 * Initial Setup
 */

// docker run --name=datex -p=33060:33060 -e MYSQL_ROOT_PASSWORD=secret  -d mysql/mysql-server:latest
const sqlStorage = new SQLDBStorageLocation({
	hostname: "localhost",
	port: 33600,
	username: "root",
	password: "secret",
	db: "datex"
});



Datex.Storage.addLocation(sqlStorage, {
	primary: true,
	modes: [Datex.Storage.Mode.SAVE_ON_CHANGE]
})

console.log(sqlStorage)

@sync
class Example1 {
	@property @type(Datex.Type.std.text) declare number: number
	@property @type(Datex.Type.std.text) declare string: string
}

@sync
class Example2 {
	@property @type(Datex.Type.std.decimal) declare number: number
	@property @type(Datex.Type.std.text) declare string: string
	@property @type(Datex.Type.get("ext:Example1")) declare example1: Example2
}

/**
 * Tests
 */

@Test export class SQLStorageTests {

	@Test
	databaseIsCreated(){
		
	}

	@Test
	pointerIsSaved() {
		const exampleValue = $$(new Example2());
		logger.warn(exampleValue);
		const examplePointer = Datex.Pointer.getByValue(exampleValue)!;
		Datex.Storage.setPointer(examplePointer, true, sqlStorage);
	}
}