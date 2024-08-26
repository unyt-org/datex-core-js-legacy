import { ProtocolDataType, Endpoint, target_clause, dxb_header } from "../../datex_all.ts";

export type MessageFilter = {
	sid?:number, 
	return_index?: number,
	inc?:number,
	type?:ProtocolDataType,
	version?:number,
	sender?:Endpoint,
	signed?:boolean,
	encrypted?:boolean,
	receiver?: target_clause,
	redirect?: boolean
}
export type MessageStream = {
	direction: 'IN' | 'OUT',
	header: dxb_header,
	socket: {
		uuid: string,
		endpoint?: Endpoint,
		type: string
	}
}
