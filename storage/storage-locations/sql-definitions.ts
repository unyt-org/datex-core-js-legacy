import type { Datex } from "../../mod.ts";

export type Class = (new (...args: any[]) => any); // type for a JS class

export enum PropertyMappingType {
    reverse_pointer_collection_ref, // n children references
    pointer_ref, // 1 reference to another object
    pointer_ref_extend // 1 reference to another object, extend the object
}
export type transform_property_config = {
    mapping_type: PropertyMappingType,

    key?: string,  // property key of the object
    column?: string, // table column

    table?: string, // table where mapped entries come from
    ref_column?: string,  // column in this table that references the ptr_id of the parent object
    collection_type?: Datex.Type // store transactions in Array/Set/...

    generate?: ()=>{ // TODO

    }
}

export type table_type_options = {
    sync?: boolean, // sync entries for this table per default (default = true)
    listen_for_external_updates?: boolean, // update synced entry objects when the database row is updated by an external party (default = true)
    bind_pointer_ids?: boolean, // add a new column to the table to store a pointer id for each row (default = false)
    name?: string, // custom name for the type

    transform_properties?: transform_property_config[]
}

export type table_raw_datex_options = {
    sync?: boolean, // sync entry (default = true)
    datex_column_name: string
    datex_format?:'text'|'base64'|'binary',
    listen_for_external_updates?: boolean, // update synced entry objects when the database row is updated by an external party (default = true)
    bind_pointer_ids?: boolean, // add a new column to the table to store a pointer id for each row (default = false)
}

export type table_entry_options = {
    sync?: boolean, // sync entry (default = true)
}

type _mysql_data_type = 'int'|'bigint'|'smallint'|'mediumint'|'tinyint'|'tiny'|'long'|'year'|'longlong'|
                       'float'|'double'|'decimal'|
                       'timestamp'|'date'|'datetime'|
                       'time'|'varchar'|'char'|'text'|'tinytext'|'mediumtext'|'longtext'|'enum'|
                       'set'|'geometry'|
                       'tinyblob'|'BLOB'|'mediumblob'|'longblob'|'binary'|'varbinary'|'bit'|
                       'boolean'|'json';

export type mysql_data_type = _mysql_data_type | `${_mysql_data_type}(${number})`;
export type mysql_data_type_caps = `${Uppercase<mysql_data_type>}`

export type mysql_type_field = {
    name: string,
    db: string,
    table: string,
    type: mysql_data_type_caps,
    length: number,
    string: ()=>string,
    buffer: ()=>ArrayBuffer,
    geometry: ()=>any
}

export type mysql_column = {
    TABLE_CATALOG: string,
    TABLE_SCHEMA: string,
    TABLE_NAME: string,
    COLUMN_NAME: string,
    ORDINAL_POSITION: bigint,
    COLUMN_DEFAULT: any,
    IS_NULLABLE: 'NO'|'YES',
    DATA_TYPE: mysql_data_type,
    CHARACTER_MAXIMUM_LENGTH: bigint,
    CHARACTER_OCTET_LENGTH: bigint,
    NUMERIC_PRECISION: bigint,
    NUMERIC_SCALE: bigint,
    DATETIME_PRECISION: bigint,
    CHARACTER_SET_NAME: string,
    COLLATION_NAME: string,
    COLUMN_TYPE: mysql_data_type|`${mysql_data_type}(${number})`,
    COLUMN_KEY: 'PRI'|'',
    EXTRA: string,
    PRIVILEGES: string,
    COLUMN_COMMENT: string,
    GENERATION_EXPRESSION: string,
    SRS_ID: any
}

export type ColumnDefinition = [
    name: string, 
    datatype: mysql_data_type|`${mysql_data_type}(${number})`|`${mysql_data_type}(${number},${number})`,
    options?:string
]

export type ConstraintsDefinition = `FOREIGN KEY ${string}`


export type TableDefinition = {
	name: string,
    columns: ColumnDefinition[],
    constraints?: ConstraintsDefinition[]
}