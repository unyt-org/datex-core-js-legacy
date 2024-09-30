import { Client, ExecuteResult } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { SQLDBStorageLocation } from "./sql-db.ts";
import { Logger } from "../../utils/logger.ts";
import { Query, Where } from "https://deno.land/x/sql_builder@v1.9.2/mod.ts";

const logger = new Logger("MYSQL_DB Storage");

export type ConnectionOptions = {
    hostname: string
    username: string
    password:string
    port: number
    db: string
}

export class MySQLStorageLocation extends SQLDBStorageLocation<ConnectionOptions> {
    
    name = "MYSQL_DB"
    #sqlClient: Client|undefined

    supportsInvisibleColumns = true
    affectedRowsQuery = undefined
    supportsSQLCalcFoundRows = true

    protected async connect(): Promise<boolean> {
        this.#sqlClient = await new Client().connect({poolSize: 20, ...this.options});
		logger.info("Using SQL database " + this.options.db + " on " + this.options.hostname + ":" + this.options.port + " as storage location")
        return true
    }

    protected executeQuery(query_string: string, query_params?: any[]): Promise<ExecuteResult> {
		return this.#sqlClient!.execute(query_string, query_params);
	}

    // custom queries

    protected getTableExistsQuery(tableName: string): string {
        return new Query()
            .table("information_schema.tables")
            .select("*")
            .where(Where.eq("table_schema", this.options.db))
            .where(Where.eq("table_name", tableName))
            .build()
    }

    protected getTableColumnInfoQuery(tableName: string): string {
        return new Query()
            .table("information_schema.key_column_usage")
            .select("COLUMN_NAME as name", "COLUMN_TYPE as type")
            .where(Where.eq("table_schema", this.options.db))
            .where(Where.eq("table_name", tableName))
            .build()
    }

    protected getTableConstraintsQuery(tableName: string): string {
        return new Query()
            .table("information_schema.key_column_usage")
            .select("COLUMN_NAME as name ", "REFERENCED_TABLE_NAME as ref_table")
            .where(Where.eq("table_schema", this.options.db))
            .where(Where.eq("table_name", tableName))
            .build()
    }

    protected getClearTableQuery(tableName: string): string {
        return `TRUNCATE TABLE ${tableName};`
    }
}