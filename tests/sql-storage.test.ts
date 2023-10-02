import { Assert, Test } from "unyt_tests/testing/test.ts"
import { testLogger } from "unyt_tests/core/logger.ts"

import { Datex } from "../datex.ts"
import { SQLDBStorageLocation } from "../runtime/storage-locations/sql-db.ts"
import { type } from "../datex_all.ts";

const logger = new Datex.Logger("sql-test");

/**
 * Initial Sestup
 */

// docker run -d --name mysql-container -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=datex -p 3306:3306 mysql
const sqlStorage = new SQLDBStorageLocation({
	hostname: "localhost",
	port: 3306,
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
class ScoreboardEntry {
	@property player: Player
	@property score: number
}

@sync
class Player {
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
		testLogger.log("whatever 1")
	}

	@Test
	pointerIsSaved() {
		testLogger.log("whatever 2")

		const exampleValue = $$(new Player());
		logger.warn(exampleValue);
		const examplePointer = Datex.Pointer.getByValue(exampleValue)!;
		Datex.Storage.setPointer(examplePointer, true, sqlStorage);
	}
}