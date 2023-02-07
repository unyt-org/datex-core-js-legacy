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





// /** a complex filter consisting of filter targets and negations, CNF */
// export class Filter {

// 	filter:AndSet<filter> = new AndSet();
// 	normal_filter: CNF;

// 	set(...ors:filter[]):void {
// 		// convert all strings to filters
// 		for (let o=0; o<ors.length;o++) {
// 			const or = ors[o];
// 			if (typeof or == "string") ors[o] = Filter.fromString(or);
// 		}
// 		this.filter = new AndSet(ors);
// 		this.calculateNormalForm();
// 	}

// 	constructor(...ors:filter[]) {
// 		this.set(...<any>ors)
// 	}

// 	// append a filter (AND) to the current filter
// 	appendFilter(filter:filter) {
// 		if (typeof filter == "string") filter = Filter.fromString(filter);
// 		this.filter.add(filter)
// 		this.calculateNormalForm();
// 	}


// 	static createMergedFilter(f1:filter, f2:filter) {
// 		return new Filter(f1, f2);
// 	}

// 	/** helper functions */
// 	// merge cnf with other cnf
// 	static concatAndCNFs(cnf1:CNF, cnf2:CNF):boolean {

// 		or2: for (let or2 of cnf2||[]) {
// 			// iterate over all literals of new cnf2
// 			for (let literal2 of (or2 instanceof Set ? or2 : [or2])) {
				
// 				// iterate over all literals of cnf1
// 				for (const or1 of cnf1||[]) {

// 					let or1_it = (or1 instanceof Set ? or1 : [or1]); // iterator for or1

// 					// check if all literals endpoints
// 					let all_1_endpoints = true;
// 					for (let literal1 of or1_it) {
// 						if (!(literal1 instanceof Endpoint)) {all_1_endpoints = false; break;}
// 					}

// 					// all literals are endpoints in or1 (@x | @y | +app)
// 					if (all_1_endpoints) {

// 						for (let literal1 of or1_it) {

// 							// literal1 in first or, negated literal2 in second or -> delete both
// 							if (literal1 == Not.get(literal2)) {
// 								// delete literal1
// 								if (or1 instanceof Set) or1.delete(literal1); 
// 								else cnf1.delete(literal1)
// 								// delete literal2
// 								if (or2 instanceof Set) or2.delete(literal2); 
// 								else continue or2; // literal2 only a single value, don't add or2
// 							}
	
							
	
// 							// (main part of literal2) == literal1 -> literal1 is redundant
// 							if (literal2 instanceof Endpoint && literal1 == literal2.main) {
// 								// delete literal1
// 								if (or1 instanceof Set) or1.delete(literal1); 
// 								else cnf1.delete(literal1)
// 							}
// 							// (main part of literal1) == literal2 -> literal2 is redundant
// 							if (literal1 instanceof Endpoint && literal2 == literal1.main) {
// 								// delete literal2
// 								if (or2 instanceof Set) or2.delete(literal2); 
// 								else continue or2; // literal2 only a single value, don't add or2
// 							}
	
// 							// ~literal1, literal2/xy -> invalid
// 							if (literal1 instanceof Not && literal2 instanceof Endpoint && literal1.value == literal2.main) return false
// 							if (literal2 instanceof Not && literal1 instanceof Endpoint && literal2.value == literal1.main) return false
	
// 							if (literal1 instanceof Endpoint && literal2 instanceof Endpoint) {
// 								// literal1 = a/xy already exists, literal2 == a, can be removed
// 								if (literal1.main == literal2.main && literal1.instance!=undefined && literal2.instance==undefined) {
// 									// delete literal2
// 									if (or2 instanceof Set) or2.delete(literal2); 
// 									else continue or2; // literal2 only a single value, don't add or2
// 								}
// 							}
// 						}
// 					}
					
// 				}
// 			}

// 			if (or2 instanceof Set && or2.size == 0) continue; // is empty now, ignore
// 			if (or2 instanceof Set && or2.size==1) or2 = [...or2][0] // if or-Set with single value, collapse Set

// 			// now add or2 to cnf1 AndSet 
// 			cnf1.add(or2);
// 		}
	
// 		return true;
// 	}

// 	// all possible (valid) combinations of n sets
// 	static* cartesian(...tail:any[]):Generator<Set<Target|Not<Target>>,void,any> {
// 		let head = tail.shift();
// 		let remainder = tail.length ? Filter.cartesian(...tail) : [[]];
// 		for (const r of remainder||[]) for (const h of head||[]) {
// 			let ors = new Set([...(h instanceof Set ? h : [h]), ...r]);
// 			for (const o of ors) {
// 				// check if contradicting values (!x | x) can be deleted
// 				let not_o = Not.get(o);
// 				if (ors.has(not_o)) {ors.delete(not_o);ors.delete(o)} 

// 				// main part already exists
// 				if (o instanceof Endpoint && ors.has(o.main)) {ors.delete(o)} 
// 			}
// 			yield ors;
// 		}
// 	}

// 	// create new a or b or c filter
// 	public static OR(...ors:(Filter|Target|Not|string)[]):Filter {
// 		let ors_set:Set<filter> = new Set();
// 		for (let or of ors) {
// 			if (typeof or == "string") ors_set.add(Filter.fromString(or));
// 			else ors_set.add(or);
// 		}
// 		return new Filter(ors_set);
// 	}
// 	// create new a and b and c filter
// 	public static AND(...ands:(Filter|Target|Not|string)[]):Filter {
// 		let and_set:Set<filter> = new Set();
// 		for (let and of ands) {
// 			if (typeof and == "string") and_set.add(Filter.fromString(and));
// 			else and_set.add(and);
// 		}
// 		return new Filter(...and_set);
// 	}


// 	/**
// 	 * returns a datex_filter from a single target string (e.g. '@xy') or label ('#xy')
// 	 * @param target_string a single filter target or a label
// 	 * @returns a <Filter>, <Target>, <Array>, <Set> or <Tuple> that the given string describes
// 	 */
// 	public static fromString(target_string: string):filter {
// 		// is label
// 		if (target_string.match(LABELED_POINTER)) {
// 			let filter = Pointer.getByLabel(target_string.slice(1)).value;
// 			if(!(filter instanceof Filter || filter instanceof Target || filter instanceof Array || filter instanceof Set)) {
// 				throw new ValueError("Invalid type: <Filter>, <Target>, <Tuple>, <Set> or <Array> expected")
// 			}
// 			return filter;
// 		}
// 		// is target
// 		return Target.get(target_string);
// 	}

// 	/**
// 	 * returns a datex_filter evaluated from a valid DATEX Script string that evaluates to a filter (e.g '@x & #yz | +app')
// 	 * @param filter_string a DATEX Script string that returns a valid <Filter>, <Target>, <Array>, <Set> or <Tuple>
// 	 */
// 	public static async fromFilterString(filter_string:string): Promise<filter> {
// 		const filter = await Runtime.executeDatexLocally(filter_string, {type:ProtocolDataType.DATA});
// 		if(!(filter instanceof Filter || filter instanceof Target || filter instanceof Array || filter instanceof Set)) {
// 			console.warn(filter);
// 			throw new ValueError("Invalid type: <Filter>, <Target>, <Tuple>, <Set>, or <Array> expected")
// 		}
// 		else return filter;
// 	}

// 	public toString(formatted=false){
// 		let string = '';//'(';
// 		let cnf = this.calculateNormalForm();
		
// 		let i = cnf.size;
// 		for (let and of cnf) {
// 			string += "("
// 			let j = (and instanceof Set ? and.size : 1);
// 			for (let or of (and instanceof Set ? and : [and])) {
// 				if (or instanceof Not) string += "~" + or.value.toString()
// 				else string += or.toString()
// 				j--;
// 				if (j > 0) string += " | ";
// 			}
// 			string += ")";
// 			i--;
// 			if (i > 0) string += " & ";
// 		}

// 		if (cnf.size == 0) string = "()";

// 		//string += ')';

// 		return string;
// 	}

// 	// returns all endpoints of the filter that could possible be valid (does not evaluate labels etc...!)
// 	public getPositiveEndpoints(){
// 		let cnf = this.calculateNormalForm();
// 		let endpoints = new Set<Endpoint>();

// 		for (let and of cnf) {
// 			for (let or of (and instanceof Set ? and : [and])) {
// 				if (or instanceof Endpoint) endpoints.add(or);
// 			}
// 		}
// 		return endpoints;
// 	}

// 	public calculateNormalForm(resolve_pointers = true) {
// 		//if (this.normal_filter) return this.normal_filter;
// 		const cnf = Filter.toNormalForm(this, resolve_pointers);
// 		if (resolve_pointers) this.normal_filter = cnf;
// 		return cnf;    }

// 	// check if a set of properties are valid properties for this <Filter>
// 	public test(...properties:Target[]){
// 		let props = new Set(properties)
// 		let main_parts = new Set<Target>();
// 		for (let prop of props) {
// 			if (prop instanceof Endpoint && prop.main) main_parts.add(prop.main);
// 		}

// 		let cnf = this.calculateNormalForm();
// 		for (let and of cnf) {
// 			let valid = false;
// 			for (let or of (and instanceof Set ? and : [and])) {
// 				if (or instanceof Not && !props.has((<Not<Target>> or).value) && !main_parts.has((<Not<Target>> or).value)) {valid=true;break} // or is okay
// 				if (or instanceof Target && props.has(or)) {valid=true;break}; // or is okay 
// 				if (or instanceof Target && main_parts.has(or)) {valid=true;break}; // or is okay 
// 			}
// 			if (!valid) return false;
// 		}
// 		return true;
// 	}

// 	// check if filter is exactly equal to a given target
// 	public equals(target:Endpoint) {
// 		if (this.filter.size == 1) {
// 			let first = [...this.filter][0];
// 			if (first instanceof Set && first.size == 1) first = [...first][0];
// 			// is same as target endpoint?
// 			if (first instanceof Endpoint && target.equals(first)) return true;
// 		}
// 		return false;
// 	}


// 	// creates NF from any filter, always returns a DatexAnd value
// 	private static toNormalForm(filter:filter, resolve_pointers = true) {
// 		return this._toNormalForm(filter, resolve_pointers) || new AndSet();
// 	}

// 	// creates CNF from any filter, false if invalid
// 	private static _toNormalForm(filter:filter, resolve_pointers = true):CNF|false {
		
// 		// return pointer value as is
// 		if (!resolve_pointers) {
// 			const pointer = Pointer.getByValue(<any>filter);
// 			if (pointer) return <any> pointer; // return the pointer directly
// 		}
	

// 		// collapse <Filter>
// 		if (filter instanceof Filter) filter = filter.filter;

// 		let cnf:CNF


// 		// filter is a literal
// 		if (filter instanceof Target) {
// 			cnf = new AndSet();
// 			cnf.add(filter)
// 			return cnf;
// 		}
		

// 		// and
// 		if (filter instanceof AndSet) {
// 			let first = true;
// 			for (let f of filter) {
// 				// cnf ist first element of and set
// 				if (first) {
// 					let _cnf = Filter._toNormalForm(f);
// 					if (_cnf==false) return false;
// 					else cnf = _cnf;
// 					first = false;
// 					continue;
// 				}

// 				// concat other and elements
// 				let cnf2 = Filter._toNormalForm(f);
// 				if (cnf2==false) return false;
// 				if (!Filter.concatAndCNFs(cnf,cnf2)) return false;
// 			}
// 			return cnf ?? new AndSet();
// 		}

// 		// or
// 		if (filter instanceof Set) {
// 			cnf = new AndSet();
// 			let literals = [];
// 			for (let f of filter) {
// 				let lit = Filter._toNormalForm(f);
// 				if (lit!==false) literals.push(lit);
// 			}
// 			// get all (valid) combinations
// 			for (let c of Filter.cartesian(...literals)) {
// 				cnf.add(c.size == 1 ? [...c][0] : c);
// 			}

// 			return cnf;
// 		}

// 		// not 
// 		if (filter instanceof Not) {
// 			cnf = new AndSet();

// 			// collapse <Filter>
// 			let not_value = filter.value;
// 			if (not_value instanceof Filter) not_value = not_value.filter;

// 			// not variable
// 			if (not_value instanceof Target) {
// 				cnf.add(<Not<Target>>filter);
// 				return cnf;
// 			}

// 			// double not
// 			if (not_value instanceof Not) return Filter._toNormalForm(not_value.value);

// 			// not and
// 			if (not_value instanceof AndSet) {
// 				let ors = new Set<any>();
// 				for (let f of not_value) ors.add(Not.get(f));
// 				return Filter._toNormalForm(new AndSet([ors]))
// 			}
// 			// not or
// 			if (not_value instanceof Set) {
// 				let ors = new AndSet<any>();
// 				for (let f of not_value) ors.add(Not.get(f));
// 				return Filter._toNormalForm(ors)
// 			}

// 		}
// 	}


// 	serialize() {
// 		return Runtime.serializeValue(Filter.toNormalForm(this));
// 	}

// 	// get copy (normalized)
// 	clone(){
// 		this.calculateNormalForm();
// 		return new Filter(this.normal_filter);
// 	}

// 	// get set of filter endpoints
// 	evaluate(): Set<Target> {
// 		this.calculateNormalForm();
// 		let all = new Set<Target>();
// 		for (let ands of this.normal_filter) {
// 			// check each and
// 			if (ands instanceof Target) all.add(ands)
// 			else if (ands instanceof Set) {
// 				for (let and of ands) {
// 					if (and instanceof Target) all.add(and);
// 				}
// 			}
// 		}
// 		return all;
// 	}
// }



// /* negatet Datex filters / targets */
// export class Not<T=filter> {
// 	static negation_map = new WeakMap<any,any>()

// 	value:T;

// 	public static get(value:filter):filter {
// 		if (value instanceof Not) return value.value // double not - return original filter
// 		if (this.negation_map.has(value)) return this.negation_map.get(value);
// 		else return new Not(value);
// 	}

// 	private constructor(value:T) {
// 		this.value = value
// 		Not.negation_map.set(value, this);
// 	}
// }


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
	
	public static getClassFromBinaryCode(binary_code?:BinaryCode): typeof Person | typeof Institution | typeof Bot | typeof IdEndpoint {
		switch (binary_code) {
			case BinaryCode.PERSON_ALIAS: return Person;
			case BinaryCode.INSTITUTION_ALIAS: return Institution;
			case BinaryCode.BOT:return Bot;
			case BinaryCode.ENDPOINT: return IdEndpoint;

			case BinaryCode.PERSON_ALIAS_WILDCARD: return Person;
			case BinaryCode.INSTITUTION_ALIAS_WILDCARD: return Institution;
			case BinaryCode.BOT_WILDCARD:return Bot;
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

			// bot (TODO remove)
			else if (name.startsWith("*")) {
				name = name.substring(1);
				classType = Bot;
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
export class Bot extends Endpoint {
	static override prefix:target_prefix = "*"
	static override type = BinaryCode.BOT
	static override get(name:string, subspaces?:string[], instance?:string, appspace?:Endpoint){return  <Bot>super.get(name, subspaces, instance, appspace, Bot)}
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