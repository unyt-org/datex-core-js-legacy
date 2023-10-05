export const SQL_QUERY = {
	TABLE_EXISTS: `SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?;`,
	CREATE_TABLE: `CREATE TABLE ?? ?;`
}