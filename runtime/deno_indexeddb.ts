// modified version of https://deno.land/x/indexeddb@1.3.5/lib/shim.ts
// --> setting databaseBasePath, not just sysDatabaseBasePath
// deno-lint-ignore-file no-explicit-any

import "https://deno.land/x/indexeddb@1.3.5/lib/indexeddb_global.ts";
import type {
	IDBCursor,
	IDBCursorWithValue,
	IDBDatabase,
	IDBFactory,
	IDBIndex,
	IDBKeyRange,
	IDBObjectStore,
	IDBOpenDBRequest,
	IDBRequest,
	IDBTransaction,
	IDBVersionChangeEvent,
} from "https://deno.land/x/indexeddb@1.3.5/lib/indexeddb.ts";
import "https://cdn.skypack.dev/pin/regenerator-runtime@v0.13.9-4Dxus9nU31cBsHxnWq2H/mode=imports/optimized/regenerator-runtime.js";
import indexeddbshim from "https://cdn.skypack.dev/pin/indexeddbshim@v9.0.0-QVaW8rBIOGlJegwkWTsK/mode=imports/unoptimized/dist/indexeddbshim-noninvasive.js";
import {
	configureSQLiteDB,
	openDatabase,
} from "https://deno.land/x/websql@1.3.2/mod.ts";
  
interface IndexedDBApi {
	IDBCursor: IDBCursor;
	IDBCursorWithValue: IDBCursorWithValue;
	IDBDatabase: IDBDatabase;
	IDBFactory: IDBFactory;
	IDBIndex: IDBIndex;
	IDBKeyRange: IDBKeyRange;
	IDBObjectStore: IDBObjectStore;
	IDBOpenDBRequest: IDBOpenDBRequest;
	IDBRequest: IDBRequest;
	IDBTransaction: IDBTransaction;
	IDBVersionChangeEvent: IDBVersionChangeEvent;
	indexedDB: IDBFactory;
}
  
interface IDBShim extends IndexedDBApi {
	readonly shimIndexedDB: {
	  __useShim: () => void;
	};
}
  
if (Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined) {
	Deno.mkdirSync = (_path: string | URL, _options?: Deno.MkdirOptions | undefined) => {}
}
  
const setGlobalVars = indexeddbshim as (...args: any[]) => IDBShim;
  
function createIndexedDB(
	makeGlobal = false,
	escapeName = true,
	systemPath?: string,
): IndexedDBApi {
	const kludge = makeGlobal ? null : { shimIndexedDB: {} };
	const idb = setGlobalVars(kludge, {
	  avoidAutoShim: !makeGlobal,
	  checkOrigin: false,
	  win: { openDatabase },
	  escapeDatabaseName: escapeName ? undefined : (name: string) => {
		if (name.toLowerCase().endsWith(".sqlite")) return name;
		return name + ".sqlite";
	  },
	  sysDatabaseBasePath: systemPath,
	  databaseBasePath: systemPath
	});
  
	if (!makeGlobal) idb.shimIndexedDB.__useShim();
  
	return {
		IDBCursor: idb.IDBCursor,
		IDBCursorWithValue: idb.IDBCursorWithValue,
		IDBDatabase: idb.IDBDatabase,
		IDBFactory: idb.IDBFactory,
		IDBIndex: idb.IDBIndex,
		IDBKeyRange: idb.IDBKeyRange,
		IDBObjectStore: idb.IDBObjectStore,
		IDBOpenDBRequest: idb.IDBOpenDBRequest,
		IDBRequest: idb.IDBRequest,
		IDBTransaction: idb.IDBTransaction,
		IDBVersionChangeEvent: idb.IDBVersionChangeEvent,
		indexedDB: idb.indexedDB,
	};
}

import { ptr_cache_path } from "./cache_path.ts";

const path = ptr_cache_path.toString().replace("file://","");

configureSQLiteDB({ memory: false });
createIndexedDB(true, true, path);