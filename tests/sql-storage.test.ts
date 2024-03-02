import { Assert, Test } from "unyt-tests/testing/test.ts"
import { testLogger } from "unyt-tests/core/logger.ts"

import { Datex, instance } from "../mod.ts"
import { SQLDBStorageLocation } from "../runtime/storage-locations/sql-db.ts"
import { type } from "../datex_all.ts";

const logger = new Datex.Logger("sql-test");

/**
 * Initial Sestup
 */

// docker run -d --name mysql-container -e MYSQL_ROOT_PASSWORD=secret -e MYSQL_DATABASE=datex -p 3306:3306 mysql
const sqlStorage = new SQLDBStorageLocation({
	hostname: "127.0.0.1",
	port: 3306,
	username: "root",
	password: "secret",
	db: "datex"
}, testLogger.log.bind(testLogger));


Datex.Storage.addLocation(sqlStorage, {
	primary: true,
	modes: [Datex.Storage.Mode.SAVE_ON_CHANGE]
})

@sync class Position {
	@property x!: number
	@property y!: number
}

@sync
class Player {
	@property name!: string
	@property @type('text(20)') declare username: string

	@property color!: bigint
	@property pos!: Position
}

@sync
class ScoreboardEntry {
	@property player!: Player
	@property score!: number
}


function logValue(val:any) {
	testLogger.log(Datex.Runtime.valueToDatexStringExperimental(val, true, true, false, true));
}

/**
 * Tests
 */

// await sqlStorage.resetAll()
// Deno.exit()



@Test export class SQLStorageTests {

	@Test
	databaseIsCreated(){
	}

	@Test
	async pointerIsSaved() {
		const exampleValue = $$(instance(Player, {
			name: "Example Player 1",
			username: "12345678901234567890",
			color: 0xffaaaan,
			pos: instance(Position, {x: 10, y: 10})
		}));

		logValue(exampleValue)
		const examplePointer = Datex.Pointer.getByValue(exampleValue)!;
		await Datex.Storage.setPointer(examplePointer, true, sqlStorage);

		// let i =0;
		// setInterval(()=>{
		// 	exampleValue.name = "Updated name " + (i++);
		// }, 1000)
		// await sleep(500000)
	}
}