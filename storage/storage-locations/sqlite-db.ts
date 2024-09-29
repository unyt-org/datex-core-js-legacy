import { ExecuteResult } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { SQLDBStorageLocation } from "./sql-db.ts";
import { DB } from "https://deno.land/x/sqlite/mod.ts";
import { logger } from "../../datex_all.ts";
import { ptr_cache_path } from "../../runtime/cache_path.ts";

export class SqliteStorageLocation extends SQLDBStorageLocation<{db: string}> {

    name = "SQLITE_DB"
    useSingleQuotes = true
    supportsInsertOrReplace = true


    #db?: DB

    protected connect() {
        this.#db = new DB(new URL(this.options.db + ".db", ptr_cache_path).pathname);
        logger.info("Using SQLite database " + this.options.db + " as storage location")
        return true;
    }

    protected executeQuery(query_string: string, query_params?: any[]): ExecuteResult {
        return {
            rows: this.#db!.query(query_string, query_params)
        }
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