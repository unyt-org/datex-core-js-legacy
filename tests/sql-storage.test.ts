import { Assert, Test } from "unyt_tests/testing/test.ts"
import { Datex } from "../datex.ts"
import { SQLDBStorageLocation } from "../runtime/storage-locations/sql-db.ts"

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

/**
 * Tests
 */

@Test export class SQLStorageTests {

	@Test
	databaseIsCreated(){
		
	}
}