import { BinaryCode } from "../compiler/binary_codes.ts";
import { Pointer } from "../runtime/pointers.ts";
import { ValueConsumer } from "./abstract_types.ts";
import { SecurityError, ValueError } from "./errors.ts";
import { Compiler } from "../compiler/compiler.ts";
import type { datex_scope } from "../utils/global_types.ts";
import { buffer2hex, hex2buffer } from "../utils/utils.ts";
import { clause, Disjunction } from "./logic.ts";
import { Runtime } from "../runtime/runtime.ts";
import { logger } from "../utils/global_values.ts";

const LABELED_POINTER = /^(\\)?(\$)([A-Za-z0-9À-ž_]{1,25})(\s*[:+-/*&|]?=(?![=>/]))?/ // #label


type target_prefix_person = "@";
type target_prefix_id = "@@";
type target_prefix_institution = "@+";
type target_prefix = target_prefix_person | target_prefix_id | target_prefix_institution;

export type filter_target_name_person = `${target_prefix_person}${string}`;
export type filter_target_name_id = `${target_prefix_id}${string}`;
export type filter_target_name_institution = `${target_prefix_institution}${string}`;
type _endpoint_name = filter_target_name_person | filter_target_name_id | filter_target_name_institution
export type endpoint_name = `${_endpoint_name}${_endpoint_name|''}`

export type endpoint_by_endpoint_name<name extends endpoint_name> = 
     name extends filter_target_name_id ? IdEndpoint : 
    (name extends filter_target_name_institution ?Institution :
    (name extends filter_target_name_person ? Person : never));



export enum ElType {
	PERSON, LABEL, INSTITUTION, BOT, FLAG
}

export type target_clause = clause<Target>
export type endpoints = Endpoint|Disjunction<Endpoint>

export class Target implements ValueConsumer {

	protected static targets = new Map<string, Endpoint>();   // target string -> target element
	static readonly prefix:target_prefix = "@"
	static readonly type:BinaryCode


	// @implements LogicalComparator<T>
    static logicalMatch(value: Target, against: Target) {
		//console.log("logical match " + value + " against " + against);
		// TODO: finish
		return (value === against || (value instanceof Endpoint && against instanceof Endpoint && value.equals(against)))
	}
	
	// TODO filter
	handleApply(value:any, SCOPE:datex_scope) {
		// if (params[0] instanceof Endpoint) return Target.get(this.name, this.subspaces, this.instance, params[0], <any> this.constructor);
		// else return this;
	}
	
	public static getClassFromBinaryCode(binary_code?:BinaryCode): typeof Person | typeof Institution | typeof IdEndpoint {
		switch (binary_code) {
			case BinaryCode.PERSON_ALIAS: return Person;
			case BinaryCode.INSTITUTION_ALIAS: return Institution;
			case BinaryCode.ENDPOINT: return IdEndpoint;

			case BinaryCode.PERSON_ALIAS_WILDCARD: return Person;
			case BinaryCode.INSTITUTION_ALIAS_WILDCARD: return Institution;
			case BinaryCode.ENDPOINT_WILDCARD: return IdEndpoint;
		}
	}

	public static isWildcardBinaryCode(binary_code?:BinaryCode): boolean {
		switch (binary_code) {
			case BinaryCode.PERSON_ALIAS_WILDCARD:
			case BinaryCode.INSTITUTION_ALIAS_WILDCARD:
			case BinaryCode.BOT_WILDCARD:
			case BinaryCode.ENDPOINT_WILDCARD:
				return true;
			default:
				return false;
		}
	}

	/** create new Filter element or return stored 
	 * @param name: 'user' or '@user' or '@user/3'
	 * @param instance: instance as extra parameter (optional)
	*/
	public static get<T extends endpoint_name>(name:T, subspaces?:string[], instance?:string|number, appspace?:Endpoint):endpoint_by_endpoint_name<T>|WildcardTarget
	public static get<T extends typeof Endpoint=typeof Endpoint>(name:string|Uint8Array, subspaces?:string[], instance?:string|number|Uint8Array, appspace?:Endpoint, type?:BinaryCode|T):InstanceType<T>|WildcardTarget
	public static get<T extends typeof Endpoint=typeof Endpoint>(name:string|Uint8Array, subspaces?:string[], instance?:string|number|Uint8Array, appspace?:Endpoint, filter_class_or_type?:BinaryCode|T):InstanceType<T>|WildcardTarget {
		
		let classType = this.getClassFromBinaryCode(<BinaryCode>filter_class_or_type) ?? <any>filter_class_or_type;
		// handle string
		if (typeof name == "string") {
			// institution
			if (name.startsWith("@+")) {
				name = name.substring(2);
				classType = Institution;
			}
			// id
			else if (name.startsWith("@@")) {
				name = name.substring(2);
				classType = IdEndpoint;
			}
			// individual
			else if (name.startsWith("@")) {
				name = name.substring(1);
				classType = Person;
			}

			// split instance and subspaces
			let split = name.split("/");
			name = split[0];
			if (split[1]) instance = split[1];
			split = name.split(":");
			name = split[0];
			if (split[1]) subspaces = split.slice(1).filter(s=>s);

		}

		if (typeof classType != "function") throw new SyntaxError("Invalid Target: " + name);

		// target or wildcard target?
		const target = new classType(name, subspaces, instance, appspace);
		if (typeof filter_class_or_type == "number" && this.isWildcardBinaryCode(filter_class_or_type)) return WildcardTarget.getWildcardTarget(target);
		else return <InstanceType<T>>target;
	}
}

/** parent class for all filters (@user, ...) */
export class Endpoint extends Target {
	#name:string
	#subspaces:string[] = []
	#appspace:Endpoint
	#binary:Uint8Array
	#instance:string
	#instance_binary:Uint8Array
	#prefix: target_prefix
	#type: BinaryCode
	#base: Target // without subspaces or appspace
	#main: Target // without instance

	#properties = new Map<string,unknown>()
	#default?: unknown

	#n: string
	n: string // show for debugging

	get name() {return this.#name}
	get instance() {return this.#instance}
	get instance_binary() {return this.#instance_binary}
	get prefix() {return this.#prefix}
	get type() {return this.#type}
	get main() {return this.#main}
	get base() {return this.#base}
	get binary() {return this.#binary}
	get subspaces() {return this.#subspaces}
	get appspace() {return this.#appspace}

	get properties() {
		return this.#properties;
	}
	get default() {
		return this.#default;
	}

	protected static readonly DEFAULT_INSTANCE = new Uint8Array(8);

	// must declare, # does not work
	declare private __id_endpoint: IdEndpoint; // id endpoint corresponding to the person, institution or bot

	get id_endpoint () {
		return this.__id_endpoint;
	}


	// important!! do not call constructor directly (constructor only public for typescript types to work properly)
	constructor(name:string|Uint8Array, subspaces?:string[], instance?:string|number|Uint8Array, appspace?:Endpoint) {
		super();

		// Buffer to string
		if (name instanceof Uint8Array) {
			this.#binary = name;
			name = buffer2hex(name);
		}
		else if (typeof name != "string") throw new ValueError("<Target> name must be a <text> or a <Buffer>");
		
		if (!name) throw new ValueError("Cannot create an empty filter target");

		// Instance buffer/string/int
		if (instance instanceof Uint8Array) {
			this.#instance_binary = instance;
			instance = new TextDecoder().decode(instance).replaceAll("\u0000","");
		}
		else if (typeof instance == "number") {
			this.#instance_binary = new Uint8Array(new BigUint64Array([BigInt(instance??0)]).buffer);
			instance = buffer2hex(this.#instance_binary);
		}
		else if (instance == undefined) {
			this.#instance_binary = Endpoint.DEFAULT_INSTANCE;
		}
		else if (typeof instance == "string") {
			this.#instance_binary = new TextEncoder().encode(instance);
		}
		else {
			console.log("inst",instance)
			throw new ValueError("<Target> instance must be a <text>, <int> or a <Buffer>");
		}

	
		// add binary if IdEndpoint
		if (typeof name == "string" && !this.#binary && (<typeof Endpoint>this.constructor).prefix == "@@") {
			try {
				this.#binary = hex2buffer(name);
			}
			catch (e) {
				console.log(e)
				throw new ValueError("Invalid binary id for <Target>");
			}
		}

		if ((this.#binary?.byteLength??0 + this.#instance_binary?.byteLength??0) > 20) throw new ValueError("ID Endpoint size must be <=20 bytes")

		if (subspaces?.length) {
			this.#subspaces = subspaces;
			this.#base = Target.get(name, null, null, null, <typeof Endpoint>this.constructor);
		}
		if (instance) {
			this.#instance = instance;
			this.#main = Target.get(name, subspaces, null, appspace, <typeof Endpoint>this.constructor)
		}

		this.#prefix = (<typeof Endpoint>this.constructor).prefix;
		this.#type = (<typeof Endpoint>this.constructor).type;
		this.#name = name;
		this.#appspace = appspace;

		// get toString() value
		this.#n = this.toString()
		this.n = this.#n; // just for debugging/display purposes
		
		// check if name is valid
		//if (!(this._toString().match(Regex._ANY_FILTER_TARGET) || (this.#prefix == "+" && this.#name == "+"))) throw new DatexValueError("Invalid filter target name: '"+this._toString()+"'");

		// target already exists? return existing filtertarget
		if (Target.targets.has(this.#n)) {
			return Target.targets.get(this.#n)
		}
		// add to filter target list
		else Target.targets.set(this.#n, this);
	}

	// create string representation of filter (-> '@user')
	override toString(with_instance=true): string {
		return this._toString(with_instance);
	}
	// return string for JSON
	toJSON() {
		return 'dx::' + this.toString() 
	}

	public async getProperty(key:string) {
		try {
			const res = await datex("#public.(?)", [key], this);
			if (res!==undefined) return res;
		} 
		// probably network error, endpoint not reachable
		catch {}
		// fallback: Blockchain
		return (await import("../network/blockchain_adapter.ts")).Blockchain.getEndpointProperty(this, key);
	}

	public async getDefault(){
		try {
			const res = await datex("#default", [], this);
			if (res!==undefined) return res;
		} 
		// probably network error, endpoint not reachable
		catch {}
		// fallback: Blockchain
		return (await import("../network/blockchain_adapter.ts")).Blockchain.getEndpointDefault(this);
	}



	protected _toString(with_instance=true): endpoint_name {
		return `${this.prefix}${this.name}${this.subspaces.length ? "." + this.subspaces.join(".") : ""}${with_instance&&this.instance? "/"+this.instance : ""}${this.appspace ? this.appspace.toString() : ""}`
	}

	
	/** returns a certain instance of an existing filter */
	public getInstance(instance:string){
		return Target.get(this.name, this.subspaces, instance, this.appspace, <any> this.constructor);
	}

	/** returns a certain subspace of an existing filter */
	public getSubspace(subspace:string){
		return Target.get(this.name, [...this.subspaces, subspace], this.instance, this.appspace, <any> this.constructor);
	}
	
	// returns if two endpoints point to the same endpoint (id or user/...)
	public equals(other: Endpoint) {
		return !! ((other == this) ||
			 (
				(other?.instance == this.instance) && // same instance and
				(  // same id endpoint
					(other?.id_endpoint == <IdEndpoint><any>this) ||
					(this.id_endpoint && (this.id_endpoint == other || this.id_endpoint == other?.id_endpoint))
				)
			));
	}

	public setIdEndpoint(id_endpoint:IdEndpoint) {
		if (this.__id_endpoint != undefined) throw new SecurityError("Id Endpoint for this Target is already set");
		else this.__id_endpoint = id_endpoint;
	}

	declare private interface_channel_info:{[channel_name:string]:any}
	public setInterfaceChannels(info:{[channel_name:string]:any}){
		this.interface_channel_info = info
	}

	public getInterfaceChannelInfo(channel:string):any {
		return this.interface_channel_info[channel]
	}


	/* handle current online status */

	#online?: Promise<boolean>
	#current_online?: boolean
	
	// returns (cached) online status
	public async isOnline(){
		if (Runtime.endpoint.equals(this) || Runtime.main_node?.equals(this)) return true; // is own endpoint or main node
		
		if (this.#online != undefined) return this.#online;
		
		const timeout = 700; // 500ms
		const cache_life_offline = 3_000; // reload cache faster if offline
		const cache_life_online = 15_000;

		const prev_online = this.#current_online;

		let resolve_online:Function|undefined
		this.#online = new Promise(resolve=>resolve_online=resolve)

		try {
			// ping
			await Runtime.datexOut(['', [], {sign:false, encrypt:false}], this, undefined, true, false, undefined, false, undefined, timeout);
			resolve_online!(this.#current_online = true)
		}
		// could not reach endpoint
		catch {
			resolve_online!(this.#current_online = false)
		}

		// log if online state changed
		if (prev_online !== this.#current_online) {
			if (this.#current_online) logger.debug `new online state for ${this.toString()}: #color(green)online`
			else logger.debug `new online state for ${this.toString()}: #color(red)offline`
		}

		// clear online state after some time
		setTimeout(()=>this.#online=undefined, this.#current_online ? cache_life_online : cache_life_offline);

		return this.#online;
	}


	// get endpoint from string
	public static fromString(string:string) {
		// normal DATEX endpoint
		try {
			return Target.get(string)
		}
		// TODO Id Endpoint from ipv6 address, ...
		catch {
			return Target.get("@TODO_IPV6")
		}
	}


	public static createNewID():filter_target_name_id{
		const id = new DataView(new ArrayBuffer(12));
		const timestamp = Math.round((new Date().getTime() - Compiler.BIG_BANG_TIME)/1000);
		id.setUint32(0,timestamp, true); // timestamp
		id.setBigUint64(4, BigInt(Math.floor(Math.random() * (2**64))), true); // random number
		return `@@${buffer2hex(new Uint8Array(id.buffer))}`;
	}

	public static getNewEndpoint():IdEndpoint{
		return IdEndpoint.get(Endpoint.createNewID())
	}


}



export class WildcardTarget extends Target {

	private static wildcard_targets = new WeakMap<Endpoint, WildcardTarget>()

	public static getWildcardTarget(target: Endpoint){
		if (this.wildcard_targets.has(target)) return this.wildcard_targets.get(target);
		else {
			const wildcard_target = new WildcardTarget(target);
			this.wildcard_targets.get(target);
			return wildcard_target;
		}
	}

	override toString() {
		return this.target?.toString() ?? "### invalid wildcard target ###";
	}

	constructor(public target:Endpoint) {super()}
}


export class Person extends Endpoint {
	static override prefix:target_prefix = "@"
	static override type = BinaryCode.PERSON_ALIAS
	static override get(name:string, subspaces?:string[], instance?:string, appspace?:Endpoint){return <Person>super.get(name, subspaces, instance, appspace, Person)}
}
export class Institution extends Endpoint {
	static override prefix:target_prefix = "@+"
	static override type = BinaryCode.INSTITUTION_ALIAS
	static override get(name:string, subspaces?:string[], instance?:string, appspace?:Endpoint){return  <Institution>super.get(name, subspaces, instance, appspace, Institution)}
}
export class IdEndpoint extends Endpoint {
	static override prefix:target_prefix = "@@"
	static override type = BinaryCode.ENDPOINT
	static override get(name:string|Uint8Array, subspaces?:string[], instance?:string, appspace?:Endpoint){return  <IdEndpoint>super.get(name, subspaces, instance, appspace, IdEndpoint)}

	constructor(name: string | Uint8Array, subspaces?:string[], instance?: string | number | Uint8Array, appspace?:Endpoint) {
		super(name, subspaces, instance, appspace);
		if (this.id_endpoint == undefined) this.setIdEndpoint(this); // is own id endpoint
	}

	// get prefix for pointer (with address type)
	public getPointerPrefix(){
		return new Uint8Array([
			this.binary.byteLength == 16 ? Pointer.POINTER_TYPE.IPV6_ID : Pointer.POINTER_TYPE.DEFAULT,
			...this.binary, 
			...this.instance_binary
		])
	}

	public getStaticPointerPrefix(){
		return new Uint8Array([
			Pointer.POINTER_TYPE.STATIC,
			...this.binary
		])
	}
}

// default local endpoint
export const LOCAL_ENDPOINT = IdEndpoint.get("@@000000000000000000000000");
export const BROADCAST      = IdEndpoint.get("@@FFFFFFFFFFFFFFFFFFFFFFFF");