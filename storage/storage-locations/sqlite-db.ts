import { ExecuteResult } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { SQLDBStorageLocation } from "./sql-db.ts";

import { Database } from "jsr:@db/sqlite@0.11";


import { logger } from "../../datex_all.ts";
import { ptr_cache_path } from "../../runtime/cache_path.ts";

export class SqliteStorageLocation extends SQLDBStorageLocation<{db: string}> {

    name = "SQLITE_DB"
    useSingleQuotes = true
    supportsInsertOrReplace = true
    supportsBinaryIO = true
    supportsSQLCalcFoundRows = false

    affectedRowsQuery = "SELECT changes() as affectedRows"

    #db?: Database

    protected connect() {
        this.#db = new Database(new URL(this.options.db + ".db", ptr_cache_path));
        logger.info("Using SQLite database " + this.options.db + " as storage location")
        return true;
    }

    protected executeQuery(query_string: string, query_params?: any[]): ExecuteResult {
        // TODO: optimize, don't prepare every time and don't return all rows if not needed
        return {
            rows: this.#db!.prepare(query_string).all(query_params)
        }
    }

    override async clear() {
        // delete sqlite file
        await Deno.remove(new URL(this.options.db + ".db", ptr_cache_path).pathname)
    }


    protected getTableExistsQuery(table: string): string {
        return `SELECT * FROM sqlite_master WHERE type = 'table' AND name = '${table}'`
    }
    protected getTableColumnInfoQuery(tableName: string): string {
        return `PRAGMA table_info('${tableName}')`
    }
    protected getTableConstraintsQuery(tableName: string): string {
        return `PRAGMA foreign_key_list('${tableName}')`
    }
    protected getClearTableQuery(tableName: string): string {
        return `DELETE FROM ${tableName}`
        // TODO: DELETE FROM sqlite_sequence WHERE name='${tableName}'; VACUUM;
    }
}