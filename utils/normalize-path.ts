export function normalizePath(path: string|URL) {
	path = decodeURIComponent(path instanceof URL ? path.pathname : path);
	if (path.match(/^\/.\:\//)) return path.slice(1)
	return path
}