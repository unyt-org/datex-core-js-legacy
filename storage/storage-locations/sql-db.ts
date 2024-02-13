import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { Query } from "https://deno.land/x/sql_builder@v1.9.2/mod.ts";
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
import { Storage } from "../storage.ts";

const logger = new Logger("SQL Storage");

export class SQLDBStorageLocation extends AsyncStorageLocation {
	name = "SQL_DB"

	#connected = false;
	#initializing = false
	#initialized = false
	#options: dbOptions
    #sqlClient: Client|undefined

	readonly #pointerMysqlType = "varchar(50)"
	readonly #pointerMysqlColumnName = "_ptr_id"

	readonly #metaTables = {
		typeMapping: {
			name: "__datex_types",
			columns: [
				["type", "varchar(50)", "PRIMARY KEY"],
				["table_name", "varchar(50)"]
			]
		},
		pointerMapping: {
			name: "__datex_pointer_mapping",
			columns: [
				[this.#pointerMysqlColumnName, this.#pointerMysqlType, "PRIMARY KEY"],
				["table_name", "varchar(50)"]
			]
		},
		rawPointers: {
			name: "__datex_pointers_raw",
			columns: [
				[this.#pointerMysqlColumnName, "varchar(50)", "PRIMARY KEY"],
				["value", "blob"]
			]
		},
		items: {
			name: "__datex_items",
			columns: [
				["key", "varchar(200)", "PRIMARY KEY"],
				["value", "blob"]
			]
		}
	} satisfies Record<string, TableDefinition>;

	// cached table columns
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
		if (this.#initialized) return;
		this.#initializing = true;
		await this.#connect();
		await this.#setupMetaTables();
		this.#initializing = false;
		this.#initialized = true;
	}

	async #resetAll() {
		// drop all custom type tables
		const tables = await this.#query<{table_name:string}>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("table_name")
				.build()
		)
		const tableNames = tables.map(({table_name})=>'`'+table_name+'`')
		await this.#query<{table_name:string}>(`DROP TABLE IF EXISTS ${tableNames.join(',')};`)

		// truncate meta tables
		for (const table of Object.values(this.#metaTables)) {
			await this.#query<{table_name:string}>(`TRUNCATE TABLE ${table.name};`)
		}
	}

	async #query<row=object>(query_string:string, query_params?:any[]): Promise<row[]> {
		// prevent infinite recursion if calling query from within init()
		if (!this.#initializing) await this.#init();

		// handle arraybuffers
		if (query_params) {
			for (let i = 0; i < query_params.length; i++) {
				const param = query_params[i];
				if (param instanceof ArrayBuffer) {
					query_params[i] = this.#binaryToString(param)
				}
				if (param instanceof Array) {
					query_params[i] = param.map(p => p instanceof ArrayBuffer ? this.#binaryToString(p) : p)
				}
			}
		}
		
        console.log("QUERY: " + query_string, query_params)

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

	#stringToBinary(value: string){
		return Uint8Array.from(value, x => x.charCodeAt(0)).buffer
	}
	#binaryToString(value: ArrayBuffer){
		return String.fromCharCode.apply(null, new Uint8Array(value) as unknown as number[])
	}

    async #queryFirst<row=object>(query_string:string, query_params?:any[]): Promise<row|undefined> {
        return (await this.#query<row>(query_string, query_params))?.[0]
    }

	async #createTableIfNotExists(definition: TableDefinition) {
		const exists = this.#tableColumns.has(definition.name) || await this.#queryFirst(
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

		// type does not have a template, use raw pointer table
		if (!type.template) return null

		const existingTable = (await this.#queryFirst<{table_name: string}|undefined>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("table_name")
				.where(Where.eq("type", this.#typeToString(type)))
				.build()
		))?.table_name;
		if (!existingTable) {
			return this.#createTableForType(type)
		}
		else return existingTable
	}

	async #getTypeForTable(table: string) {
		const type = await this.#queryFirst<{type:string}>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("type")
				.where(Where.eq("table_name", table))
				.build()
		)
		if (!type) return null;
		return Datex.Type.get(type.type)
	}

	#typeToTableName(type: Datex.Type) {
		return type.namespace=="ext" ? type.name : `${type.namespace}_${type.name}`;
	}

	#typeToString(type: Datex.Type) {
		return type.namespace + ":" + type.name;
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
				let foreignTable = await this.#getTableForType(propType);

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
					type: this.#typeToString(type),
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

	/**
	 * Insert a pointer into the database, pointer type must be templated
	 */
	async #insertPointer(pointer: Datex.Pointer) {
		const table = await this.#getTableForType(pointer.type)
		if (!table) throw new Error("Cannot store pointer of type " + pointer.type + " in a custom table")
		const columns = await this.#getTableColumns(table);

		const insertData:Record<string,unknown> = {
			[this.#pointerMysqlColumnName]: pointer.id
		}

		for (const [name, {foreignPtr}] of columns) {
			if (foreignPtr) {
				const propPointer = Datex.Pointer.getByValue(pointer.val[name]);
				if (!propPointer) throw new Error("Cannot reference non-pointer value in SQL table")
				insertData[name] = propPointer.id
				await this.setPointer(propPointer, NOT_EXISTING)
			}
			else insertData[name] = pointer.val[name];
		}
		// this.log("cols", insertData)

		await this.#query('INSERT INTO ?? ?? VALUES ?;', [table, Object.keys(insertData), Object.values(insertData)])
	
		// add to pointer mapping
		await this.#updatePointerMapping(pointer.id, table)
	}

	/**
	 * Update a pointer in the database, pointer type must be templated
	 */
	async #updatePointer(pointer: Datex.Pointer, keys:string[]) {
		const table = await this.#getTableForType(pointer.type);
		if (!table) throw new Error("Cannot store pointer of type " + pointer.type + " in a custom table")
		const columns = await this.#getTableColumns(table);

		for (const key of keys) {
			const val = columns.get(key)?.foreignPtr ? Datex.Pointer.getByValue(pointer.val[key])!.id : pointer.val[key];
			await this.#query('UPDATE ?? SET ?? = ? WHERE ?? = ?;', [table, key, val, this.#pointerMysqlColumnName, pointer.id])
		}
	}

	/**
	 * Check if a pointer entry exists in the database
	 */
	async #pointerEntryExists(pointer: Datex.Pointer) {
		const table = await this.#getTableForType(pointer.type)
		// TODO: do we need to check if the pointer is actually in the table - if there
		// is a table mapping entry, the pointer should be in the table
		const exists = await this.#queryFirst<{COUNT:number}>(
			`SELECT COUNT(*) as COUNT FROM ?? WHERE ??=?`, [
				table,
				this.#pointerMysqlColumnName,
				pointer.id
			]
		);
		return (!!exists) && exists.COUNT > 0;
	}

	async #getTemplatedPointerValueString(pointerId: string, table?: string) {
		table = table ?? await this.#getPointerTable(pointerId);
		if (!table) {
			logger.error("No table found for pointer " + pointerId);
			return null;
		}

		const type = await this.#getTypeForTable(table);
		if (!type) {
			logger.error("No type found for table " + table);
			return null;
		}

		const object = await this.#getTemplatedPointerObject(pointerId, table);
		if (!object) return null;

		// resolve foreign pointers
		const foreignPointerPlaceholders: string[] = []
		// const foreignPointerPlaceholderPromises: Promise<string | null>[] = []
		for (const [colName, {foreignPtr}] of this.#tableColumns.get(table)!.entries()) {
			// is an object type with a template
			if (foreignPtr) {
				if (typeof object[colName] == "string") {
					const ptrId = object[colName] as string
					object[colName] = `\u0001${foreignPointerPlaceholders.length}`
					foreignPointerPlaceholders.push("$"+ptrId)
				}
				else {
					logger.error("Cannot get pointer value for property " + colName + " in object " + pointerId + " - " + table)
				}
			}
		}

		// const foreignPointerPlaceholders = await Promise.all(foreignPointerPlaceholderPromises)

		const objectString = Datex.Runtime.valueToDatexStringExperimental(object, false, false)
			.replace(/"\u0001(\d+)"/g, (_, index) => foreignPointerPlaceholders[parseInt(index)]??"void")

		return `${type.toString()} ${objectString}`
	}

	async #getTemplatedPointerObject(pointerId: string, table?: string) {
		table = table ?? await this.#getPointerTable(pointerId);
		if (!table) {
			logger.error("No table found for pointer " + pointerId);
			return null;
		}
		const object = await this.#queryFirst<Record<string,unknown>>(
			new Query()
				.table(table)
				.select("*")
				.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
				.build()
		)
		if (!object) return null;
		const type = await this.#getTypeForTable(table);
		if (!type) {
			logger.error("No type found for table " + table);
			return null;
		}
		return object;
	}

	async #getTemplatedPointerValueDXB(pointerId: string, table?: string) {
		const string = await this.#getTemplatedPointerValueString(pointerId, table);
		if (!string) return null;
		console.log("string: " + string)
		const compiled = await Compiler.compile(string, [], {sign: false, encrypt: false, to: Datex.Runtime.endpoint}, false) as ArrayBuffer;
		return compiled
	}

	async #getPointerTable(pointerId: string) {
		return (await this.#queryFirst<{table_name:string}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select("table_name")
				.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
				.build()
		))?.table_name;
	}

	async #setPointerRaw(pointer: Pointer) {
		console.log("storing raw pointer: " + Runtime.valueToDatexStringExperimental(pointer, true, true))
		const dependencies = new Set<Pointer>()
		const encoded = Compiler.encodeValue(pointer, dependencies, true, false, true);
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.rawPointers.name, [this.#pointerMysqlColumnName, "value"], [pointer.id, encoded], encoded])
        // add to pointer mapping
		await this.#updatePointerMapping(pointer.id, this.#metaTables.rawPointers.name)
		return dependencies;
	}

	async #updatePointerMapping(pointerId: string, tableName: string) {
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE table_name=?;', [this.#metaTables.pointerMapping.name, [this.#pointerMysqlColumnName, "table_name"], [pointerId, tableName], tableName])
	}

	isSupported() {
		return client_type === "deno";
	}

	async setItem(key: string,value: unknown) {
		const dependencies = new Set<Pointer>()
		const encoded = Compiler.encodeValue(value, dependencies);
		console.log("db set item", key)
		await this.setItemValueDXB(key, encoded)
		return dependencies;
	}
	async getItem(key: string, conditions: ExecConditions): Promise<unknown> {
		const encoded = await this.getItemValueDXB(key);
		if (!encoded) return null;
		return Runtime.decodeValue(encoded, false, conditions);
	}

	async hasItem(key:string) {
		const count = (await this.#queryFirst<{COUNT: number}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("COUNT(*) as COUNT")
				.where(Where.eq("key", key))
				.build()
		));
		return (!!count) && count.COUNT > 0;
	}

	async getItemKeys() {
		const keys = await this.#query<{key:string}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("key")
				.build()
		)
		return function*(){
			for (const {key} of keys) {
				yield key;
			} 
		}()
	}

	async getPointerIds() {
		const pointerIds = await this.#query<{_ptr_id:string}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select(this.#pointerMysqlColumnName)
				.build()
		)
		return function*(){
			for (const {_ptr_id} of pointerIds) {
				yield _ptr_id;
			} 
		}()
	}

	async removeItem(key: string): Promise<void> {
		await this.#query('DELETE FROM ?? WHERE ??=?;', [this.#metaTables.items.name, "key", key])
	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer|null> {
		const encoded = (await this.#queryFirst<{value: string}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("value")
				.where(Where.eq("key", key))
				.build()
		));
		if (!encoded || !encoded.value) return null;
		else return this.#stringToBinary(encoded.value);
	}
	async setItemValueDXB(key: string, value: ArrayBuffer) {
		const stringBinary = this.#binaryToString(value)
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.items.name, ["key", "value"], [key, stringBinary], stringBinary])
	}

	async setPointer(pointer: Pointer<any>, partialUpdateKey: unknown|typeof NOT_EXISTING): Promise<Set<Pointer<any>>> {
		const dependencies = new Set<Pointer>()

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
				// full update
				else {
					// TODO
				}
			}
		}

		// no template, just add a raw DXB entry, partial updates are not supported
		else {
			await this.#setPointerRaw(pointer)
		}
		
		return dependencies;
	}

	async getPointerValue(pointerId: string, outer_serialized: boolean): Promise<unknown> {
		// get table where pointer is stored
		const table = await this.#getPointerTable(pointerId);
		console.log("table for pointer", pointerId, table)
		if (!table) {
			logger.error("No table found for pointer " + pointerId);
			return null;
		}

		// is raw pointer
		if (table == this.#metaTables.rawPointers.name) {
			const value = (await this.#queryFirst<{value: string}>(
				new Query()
					.table(this.#metaTables.rawPointers.name)
					.select("value")
					.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
					.build()
			))?.value;
			return value ? Runtime.decodeValue(this.#stringToBinary(value), outer_serialized) : null;
		}

		// is templated pointer
		else {
			const type = await this.#getTypeForTable(table);
			if (!type) {
				logger.error("No type found for table " + table);
				return null;
			}
			const object = await this.#getTemplatedPointerObject(pointerId, table);
			if (!object) return null;

			// resolve foreign pointers
			for (const [colName, {foreignPtr}] of this.#tableColumns.get(table)!.entries()) {
				// is an object type with a template
				if (foreignPtr) {
					if (typeof object[colName] == "string") {
						object[colName] = await Storage.getPointer(object[colName] as string);
					}
					else {
						logger.error("Cannot get pointer value for property " + colName + " in object " + pointerId + " - " + table)
					}
				}
			}
			console.log("Templateo",object)
			return type.cast(object, undefined, undefined, false);
		}
	}

	

	async removePointer(pointerId: string): Promise<void> {
		// get table where pointer is stored
		const table = await this.#getPointerTable(pointerId);
		if (table) {
			await this.#query('DELETE FROM ?? WHERE ??=?;', [table, this.#pointerMysqlColumnName, pointerId])
		}
		// delete from pointer mapping
		await this.#query('DELETE FROM ?? WHERE ??=?;', [this.#metaTables.pointerMapping.name, this.#pointerMysqlColumnName, pointerId])
	}

	async getPointerValueDXB(pointerId: string): Promise<ArrayBuffer|null> {
		// get table where pointer is stored
		const table = await this.#getPointerTable(pointerId);
		console.log("table for pointer", pointerId, table)

		// is raw pointer
		if (table == this.#metaTables.rawPointers.name) {
			const value = (await this.#queryFirst<{value: string}>(
				new Query()
					.table(this.#metaTables.rawPointers.name)
					.select("value")
					.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
					.build()
			))?.value;
			return value ? this.#stringToBinary(value) : null;
		}

		// is templated pointer
		else {
			return this.#getTemplatedPointerValueDXB(pointerId, table);
		}

	}

	async setPointerValueDXB(pointerId: string, value: ArrayBuffer) {
		// check if raw pointer, otherwise not yet supported
		const table = await this.#getPointerTable(pointerId);
		if (table == this.#metaTables.rawPointers.name) {
			await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [table, [this.#pointerMysqlColumnName, "value"], [pointerId, value], value])
			// add to pointer mapping
			await this.#updatePointerMapping(pointerId, this.#metaTables.rawPointers.name)
		}
		else {
			logger.error("Setting raw dxb value for templated pointer is not yet supported in SQL storage (pointer: " + pointerId + ", table: " + table + ")");
		}
	}

	async hasPointer(pointerId: string): Promise<boolean> {
		const count = (await this.#queryFirst<{COUNT: number}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select("COUNT(*) as COUNT")
				.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
				.build()
		));
		return (!!count) && count.COUNT > 0;
	}

	async clear() {
		await this.#resetAll();
	}

}