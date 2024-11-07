import { Client, ExecuteResult } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { Query } from "https://deno.land/x/sql_builder@v1.9.2/mod.ts";
import { Where } from "https://deno.land/x/sql_builder@v1.9.2/where.ts";
import { Pointer } from "../../runtime/pointers.ts";
import { AsyncStorageLocation } from "../storage.ts";
import { ColumnDefinition, ConstraintsDefinition, TableDefinition, mysql_data_type } from "./sql-definitions.ts";
import { Logger } from "../../utils/logger.ts";
import { Datex } from "../../mod.ts";
import { datex_type_mysql_map } from "./sql-type-map.ts";
import { NOT_EXISTING } from "../../runtime/constants.ts";
import { client_type } from "../../utils/constants.ts";
import { Compiler } from "../../compiler/compiler.ts";
import type { ExecConditions } from "../../utils/global_types.ts";
import { Runtime } from "../../runtime/runtime.ts";
import { Storage } from "../storage.ts";
import { Type } from "../../types/type.ts";
import { TypedArray } from "../../utils/global_values.ts";
import { MessageLogger } from "../../utils/message_logger.ts";
import { Join } from "https://deno.land/x/sql_builder@v1.9.2/join.ts";
import { LazyPointer } from "../../runtime/lazy-pointer.ts";
import { MatchOptions, MatchCondition, MatchConditionType, ComputedProperty, ComputedPropertyType} from "../storage.ts";
import { MatchResult } from "../storage.ts";
import { Time } from "../../types/time.ts";
import { Order } from "https://deno.land/x/sql_builder@v1.9.2/order.ts";
import { configLogger } from "https://deno.land/x/mysql@v2.12.1/src/logger.ts";
import { replaceParams } from "https://deno.land/x/sql_builder@v1.9.2/util.ts";

configLogger({level: "WARNING"})

const logger = new Logger("SQL Storage");

export abstract class SQLDBStorageLocation<Options extends {db: string}> extends AsyncStorageLocation {


	protected abstract connect(): boolean|Promise<boolean>;
	protected abstract executeQuery(query_string: string, query_params?: any[]): ExecuteResult|Promise<ExecuteResult>

	protected abstract getTableExistsQuery(tableName: string): string;
	protected abstract getTableColumnInfoQuery(tableName: string): string
	protected abstract getTableConstraintsQuery(tableName: string): string
	protected abstract getClearTableQuery(tableName: string): string;
	protected abstract affectedRowsQuery?: string;
	protected abstract disableForeignKeyChecksQuery: string;
    protected abstract enableForeignKeyChecksQuery: string;

	static #debugMode = false;

	/**
	 * Enable or disable debug mode, which logs all queries
	 */
	static debug(debugMode = true) {
		this.#debugMode = debugMode;
	}

	name = "SQL_DB"
	supportsPrefixSelection = true;
	supportsMatchSelection = true;
	supportsPartialUpdates = true;
	supportsBinaryIO = false;
	supportsSQLCalcFoundRows = true;
	supportsInsertOrIgnore = false;
	supportsPartialForeignKeys() {
		return true;
	}

	#connected = false;
	#initializing = false
	#initialized = false
	protected options: Options

	// use single quotes instead of double quotes in queries
	protected useSingleQuotes = false;
	// support for INSERT OR REPLACE
	protected supportsInsertOrReplace = false;
	// support for invisible columns
	protected supportsInvisibleColumns = false;
		
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
				[this.#pointerMysqlColumnName, this.#pointerMysqlType, "PRIMARY KEY"],
				["value", "blob"]
			]
		},
		sets: {
			name: "__datex_sets",
			columns: [
				[this.#pointerMysqlColumnName, this.#pointerMysqlType, "PRIMARY KEY"],
				this.supportsPartialForeignKeys() ? ["hash", "varchar(50)", "PRIMARY KEY"] : ["hash", "varchar(50)"],
				["value_dxb", "blob"],
				["value_text", "text"],
				["value_integer", "int"],
				["value_decimal", "double"],
				["value_boolean", "boolean"],
				["value_time", "datetime"],
				["value_pointer", this.#pointerMysqlType]
			]
		},
		items: {
			name: "__datex_items",
			columns: [
				["key", "varchar(200)", "PRIMARY KEY"],
				["value", "blob"],
				["value_text", "text"],
				["value_integer", "int"],
				["value_decimal", "double"],
				["value_boolean", "boolean"],
				["value_time", "datetime"],
				[this.#pointerMysqlColumnName, this.#pointerMysqlType],
			]
		}
	} satisfies Record<string, TableDefinition>;

	// cached table columns
	#tableColumns = new Map<string, Map<string, {foreignPtr:boolean, foreignTable?:string, type:string}>>()
	// cached table -> type mapping
	#tableTypes = new Map<string, Datex.Type>()

	#existingItemsCache = new Set<string>()
	#existingPointersCache = new Set<string>()
	#tableCreationTasks = new Map<Type, Promise<string>>()
	#tableColumnTasks = new Map<string, Promise<Map<string, {foreignPtr:boolean, foreignTable?:string, type:string}>>>()
	#tableLoadingTasks = new Map<Type, Promise<string|undefined>>()

	// remember tables for pointers that still need to be loaded
	#pointerTables = new Map<string, string>()
	#templateMultiQueries = new Map<string, {pointers:Set<string>, result: Promise<Record<string,unknown>[]>}>()

    constructor(options:Options, private log?:(...args:unknown[])=>void) {
		super()
        this.options = options
    }
	async #connect(){
		if (this.#connected) return;
        this.#connected = await this.connect();
    }
	async #init() {
		if (this.#initialized) return;
		this.#initializing = true;
		await this.#connect();
		await this.#setupMetaTables();
		await MessageLogger.init(); // required for decompiling
		this.#initializing = false;
		this.#initialized = true;
	}

	async #resetAll() {
		
		// drop all custom type tables
		const tables = await this.#query<{table_name:string}>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("table_name")
				.build(),
			undefined, false, ["table_name"]
		)
		const tableNames = tables.map(({table_name})=>'`'+table_name+'`');

		// TODO: better solution to handle drop with foreign constraints
		// currently just runs multiple drop table queries on failure, which is not ideal
		if (tableNames.length) {
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
		}

		// truncate meta tables
		await Promise.all(Object.values(this.#metaTables).map(table => this.#query(this.getClearTableQuery(table.name))))
	}


	async #query<row=object>(query_string:string, query_params:any[]|undefined, returnRawResult: true): Promise<{rows:row[], result:ExecuteResult}>
	async #query<row=object>(query_string:string, query_params:any[]|undefined, returnRawResult: false): Promise<row[]>
	async #query<row=object>(query_string:string, query_params?:any[]): Promise<row[]>
	async #query<row=object>(query_string:string, query_params?:any[], returnRawResult?: boolean): Promise<row[]|{rows:row[], result:ExecuteResult}> {
		
		// TODO: only workaround for sqlite, replace all " with ' in queries
		if (this.useSingleQuotes) {
			query_string = query_string.replace(/"/g, "'");
		}
		
		// prevent infinite recursion if calling query from within init()
		if (!this.#initializing) await this.#init();

		// handle arraybuffers, convert undefined to null
		if (query_params) {
			for (let i = 0; i < query_params.length; i++) {
				const param = query_params[i];
				if (param instanceof ArrayBuffer) {
					query_params[i] = this.#binaryToString(param)
				}
				if (param === undefined) query_params[i] = null;
				if (param instanceof Array) {
					query_params[i] = param.map(p => {
						if (p instanceof ArrayBuffer) return this.#binaryToString(p);
						else if (p === undefined) return null;
						return p;
					})
				}
			}
		}

		
    	if (SQLDBStorageLocation.#debugMode) console.log("QUERY: " + query_string, query_params)

		if (typeof query_string != "string") {console.error("invalid query:", query_string); throw new Error("invalid query")}
        if (!query_string) throw new Error("empty query");
        try {
            const result = await this.executeQuery(query_string, query_params);
			if (returnRawResult) return {rows: result.rows ?? [], result};
			else return result.rows ?? [];
        } catch (e) {
			console.log(query_string, query_params)
			if (this.log) this.log("SQL error:", e)
           	else console.error("SQL error:", e);

			// errors to ignore for now (TODO: this is only a temporary solution, input should be validated beforehand)
			// incorrect datetime value (out of range, etc.)
			if (e?.toString?.().startsWith("Error: Incorrect datetime value")) {
				console.error("SQL: Ignoring incorrect datetime value error", e.message);
				if (returnRawResult) return {rows: [], result: {affectedRows: 0, lastInsertId: 0, rows: []}};
				else return [];
			}

            throw e;
			
        }
    }


	#stringToBinary(value: string|Uint8Array|ArrayBuffer): ArrayBuffer {
		if (value instanceof Uint8Array) return value.buffer;
		if (value instanceof ArrayBuffer) return value;
		return Uint8Array.from(value, x => x.charCodeAt(0)).buffer
	}
	#binaryToString(value: ArrayBuffer){
		if (this.supportsBinaryIO) return new Uint8Array(value);
		return String.fromCharCode.apply(null, new Uint8Array(value) as unknown as number[])
	}

    async #queryFirst<row=object>(query_string:string, query_params?:any[]): Promise<row|undefined> {
        return (await this.#query<row>(query_string, query_params, false))?.[0]
    }

	async #createTableIfNotExists(definition: TableDefinition) {
		const exists = this.#tableColumns.has(definition.name) || await this.#queryFirst(
			this.getTableExistsQuery(definition.name)
		)
		if (!exists) {
			await this.#createTableFromDefinition(definition);
			return true;
		}
		return false;
	}


	/**
	 * Creates a new table
	 */
	async #createTableFromDefinition(definition: TableDefinition) {
		const compositePrimaryKeyColumns = definition.columns.filter(col => col[2]?.includes("PRIMARY KEY"));
		if (compositePrimaryKeyColumns.length > 1) {
			for (const col of compositePrimaryKeyColumns) {
				col[2] = col[2]?.replace("PRIMARY KEY", "")
			}
		}
		const primaryKeyDefinition = compositePrimaryKeyColumns.length > 1 ? `, PRIMARY KEY (${compositePrimaryKeyColumns.map(col => `\`${col[0]}\``).join(', ')})` : '';

		// create
		await this.#queryFirst(`CREATE TABLE IF NOT EXISTS \`${definition.name}\` (${definition.columns.map(col => 
			`\`${col[0]}\` ${col[1]} ${col[2]??''}`
			).join(', ')}${definition.constraints?.length ? ',' + definition.constraints.join(',') : ''}${primaryKeyDefinition});`)
		// load column definitions
		await this.#getTableColumns(definition.name);	
	}

	/**
	 * Returns the table name for a given type, creates a new table if it does not exist
	 * @param type 
	 * @returns 
	 */
	async #getTableForType(type: Datex.Type) {
		// type does not have a template, use raw pointer table
		if (!type.template) return null

		// already has a table
		const tableName = this.#typeToTableName(type);
		if (this.#tableTypes.has(tableName)) return tableName;
		

		// already creating table
		if (this.#tableLoadingTasks.has(type)) {
			return this.#tableLoadingTasks.get(type);
		}

		const {promise, resolve} = Promise.withResolvers<string|undefined>();
		this.#tableLoadingTasks.set(type, promise);

		const existingTable = (await this.#queryFirst<{table_name: string}>(
			new Query()
				.table(this.#metaTables.typeMapping.name)
				.select("table_name")
				.where(Where.eq("type", this.#typeToString(type)))
				.build(), 
			undefined, ['table_name']
		))?.table_name;

		const table = existingTable ?? await this.#createTableForType(type);
		resolve(table);
		this.#tableLoadingTasks.delete(type);
		return table;
	}

	async #getTypeForTable(table: string) {
		if (!this.#tableTypes.has(table)) {
			const type = await this.#queryFirst<{type:string}>(
				new Query()
					.table(this.#metaTables.typeMapping.name)
					.select("type")
					.where(Where.eq("table_name", table))
					.build(), 
				undefined, ['type']
			)
			if (!type) {
				logger.error("No type found for table " + table);
			}
			else this.#tableTypes.set(table, Datex.Type.get(type.type));
		}

		return this.#tableTypes.get(table)
	}

	/**
	 * Returns the table name for a given type.
	 * Converts UpperCamelCase to snake_case and pluralizes the name.
	 * Does not validate if the table exists
	 * Throws if the type is not templated
	 */
	#typeToTableName(type: Datex.Type) {
		if (!type.template) throw new Error("Cannot create table for non-templated type " + type)
		const snakeCaseName = type.name.replace(/([A-Z])/g, "_$1").toLowerCase().slice(1).replace(/__+/g, '_');
		const snakeCasePlural = snakeCaseName + (snakeCaseName.endsWith("s") ? "es" : "s");
		const name = type.namespace=="ext"||type.namespace=="struct" ? snakeCasePlural : `${type.namespace}_${snakeCasePlural}`;
		if (name.length > 64) throw new Error("Type name too long: " + type);
		else return name;
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

		// already creating table
		if (this.#tableCreationTasks.has(type)) {
			return this.#tableCreationTasks.get(type);
		}

		const {promise, resolve} = Promise.withResolvers<string>();
		this.#tableCreationTasks.set(type, promise);

		const columns:ColumnDefinition[] = [
			[this.#pointerMysqlColumnName, this.#pointerMysqlType, 'PRIMARY KEY'+(this.supportsInvisibleColumns ? ' INVISIBLE' : '')+' DEFAULT "0"']
		]
		const constraints: ConstraintsDefinition[] = []

		for (const [propName, propType] of Object.entries(type.template as {[key:string]:Datex.Type})) {

			// invalid prop name for now: starting/ending with _
			if (propName.startsWith("_") || propName.endsWith("_")) throw new Error("Invalid property name: " + propName + " (Property names cannot start or end with an underscore)");

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
					logger.warn("Cannot map type " + propType + " to a SQL table, falling back to raw DXB")
					columns.push([propName, "blob"])
				}
				else {
					let foreignTable = await this.#getTableForType(propType);

					if (!foreignTable) {

						// "set" table
						if (propType.base_type == Type.std.Set) {
							foreignTable = this.#metaTables.sets.name;
						}
						else {
							if (
								propType !== Datex.Type.std.StorageSet &&
								propType !== Datex.Type.std.StorageMap &&
								propType !== Datex.Type.std.StorageWeakSet &&
								propType !== Datex.Type.std.StorageWeakMap
							) {
								logger.warn("Cannot map type " + propType + " to a SQL table, falling back to raw pointer storage")
							}
							foreignTable = this.#metaTables.rawPointers.name;
						}
						
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
		await this.#createTableFromDefinition({
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

		// remember table type mapping
		this.#tableTypes.set(name, type);

		// resolve promise
		resolve(name);
		this.#tableCreationTasks.delete(type);

		return name;
	}

	/**
	 * makes sure all DATEX meta tables exist in the database
	 */
	async #setupMetaTables() {
		await Promise.all(
			Object
				.values(this.#metaTables)
				.map(definition => this.#createTableIfNotExists(definition))
		)
	}

	async #getTableColumns(tableName: string) {

		if (!this.#tableColumns.has(tableName)) {
			if (this.#tableColumnTasks.has(tableName)) return this.#tableColumnTasks.get(tableName)!;
			const {promise, resolve} = Promise.withResolvers<Map<string, {foreignPtr:boolean, foreignTable?:string, type:string}>>();
			this.#tableColumnTasks.set(tableName, promise);

			const columnData = new Map<string, {foreignPtr: boolean, foreignTable?: string, type: string}>()
			const columns = await this.#query<{_id: string, name:string, type:string}>(
				this.getTableColumnInfoQuery(tableName), [], false, ["_id", "name", "type"]
			)

			const constraints = (await this.#query<{_id:string, name:string, ref_table:string, table:string, from:string}>(
				this.getTableConstraintsQuery(tableName), [], false, ["_id", "name", "ref_table"]
			));

			const columnTables = new Map<string, string>()
			for (const constraint of constraints) {
				const name = constraint.name ?? constraint.from; // mysql/sqlite
				const ref_table = constraint.ref_table ?? constraint.table; // mysql/sqlite
				columnTables.set(name, ref_table)
			}

			for (const col of columns) {
				const columnName = col.name
				const dataType = col.type
				if (columnName == this.#pointerMysqlColumnName) continue;
				columnData.set(columnName, {foreignPtr: columnTables.has(columnName), foreignTable: columnTables.get(columnName), type: dataType})
			}

			this.#tableColumns.set(tableName, columnData)

			resolve(this.#tableColumns.get(tableName)!);
			this.#tableColumnTasks.delete(tableName);
		}

		return this.#tableColumns.get(tableName)!;
	}

	/**
	 * Insert a pointer into the database, pointer type must be templated
	 */
	async #insertTemplatedPointer(pointer: Datex.Pointer) {
		const table = await this.#getTableForType(pointer.type)
		if (!table) throw new Error("Cannot store pointer of type " + pointer.type + " in a custom table")
		const columns = await this.#getTableColumns(table);

		const dependencies = new Set<Pointer>()

		const insertData:Record<string,unknown> = {
			[this.#pointerMysqlColumnName]: pointer.id
		}

		// was garbage collected in the meantime
        if (pointer.garbage_collected) {
            return dependencies;
        }

		const val = pointer.val;

		for (const [name, {foreignPtr, type}] of columns) {
			const value = val[name];
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
			// is raw dxb value (exception for blob <-> ArrayBuffer, TODO: better solution, can lead to issues)
			else if (type == "blob" && !(value instanceof ArrayBuffer || value instanceof TypedArray)) {
				insertData[name] = Compiler.encodeValue(value, dependencies, true, false, false);
			}
			else insertData[name] = value;
		}

		// replace if entry already exists

		if (this.supportsInsertOrReplace) {
			await this.#query(`INSERT OR REPLACE INTO \`${table}\` (${Object.keys(insertData).map(key => `\`${key}\``).join(', ')}) VALUES (${Object.keys(insertData).map(() => '?').join(', ')})`, Object.values(insertData))
		}
		else {
			await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE '+Object.keys(insertData).map((key) => `\`${key}\` = ?`).join(', '), [table, Object.keys(insertData), Object.values(insertData), ...Object.values(insertData)])
		}

		// await this.#query('INSERT INTO ?? ?? VALUES ?;', [table, Object.keys(insertData), Object.values(insertData)])
	
		// add to pointer mapping
		await this.#updatePointerMapping(pointer.id, table)
		return dependencies;
	}

	/**
	 * Update a pointer in the database, pointer type must be templated
	 */
	async #updatePointer(pointer: Datex.Pointer, keys:string[], dependencies?: Set<Pointer>) {
		const table = await this.#getTableForType(pointer.type);
		if (!table) throw new Error("Cannot store pointer of type " + pointer.type + " in a custom table")
		const columns = await this.#getTableColumns(table);

		// was garbage collected in the meantime
		if (pointer.garbage_collected) {
			return;
		}
		const ptrVal = pointer.val;

		for (const key of keys) {
			const column = columns.get(key);
			const val = 
				column?.foreignPtr ?
					// foreign pointer id
					Datex.Pointer.getByValue(ptrVal[key])!.id : 
					(
						(column?.type == "blob" && !(ptrVal[key] instanceof ArrayBuffer || ptrVal[key] instanceof TypedArray)) ?
							// raw dxb value
							Compiler.encodeValue(ptrVal[key], dependencies, true, false, false) : 
							// normal value
							ptrVal[key]
					)
			//await this.#query('UPDATE ?? SET ?? = ? WHERE ?? = ?;', [table, key, val, this.#pointerMysqlColumnName, pointer.id])
			await this.#query(`UPDATE \`${table}\` SET \`${key}\` = ? WHERE \`${this.#pointerMysqlColumnName}\` = ?`, [val, pointer.id])
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
			// convert Date to Time
			else if (object[colName] instanceof Date) {
				object[colName] = new Time(object[colName] as Date)
			}

			// convert to boolean
			else if (typeof object[colName] == "number" && (type == "tinyint" || type == "boolean")) {
				object[colName] = Boolean(object[colName])
			}

			// is an object type with a template
			if (foreignPtr) {
				if (typeof object[colName] == "string") {
					const ptrId = object[colName] as string
					object[colName] = `\u0001${foreignPointerPlaceholders.length}`
					foreignPointerPlaceholders.push("$"+ptrId)
				}
				// otherwise, property is null/undefined
			}
			// is blob, assume it is a DXB value
			else if (type == "blob") {
				try {
					// TODO: fix decompiling
					foreignPointerPlaceholders.push(Storage.removeTrailingSemicolon(MessageLogger.decompile(object[colName] as ArrayBuffer, false, false, false)||"'error'"))
				}
				catch (e) {
					console.error("error decompiling", object[colName], e)
					foreignPointerPlaceholders.push("'error'")
				}
				object[colName] = `\u0001${foreignPointerPlaceholders.length-1}`
			}
		}

		// const foreignPointerPlaceholders = await Promise.all(foreignPointerPlaceholderPromises)

		const objectString = Datex.Runtime.valueToDatexStringExperimental(object, false, false)
			.replace(/"\u0001(\d+)"/g, (_, index) => foreignPointerPlaceholders[parseInt(index)]||"'error: no placeholder'")

		return `${type.toString()} ${objectString}`
	}


	async #getTemplatedPointerObject(pointerId: string, table?: string) {
		table = table ?? await this.#getPointerTable(pointerId);
		if (!table) {
			logger.error("No table found for pointer " + pointerId);
			return null;
		}

		let result: Promise<Record<string,unknown>[]>;

		if (this.#templateMultiQueries.has(table)) {
			const multiQuery = this.#templateMultiQueries.get(table)!
			multiQuery.pointers.add(pointerId)
			result = multiQuery.result;
		}
		else {
			const pointers = new Set<string>([pointerId])
			result = (async () => {
				await sleep(30);
				this.#templateMultiQueries.delete(table)
				return this.#query<Record<string,unknown>>(
					new Query()
						.table(table)
						.select("*", this.#pointerMysqlColumnName)
						.where(Where.in(this.#pointerMysqlColumnName, Array.from(pointers)))
						.build()
				)
			})()
			this.#templateMultiQueries.set(table, {pointers, result})
		}

		const res = (await result)
			.find(obj => obj[this.#pointerMysqlColumnName] == pointerId)
		if (res) delete res[this.#pointerMysqlColumnName];
		return res;
	}

	async #getTemplatedPointerValueDXB(pointerId: string, table?: string) {
		const string = await this.#getTemplatedPointerValueString(pointerId, table);
		if (!string) return null;
		const compiled = await Compiler.compile(string, [], {sign: false, encrypt: false, to: Datex.Runtime.endpoint, preemptive_pointer_init: false}, false) as ArrayBuffer;
		return compiled
	}

	async #getPointerTable(pointerId: string) {
		if (this.#pointerTables.has(pointerId)) {
			const table = this.#pointerTables.get(pointerId);
			this.#pointerTables.delete(pointerId);
			return table;
		}

		return (await this.#queryFirst<{table_name:string}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select("table_name")
				.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
				.build(),
			undefined, ['table_name']
		))?.table_name;
	}

	async #setPointerRaw(pointer: Pointer) {
		const dependencies = new Set<Pointer>()
		const encoded = Compiler.encodeValue(pointer, dependencies, true, false, true);
		await this.#setPointerInRawTable(pointer.id, encoded);
		return dependencies;
	}

	async #setPointerSet(pointer: Pointer) {
		const dependencies = new Set<Pointer>()

		// was garbage collected in the meantime
		if (pointer.garbage_collected) {
			return;
		}
		if (!(pointer.val instanceof Set)) throw new Error("Pointer value must be a Set");

		const builder = new Query().table(this.#metaTables.sets.name)
		const entries = []
		// add default entry (also for empty set)
		entries.push({
			[this.#pointerMysqlColumnName]: pointer.id, 
			hash: "",
			value_dxb: null,
			value_text: null,
			value_integer: null,
			value_decimal: null,
			value_boolean: null,
			value_time: null,
			value_pointer: null
		})

		for (const val of pointer.val) {
			const hash = await Compiler.getValueHashString(val)
			const data = {[this.#pointerMysqlColumnName]: pointer.id, hash} as Record<string,unknown>;
			const valPtr = Datex.Pointer.pointerifyValue(val);

			if (typeof val == "string") data.value_text = val
			else if (typeof val == "number") data.value_decimal = val
			else if (typeof val == "bigint") data.value_boolean = val
			else if (typeof val == "boolean") data.value_boolean = val
			else if (val instanceof Date) data.value_time = val
			else if (valPtr instanceof Pointer) {
				data.value_pointer = valPtr.id
				dependencies.add(valPtr);
			}
			else data.value_dxb = this.#binaryToString(Compiler.encodeValue(val, dependencies, true, false, false))
			entries.push(data)
		}
		builder.insert(entries);

		// first delete all existing entries for this pointer (except the default entry)
		try {
			await this.#query(this.disableForeignKeyChecksQuery);
			//await this.#query('DELETE FROM ?? WHERE ?? = ? AND `hash` != "";', [this.#metaTables.sets.name, this.#pointerMysqlColumnName, pointer.id])
			await this.#query(`DELETE FROM \`${this.#metaTables.sets.name}\` WHERE \`${this.#pointerMysqlColumnName}\` = ? AND \`hash\` != "";`, [pointer.id])
			await this.#query(this.enableForeignKeyChecksQuery);
		}
		catch (e) {
			console.error("Error deleting old set entries", e)
		}

		// replace INSERT with INSERT IGNORE to prevent duplicate key errors
		const {result} = await this.#query(builder.build().replace("INSERT", this.supportsInsertOrIgnore ? "INSERT OR IGNORE" : "INSERT IGNORE"), undefined, true)
		// add to pointer mapping TODO: better decision if to add to pointer mapping
		if (result.affectedRows) await this.#updatePointerMapping(pointer.id, this.#metaTables.sets.name)
		return dependencies;
	}

	async #updatePointerMapping(pointerId: string, tableName: string) {
		if (this.supportsInsertOrReplace) {
			await this.#query(`INSERT OR REPLACE INTO \`${this.#metaTables.pointerMapping.name}\` (\`${this.#pointerMysqlColumnName}\`, \`table_name\`) VALUES (?, ?);`, [pointerId, tableName])
		}
		else {
			await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE table_name=?;', [this.#metaTables.pointerMapping.name, [this.#pointerMysqlColumnName, "table_name"], [pointerId, tableName], tableName])
		}
	}

	async #setItemPointer(key: string, pointer: Pointer) {
		if (this.supportsInsertOrReplace) {
			await this.#query(`INSERT OR REPLACE INTO \`${this.#metaTables.items.name}\` (\`key\`, \`${this.#pointerMysqlColumnName}\`) VALUES (?, ?);`, [key, pointer.id])
		}
		else {
			await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE '+this.#pointerMysqlColumnName+'=?;', [this.#metaTables.items.name, ["key", this.#pointerMysqlColumnName], [key, pointer.id], pointer.id])
		}
	}

	isSupported() {
		return client_type === "deno";
	}

	supportsMatchForType(type: Datex.Type<any>) {
		// only templated types are supported because they are stored in custom tables
		return !!type.template
	}

	async matchQuery<T extends object, Options extends MatchOptions>(itemPrefix: string, valueType: Datex.Type<T>, match: Datex.MatchInput<T>, options: Options): Promise<MatchResult<T, Options>> {

		// validate options
		if ('limit' in options && options.limit != undefined && !isFinite(options.limit)) throw new Error("Invalid limit: " + options.limit)
		if ('offset' in options && options.offset != undefined && !isFinite(options.offset)) throw new Error("Invalid offset: " + options.offset) 
	  
		// measure total query time
		const start = Date.now();

		const joins = new Map<string, Join>()
		const collectedTableTypes = new Set<Type>([valueType])
		const collectedIdentifiers = new Set<string>()
		const builder = new Query()
			.table(this.#metaTables.items.name)
			.where(Where.like(this.#metaTables.items.name + ".key", itemPrefix + "%"))
			.join(
				Join.left(this.#typeToTableName(valueType)).on(`${this.#metaTables.items.name}.${this.#pointerMysqlColumnName}`, `${this.#typeToTableName(valueType)}.${this.#pointerMysqlColumnName}`)
			)
		const rootTableName = this.#typeToTableName(valueType);

		const where = this.buildQueryConditions(builder, match, joins, collectedTableTypes, collectedIdentifiers, valueType, rootTableName, undefined, options.computedProperties, true)
		let query = "error";

		// computed properties - nested select
		if (options.computedProperties || options.returnRaw) {

			// add property joins for returnRaw
			if (options.returnRaw) {
				this.addPropertyJoins(
					options.returnRaw, 
					builder, joins, valueType, collectedTableTypes
				)
				for (const property of options.returnRaw) {
					collectedIdentifiers.add(property.replaceAll(".", "__"))
				}
			}

			const select = [...collectedIdentifiers, this.#pointerMysqlColumnName].map(identifier => {
				if (identifier.includes("__")) {
					return `${this.getTableProperty(identifier)} as ${identifier}`
				}
				else return rootTableName + '.' + identifier;
			});

			for (const [name, value] of Object.entries(options.computedProperties??{})) {
				if (value.type == ComputedPropertyType.GEOGRAPHIC_DISTANCE) {
					const computedProperty = value as ComputedProperty<ComputedPropertyType.GEOGRAPHIC_DISTANCE>
					const {pointA, pointB} = computedProperty.data;

					this.addPropertyJoins(
						[pointA.lat, pointA.lon, pointB.lat, pointB.lon].filter(v => typeof v == "string") as string[], 
						builder, joins, valueType, collectedTableTypes
					)
					
					select.push(
						`ST_Distance_Sphere(point(${
							typeof pointA.lon == "string" ? this.formatProperty(pointA.lon) : pointA.lon
						},${
							typeof pointA.lat == "string" ? this.formatProperty(pointA.lat) : pointA.lat
						}), point(${
							typeof pointB.lon == "string" ? this.formatProperty(pointB.lon) : pointB.lon
						},${
							typeof pointB.lat == "string" ? this.formatProperty(pointB.lat) : pointB.lat
						})) as ${name}`
					)
				}
				else if (value.type == ComputedPropertyType.SUM) {
					const computedProperty = value as ComputedProperty<ComputedPropertyType.SUM>
					this.addPropertyJoins(
						computedProperty.data.filter(v => typeof v == "string") as string[], 
						builder, joins, valueType, collectedTableTypes
					)
					select.push(`SUM(${computedProperty.data.map(p => {
						if (typeof p == "string") return this.formatProperty(p)
						else return p
					})}) as ${name}`)
				}
				else {
					throw new Error("Unsupported computed property type " + value.type)
				}
			}
			builder.select(...select);
			joins.forEach(join => builder.join(join));

			const outerBuilder = new Query()
				.select(options.returnRaw ? `*` :`DISTINCT ${this.supportsSQLCalcFoundRows?'SQL_CALC_FOUND_ROWS ' : 'COUNT(*) OVER () AS foundRows, '}${this.#pointerMysqlColumnName} as ${this.#pointerMysqlColumnName}` + (
					options.returnKeys ? `, ${this.#metaTables.items.name}.key as map_key` : ''
				))
				.table('__placeholder__');

			// TODO: does not work for all cases, only a workaround for now
			this.appendBuilderConditions(outerBuilder, options, where)

			// nested select
			query = outerBuilder.build().replace('`__placeholder__`', `(${builder.build()}) as _inner_res`)
		}

		// no computed properties
		else {
			builder.select(`DISTINCT ${this.supportsSQLCalcFoundRows?'SQL_CALC_FOUND_ROWS ' : 'COUNT(*) OVER () AS foundRows, '}\`${this.#typeToTableName(valueType)}\`.${this.#pointerMysqlColumnName} as ${this.#pointerMysqlColumnName}` + (
				options.returnKeys ? `, ${this.#metaTables.items.name}.key as map_key` : ''
			));
			this.appendBuilderConditions(builder, options, where)
			joins.forEach(join => builder.join(join));
			query = builder.build();
		}

		// make sure all tables are created
		for (const type of collectedTableTypes) {
			await this.#getTableForType(type)
		}

		const queryResult = await this.#query<{_ptr_id:string, map_key: string}>(query);

		const ptrIds = options.returnKeys ? queryResult.map(({map_key}) => map_key.split(".")[1].slice(1)) : queryResult.map(({_ptr_id}) => _ptr_id)
		const limitedPtrIds = options.returnPointerIds ? 
			// offset and limit manually after query
			ptrIds.slice(options.offset ?? 0, options.limit ? (options.offset ?? 0) + options.limit : undefined) : 
			// use ptrIds returned from query (already limited)
			ptrIds	

		let foundRows = -1;

		if (options?.returnAdvanced) {
			if (this.supportsSQLCalcFoundRows) {
				const res = await this.#queryFirst<{foundRows: number}>("SELECT FOUND_ROWS() as foundRows");
				if (res?.foundRows != undefined) foundRows = res.foundRows;
			}
			else {
				foundRows = (queryResult[0] as any)?.foundRows ?? 0;
			}
		}

		// remember pointer table
		for (const ptrId of ptrIds) {
			this.#pointerTables.set(ptrId, rootTableName)
		}

		const loadStart = Date.now();

		const result = options.returnRaw ? null : new Set((await Promise.all(limitedPtrIds
			.filter(ptrId => {
				if (!ptrId) logger.warn("Empty pointer id found in match query");
				else return ptrId;
			})
			.map(ptrId => Pointer.load(ptrId))))
			.filter(ptr => {
				if (ptr instanceof LazyPointer) {
					logger.warn("Cannot return lazy pointer from match query (" + ptr.id + ")");
					return false;
				}
				return true;
			})
			.map(ptr => (ptr as Pointer).val as T))

		logger.debug("load time", (Date.now() - loadStart) + "ms")
		logger.debug("total query time", (Date.now() - start) + "ms")

		const matches = options.returnRaw ? 
			await Promise.all(queryResult.map(async entry => (this.mergeNestedObjects(await Promise.all(Object.entries(entry).map(
				([key, value]) => this.collapseNestedObjectEntry(key, value, rootTableName)
			)))))) :
			result;

		if (options?.returnAdvanced) {
			return {
				matches: matches,
				total: foundRows,
				...options?.returnPointerIds ? {pointerIds: new Set(ptrIds)} : {}
			} as MatchResult<T, Options>;
		}
		else {
			return matches as MatchResult<T, Options>;
		}
	}

	private mergeNestedObjects(insertObjects: Record<string, any>[], existingObject:Record<string, any> = {}): Record<string, any> {
		for (const insertObject of insertObjects) {
			for (const [key, value] of Object.entries(insertObject)) {
				if (key in existingObject && typeof value == "object" && value !== null) {
					this.mergeNestedObjects([value], existingObject[key])
				}
				else existingObject[key] = value;
			}
		}
		return existingObject;
	}

	private async collapseNestedObjectEntry(key: string, value: unknown, tableName: string): Promise<{[key: string]: unknown}> {
		const tableDefinition = await this.#getTableColumns(tableName);
		if (key.includes("__")) {
			const [firstKey, ...rest] = key.split("__");
			const subTable = tableDefinition?.get(firstKey)?.foreignTable;
			if (!subTable) throw new Error("No foreign table found for key " + firstKey);
			return {[firstKey]: await this.collapseNestedObjectEntry(rest.join("__"), value, subTable)}
		}
		else {
			// buffer
			if (tableDefinition?.get(key)?.type == "blob" && typeof value == "string") {
				value = await Runtime.decodeValue(this.#stringToBinary(value))
			}

			return {[key]: value}
		}
	}

	private addPropertyJoins(properties: string[], builder: Query, joins: Map<string, Join>, valueType: Type, collectedTableTypes: Set<Type>) {
		const mockObject = {}
		for (const property of properties) {
			let object:Record<string,any> = mockObject;
			let lastParent:Record<string,any> = mockObject;
			let lastProperty: string|undefined
			for (const part of property.split(".")) {
				if (!object[part]) object[part] = {};
				lastParent = object;
				lastProperty = part;
				object = object[part];
			}
			if (lastParent && lastProperty!=undefined) lastParent[lastProperty] = null;
		}
		// get correct joins
		this.buildQueryConditions(builder, mockObject, joins, collectedTableTypes, new Set<string>(), valueType)
	}

	private appendBuilderConditions(builder: Query, options: MatchOptions, where?: Where) {
		// limit, do limit later if options.returnPointerIds
		if (options && (options.limit !== undefined && isFinite(options.limit) && !options.returnPointerIds)) {
			builder.limit(options.offset ?? 0, options.limit)
		}
		// sort
		if (options.sortBy) {
			builder.order(Order.by(this.formatProperty(options.sortBy))[options.sortDesc ? "desc" : "asc"])
		}
		if (where) builder.where(where);
	}

	/**
	 * replace all .s with __s, except the last one
	 */
	private formatProperty(prop: string) {
		// 
		return prop.replace(/\.(?=.*[.].*)/g, '__')
	}

	/**
	 * replace last __ with .
	 */
	private getTableProperty(prop: string) {
		return prop.replace(/__(?!.*__.*)/, '.')
	}

	private buildQueryConditions(builder: Query, match: unknown, joins: Map<string, Join>, collectedTableTypes:Set<Type>, collectedIdentifiers:Set<string>, valueType:Type, namespacedKey?: string, previousKey?: string, computedProperties?: Record<string, ComputedProperty<Datex.ComputedPropertyType>>, isRoot = false): Where|undefined {

		const matchOrs = match instanceof Array ? match : [match]
		// entry identifier for nested props: address.street
		// entry identifier for root table: person.name
		// entry identifier for computed properties: computedProperty
		let entryIdentifier = (previousKey && !(computedProperties && namespacedKey && namespacedKey in computedProperties)) ? previousKey + '.' + namespacedKey : namespacedKey
		const underscoreIdentifier = entryIdentifier?.replaceAll(".", "__")

		let where: Where|undefined;
		let insertedConditionForIdentifier = true; // only set to false if recursing
		let isPrimitiveArray = true;

		for (const or of matchOrs) {
			if (typeof or == "object" || or === null || or instanceof Date) {
				isPrimitiveArray = false;
				break;
			}
		}

		const rememberEntryIdentifier = computedProperties && entryIdentifier && !(entryIdentifier in computedProperties);
		
		// rename entry identifier
		if (rememberEntryIdentifier && entryIdentifier) {
			entryIdentifier = underscoreIdentifier
		}

		// only primitive array, use IN selector
		if (isPrimitiveArray) {
			if (!namespacedKey) throw new Error("missing namespacedKey");
			if (matchOrs.length == 1) where = Where.eq(entryIdentifier!, matchOrs[0])
			else if (matchOrs.length) where = Where.in(entryIdentifier!, matchOrs)
			else where = Where.expr("false")
		}

		else {
			const wheresOr = []
			for (const or of matchOrs) {

				// regex
				if (or instanceof RegExp) {
					if (!namespacedKey) throw new Error("missing namespacedKey");
					wheresOr.push(Where.expr(`${entryIdentifier!} REGEXP ?`, or.source))
				}

				// match condition
				else if (or instanceof MatchCondition) {
					if (!namespacedKey) throw new Error("missing namespacedKey");

					if (or.type == MatchConditionType.BETWEEN) {
						const condition = or as MatchCondition<MatchConditionType.BETWEEN, unknown>
						wheresOr.push(Where.between(entryIdentifier!, condition.data[0], condition.data[1]))
					}
					else if (or.type == MatchConditionType.GREATER_THAN) {
						const condition = or as MatchCondition<MatchConditionType.GREATER_THAN, unknown>
						wheresOr.push(Where.gt(entryIdentifier!, condition.data))
					}
					else if (or.type == MatchConditionType.LESS_THAN) {
						const condition = or as MatchCondition<MatchConditionType.LESS_THAN, unknown>
						wheresOr.push(Where.lt(entryIdentifier!, condition.data))
					}
					else if (or.type == MatchConditionType.GREATER_OR_EQUAL) {
						const condition = or as MatchCondition<MatchConditionType.GREATER_OR_EQUAL, unknown>
						wheresOr.push(Where.gte(entryIdentifier!, condition.data))
					}
					else if (or.type == MatchConditionType.LESS_OR_EQUAL) {
						const condition = or as MatchCondition<MatchConditionType.LESS_OR_EQUAL, unknown>
						wheresOr.push(Where.lte(entryIdentifier!, condition.data))
					}
					else if (or.type == MatchConditionType.NOT_EQUAL) {
						const condition = or as MatchCondition<MatchConditionType.NOT_EQUAL, unknown>
						wheresOr.push(Where.ne(entryIdentifier!, condition.data))
					}
					else if (or.type == MatchConditionType.CONTAINS) {
						insertedConditionForIdentifier = false;
						const condition = or as MatchCondition<MatchConditionType.CONTAINS, unknown[]>
						const propertyType = valueType.template[namespacedKey];
						const tableAName = this.#typeToTableName(valueType) + '.' + namespacedKey // User.address
						
						if (propertyType.base_type == Type.std.Set) {
							joins.set(
								namespacedKey, 
								Join
									.left(`${this.#metaTables.sets.name}`, namespacedKey)
									.on(`${namespacedKey}.${this.#pointerMysqlColumnName}`, tableAName)
							);
							const values = [...condition.data]
							// group values by type
							const valuesByType = Map.groupBy(values, v => 
									v instanceof Date ? 
										"time" : 
									Pointer.getByValue(v) ? "value_pointer" :
										typeof v
								);
							
							for (const [type, vals] of valuesByType) {

								for (let i=0;i<vals.length;i++) {
									if (Pointer.getByValue(vals[i])) vals[i] = Pointer.getByValue(vals[i])!.id
								}

								const columnName = {
									string: "value_text",
									number: "value_decimal",
									bigint: "value_integer",
									boolean: "value_boolean",
									function: "value_dxb",
									time: "value_time",
									object: "value_dxb",
									symbol: "value_dxb",
									value_pointer: "value_pointer",
									undefined: "value_dxb",
								}[type];

								if (columnName) {
									const identifier = rememberEntryIdentifier ? `${namespacedKey}__${columnName}` : `${namespacedKey}.${columnName}`
									if (rememberEntryIdentifier) collectedIdentifiers.add(identifier)

									// no match
									if (vals.length == 0) wheresOr.push(Where.expr("false"))
									// equals
									else if (vals.length == 1) wheresOr.push(Where.eq(identifier, vals[0]))
									// in
									else wheresOr.push(Where.in(identifier, vals))
								}
								else {
									throw new Error("Unsupported type for MatchConditionType.CONTAINS: " + type);
								}
							}
							
						}

						else if (propertyType.base_type == Type.std.StorageSet) {
							// CONTAINS for storage sets currently only supports pointer id matching
							const values = [...condition.data];
							const ptrIds = values.map(v => Pointer.getId(v));
							if (ptrIds.some(v => !v)) throw new Error("Cannot match non-pointer value in CONTAINS for <StorageSet>");

							const join = Join
								.left(`${this.#metaTables.items.name}`, namespacedKey)
							join.value += replaceParams(` ON ?? LIKE CONCAT('dxset::$', ??, '.%')`, [`${namespacedKey}.key`, tableAName]);

							joins.set(namespacedKey, join);

							for (const ptrId of ptrIds) {
								wheresOr.push(Where.eq(`${namespacedKey}.${this.#pointerMysqlColumnName}`, ptrId))
							}

						}
						else throw new Error("MatchConditionType.CONTAINS is not supported for type " + propertyType.base_type);
					}
					else if (or.type == MatchConditionType.POINTER_ID) {
						const condition = or as MatchCondition<MatchConditionType.POINTER_ID, string>
						const column = isRoot && entryIdentifier == namespacedKey ? this.#pointerMysqlColumnName : entryIdentifier!;
						// no match
						if (condition.data.length == 0) wheresOr.push(Where.expr("false"))
						else if (condition.data.length == 1) wheresOr.push(Where.eq(column, condition.data[0]))
						else wheresOr.push(Where.in(column, condition.data))
					}
					else {
						throw new Error("Unsupported match condition type " + or.type)
					}
				}

				else if (typeof or == "object" && !(or == null || or instanceof Date)) {

					// is pointer
					const ptr = Pointer.pointerifyValue(or);
					if (ptr instanceof Pointer) {
						if (!namespacedKey) throw new Error("missing namespacedKey");
						if (isRoot && entryIdentifier == namespacedKey) wheresOr.push(Where.eq(this.#pointerMysqlColumnName, ptr.id))
						else wheresOr.push(Where.eq(entryIdentifier!, ptr.id))
					}
	
					else {
						insertedConditionForIdentifier = false;

						// only enter after first recursion
						if (namespacedKey && !isRoot) {

							const propertyType = valueType.template[namespacedKey];
							if (!propertyType) throw new Error("Property '" + namespacedKey + "' does not exist in type " + valueType);
							if (propertyType.is_primitive) throw new Error("Tried to match primitive type " + propertyType + " against an object (" + entryIdentifier?.replaceAll("__",".")??namespacedKey + ")")
		
							collectedTableTypes.add(valueType);
							collectedTableTypes.add(propertyType);

							const tableAName = rememberEntryIdentifier ? this.getTableProperty(entryIdentifier!) : entryIdentifier!// this.#typeToTableName(valueType) + '.' + namespacedKey // User.address
							const tableBName = this.#typeToTableName(propertyType); // Address
							const tableBIdentifier = underscoreIdentifier + '.' + this.#pointerMysqlColumnName
							// Join Adddreess on address._ptr_id = User.address
							joins.set(
								underscoreIdentifier!, 
								Join
									.left(`${tableBName}`, underscoreIdentifier)
									.on(tableBIdentifier, tableAName)
							);
							valueType = valueType.template[namespacedKey];
						}

						const whereAnds:Where[] = []
						for (const [key, value] of Object.entries(or)) {
							
							// make sure the key exists in the type
							if (!valueType.template[key] && !(computedProperties && key in computedProperties)) throw new Error("Property '" + key + "' does not exist in type " + valueType);

							const condition = this.buildQueryConditions(builder, value, joins, collectedTableTypes, collectedIdentifiers, valueType, key, underscoreIdentifier, computedProperties);
							if (condition) whereAnds.push(condition)
						}
						if (whereAnds.length > 1) wheresOr.push(Where.and(...whereAnds))
						else if (whereAnds.length) wheresOr.push(whereAnds[0])
					}				
				}
				else {
					if (!namespacedKey) throw new Error("missing namespacedKey");
					wheresOr.push(Where.eq(entryIdentifier!, or))
				}
			}
			if (wheresOr.length) where = Where.or(...wheresOr)
		}


		if (rememberEntryIdentifier && insertedConditionForIdentifier && entryIdentifier) {
			collectedIdentifiers.add(entryIdentifier);
		}

		return where;

	}


	async setItem(key: string, value: unknown) {
		const dependencies = new Set<Pointer>()

		// value is pointer
		const ptr = Pointer.pointerifyValue(value);
		if (ptr instanceof Pointer) {
			dependencies.add(ptr);
			await this.#setItemPointer(key, ptr)
		}
		// value is primitive
		else if (typeof value == "string" || typeof value == "number" || typeof value == "bigint" || typeof value == "boolean" || value instanceof Date) {
			await this.setItemValuePrimitive(key, value);
		}
		else {
			const encoded = Compiler.encodeValue(value, dependencies);
			await this.setItemValueDXB(key, encoded)
		}
		return dependencies;
	}
	getItem(key: string, conditions: ExecConditions): Promise<unknown> {
		return this.getItemValue(key, conditions);
	}

	async hasItem(key:string) {
		if (this.#existingItemsCache.has(key)) return true;
		const count = (await this.#queryFirst<{COUNT: number}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("COUNT(*) as COUNT")
				.where(Where.eq("key", key))
				.build(),
			undefined
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

		const keys = await this.#query<{key:string}>(builder.build(), [], false, ['key'])
		return function*(){
			for (const {key} of keys) {
				yield key;
			} 
		}()
	}

	async getItemKey(value: unknown) {
		
		// value is pointer
		const ptrId = Pointer.getId(value);
		if (ptrId) {
			const key = await this.#queryFirst<{key:string}>(
				new Query()
					.table(this.#metaTables.items.name)
					.select("key")
					.where(Where.eq(this.#pointerMysqlColumnName, ptrId))
					.build(),
				undefined, ['key']
			);
			return key?.key;
		}
		else {
			const encoded = Compiler.encodeValue(value, undefined, true, false, true);
			const key = await this.#queryFirst<{key:string}>(
				new Query()
					.table(this.#metaTables.items.name)
					.select("key")
					.where(Where.eq("value", encoded))
					.build(),
				undefined, ['key']
			);
			return key?.key;
		
		}
	}

	async getPointerIds() {
		const pointerIds = await this.#query<{ptrId:string}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select(`${this.#pointerMysqlColumnName} as ptrId`)
				.build(),
			undefined, false, ['ptrId']
		)
		return function*(){
			for (const {ptrId} of pointerIds) {
				yield ptrId;
			} 
		}()
	}

	async removeItem(key: string): Promise<void> {
		this.#existingItemsCache.delete(key)
		//await this.#query('DELETE FROM ?? WHERE ??=?;', [this.#metaTables.items.name, "key", key])
		await this.#query(`DELETE FROM \`${this.#metaTables.items.name}\` WHERE \`key\`=?;`, [key])
	}
	async getItemValueDXB(key: string): Promise<ArrayBuffer|null> {
		const encoded = (await this.#queryFirst<{value: string, ptrId: string}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("value", `${this.#pointerMysqlColumnName} as ptrId`)
				.where(Where.eq("key", key))
				.build(),
			undefined
		));
		if (encoded?.ptrId) return Compiler.compile(`$${encoded.ptrId}`, undefined, {sign: false, encrypt: false, to: Datex.Runtime.endpoint, preemptive_pointer_init: false}, false) as Promise<ArrayBuffer>;
		else if (encoded?.value) return this.#stringToBinary(encoded.value);
		else return null;
	}

	async getItemValue(key: string, conditions?: ExecConditions): Promise<unknown> {
		const result = (await this.#queryFirst<{value: string, value_text: string, value_integer: number, value_decimal: number, value_boolean: boolean, value_time: Date, ptrId: string}>(
			new Query()
				.table(this.#metaTables.items.name)
				.select("value", "value_text", "value_integer", "value_decimal", "value_boolean", "value_time", "value_pointer", `${this.#pointerMysqlColumnName} as ptrId`)
				.where(Where.eq("key", key))
				.build(),
			undefined
		));
		if (result?.ptrId || result?.value) {
			const dxb = result.ptrId ?
				await (Compiler.compile(`$${result.ptrId}`, undefined, {sign: false, encrypt: false, to: Datex.Runtime.endpoint, preemptive_pointer_init: false}, false) as Promise<ArrayBuffer>) :
				this.#stringToBinary(result.value);
			return Runtime.decodeValue(dxb, false, conditions);
		} 
		else if (result?.value_text) return result.value_text
		else if (result?.value_integer) return BigInt(result.value_integer);
		else if (result?.value_decimal) return result.value_decimal;
		else if (result?.value_boolean) return Boolean(result.value_boolean);
		else if (result?.value_time) return result.value_time;
		else return NOT_EXISTING;
	}

	async setItemValueDXB(key: string, value: ArrayBuffer) {
		if (this.supportsInsertOrReplace) {
			await this.#query(`INSERT OR REPLACE INTO \`${this.#metaTables.items.name}\` (\`key\`, \`value\`) VALUES (?, ?);`, [key, value])
		}
		else {
			await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.items.name, ["key", "value"], [key, value], value])
		}
	}

	async setItemValuePrimitive(key: string, value: string|number|bigint|boolean|Date) {
		if (this.supportsInsertOrReplace) {
			const columnName = "value_" + (
				typeof value == "string" ? "text" :
				typeof value == "number" ? "decimal" :
				typeof value == "bigint" ? "integer" :
				typeof value == "boolean" ? "boolean" :
				value instanceof Date ? "time" : "text"
			)
			await this.#query(`INSERT OR REPLACE INTO \`${this.#metaTables.items.name}\` (\`key\`, \`value\`) VALUES (?, ?);`, [key, value])
		}
		else {
			await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [this.#metaTables.items.name, ["key", "value"], [key, value], value])
		}
	}

	async setPointer(pointer: Pointer<any>, partialUpdateKey: unknown|typeof NOT_EXISTING): Promise<Set<Pointer<any>>> {

		// is templatable pointer type
		if (pointer.type.template) {
			// this.log?.("update " + pointer.id + " - " + pointer.type, partialUpdateKey, await this.#pointerEntryExists(pointer))

			// new full insert
			if (partialUpdateKey === NOT_EXISTING || !await this.hasPointer(pointer.id)) {
				return this.#insertTemplatedPointer(pointer)
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
				await this.#updatePointer(pointer, [partialUpdateKey], dependencies)
				return dependencies;
			}
		}

		// is set, store in set table
		else if (pointer.type == Type.std.Set) {
			return this.#setPointerSet(pointer)
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
			console.warn("No table found for pointer " + pointerId);
			return NOT_EXISTING;
		}

		// is raw pointer
		if (table == this.#metaTables.rawPointers.name) {
			const value = (await this.#queryFirst<{value: string}>(
				new Query()
					.table(this.#metaTables.rawPointers.name)
					.select("value")
					.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
					.build(),
				undefined, ['value']
			))?.value;
			if (value) this.#existingPointersCache.add(pointerId);
			return value ? Runtime.decodeValue(this.#stringToBinary(value), outer_serialized) : NOT_EXISTING;
		}

		// is set pointer
		else if (table == this.#metaTables.sets.name) {
			const values = await this.#query<{value_text:string, value_integer:number, value_decimal:number, value_boolean:boolean, value_time:Date, value_pointer:string, value_dxb:string}>(
				new Query()
					.table(this.#metaTables.sets.name)
					.select("value_text", "value_integer", "value_decimal", "value_boolean", "value_time", "value_pointer", "value_dxb")
					.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
					.where(Where.ne("hash", ""))
					.build(),
				undefined, false, ['value_text', 'value_integer', 'value_decimal', 'value_boolean', 'value_time', 'value_pointer', 'value_dxb']
			)

			const result = new Set()
			for (const {value_text, value_integer, value_decimal, value_boolean, value_time, value_pointer, value_dxb} of values) {
				if (value_text != undefined) result.add(value_text)
				else if (value_integer != undefined) result.add(BigInt(value_integer))
				else if (value_decimal != undefined) result.add(value_decimal)
				else if (value_boolean != undefined) result.add(Boolean(value_boolean))
				else if (value_time != undefined) result.add(value_time)
				else if (value_pointer != undefined) result.add(await Pointer.load(value_pointer))
				else if (value_dxb != undefined) result.add(await Runtime.decodeValue(this.#stringToBinary(value_dxb)))
			}
			this.#existingPointersCache.add(pointerId);
			return result;
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

			await Promise.all(
				[...columns.entries()]
					.map(([colName, {foreignPtr, foreignTable, type}]) => this.assignPointerProperty(object, colName, type, foreignPtr, foreignTable))
			)

			this.#existingPointersCache.add(pointerId);
			return type.cast(object, undefined, undefined, false, undefined, undefined, true);
		}
	}

	private async assignPointerProperty(object:Record<string,unknown>, colName:string, type:string, foreignPtr:boolean, foreignTable?:string) {

		// custom conversions:
		// convert blob strings to ArrayBuffer
		if (type == "blob" && typeof object[colName] == "string") {
			object[colName] = this.#stringToBinary(object[colName] as string)
		}
		// convert Date ot Time
		else if (object[colName] instanceof Date || type == "datetime") {
			object[colName] = new Time(object[colName] as Date)
		}

		// convert to boolean
		else if (typeof object[colName] == "number" && (type == "tinyint" || type == "boolean")) {
			object[colName] = Boolean(object[colName])
		}

		// is an object type with a template
		if (foreignPtr) {
			if (typeof object[colName] == "string") {
				const ptrId = object[colName] as string;
				if (foreignTable) this.#pointerTables.set(ptrId, foreignTable)
				object[colName] = await Pointer.load(ptrId);
			}
			// else property is null/undefined
		}
		// is blob, assume it is a DXB value
		else if (type == "blob") {
			object[colName] = await Runtime.decodeValue(object[colName] as ArrayBuffer, true);
		}
	}

	

	async removePointer(pointerId: string): Promise<void> {
		this.#existingPointersCache.delete(pointerId)
		// get table where pointer is stored
		const table = await this.#getPointerTable(pointerId);
		if (table) {
			//await this.#query('DELETE FROM ?? WHERE ??=?;', [table, this.#pointerMysqlColumnName, pointerId])
			await this.#query(`DELETE FROM \`${table}\` WHERE \`${this.#pointerMysqlColumnName}\`=?;`, [pointerId])
		}
		// delete from pointer mapping
		//await this.#query('DELETE FROM ?? WHERE ??=?;', [this.#metaTables.pointerMapping.name, this.#pointerMysqlColumnName, pointerId])
		await this.#query(`DELETE FROM \`${this.#metaTables.pointerMapping.name}\` WHERE \`${this.#pointerMysqlColumnName}\`=?;`, [pointerId])
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
					.build(),
				undefined, ['value']
			))?.value;
			return value ? this.#stringToBinary(value) : null;
		}

		// is set pointer
		else if (table == this.#metaTables.sets.name) {
			const values = await this.#query<{value_text:string, value_integer:number, value_decimal:number, value_boolean:boolean, value_time:Date, value_pointer:string, value_dxb:string}>(
				new Query()
					.table(this.#metaTables.sets.name)
					.select("value_text", "value_integer", "value_decimal", "value_boolean", "value_time", "value_pointer", "value_dxb")
					.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
					.where(Where.ne("hash", ""))
					.build(),
				undefined, false, ['value_text', 'value_integer', 'value_decimal', 'value_boolean', 'value_time', 'value_pointer', 'value_dxb']
			)
			let setString = `<Set> [`
			const setEntries:string[] = []

			for (const {value_text, value_integer, value_decimal, value_boolean, value_time, value_pointer, value_dxb} of values) {
				if (value_text != undefined) setEntries.push(Runtime.valueToDatexStringExperimental(value_text))
				else if (value_integer != undefined) setEntries.push(Runtime.valueToDatexStringExperimental(value_integer))
				else if (value_decimal != undefined) setEntries.push(Runtime.valueToDatexStringExperimental(value_decimal))
				else if (value_boolean != undefined) setEntries.push(Runtime.valueToDatexStringExperimental(value_boolean))
				else if (value_time != undefined) setEntries.push(Runtime.valueToDatexStringExperimental(value_time))
				else if (value_pointer != undefined) setEntries.push(Runtime.valueToDatexStringExperimental(await Pointer.load(value_pointer)))
				else if (value_dxb != undefined) setEntries.push(MessageLogger.decompile(this.#stringToBinary(value_dxb), false, false, false))
			}
			setString += setEntries.join(",") + "]"
			return Compiler.compile(setString, [], {sign: false, encrypt: false, to: Datex.Runtime.endpoint, preemptive_pointer_init: false}, false) as ArrayBuffer;
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
			await this.#setPointerInRawTable(pointerId, value);
		}
		else {
			logger.error("Setting raw dxb value for templated pointer is not yet supported in SQL storage (pointer: " + pointerId + ", table: " + table + ")");
		}
	}

	async #setPointerInRawTable(pointerId: string, encoded: ArrayBuffer) {
		const table = this.#metaTables.rawPointers.name;
		const {result} = 
			this.supportsInsertOrReplace ?
				await this.#query(`INSERT OR REPLACE INTO \`${table}\` (\`${this.#pointerMysqlColumnName}\`, \`value\`) VALUES (?, ?);`, [pointerId, encoded], true) :
				await this.#query('INSERT INTO ?? ?? VALUES ? ON DUPLICATE KEY UPDATE value=?;', [table, [this.#pointerMysqlColumnName, "value"], [pointerId, encoded], encoded], true)
		// is newly inserted, add to pointer mapping
		if (!('affectedRows' in result) && this.affectedRowsQuery) {
			// query affected rows
			const {affectedRows} = await this.#queryFirst<{affectedRows:number}>(this.affectedRowsQuery, undefined, ['affectedRows']) ?? {};
			result.affectedRows = affectedRows;
		}
		if (result.affectedRows == 1) await this.#updatePointerMapping(pointerId, table)
	}

	async hasPointer(pointerId: string): Promise<boolean> {
		if (this.#existingPointersCache.has(pointerId)) return true;
		const count = (await this.#queryFirst<{COUNT: number}>(
			new Query()
				.table(this.#metaTables.pointerMapping.name)
				.select("COUNT(*) as COUNT")
				.where(Where.eq(this.#pointerMysqlColumnName, pointerId))
				.build(),
			undefined, ['COUNT']
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