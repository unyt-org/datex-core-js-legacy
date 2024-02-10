import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { Query, replaceParams } from "https://deno.land/x/sql_builder@v1.9.2/mod.ts";
import { Where } from "https://deno.land/x/sql_builder@v1.9.2/where.ts";
import { Pointer } from "../../runtime/pointers.ts";
import { AsyncStorageLocation } from "../storage.ts";
import { ColumnDefinition, ConstraintsDefinition, TableDefinition, dbOptions, mysql_data_type } from "./sql-definitions.ts";
import { Logger } from "../../utils/logger.ts";
import { Datex } from "../../mod.ts";
import { datex_type_mysql_map } from "./sql-type-map.ts";
import { NOT_EXISTING } from "../../runtime/constants.ts";
import { client_type } from "../../utils/constants.ts";
import { Compiler } from "../../compiler/compiler.ts";
import { ExecConditions } from "../../utils/global_types.ts";
import { Runtime } from "../../runtime/runtime.ts";

const logger = new Logger("SQL Storage");

export class SQLDBStorageLocation extends AsyncStorageLocation {
	name = "SQL_DB"

	#connected = false;
	#options: dbOptions
    #sqlClient: Client|undefined

	readonly #pointerMysqlType = "varchar(50)"
	readonly #pointerMysqlColumnName = "_ptr_id"

	readonly #metaTables = {
		typeMapping: {
			name: "datex_types",
			columns: [
				["type", "varchar(50)", "PRIMARY KEY"],
				["table_name", "varchar(50)"]
			]
		},
		pointerMapping: {
			name: "datex_pointer_mapping",
			columns: [
				[this.#pointerMysqlColumnName, this.#pointerMysqlType, "PRIMARY KEY"],
				["table_name", "varchar(50)"]
			]
		},
		rawPointers: {
			name: "datex_pointers_raw",
			columns: [
				["id", "varchar(50)", "PRIMARY KEY"],
				["value", "blob"]
			]
		},
		items: {
			name: "datex_items",
			columns: [
				["key", "varchar(200)", "PRIMARY KEY"],
				["value", "blob"]
			]
		}
	} satisfies Record<string, TableDefinition>;

	#tableColumns = new Map<string, Map<string, {foreignPtr:boolean}>>()

    constructor(options:dbOptions, private log?:(...args:unknown[])=>void) {
		super()
        this.#options = options
    }
	async #connect(){
		if (this.#connected) return;
        this.#sqlClient = await new Client().connect(this.#options);
		this.log?.("Connected to SQL database " + this.#options.db + " on " + this.#options.hostname + ":" + this.#options.port)
        this.#connected = true;
    }

	async #init() {
		await this.#connect();
		await this.#setupMetaTables();
	}

	async resetAll() {
		await this.#init();

		const tables = await this.#query<{table_name:string}>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("table_name")
				.build()
		)

		const tableNames = tables.map(({table_name})=>'`'+table_name+'`')
		
		await this.#query<{table_name:string}>(`DROP TABLE IF EXISTS ${tableNames.join(',')};`)
		await this.#query<{table_name:string}>(`TRUNCATE TABLE ${this.#metaTables.typeMapping.name};`)
		await this.#query<{table_name:string}>(`TRUNCATE TABLE ${this.#metaTables.pointerMapping.name};`)
	}

	async #query<row=object>(query_string:string, query_params?:any[]): Promise<row[]> {

		// handle arraybuffers
		if (query_params) {
			for (let i = 0; i < query_params.length; i++) {
				const param = query_params[i];
				if (param instanceof ArrayBuffer) {
					query_params[i] = new TextDecoder().decode(param)
				}
				if (param instanceof Array) {
					query_params[i] = param.map(p => p instanceof ArrayBuffer ? new TextDecoder().decode(p) : p)
				}
			}
		}
		
        // console.log("QUERY: " + query_string, query_params)

		if (typeof query_string != "string") {console.error("invalid query:", query_string); throw new Error("invalid query")}
        if (!query_string) throw new Error("empty query");
        try {
            const result = await this.#sqlClient!.execute(query_string, query_params);
            return result.rows ?? [];
        } catch (e){
			if (this.log) this.log("SQL error:", e)
           	else console.error("SQL error:", e);
            throw e;
        }
    }

    async #queryFirst<row=object>(query_string:string, query_params?:any[]): Promise<row> {
        return (await this.#query<row>(query_string, query_params))?.[0]
    }

	async #createTableIfNotExists(definition: TableDefinition) {
		const exists = await this.#queryFirst(
			new Query()
				.table("information_schema.tables")
				.select("*")
				.where(Where.eq("table_schema", this.#options.db))
				.where(Where.eq("table_name", definition.name))
				.build()
		)
		if (!exists) {
			await this.#createTable(definition);
			return true;
		}
		return false;
	}

	async #createTable(definition: TableDefinition) {
		await this.#queryFirst(`CREATE TABLE ?? (${definition.columns.map(col => 
			`\`${col[0]}\` ${col[1]} ${col[2]??''}`
			).join(', ')}${definition.constraints?.length ? ',' + definition.constraints.join(',') : ''});`, [definition.name])
	}

	async #getTableForType(type: Datex.Type) {
		const existingTable = (await this.#queryFirst<{table_name: string}|undefined>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("table_name")
				.where(Where.eq("type", type.toString()))
				.build()
		))?.table_name;
		if (!existingTable) {
			return this.#createTableForType(type)
		}
		else return existingTable
	}

	#typeToTableName(type: Datex.Type) {
		return type.namespace=="ext" ? type.name : `${type.namespace}_${type.name}`;
	}

	async #createTableForType(type: Datex.Type) {
		const columns:ColumnDefinition[] = [
			[this.#pointerMysqlColumnName, this.#pointerMysqlType, 'PRIMARY KEY INVISIBLE DEFAULT "0"']
		]
		const constraints: ConstraintsDefinition[] = []

		this.log?.("Creating table for type " + type)
		console.log(type)

		for (const [propName, propType] of Object.entries(type.template as {[key:string]:Datex.Type})) {
			let mysqlType: mysql_data_type|undefined
			
			if (propType.base_type == Datex.Type.std.text && typeof propType.parameters?.[0] == "number") {
				mysqlType = `varchar(${propType.parameters[0]})`
			}
			else {
				mysqlType = datex_type_mysql_map.get(propType) ?? datex_type_mysql_map.get(propType.base_type)
			}

			if (mysqlType) {
				columns.push([propName, mysqlType!])
			}
			// no matching primitive type found
			else if (!mysqlType) {
				let foreignTable = propType.template ? await this.#getTableForType(propType) : null;

				if (!foreignTable) {
					logger.warn("Cannot map type " + propType + " to a SQL table, falling back to raw DXB storage")
					foreignTable = this.#metaTables.rawPointers.name;
				}

				columns.push([propName, this.#pointerMysqlType])
				constraints.push(`FOREIGN KEY (\`${propName}\`) REFERENCES \`${foreignTable}\`(\`${this.#pointerMysqlColumnName}\`)`)
			}

			else {
				throw new Error("Cannot map type " + propType + " to a SQL table")
			}

		}

		const name = this.#typeToTableName(type);

		// create table
		await this.#createTable({
			name,
			columns,
			constraints
		})

		// save type mapping in meta table
		await this.#queryFirst(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.insert({
					type: type.toString(),
					table_name: name
				})
				.build()
		)


		return name;
	}

	/**
	 * makes sure all DATEX meta tables exist in the database
	 */
	async #setupMetaTables() {
		for (const definition of Object.values(this.#metaTables)) {
			const createdNew = await this.#createTableIfNotExists(definition);
			if (createdNew) this.log?.("Created meta table '" + definition.name + "'")
		}
	}

	async #getTableColumns(tableName: string) {
		if (!this.#tableColumns.has(tableName)) {
			const columnData = new Map<string, {foreignPtr: boolean}>()
			const columns = await this.#query<{COLUMN_NAME:string, COLUMN_KEY:string}>(
				new Query()
					.table("information_schema.columns")
					.select("COLUMN_NAME", "COLUMN_KEY")
					.where(Where.eq("table_schema", this.#options.db))
					.where(Where.eq("table_name", tableName))
					.build()
			)

			for (const col of columns) {
				if (col.COLUMN_NAME == this.#pointerMysqlColumnName) continue;
				columnData.set(col.COLUMN_NAME, {foreignPtr: col.COLUMN_KEY == "MUL"})
			}

			this.#tableColumns.set(tableName, columnData)
		}
		return this.#tableColumns.get(tableName)!;
	}

	async #insertPointer(pointer: Datex.Pointer) {
		const table = await this.#getTableForType(pointer.type)
		const columns = await this.#getTableColumns(table);

		const insertData:Record<string,unknown> = {
			[this.#pointerMysqlColumnName]: pointer.id
		}

		for (const [name, {foreignPtr}] of columns) {
			if (foreignPtr) {
				const propPointer = Datex.Pointer.getByValue(pointer.val[name]);
				if (!propPointer) throw new Error("Cannot reference non-pointer value in SQL table")
				insertData[name] = propPointer.id
				await this.#insertPointer(propPointer)
			}
			else insertData[name] = pointer.val[name];
		}
		// this.log("cols", insertData)


		await this.#query('INSERT INTO ?? ?? VALUES ?;', [table, Object.keys(insertData), Object.values(insertData)])
	}

	async #updatePointer(pointer: Datex.Pointer, keys:string[]) {
		const table = await this.#getTableForType(pointer.type)
		const columns = await this.#getTableColumns(table);

		for (const key of keys) {
			const val = columns.get(key)?.foreignPtr ? Datex.Pointer.getByValue(pointer.val[key])!.id : pointer.val[key];
			await this.#query('UPDATE ?? SET ?? = ? WHERE ?? = ?;', [table, key, val, this.#pointerMysqlColumnName, pointer.id])
		}
	}

	async #pointerEntryExists(pointer: Datex.Pointer) {
		const table = await this.#getTableForType(pointer.type)

		const exists = await this.#queryFirst<{COUNT:number}>(
			`SELECT COUNT(*) as COUNT FROM ?? WHERE ??=?`, [
				table,
				this.#pointerMysqlColumnName,
				pointer.id
			]
		);
		return exists.COUNT > 0;
	}


	isSupported() {
		return client_type === "deno";
	}

	async setItem(key: string,value: unknown) {
		await this.#init();
		const dependencies = new Set<Pointer>()
		const encoded = Compiler.encodeValue(value, dependencies);
		console.log("db set item", key)
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.items.name, ["key", "value"], [key, encoded], encoded])
        // await datex_item_storage.setItem(key, Compiler.encodeValue(value, dependencies));
		return dependencies;
	}
	async getItem(key: string, conditions: ExecConditions): Promise<unknown> {
		const encoded = (await this.#queryFirst<{value: ArrayBuffer}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("value")
				.where(Where.eq("key", key))
				.build()
		));
		console.log("encoded",encoded)
		if (!encoded) return null;
		else return Runtime.decodeValue(encoded, false, conditions);
	}

	async hasItem(key:string) {
		return false
	}

	async getItemKeys() {
		return function*(){}()
	}

	async getPointerIds() {
		return function*(){}()
	}

	async removeItem(key: string): Promise<void> {

	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer|null> {
		
	}
	async setItemValueDXB(key: string, value: ArrayBuffer) {
		
	}

	async setPointer(pointer: Pointer<any>, partialUpdateKey: unknown|typeof NOT_EXISTING): Promise<Set<Pointer<any>>> {
		const dependencies = new Set<Pointer>()

		await this.#init();

		// is templatable pointer type
		if (pointer.type.template) {
			this.log?.("update " + pointer.id + " - " + pointer.type, partialUpdateKey, await this.#pointerEntryExists(pointer))

			// new full insert
			if (!await this.#pointerEntryExists(pointer))
				await this.#insertPointer(pointer)
			else {
				// partial update
				if (partialUpdateKey !== NOT_EXISTING) {
					if (typeof partialUpdateKey !== "string") throw new Error("invalid key type for SQL table: " + Datex.Type.ofValue(partialUpdateKey))
					await this.#updatePointer(pointer, [partialUpdateKey])
				}
				// full udpdate
				else {
					// TODO
				}
			}
		}

		// no template, just add a raw DXB entry
		else {
			await this.setPointerRaw(pointer)
		}
		
		return dependencies;
	}

	async setPointerRaw(pointer: Pointer) {
		console.log("storing raw pointer: " + Runtime.valueToDatexStringExperimental(pointer, true, true))
		await this.#init();
		const dependencies = new Set<Pointer>()
		const encoded = Compiler.encodeValue(pointer, dependencies, true, false, true);
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.rawPointers.name, ["id", "value"], [pointer.id, encoded], encoded])
        // await datex_item_storage.setItem(key, Compiler.encodeValue(value, dependencies));
		return dependencies;
	}

	async getPointerValue(pointerId: string, outer_serialized: boolean): Promise<unknown> {
		
	}
	async removePointer(pointerId: string): Promise<void> {

	}
	async getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null> {
		
	}
	async setPointerValueDXB(pointerId: string, value: ArrayBuffer) {

	}

	async hasPointer(pointerId: string): Promise<boolean> {
		return false;
	}

	async clear() {
		// TODO!
	}

}