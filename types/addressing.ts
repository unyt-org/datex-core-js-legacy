import { BinaryCode } from "../compiler/binary_codes.ts";
import { Pointer } from "../runtime/pointers.ts";
import { ValueConsumer } from "./abstract_types.ts";
import { ValueError } from "./errors.ts";
import { Compiler, ProtocolDataTypesMap } from "../compiler/compiler.ts";
import type { datex_scope, dxb_header } from "../utils/global_types.ts";
import { base64ToArrayBuffer, buffer2hex, hex2buffer } from "../utils/utils.ts";
import { clause, Disjunction } from "./logic.ts";
import { Runtime, StaticScope } from "../runtime/runtime.ts";
import { logger } from "../utils/global_values.ts";
import { Datex } from "../mod.ts";
import { ProtocolDataType } from "../compiler/protocol_types.ts";
import { ESCAPE_SEQUENCES } from "../utils/logger.ts";
import { deleteCookie, getCookie } from "../utils/cookies.ts";
import { Crypto } from "../runtime/crypto.ts";

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

	protected static targets = new Map<string, WeakRef<Endpoint>>();   // target string -> target element
	static readonly prefix:target_prefix = "@"
	static readonly type:BinaryCode


	// @implements LogicalComparator<T>
    static logicalMatch(value: Target, against: Target) {
		return (
			against === BROADCAST ||
			value === against || 
			(value instanceof Endpoint && value.main === against) ||
			(value instanceof Endpoint && against instanceof Endpoint && value.equals(against))
		)
	}
	
	// TODO filter
	handleApply(value:any, SCOPE:datex_scope) {
		// if (params[0] instanceof Endpoint) return Target.get(this.name, this.subspaces, this.instance, params[0], <any> this.constructor);
		// else return this;
	}
	
	public static getClassFromBinaryCode(binary_code?:BinaryCode): typeof Person | typeof Institution | typeof IdEndpoint | undefined {
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
	public static get<T extends endpoint_name>(name:T, instance?:string|number):endpoint_by_endpoint_name<T>|WildcardTarget
	public static get<T extends typeof Endpoint=typeof Endpoint>(name:string|Uint8Array, instance?:string|number|Uint8Array, type?:BinaryCode|T):InstanceType<T>|WildcardTarget
	public static get<T extends typeof Endpoint=typeof Endpoint>(name:string|Uint8Array, instance?:string|number|Uint8Array, filter_class_or_type?:BinaryCode|T):InstanceType<T>|WildcardTarget {
		
		// @ts-ignore
		if (name?.includes(".")) throw "invalid target: includes '.'"

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

		}

		if (typeof classType != "function") throw new SyntaxError("Invalid Target: " + name);

		// target or wildcard target?
		const target = new classType(name, instance);
		if (typeof filter_class_or_type == "number" && this.isWildcardBinaryCode(filter_class_or_type)) return WildcardTarget.getWildcardTarget(target);
		else return <InstanceType<T>>target;
	}
}

/** parent class for all filters (@user, ...) */
export class Endpoint extends Target {
	protected static readonly DEFAULT_INSTANCE = new Uint8Array(2);

	#name:string
	#binary = new Uint8Array(18) // 18 bytes
	#instance?:string
	#instance_binary:Uint8Array // 2 bytes
	#alias?: string
	#certifier?: Endpoint

	#properties = new Map<unknown,unknown>()
	#entrypoint?: unknown

	#n: string
	// n: string // show for debugging

	get name() {return this.#name}
	get instance() {return this.#instance}
	get instance_binary() {return this.#instance_binary}
	get prefix() {return (<typeof Endpoint>this.constructor).prefix}
	get type() {return (<typeof Endpoint>this.constructor).type}
	get main():Endpoint {return (this.#instance == "0000" || !this.#instance) ? this : this.getInstance("")} // target without instance
	get binary() {return this.#binary}
	get alias() {return this.#alias}
	get certifier() {return this.#certifier}

	get properties() {
		return this.#properties;
	}
	get entrypoint() {
		return this.#entrypoint;
	}


	protected nameToBinary(name:string){return new TextEncoder().encode(name)}
	protected nameFromBinary(name:Uint8Array){return new TextDecoder().decode(name).split("\u0000")?.[0]}

	// important!! do not call constructor directly (constructor only public for typescript types to work properly)
	constructor(name:string|Uint8Array, instance?:string|number|Uint8Array) {
		super();

		// Buffer to string
		if (name instanceof Uint8Array) {
			if (name.byteLength > 18) throw new ValueError("Endpoint id/name must be <=18 bytes")
			this.#binary.set(name);
		}
		else if (typeof name === "string") {
			const name_bin = this.nameToBinary(name);
			if (name_bin.byteLength > 18) throw new ValueError("Endpoint id/name must be <=18 bytes")
			this.#binary.set(name_bin);
		}
		else {
			throw new ValueError("<Target> name must be a <text> or a <Buffer>");
		}
		
		this.#name = this.nameFromBinary(this.#binary);

		// Instance buffer/string/int
		if (instance instanceof Uint8Array) {
			this.#instance_binary = instance;
			this.#instance = buffer2hex(instance);
		}
		else if (typeof instance == "number") {
			this.#instance_binary = new Uint8Array([(instance>>8) & 0xff, instance & 0xff]);
			this.#instance = buffer2hex(this.#instance_binary);
		}
		else if (typeof instance == "string" && instance) {
			this.#instance_binary = hex2buffer(instance);
			this.#instance = instance.toUpperCase();
		}
		else {
			this.#instance_binary = Endpoint.DEFAULT_INSTANCE;
			this.#instance = buffer2hex(this.#instance_binary);
		}

		if ((this.#instance_binary.byteLength??0) > 2) throw new ValueError("Endpoint instance must be <=2 bytes")

		// get toString() value
		this.#n = this.toString()
		// this.n = this.#n; // just for debugging/display purposes
		
		// target already exists? return existing filtertarget
		if (Target.targets.has(this.#n) && Target.targets.get(this.#n)?.deref()) {
			return Target.targets.get(this.#n)!.deref()!;
		}
		// add to filter target list
		else {
			const ref = new WeakRef(this);
			Endpoint.registry.register(this, this.#n);
			Target.targets.set(this.#n, ref);
		}
	}
	static registry: FinalizationRegistry<string> = new FinalizationRegistry((key)=>{
		Target.targets.delete(key);
	});

	get [Symbol.toStringTag]() {
		return this.#n;
	}

	// create string representation of filter (-> '@user')
	override toString(with_instance=true): string {
		return this._toString(with_instance);
	}
	// return string for JSON
	toJSON() {
		return 'dx::' + this.toString() 
	}

	public async getProperty(key:unknown) {
		if (!Datex.Supranet.connected && this !== Datex.Runtime.endpoint) {
			// logger.error("cannot get endpoint property");
			return new UnresolvedEndpointProperty(this, key)
		}
		try {
			const res = await datex("#public.(?)", [key], this);
			if (res!==undefined) {
				this.#properties.set(key, res)
				return res;
			}
		} 
		// probably network error, endpoint not reachable
		catch (e) {
			console.debug("error getting '" + this + "." + key + "'",e)
		}
		// fallback: Blockchain
		const res = Runtime.Blockchain.getEndpointProperty(this, key);
		this.#properties.set(key, res)
		return res;
	}

	public setProperty(key:unknown, value:unknown) {
		if (this !== Runtime.endpoint) throw new ValueError("cannot set endpoint property of remote endpoint")
		StaticScope.scopes.set(key, <any>value)
		// this.#properties.set(key, value);
	}

	public async getEntrypoint(){
		try {
			const res = await datex("#entrypoint", [], this);
			if (res!==undefined) return this.#entrypoint = res;
		} 
		// probably network error, endpoint not reachable
		catch {}
		// fallback: Blockchain
		return this.#entrypoint = Runtime.Blockchain.getEndpointDefault(this);
	}

	public async getAlias(){
		// resolve alias from Blockchain
		try {
			this.#alias = <string | undefined> await Runtime.Blockchain.resolveAlias(this);
		}
		catch (e){
			// console.debug("failed to resolve alias for " + this, e)
		}
		return this.#alias
	}

	/**
	 * Generates a network trace
	 * (for routing debugging)
	 */
	public async trace(previous?: {header: dxb_header, trace: any[], source?: any}):Promise<{endpoint: Endpoint, timestamp: Date, interface: {type?: string, description?:string}}[]> {
		if (previous) {
			console.log(ProtocolDataTypesMap[previous.header.type??ProtocolDataType.TRACE]+" from " + previous.header.sender + " to " + this);
		}
		const trace = previous?.trace ?? [];
		trace.push({endpoint:Runtime.endpoint, interface: {type: previous?.source?.type, description: previous?.source?.description}, timestamp: new Date()});

		const res = await Runtime.datexOut(['?', [trace], {type:previous?.header?.type ?? ProtocolDataType.TRACE, sign:false}], this, previous?.header?.sid, true, false, undefined, false, undefined, 60_000, previous?.source);
		return res;
	}

	public async printTrace() {
		const format = (val:any) => Runtime.valueToDatexStringExperimental(val, true, true);

		let trace: {endpoint: Endpoint, timestamp: Date, interface: {type?: string, description?:string}}[]
		try {
			trace = await this.trace();
		}
		catch {
			let title = `${ESCAPE_SEQUENCES.BOLD}DATEX Network Trace\n${ESCAPE_SEQUENCES.RESET}`;
			title += `${format(Runtime.endpoint)}${ESCAPE_SEQUENCES.RESET} -> ${format(this)}${ESCAPE_SEQUENCES.RESET}\n\n`
			title += `${ESCAPE_SEQUENCES.RED}Error: Endpoint not reachable`
			console.log(title);
			return;
		}

		if (!trace) throw new Error("Invalid trace");

		const resolvedEndpointData = trace.find((data) => trace.indexOf(data)!=0 && (data.endpoint == this || data.endpoint.main == this || (data.endpoint == Runtime.endpoint && (this as any)==Datex.LOCAL_ENDPOINT)))!;
		const resolveEndpointIndex = trace.indexOf(resolvedEndpointData);
		const resolvedEndpoint = resolvedEndpointData.endpoint;
		const hopsToDest = resolveEndpointIndex;
		const hopsFromDest = trace.length - resolveEndpointIndex - 1;

		let title = `${ESCAPE_SEQUENCES.BOLD}DATEX Network Trace\n${ESCAPE_SEQUENCES.RESET}`;
		title += `${format(Runtime.endpoint)}${ESCAPE_SEQUENCES.RESET} -> ${format(resolvedEndpoint)}${ESCAPE_SEQUENCES.RESET}\n\n`
		let pre = ''
		let logs = ''
		const rtt = trace.at(-1).timestamp.getTime() - trace.at(0).timestamp.getTime();

		pre += `-----------------------------\n`
		pre += `${ESCAPE_SEQUENCES.BOLD}Round-Trip Time:       ${ESCAPE_SEQUENCES.RESET}${rtt}ms\n`
		pre += `${ESCAPE_SEQUENCES.BOLD}Hops to Destination:   ${ESCAPE_SEQUENCES.RESET}${hopsToDest}\n`
		pre += `${ESCAPE_SEQUENCES.BOLD}Hops from Destination: ${ESCAPE_SEQUENCES.RESET}${hopsFromDest}\n`
		pre += `-----------------------------\n\n`

		pre += `\n${ESCAPE_SEQUENCES.BOLD}Hops:${ESCAPE_SEQUENCES.RESET}\n\n`;

		for (let i = 0; i<trace.length; i++) {
			const current = trace[i];
			const next = trace[i+1];
			if (!next) break;

			if (i == hopsToDest) pre += `\n${ESCAPE_SEQUENCES.BOLD}Return Trip:${ESCAPE_SEQUENCES.RESET}\n\n`;

			pre += `${ESCAPE_SEQUENCES.BOLD} #${(i%hopsToDest)+1} ${ESCAPE_SEQUENCES.RESET}(${next.interface.type??'unknown'}${next.interface.description ? ' ' + next.interface.description : ''})${ESCAPE_SEQUENCES.RESET}:\n  ${format(current.endpoint)}${ESCAPE_SEQUENCES.RESET} -> ${format(next.endpoint)}${ESCAPE_SEQUENCES.RESET}\n\n`
		}


		console.log(title+pre+logs)
	}


	public async getCertifier(){
		// resolve alias from Blockchain
		return this.#certifier = <Endpoint | undefined> Runtime.Blockchain.getEndpointCertifier(this);
	}


	protected _toString(with_instance=true): endpoint_name {
		return `${this.prefix}${this.name}${with_instance&&(this.instance&&this.instance!="0000")? "/"+this.instance : ""}`
	}

	
	/** returns a certain instance of an existing filter */
	public getInstance(instance:string|number|Uint8Array): Endpoint {
		return Target.get(this.name, instance, <any> this.constructor);
	}
	
	// returns if two endpoints point to the same endpoint (id or user/...)
	public equals(other: Endpoint) {
		return other === this;
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
	
	#onlinePointer?: Pointer<boolean>;
	public get online() {
		if (this.#onlinePointer)
			return this.#onlinePointer;
		const interval = setInterval(()=>this.isOnline(), 10_000);
		this.isOnline();
		this.#onlinePointer = $$(this.#current_online ?? false) as Pointer<boolean>;
		this.#onlinePointer.onGargabeCollection(()=> clearInterval(interval));
		return this.#onlinePointer;
	}


	// max allowed time for DATEX online ping response
	static max_ping_response_time = 2000;
	static max_ping_response_time_unyt_node = 5000;
	static unyt_nodes = [
		"@+unyt1",
		"@+unyt2",
		"@+unyt3"
	]

	// online state cache reload time if currently online/offline
	static cache_life_offline = 3_000;
	static cache_life_online = 15_000;

	/**
	 * Override online state (e.g. when retrieving a GOODBYE or other message)
	 * Gets reset after some time (Endpoint.cache_life_offline/Endpoint.cache_life_online)
	 * @param online 
	 */
	public setOnline(online = true) {
		if (this.#current_online === online) return; // no change

		this.#online = new Promise(resolve => resolve(online));
		this.#current_online = online;
		if (this.#onlinePointer) this.#onlinePointer.val = online;
		// reset overriden online state after some time
		this.#resetOnlineCache();
	}


	// returns (cached) online status
	public async isOnline(): Promise<boolean> {
		if (Runtime.endpoint.equals(this) || Runtime.main_node?.equals(this) || this as Endpoint === LOCAL_ENDPOINT) return true; // is own endpoint or main node
		
		if (this.#online != undefined) return this.#online;
		

		const prev_online = this.#current_online;

		let resolve_online:Function|undefined
		this.#online = new Promise(resolve=>resolve_online=resolve)

		try {
			// ping
			await Runtime.datexOut(
				['"ping"', [], {sign:false, encrypt:false}], 
				this, 
				undefined, 
				true, 
				false, 
				undefined, 
				false, 
				undefined,
				Endpoint.unyt_nodes.includes(this.main.toString()) ? 
					Endpoint.max_ping_response_time_unyt_node : 
					Endpoint.max_ping_response_time
				);
			resolve_online!(this.#current_online = true)
		}
		// could not reach endpoint
		catch (e) {
			resolve_online!(this.#current_online = false)
		}

		// log if online state changed
		if (prev_online !== this.#current_online) {
			if (this.#onlinePointer) this.#onlinePointer.val = this.#current_online;
			if (this.#current_online) logger.debug `new online state for ${this.toString()}: #color(green)online`
			else logger.debug `new online state for ${this.toString()}: #color(red)offline`
		}

		// clear online state after some time
		this.#resetOnlineCache();

		return this.#online;
	}

	/**
	 * Resets the current online state cache after some time (Endpoint.cache_life_offline/Endpoint.cache_life_online)
	 */
	#resetOnlineCache() {
		setTimeout(() => this.#online=undefined, this.#current_online ? Endpoint.cache_life_online : Endpoint.cache_life_offline);
	}


	// get endpoint from string
	public static fromString(string:string) {
		// normal DATEX endpoint
		try {
			return Target.get(string)
		}
		// TODO Id Endpoint from ipv6 address, ...
		catch {
			throw "cannot resolve endpoint name"
		}
	}

	public static async fromStringAsync(string:string) {
		// TODO: regex
		// normal DATEX endpoint
		const val = await datex(string);
		if (!(val instanceof Endpoint || val instanceof UnresolvedEndpointProperty)) throw new ValueError(`Could not parse endpoint string: "${string}" - Not an endpoint`);
		return val;
	}
	
	/**
	 * Get endpoint + keys from "datex-endpoint" cookie and "new_keys" entry
	 * Only works one time ("new_keys" localStorage entry is removewd)
	 * Deletes the cookie if not a valid endpoint or no "new_keys" entry exists, and returns null
	 * @returns
	 */
	public static getFromCookie() {
		const cookieEndpoint = getCookie("datex-endpoint");
		if (cookieEndpoint) {
			const newKeysEntry = localStorage.getItem("new_keys");
			if (!newKeysEntry) {
				logger.warn("no keys for datex-endpoint found");
				deleteCookie("datex-endpoint")
				deleteCookie("datex-endpoint-validation")
				deleteCookie("uix-session") // TODO: this is UIX specific and should not be handled here
				return null;
			}
			localStorage.removeItem("new_keys");

			// check if has matching new_keys
			const newKeys = JSON.parse(newKeysEntry);

			try {
				const endpoint = Target.get(cookieEndpoint) as Endpoint;

				if (newKeys.endpoint !== endpoint.main.toString()) {
					logger.warn("datex-endpoint does not match keys")
					deleteCookie("datex-endpoint")
					deleteCookie("datex-endpoint-validation")
					deleteCookie("uix-session") // TODO: this is UIX specific and should not be handled here
					return null;
				}

				const exportedKeys:Crypto.ExportedKeySet = {
					sign: [base64ToArrayBuffer(newKeys.keys.sign[0]), base64ToArrayBuffer(newKeys.keys.sign[1])],
					encrypt: [base64ToArrayBuffer(newKeys.keys.encrypt[0]), base64ToArrayBuffer(newKeys.keys.encrypt[1])]
				}

				logger.debug("loaded endpoint from 'datex-endpoint' cookie: " + endpoint)
				return {endpoint, keys:exportedKeys}
			}
			catch {
				deleteCookie("datex-endpoint")
			}
		}
		return null;
	}

	public static createNewID():filter_target_name_id{
		const id = new DataView(new ArrayBuffer(16));
        const timestamp = Math.round((new Date().getTime() - Compiler.BIG_BANG_TIME));
        id.setBigUint64(0, BigInt(timestamp), true); // timestamp
        id.setBigUint64(8, BigInt(Math.floor(Math.random() * (2**64))), true); // random number
        return `@@${buffer2hex(new Uint8Array(id.buffer))}`;
	}

	public static getNewEndpoint():IdEndpoint{
		return IdEndpoint.get(Endpoint.createNewID())
	}

	// get prefix for pointer (with address type) (same as dxb representation of endpoint)
	public getPointerPrefix(){
		return new Uint8Array([
			this.type,
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


export class UnresolvedEndpointProperty {
	constructor(public parent:Endpoint, public property:any) {}

	resolve() {
		return datex `${this.parent}.${this.property}`;
	}

	toString() {
		return `${this.parent}.${this.property}`;
	}

	// to make compatible with Endpoint.getAlias()
	getAlias() {
		return this.toString()
	}
}



export class WildcardTarget extends Target {

	private static wildcard_targets = new WeakMap<Endpoint, WildcardTarget>()

	public static getWildcardTarget(target: Endpoint){
		if (this.wildcard_targets.has(target)) return this.wildcard_targets.get(target)!;
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
	static override get(name:string, instance?:string){return <Person>super.get(name, instance, Person)}
}
export class Institution extends Endpoint {
	static override prefix:target_prefix = "@+"
	static override type = BinaryCode.INSTITUTION_ALIAS
	static override get(name:string, instance?:string){return <Institution>super.get(name, instance, Institution)}
}
export class IdEndpoint extends Endpoint {
	static override prefix:target_prefix = "@@"
	static override type = BinaryCode.ENDPOINT
	static override get(name:string|Uint8Array, instance?:string){return <IdEndpoint>super.get(name, instance, IdEndpoint)}
	override nameToBinary(name:string){
		if (name == "local") return new Uint8Array(18);
		else if (name == "any") return Uint8Array.from(Array(18).fill(0xff));
		return hex2buffer(name)
	}
	override nameFromBinary(name:Uint8Array){
		const string = buffer2hex(name).replace(/(00)*$/, ''); 
		if (string == "") return "local"
		else if (string == "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF") return "any"
		else return string;
	}
}

// default local endpoint
export const LOCAL_ENDPOINT = IdEndpoint.get("@@local");
export const BROADCAST      = IdEndpoint.get("@@any");