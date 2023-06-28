import { Client } from "https://deno.land/x/mysql@v2.10.3/mod.ts";
import { Pointer } from "../../runtime/pointers.ts";
import { AsyncStorageLocation } from "../storage.ts";
import { db_credentials } from "./sql-definitions.ts";

export class SQLDBStorageLocation extends AsyncStorageLocation {
	name = "SQL_DB"

	#connected = false;
	#credentials: db_credentials
    #sql_client: Client|undefined


    constructor(credentials:db_credentials) {
		super()
        this.#credentials = credentials
    }
	async #connect(){
        this.#sql_client = await new Client().connect(this.#credentials);
        this.#connected = true;
    }

	async #query<row=object>(query_string:string, query_params?:any[]): Promise<row[]> {
        if (typeof query_string != "string") {console.error("invalid query:", query_string); throw("invalid query")}
        if (!query_string) throw("empty query");

        try {
            const result = await this.#sql_client!.execute(query_string, query_params);
            return result.rows ?? [];
        } catch (e){
            console.error("SQL error:", e);
            throw e;
        }
    }

    async #queryFirst<row=object>(query_string:string, query_params?:any[]): Promise<row> {
        return (await this.#query<row>(query_string, query_params))?.[0]
    }

	isSupported() {
		return !!globalThis.Deno;
	}

	async setItem(key: string,value: unknown): Promise<boolean> {
		
	}
	async getItem(key: string): Promise<unknown> {
		
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

	async setPointer(pointer: Pointer<any>): Promise<Set<Pointer<any>>> {
		this.#connect()
		console.log("setpointer....",pointer.idString())
		return new Set();
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