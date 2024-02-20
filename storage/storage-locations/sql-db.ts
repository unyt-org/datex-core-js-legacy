import { Client, ExecuteResult } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
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
import { Type } from "../../types/type.ts";
import { TypedArray } from "../../utils/global_values.ts";
import { MessageLogger } from "../../utils/message_logger.ts";
import { Join } from "https://deno.land/x/sql_builder@v1.9.2/join.ts";

const logger = new Logger("SQL Storage");

export class SQLDBStorageLocation extends AsyncStorageLocation {
	name = "SQL_DB"
	supportsPrefixSelection = true;
	supportsMatchSelection = true;

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
				["value", "blob"],
				[this.#pointerMysqlColumnName, this.#pointerMysqlType],
			]
		}
	} satisfies Record<string, TableDefinition>;

	// cached table columns
	#tableColumns = new Map<string, Map<string, {foreignPtr:boolean, type:string}>>()
	// cached table -> type mapping
	#tableTypes = new Map<string, Datex.Type>()

	#existingItemsCache = new Set<string>()
	#existingPointersCache = new Set<string>()

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
		const tableNames = tables.map(({table_name})=>'`'+table_name+'`');

		// TODO: better solution to handle drop with foreign constraints
		// currently just runs multiple drop table queries on failure, which is not ideal
		const iterations = 10;
		for (let i = 0; i < iterations; i++) {
			try {
				await this.#query<{table_name:string}>(`DROP TABLE IF EXISTS ${tableNames.join(',')};`)
				break;
			}
			catch (e) {
				console.error("Failed to drop some tables due to foreign constraints, repeating", e)
			}
		}

		// truncate meta tables
		for (const table of Object.values(this.#metaTables)) {
			await this.#query<{table_name:string}>(`TRUNCATE TABLE ${table.name};`)
		}

	}

	async #query<row=object>(query_string:string, query_params?:any[], returnRawResult: true): Promise<{rows:row[], result:ExecuteResult}>
	async #query<row=object>(query_string:string, query_params?:any[]): Promise<row[]>
	async #query<row=object>(query_string:string, query_params?:any[], returnRawResult?: boolean): Promise<row[]|{rows:row[], result:ExecuteResult}> {
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
		
        console.warn("QUERY: " + query_string, query_params)

		if (typeof query_string != "string") {console.error("invalid query:", query_string); throw new Error("invalid query")}
        if (!query_string) throw new Error("empty query");
        try {
            const result = await this.#sqlClient!.execute(query_string, query_params);
			if (returnRawResult) return {rows: result.rows ?? [], result};
			else return result.rows ?? [];
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

	/**
	 * Returns the table name for a given type, creates a new table if it does not exist
	 * @param type 
	 * @returns 
	 */
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
		if (!this.#tableTypes.has(table)) {
			const type = await this.#queryFirst<{type:string}>(
				new Query()
					.table(this.#metaTables.typeMapping.name)
					.select("type")
					.where(Where.eq("table_name", table))
					.build()
			)
			if (!type) {
				logger.error("No type found for table " + table);
			}
			this.#tableTypes.set(table, type ? Datex.Type.get(type.type) : null)
		}

		return this.#tableTypes.get(table)
	}

	/**
	 * Returns the table name for a given type.
	 * Does not validate if the table exists
	 */
	#typeToTableName(type: Datex.Type) {
		return type.namespace=="ext" ? type.name : `${type.namespace}_${type.name}`;
	}

	#typeToString(type: Datex.Type) {
		return type.namespace + ":" + type.name;
	}

	*#iterateTableColumns(type: Datex.Type) {
		const table = this.#typeToTableName(type);
		const columns = this.#tableColumns.get(table);
		if (!columns) throw new Error("Table columns for type " + type + " are not loaded");
		for (const data of columns) {
			yield data
		}
	}

	async #createTableForType(type: Datex.Type) {
		const columns:ColumnDefinition[] = [
			[this.#pointerMysqlColumnName, this.#pointerMysqlType, 'PRIMARY KEY INVISIBLE DEFAULT "0"']
		]
		const constraints: ConstraintsDefinition[] = []

		this.log?.("Creating table for type " + type)

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

				// is a primitive type -> assume no pointer, just store as dxb inline
				if (propType == Type.std.Any || propType.is_primitive || propType.is_js_pseudo_primitive ) {
					logger.warn("Cannot map primitive type " + propType + " to a SQL table, falling back to raw DXB")
					columns.push([propName, "blob"])
				}
				else {
					let foreignTable = await this.#getTableForType(propType);

					if (!foreignTable) {
						logger.warn("Cannot map type " + propType + " to a SQL table, falling back to raw pointer storage")
						foreignTable = this.#metaTables.rawPointers.name;
					}
	
					columns.push([propName, this.#pointerMysqlType])
					constraints.push(`FOREIGN KEY (\`${propName}\`) REFERENCES \`${foreignTable}\`(\`${this.#pointerMysqlColumnName}\`)`)
				}

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
			const columnData = new Map<string, {foreignPtr: boolean, type: string}>()
			const columns = await this.#query<{COLUMN_NAME:string, COLUMN_KEY:string, DATA_TYPE:string}>(
				new Query()
					.table("information_schema.columns")
					.select("COLUMN_NAME", "COLUMN_KEY", "DATA_TYPE")
					.where(Where.eq("table_schema", this.#options.db))
					.where(Where.eq("table_name", tableName))
					.build()
			)

			for (const col of columns) {
				if (col.COLUMN_NAME == this.#pointerMysqlColumnName) continue;
				columnData.set(col.COLUMN_NAME, {foreignPtr: col.COLUMN_KEY == "MUL", type: col.DATA_TYPE})
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

		const dependencies = new Set<Pointer>()

		const insertData:Record<string,unknown> = {
			[this.#pointerMysqlColumnName]: pointer.id
		}

		for (const [name, {foreignPtr, type}] of columns) {
			const value = pointer.val[name];
			if (foreignPtr) {
				const propPointer = Datex.Pointer.getByValue(value);
				// no pointer value
				if (!propPointer) {
					// null values are okay, otherwise error
					if (value !== undefined) {
						logger.error("Cannot reference non-pointer value in SQL table")
					}
				}
				else {
					insertData[name] = propPointer.id
					// must immediately add entry for foreign constraint to work
					await Storage.setPointer(propPointer, true)
					dependencies.add(propPointer)
				}
			}
			// is raw dxb value (exception for blob <->A rrayBuffer, TODO: better solution, can lead to issues)
			else if (type == "blob" && !(value instanceof ArrayBuffer || value instanceof TypedArray)) {
				insertData[name] = Compiler.encodeValue(value, dependencies, true, false, true);
			}
			else insertData[name] = value;
		}
		// this.log("cols", insertData)

		await this.#query('INSERT INTO ?? ?? VALUES ?;', [table, Object.keys(insertData), Object.values(insertData)])
	
		// add to pointer mapping
		await this.#updatePointerMapping(pointer.id, table)
		return dependencies;
	}

	/**
	 * Update a pointer in the database, pointer type must be templated
	 */
	async #updatePointer(pointer: Datex.Pointer, keys:string[]) {
		const table = await this.#getTableForType(pointer.type);
		if (!table) throw new Error("Cannot store pointer of type " + pointer.type + " in a custom table")
		const columns = await this.#getTableColumns(table);

		for (const key of keys) {
			const column = columns.get(key);
			const val = 
				column?.foreignPtr ?
					// foreign pointer id
					Datex.Pointer.getByValue(pointer.val[key])!.id : 
					(
						(column?.type == "blob" && !(pointer.val[key] instanceof ArrayBuffer || pointer.val[key] instanceof TypedArray)) ?
							// raw dxb value
							Compiler.encodeValue(pointer.val[key], new Set<Pointer>(), true, false, true) : 
							// normal value
							pointer.val[key]
					)
			await this.#query('UPDATE ?? SET ?? = ? WHERE ?? = ?;', [table, key, val, this.#pointerMysqlColumnName, pointer.id])
		}
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
		const columns = await this.#getTableColumns(table);
		if (!columns) throw new Error("No columns found for table " + table)
		for (const [colName, {foreignPtr, type}] of columns.entries()) {

			// convert blob strings to ArrayBuffer
			if (type == "blob" && typeof object[colName] == "string") {
				object[colName] = this.#stringToBinary(object[colName] as string)
			}

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
			// is blob, assume it is a DXB value
			else if (type == "blob") {
				object[colName] = `\u0001${foreignPointerPlaceholders.length}`
				try {
					// TODO: fix decompiling
					foreignPointerPlaceholders.push(MessageLogger.decompile(object[colName] as ArrayBuffer, false, false, false)||"'error: empty'")
				}
				catch (e) {
					console.error("error decompiling", object[colName], e)
					foreignPointerPlaceholders.push("'error'")
				}

			}
		}

		// const foreignPointerPlaceholders = await Promise.all(foreignPointerPlaceholderPromises)

		console.log("foreignPointerPlaceholders", foreignPointerPlaceholders)

		const objectString = Datex.Runtime.valueToDatexStringExperimental(object, false, false)
			.replace(/"\u0001(\d+)"/g, (_, index) => foreignPointerPlaceholders[parseInt(index)]||"error: no placeholder")

		console.log("objectString", objectString)

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
		const dependencies = new Set<Pointer>()
		const encoded = Compiler.encodeValue(pointer, dependencies, true, false, true);
		const {result} = await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.rawPointers.name, [this.#pointerMysqlColumnName, "value"], [pointer.id, encoded], encoded], true)
        // add to pointer mapping
		if (result.affectedRows == 1) await this.#updatePointerMapping(pointer.id, this.#metaTables.rawPointers.name)
		return dependencies;
	}

	async #updatePointerMapping(pointerId: string, tableName: string) {
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE table_name=?;', [this.#metaTables.pointerMapping.name, [this.#pointerMysqlColumnName, "table_name"], [pointerId, tableName], tableName])
	}

	async #setItemPointer(key: string, pointer: Pointer) {
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE '+this.#pointerMysqlColumnName+'=?;', [this.#metaTables.items.name, ["key", this.#pointerMysqlColumnName], [key, pointer.id], pointer.id])
	}

	isSupported() {
		return client_type === "deno";
	}

	async supportsMatchForType(type: Datex.Type<any>): Promise<boolean> {
		return (await this.#getTableForType(type)) != null;
	}

	async matchQuery<T extends object>(itemPrefix: string, valueType: Datex.Type<T>, match: Datex.MatchInput<T>, limit: number): Promise<T[]> {
	  
		const builder = new Query()
			.table(this.#metaTables.items.name)
			// .select(this.#pointerMysqlColumnName)
			.select(`${this.#typeToTableName(valueType)}.${this.#pointerMysqlColumnName} as ptrId`)
			.where(Where.like("key", itemPrefix + "%"))
			.join(
				Join.left(this.#typeToTableName(valueType)).on(`${this.#metaTables.items.name}.${this.#pointerMysqlColumnName}`, `${this.#typeToTableName(valueType)}.${this.#pointerMysqlColumnName}`)
			)

		if (isFinite(limit)) builder.limit(0, limit)
			
		const joins = new Map<string, Join>()
		const where = this.buildQueryConditions(builder, match, joins, valueType)

		builder.where(where);
		joins.forEach(join => builder.join(join));
			
		const ptrIds = await this.#query<{ptrId:string}>(builder.build())
		return Promise.all(ptrIds.map(({ptrId}) => Storage.getPointer(ptrId)))
	}

	private buildQueryConditions(builder: Query, match: unknown, joins: Map<string, Join>, valueType:Type, namespacedKey?: string, previousKey?: string): Where {

		const matchOrs = match instanceof Array ? match : [match]
		const entryIdentifier = previousKey ? previousKey + '.' + namespacedKey : namespacedKey // address.street

		let isPrimitiveArray = true;

		for (const or of matchOrs) {
			if (typeof or == "object") {
				isPrimitiveArray = false;
				break;
			}
		}

		
		// only primitive array, use IN selector
		if (isPrimitiveArray) {
			if (!namespacedKey) throw new Error("missing namespacedKey");
			if (matchOrs.length == 1) return Where.eq(entryIdentifier!, matchOrs[0])
			else return Where.in(entryIdentifier!, matchOrs)
		}

		else {
			const wheresOr = []
			for (const or of matchOrs) {

				if (typeof or == "object") {

					// is pointer
					const ptr = Pointer.pointerifyValue(or);
					if (ptr instanceof Pointer) {
						wheresOr.push(Where.eq(entryIdentifier!, ptr.id))
						continue;
					}
	
					// only enter after first recursion
					if (namespacedKey) {
						const tableAName = this.#typeToTableName(valueType) + '.' + namespacedKey // User.address
						const tableBName = this.#typeToTableName(valueType.template[namespacedKey]); // Address
						const tableBIdentifier = namespacedKey + '.' + this.#pointerMysqlColumnName
						// Join Adddreess on address._ptr_id = User.address
						joins.set(namespacedKey, Join.left(`${tableBName}`, namespacedKey).on(tableBIdentifier, tableAName));
						valueType = valueType.template[namespacedKey];
					}

					const whereAnds = []
					for (const [key, value] of Object.entries(or)) {
						// const nestedKey = namespacedKey ? namespacedKey + "." + key : key; 
						whereAnds.push(this.buildQueryConditions(builder, value, joins, valueType, key, namespacedKey))
					}
					wheresOr.push(Where.and(...whereAnds))
				}
				else {
					if (!namespacedKey) throw new Error("missing namespacedKey");
					wheresOr.push(Where.eq(entryIdentifier!, or))
				}
			}
			return Where.or(...wheresOr)
		}

	}


	async setItem(key: string,value: unknown) {
		const dependencies = new Set<Pointer>()

		// value is pointer
		const ptr = Pointer.pointerifyValue(value);
		if (ptr instanceof Pointer) {
			dependencies.add(ptr);
			this.#setItemPointer(key, ptr)
		}
		else {
			const encoded = Compiler.encodeValue(value, dependencies);
			await this.setItemValueDXB(key, encoded)
		}
		return dependencies;
	}
	async getItem(key: string, conditions: ExecConditions): Promise<unknown> {
		const encoded = await this.getItemValueDXB(key);
		if (encoded === null) return NOT_EXISTING;
		return Runtime.decodeValue(encoded, false, conditions);
	}

	async hasItem(key:string) {
		if (this.#existingItemsCache.has(key)) return true;
		const count = (await this.#queryFirst<{COUNT: number}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("COUNT(*) as COUNT")
				.where(Where.eq("key", key))
				.build()
		));
		const exists = !!count && count.COUNT > 0;
		if (exists) {
			this.#existingItemsCache.add(key);
			// delete from cache after 2 minutes
			setTimeout(()=>this.#existingItemsCache.delete(key), 1000*60*2)
		}
		return exists;
	}

	async getItemKeys(prefix: string) {
		const builder = new Query()
			.table(this.#metaTables.items.name)
			.select("key")

		if (prefix != undefined) builder.where(Where.like("key", prefix + "%"))

		const keys = await this.#query<{key:string}>(builder.build())
		return function*(){
			for (const {key} of keys) {
				yield key;
			} 
		}()
	}

	async getPointerIds() {
		const pointerIds = await this.#query<{ptrId:string}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select(`${this.#pointerMysqlColumnName} as ptrId`)
				.build()
		)
		return function*(){
			for (const {ptrId} of pointerIds) {
				yield ptrId;
			} 
		}()
	}

	async removeItem(key: string): Promise<void> {
		this.#existingItemsCache.delete(key)
		await this.#query('DELETE FROM ?? WHERE ??=?;', [this.#metaTables.items.name, "key", key])
	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer|null> {
		const encoded = (await this.#queryFirst<{value: string, ptrId: string}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("value", `${this.#pointerMysqlColumnName} as ptrId`)
				.where(Where.eq("key", key))
				.build()
		));
		if (encoded?.ptrId) return Compiler.compile(`$${encoded.ptrId}`, undefined, undefined, false) as Promise<ArrayBuffer>;
		else if (encoded?.value) return this.#stringToBinary(encoded.value);
		else return null;
	}
	async setItemValueDXB(key: string, value: ArrayBuffer) {
		const stringBinary = this.#binaryToString(value)
		await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.items.name, ["key", "value"], [key, stringBinary], stringBinary])
	}

	async setPointer(pointer: Pointer<any>, partialUpdateKey: unknown|typeof NOT_EXISTING): Promise<Set<Pointer<any>>> {

		// is templatable pointer type
		if (pointer.type.template) {
			// this.log?.("update " + pointer.id + " - " + pointer.type, partialUpdateKey, await this.#pointerEntryExists(pointer))

			// new full insert
			if (partialUpdateKey === NOT_EXISTING || !await this.hasPointer(pointer.id)) {
				return this.#insertPointer(pointer)
			}
			// partial update
			else {
				if (typeof partialUpdateKey !== "string") throw new Error("invalid key type for SQL table: " + Datex.Type.ofValue(partialUpdateKey))
				const dependencies = new Set<Pointer>()
				// add all pointer properties to dependencies
				// dependencies must be added to database before the update to prevent foreign key constraint errors
				const promises = []
				for (const [name, {foreignPtr}] of this.#iterateTableColumns(pointer.type)) {
					if (foreignPtr) {
						const ptr = Pointer.pointerifyValue(pointer.getProperty(name));
						if (ptr instanceof Pointer) {
							dependencies.add(ptr)
							promises.push(Storage.setPointer(ptr))
						}
					}
				}
				await Promise.all(promises)
				await this.#updatePointer(pointer, [partialUpdateKey])
				return dependencies;
			}
		}

		// no template, just add a raw DXB entry, partial updates are not supported
		else {
			return this.#setPointerRaw(pointer)
		}
		
	}

	async getPointerValue(pointerId: string, outer_serialized: boolean): Promise<unknown> {
		// get table where pointer is stored
		const table = await this.#getPointerTable(pointerId);
		if (!table) {
			logger.error("No table found for pointer " + pointerId);
			return NOT_EXISTING;
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
			return value ? Runtime.decodeValue(this.#stringToBinary(value), outer_serialized) : NOT_EXISTING;
		}

		// is templated pointer
		else {
			const type = await this.#getTypeForTable(table);
			if (!type) {
				logger.error("No type found for table " + table);
				return NOT_EXISTING;
			}
			const object = await this.#getTemplatedPointerObject(pointerId, table);
			if (!object) return NOT_EXISTING;

			// resolve foreign pointers
			const columns = await this.#getTableColumns(table);
			if (!columns) throw new Error("No columns found for table " + table)
			for (const [colName, {foreignPtr, type}] of columns.entries()) {
				
				// convert blob strings to ArrayBuffer
				if (type == "blob" && typeof object[colName] == "string") {
					object[colName] = this.#stringToBinary(object[colName] as string)
				}
				
				// is an object type with a template
				if (foreignPtr) {
					if (typeof object[colName] == "string") {
						object[colName] = await Storage.getPointer(object[colName] as string, true);
					}
					else {
						logger.error("Cannot get pointer value for property " + colName + " in object " + pointerId + " - " + table)
					}
				}
				// is blob, assume it is a DXB value
				else if (type == "blob") {
					object[colName] = await Runtime.decodeValue(object[colName] as ArrayBuffer, true);
				}
			}
			return type.cast(object, undefined, undefined, false);
		}
	}

	

	async removePointer(pointerId: string): Promise<void> {
		this.#existingPointersCache.delete(pointerId)
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
			const {result} = await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [table, [this.#pointerMysqlColumnName, "value"], [pointerId, value], value], true)
			console.log("affectedRows", result.affectedRows)
			// is newly inserted, add to pointer mapping
			if (result.affectedRows == 1) await this.#updatePointerMapping(pointerId, this.#metaTables.rawPointers.name)
		}
		else {
			logger.error("Setting raw dxb value for templated pointer is not yet supported in SQL storage (pointer: " + pointerId + ", table: " + table + ")");
		}
	}

	async hasPointer(pointerId: string): Promise<boolean> {
		if (this.#existingPointersCache.has(pointerId)) return true;
		const count = (await this.#queryFirst<{COUNT: number}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select("COUNT(*) as COUNT")
				.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
				.build()
		));
		const exists = !!count && count.COUNT > 0;
		if (exists) {
			this.#existingPointersCache.add(pointerId);
			// delete from cache after 2 minutes
			setTimeout(()=>this.#existingPointersCache.delete(pointerId), 1000*60*2)
		}
		return exists;
	}

	async clear() {
		await this.#resetAll();
	}

}