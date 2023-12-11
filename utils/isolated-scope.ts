import { JSTransferableFunction } from "../types/js-function.ts";

export function isolatedScope(handler:(...args: any[]) => any) {
	return JSTransferableFunction.create(handler);
}