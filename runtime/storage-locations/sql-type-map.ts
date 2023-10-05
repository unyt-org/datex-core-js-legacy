import { Datex } from "../../datex.ts";
import { mysql_data_type } from "./sql-definitions.ts";

export const mysql_datex_type_map = new Map<mysql_data_type,Datex.Type>([
    ['int', Datex.Type.std.integer],
    ['bigint', Datex.Type.std.integer_64],
    ['smallint', Datex.Type.std.integer_16],
    ['mediumint', Datex.Type.std.integer],
    ['tinyint', Datex.Type.std.integer_8],
    ['tiny', Datex.Type.std.integer],
    ['long', Datex.Type.std.integer],
    ['year', Datex.Type.std.integer],

    ['float', Datex.Type.std.decimal],
    ['double', Datex.Type.std.decimal],
    ['decimal', Datex.Type.std.decimal],

    ['timestamp', Datex.Type.std.time],
    ['date', Datex.Type.std.time],
    ['datetime', Datex.Type.std.time],

    ['time', Datex.Type.std.text],
    ['varchar', Datex.Type.std.text],
    ['char', Datex.Type.std.text],
    ['text', Datex.Type.std.text],
    ['tinytext', Datex.Type.std.text],
    ['mediumtext', Datex.Type.std.text],
    ['longtext', Datex.Type.std.text],
    ['enum', Datex.Type.std.text],
    ['geometry', Datex.Type.std.text],

    ['set', Datex.Type.std.Set],

    ['tinyblob', Datex.Type.std.buffer],
    ['blob', Datex.Type.std.buffer],
    ['mediumblob', Datex.Type.std.buffer],
    ['longblob', Datex.Type.std.buffer],
    ['binary', Datex.Type.std.buffer],
    ['varbinary', Datex.Type.std.buffer],
    ['bit', Datex.Type.std.buffer],

    ['boolean', Datex.Type.std.boolean],
    ['json', Datex.Type.std.Object],
])

export const datex_type_mysql_map = new Map<Datex.Type, mysql_data_type>([
    [Datex.Type.std.integer, 'int'],
    [Datex.Type.std.integer_8, 'tinyint'],
    [Datex.Type.std.integer_16, 'smallint'],
    [Datex.Type.std.integer_32, 'int'],
    [Datex.Type.std.integer_64, 'bigint'],

    [Datex.Type.std.decimal, 'double'],

    [Datex.Type.std.time, 'datetime'],

    [Datex.Type.std.text, 'text'],

    // ['smallint', Datex.Type.std.integer],
    // ['mediumint', Datex.Type.std.integer],
    // ['tinyint', Datex.Type.std.integer],
    // ['tiny', Datex.Type.std.integer],
    // ['long', Datex.Type.std.integer],
    // ['year', Datex.Type.std.integer],

    // ['float', Datex.Type.std.decimal],
    // ['double', Datex.Type.std.decimal],
    // ['decimal', Datex.Type.std.decimal],

    // ['timestamp', Datex.Type.std.time],
    // ['date', Datex.Type.std.time],
    // ['datetime', Datex.Type.std.time],

    // ['time', Datex.Type.std.text],
    // ['varchar', Datex.Type.std.text],
    // ['char', Datex.Type.std.text],
    // ['text', Datex.Type.std.text],
    // ['tinytext', Datex.Type.std.text],
    // ['mediumtext', Datex.Type.std.text],
    // ['longtext', Datex.Type.std.text],
    // ['enum', Datex.Type.std.text],
    // ['geometry', Datex.Type.std.text],

    // ['set', Datex.Type.std.Set],

    // ['tinyblob', Datex.Type.std.buffer],
    // ['blob', Datex.Type.std.buffer],
    // ['mediumblob', Datex.Type.std.buffer],
    // ['longblob', Datex.Type.std.buffer],
    // ['binary', Datex.Type.std.buffer],
    // ['varbinary', Datex.Type.std.buffer],
    // ['bit', Datex.Type.std.buffer],

    // ['boolean', Datex.Type.std.boolean],
    // ['json', Datex.Type.std.Object],
])