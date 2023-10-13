import { Datex, instance } from "../mod.ts";
import { Endpoint } from "../datex_all.ts";
import {endpoint, property} from "../datex_all.ts";
import { Logger } from "../utils/logger.ts";

const logger = new Logger("Blockchain Adapter");

/**
 * Blockchain type definitions
 */

export enum BCEntryType {
	ENDPOINT_REGISTRATION, // register a new endpoint
	ENDPOINT_PROPERTY, // set a endpoint property
	ENDPOINT_DEFAULT, // set the endpoint default value

	POINTER, // save a BC pointer value
	POINTER_PROPERTY // set a property of a BC pointer
}

// index type for blockchain entries (branded number)
export type entry_index<T extends BCEntryType = BCEntryType> = number & { __type: T }

export type property_entry_index = entry_index<BCEntryType.ENDPOINT_PROPERTY|BCEntryType.POINTER_PROPERTY>
export type pointer_entry_index = entry_index<BCEntryType.POINTER>

// used for reverse name resolution
export type TRACABLE_DATA = {
	trace?: property_entry_index
}



export type ENDPOINT_REGISTRATION_DATA = TRACABLE_DATA & {
	endpoint: Endpoint, 
	keys: [verify:ArrayBuffer, encrypt:ArrayBuffer],
} 
export type ENDPOINT_PROPERTY_DATA = {
	key: unknown,
	value: unknown,
	readonly?: boolean,
}
export type ENDPOINT_DEFAULT_DATA = {
	value: unknown,
}

export type POINTER_DATA = TRACABLE_DATA & {
	value: unknown,
	readonly?: boolean
} 
export type POINTER_PROPERTY_DATA = {
	pointer: pointer_entry_index,
	key: unknown,
	value: unknown,
	readonly?: boolean,
}


export type BCData<T extends BCEntryType> = 
	T extends BCEntryType.ENDPOINT_REGISTRATION ? ENDPOINT_REGISTRATION_DATA :(
	T extends BCEntryType.ENDPOINT_PROPERTY     ? ENDPOINT_PROPERTY_DATA     :(
	T extends BCEntryType.ENDPOINT_DEFAULT      ? ENDPOINT_DEFAULT_DATA      :(
	T extends BCEntryType.POINTER               ? POINTER_DATA               :(
	T extends BCEntryType.POINTER_PROPERTY      ? POINTER_PROPERTY_DATA      
	: never))))


@sync export class BCEntry<T extends BCEntryType = BCEntryType> {
	@property declare index: entry_index
	@property declare type:T
	@property declare data:BCData<T>
	@property declare creator?:Endpoint
	@property declare signature?:ArrayBuffer

	public async sign(){
		const data_dx = Datex.Compiler.encodeValue(this.data);
		this.creator = Datex.Runtime.endpoint;
		this.signature = await Datex.Crypto.sign(data_dx);
	}
}


/**
 * Blockchain interface
 */

@endpoint('@+unyt') export class Blockchain {

	/**
	 * Methods that must be implemented on an endpoint that has access to the blockchain:#
	 */
	// Add a blockchain entry like: new Registration, Endpoint Assignment (Registration&Verification + Property), new Verification, new Property Assignment, new Pointer
	@property static addEntry<T extends BCEntryType>(entry: BCEntry<T>):Datex.Return<entry_index<T>> {}
	// get any entry by the index
	@property static getEntry(index: number): Datex.Return<BCEntry<BCEntryType>> {}
	// Public keys for encryption of messages and verification of signatures
	@property static getEndpointPublicKeys(endpoint: Endpoint):Datex.Return<[ArrayBuffer, ArrayBuffer]> {}
	// Get the (authority) endpoint that certified an endpoint
	@property static getEndpointCertifier(endpoint: Endpoint):Datex.Return<Endpoint|undefined> {}
	// get entry for endpoint registration
	@property static getEndpointEntry(endpoint: Endpoint): Datex.Return<BCEntry<BCEntryType.ENDPOINT_REGISTRATION>> {}
	// gets an endpoint property like @endpoint.name
	@property static getEndpointProperty(endpoint: Endpoint, key: unknown): any {}
	// gets an endpoint default value
	@property static getEndpointDefault(endpoint: Endpoint): any {}
	// get latest entry for an endpoint property
	@property static getEndpointPropertyEntry(endpoint: Endpoint, key: unknown): Datex.Return<BCEntry<BCEntryType.ENDPOINT_PROPERTY>> {}
	// get a pointer value
	@property static getPointer(id: number) : any {}
	@property static getPointerEntry(id: number): Datex.Return<BCEntry<BCEntryType.POINTER>> {}
	// traces backe the alias name of an endpoint or object (e.g. @@3456677564 -> get @unyt )
	@property static resolveAlias(target: Endpoint|BCEntry<BCEntryType.POINTER|BCEntryType.ENDPOINT_REGISTRATION>): Datex.Return<string|undefined> {}

	/**
	 * implemented blockchain util methods (validation, ...)
	 */

	static isEntryOfType<T extends BCEntryType>(entry: BCEntry<BCEntryType>, type: T): entry is BCEntry<T> {
		return entry.type == type;
	}

	static async validateEntry(entry: BCEntry<BCEntryType>, allow_unsigned = false){
		// creator set?
		if (!entry.creator && entry.type != BCEntryType.ENDPOINT_REGISTRATION) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): missing creator`);

		// validate signature
		if (!allow_unsigned && !entry.signature) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): signature required`);
		if (entry.signature) await this.validateEntrySignature(entry);

		// check if endpoint is already registered
		if (this.isEntryOfType(entry, BCEntryType.ENDPOINT_REGISTRATION)) {
			if (!(entry.data.keys instanceof Array && entry.data.keys.length == 2 && entry.data.keys[0] instanceof ArrayBuffer && entry.data.keys[1] instanceof ArrayBuffer)) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): invalid keys`);
			if (await this.getEndpointPublicKeys(entry.data.endpoint)) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): endpoint already registered`);
			if (entry.creator && entry.data.endpoint.equals(entry.creator)) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): endpoint cannot certify itself`);
		}

		// check if endpoint is already registered
		if (this.isEntryOfType(entry, BCEntryType.ENDPOINT_PROPERTY)) {
			if ((await this.getEndpointPropertyEntry(entry.creator!, entry.data.key))?.data.readonly) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): cannot update readonly property`);
		}


		logger.success("validated block: " + BCEntryType[entry.type])
	}

	static async validateEntrySignature(entry: BCEntry<BCEntryType>){
		if (!entry.signature) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): missing signature`);
		if (!entry.creator) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): missing creator`);

		const data_dx = Datex.Compiler.encodeValue(entry.data);
		const valid = await Datex.Crypto.verify(data_dx, entry.signature, entry.creator);
		if (!valid) throw new Error(`invalid Blockchain entry (${BCEntryType[entry.type]}): invalid signature`);
	}

}


export class BlockchainActions {

	/**
	 * Register a new endpoint with corresponding public keys in the blockchain
	 * @param endpoint the new endpoint
	 * @param keys endpoint public keys (verify + encrypt)
	 * @param sign optional, let the current endpoint sign the block
	 * @param trace entry id of a linked property assignment (for reverse alias resolution)
	 * @returns 
	 */
	public static async registerEndpoint(endpoint: Endpoint, keys: [verify:ArrayBuffer, encrypt:ArrayBuffer], sign = false, trace?:property_entry_index) {
		const entry = instance(BCEntry<BCEntryType.ENDPOINT_REGISTRATION>, {
			type: BCEntryType.ENDPOINT_REGISTRATION,
			data: {
				endpoint,
				keys,
				trace
			}
		});
		if (sign) await entry.sign(); // sign (optional)
		await Blockchain.validateEntry(entry, !sign); // check if valid before sending
		return Blockchain.addEntry(entry)
	}

	/**
	 * Store a endpoint property (@example.xy) in the blockchain / distributed storage
	 * @param key property key
	 * @param value property value
	 * @param readonly set to true if the property should not be modified ever
	 * @returns 
	 */
	public static async storeEndpointProperty(key: unknown, value: unknown, readonly = false) {
		const entry = instance(BCEntry<BCEntryType.ENDPOINT_PROPERTY>, {
			type: BCEntryType.ENDPOINT_PROPERTY,
			data: {
				key,
				value,
				readonly,
			}
		});
		await entry.sign(); // always sign
		await Blockchain.validateEntry(entry); // check if valid before sending
		return Blockchain.addEntry(entry)
	}

	/**
	 * Store the endpoint default value (get @example) in the blockchain / distributed storage
	 * @param value default value
	 * @returns 
	 */
	public static async storeEndpointDefault(value: unknown) {
		const entry = instance(BCEntry<BCEntryType.ENDPOINT_DEFAULT>, {
			type: BCEntryType.ENDPOINT_DEFAULT,
			data: {
				value,
			}
		});
		await entry.sign(); // always sign
		await Blockchain.validateEntry(entry); // check if valid before sending
		return Blockchain.addEntry(entry)
	}

	/**
	 * Store a pointer in the blockchain / distributed storage
	 * @param value pointer value
	 * @param readonly set to true if the pointer should not be modified ever
	 * @param trace entry id of a linked property assignment (for reverse alias resolution)
	 * @returns the BC pointer id (entry index)
	 */
	public static async storePointer(value: unknown, readonly = false, trace?:property_entry_index) {
		const entry = instance(BCEntry<BCEntryType.POINTER>, {
			type: BCEntryType.POINTER,
			data: {
				value,
				readonly,
				trace
			}
		});
		await entry.sign(); // always sign
		await Blockchain.validateEntry(entry); // check if valid before sending
		return Blockchain.addEntry(entry)
	}

	/**
	 * Store a pointer property in the blockchain / distributed storage
	 * @param value pointer value
	 * @param readonly set to true if the pointer should not be modified ever
	 * @param trace entry id of a linked property assignment (for reverse alias resolution)
	 * @returns the BC pointer id (entry index)
	 */
	public static async storePointerProperty(pointer:pointer_entry_index, key:unknown, value: unknown, readonly = false) {
		const entry = instance(BCEntry<BCEntryType.POINTER_PROPERTY>, {
			type: BCEntryType.POINTER_PROPERTY,
			data: {
				pointer,
				key,
				value,
				readonly
			}
		});
		await entry.sign(); // always sign
		await Blockchain.validateEntry(entry); // check if valid before sending
		return Blockchain.addEntry(entry)
	}

	/**
	 * Create a new sub endpoint for the current endpoint
	 * @param name name of the endpoint property (@example.*name*)
	 * @param sub_endpoint the actual endpoint to which the sub endpoint resolves
	 * @param keys public keys for the sub endpoint (verify + encrypt)
	 */
	public static async registerSubEndpoint(name:string, sub_endpoint: Endpoint, keys: [verify:ArrayBuffer, encrypt:ArrayBuffer]) {
		// store as property of current endpoint
		const trace = (await this.storeEndpointProperty(name, sub_endpoint))!;

		// register new sub endpoint, signed by the current endpoint
		await this.registerEndpoint(sub_endpoint, keys, true, trace);
	}

}