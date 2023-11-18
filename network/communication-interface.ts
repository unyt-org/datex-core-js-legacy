import { Endpoint } from "../types/addressing.ts";

/**
 * Base class for all DATEX communication interfaces
 */
export abstract class CommunicationInterface {

	abstract name: string
	abstract description?: string

	/**
	 * Can send data
	 */
	abstract canSend: boolean

	/**
	 * Can receive data
	 */
	abstract canReceive: boolean

	/**
	 * Has a connection to the supranet, use as a default interface if possible
	 */
	abstract isGlobal: boolean // 


	/**
	 * Send a DATEX block via this interface
	 * @param datex
	 * @param to 
	 */
	public send(datex:ArrayBuffer, to?: Endpoint) {

	}

}