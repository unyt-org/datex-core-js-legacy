
// parent class for &,| value compositions (logical formulas)
// CNF

import type { Class } from "../utils/global_types.ts";
import { Runtime } from "../runtime/runtime.ts";
import { ReactiveValue } from "../runtime/pointers.ts";

import { RuntimeError } from "./errors.ts";
import { Assertion } from "./assertion.ts";
import { Type } from "./type.ts";
import { Datex } from "../mod.ts";

export type literal<T> = T|Negation<T>|Assertion<T>; // x, ~x
type cnf_disjunction<T> = Disjunction<literal<T>>|literal<T>; // x, x|y, x|~y, ...
export type cnf<T> = Conjunction<cnf_disjunction<T>>; // (x|y) & (z) & ...

export type clause<T> = literal<T>|Logical<clause<T>>


export interface LogicalComparator<T> {
	logicalMatch(value:T, against:T): boolean
}

// parent class for and, or, not
export class Logical<T> extends Set<T> {

	constructor(values?: T[]|[T]) {
		// ignore 'undefined' values
		super(values?.filter(v=>v!==undefined))
	}


	// create new conjunction
	and(value:T):Conjunction<clause<T>> {
		return new Conjunction<clause<T>>(this, value);
	}

	// create new disjunction
	or(value:T):Disjunction<clause<T>> {
		return new Disjunction<clause<T>>(this, value);
	}

	// create new negation
	not():Negation<clause<T>>|T {
		if (this instanceof Negation) return [...this][0]; // double negation
		else return new Negation<clause<T>>(this);
	}

	protected sampleValue():T|void{
		if (this.size) {
			const first = [...this][0];
			if (first instanceof Logical) return first.sampleValue();
			else return first;
		}
	}

	override toString(){
		return Runtime.valueToDatexString(this);
	}

	// value clause matches against other clause
	// if no atomic_class is provided, the first value clause literal is used to determine a atomic class
    public static matches<T>(value:clause<T>, against:clause<T>, atomic_class?:Class<T>&LogicalComparator<T>, assertionValue = value, throwInvalidAssertion = false): boolean {

		// TODO: empty - does not match?
		if (against === undefined) return false;

		value = <clause<T>> Datex.ReactiveValue.collapseValue(value, true, true);
		against = <clause<T>> Datex.ReactiveValue.collapseValue(against, true, true);

		// auto infer atomic class
		if (atomic_class === undefined) {
			const atomic_value = (value instanceof Logical ? (<Logical<clause<T>>>value).sampleValue() : value) ?? (against instanceof Logical ? (<Logical<clause<T>>>against).sampleValue() : against);
			atomic_class = (<any>atomic_value)?.constructor;
			if (typeof atomic_class != "function" || !atomic_class.logicalMatch) throw new RuntimeError("Could not infer valid atomic type for match check");
		}

		if (typeof atomic_class != "function" || !atomic_class.logicalMatch) throw new RuntimeError("Invalid atomic type for match check");

        // or (all parts must match)
        if (value instanceof Disjunction) {
			//  TODO: empty disjunction == any?
			if (value.size == 0) return true;

            for (const p of value) {
                if (!(this.matches(p, against, atomic_class, assertionValue, throwInvalidAssertion))) return false; 
            }
            return true;
        }
        // and (any part must match)
        if (value instanceof Conjunction) {
			//  TODO: empty disjunction == any?
			if (value.size == 0) return true;
			
            for (const p of value) {
                if (this.matches(p, against, atomic_class, assertionValue, throwInvalidAssertion)) return true;
            }
            return false;
        }
        // not
        if (value instanceof Negation) {
            return !this.matches(value.not(), against, atomic_class, assertionValue, throwInvalidAssertion)
        }

		// assertion
		if (value instanceof Assertion) {
			throw "TODO asssertion";
			// if (res instanceof Promise) throw new RuntimeError("async assertion cannot be evaluated in logical connective");
			// return res
		}
        
		// default
		return this.matchesSingle(<T>ReactiveValue.collapseValue(value, true, true), against, atomic_class, assertionValue, throwInvalidAssertion);
        
    }

    private static matchesSingle<T>(atomic_value:T, against: clause<T>, atomic_class:Class<T>&LogicalComparator<T>, assertionValue = atomic_value, throwInvalidAssertion = false): boolean {

		atomic_value = <T> Datex.ReactiveValue.collapseValue(atomic_value, true, true);
		against = <clause<T>> Datex.ReactiveValue.collapseValue(against, true, true);

		// wrong atomic type for atomic_value at runtime
		if (atomic_class && !(atomic_value instanceof atomic_class)) throw new RuntimeError(`Invalid match check: atomic value has wrong type (expected ${Type.getClassDatexType(atomic_class)}, found ${Type.ofValue(atomic_value)})`);

        // or
        if (against instanceof Disjunction) {
			//  TODO:empty disjunction == any?
			if (against.size == 0) return true;
            for (const t of against) {
                if (this.matchesSingle(atomic_value, t, atomic_class, assertionValue, throwInvalidAssertion)) return true; // any type matches
            }
            return false;
        }
        // and
        if (against instanceof Conjunction) {
            for (const t of against) {
                if (!this.matchesSingle(atomic_value, t, atomic_class, assertionValue, throwInvalidAssertion)) return false; // any type does not match
            }
            return true;
        }
        // not
        if (against instanceof Negation) {
            return !this.matchesSingle(atomic_value, against.not(), atomic_class, assertionValue, throwInvalidAssertion)
        }

		// assertion
		if (against instanceof Assertion) {
			const res = against.assert(assertionValue, undefined, !throwInvalidAssertion);
			if (res instanceof Promise) throw new RuntimeError("async assertion cannot be evaluated in logical connective");
			return res
		}


		// wrong atomic type at runtime
		// guard for: against is T
		if (!(against instanceof atomic_class)) {
			console.error(`Invalid match check: atomic value has wrong type (expected ${Type.getClassDatexType(atomic_class)}, found ${Type.ofValue(against)})`)
			// throw new RuntimeError(`Invalid match check: atomic value has wrong type (expected ${Type.getClassDatexType(atomic_class)}, found ${Type.ofValue(against)})`);
			return true;
		}

		// match
		return atomic_class.logicalMatch(<T>ReactiveValue.collapseValue(atomic_value, true, true), <T>against);
    }


	// collapse clause to list
	public static collapse<T>(value:clause<T>, atomic_class:Class<T>&LogicalComparator<T>): Disjunction<T> {
		const list = new Disjunction<T>();

		this.addToCollapseList(value, atomic_class, list);

		return list;
	}

	private static addToCollapseList<T>(value:clause<T>, atomic_class:Class<T>&LogicalComparator<T>, list:Disjunction<T>) {

		if (typeof atomic_class != "function" || !atomic_class.logicalMatch) throw new RuntimeError("Invalid atomic type for logical collapse");

        // or: add every value
        if (value instanceof Disjunction) {
            for (const p of value) {
				if (!this.addToCollapseList(p, atomic_class, list)) return false; // recursive and possible early cancel
            }
            return true;
        }
        // and
        if (value instanceof Conjunction) {
            for (const p of value) {
				// TODO: calculate intersection
				// and contradiction
                if (!this.matches(p, list, atomic_class)) {
					list.clear();
					return false; 
				}
				// add
				if (!this.addToCollapseList(p, atomic_class, list)) return false; // recursive and possible early cancel
            }
            return true;
        }
        // not
        if (value instanceof Negation) {
            return false // TODO:
        }
        
		// default

		value = <T>ReactiveValue.collapseValue(value, true, true)
		if (!(value instanceof atomic_class)) throw new RuntimeError(`logical collapse: atomic value has wrong type (expected ${Type.getClassDatexType(atomic_class)}, found ${Type.ofValue(value)})`);

		list.add(<T>value);

		return true;
	}
}

// ~value
export class Negation<T> extends Logical<T> {
	// only a single value
	constructor(value:T) {
		super([value]);
	}

}

// logical connective ("and" or "or")
export abstract class Connective<T> extends Logical<T> {
	constructor(...values:T[]|[T]) {
		super(values);
	}
}

// x & y
export class Conjunction<T> extends Connective<T> {

	// change internally
	appendAnd(value:T) {
		this.add(value);
	}
	
}

// x | y
export class Disjunction<T> extends Connective<T> {

	// change internally
	appendOr(value:T) {
		this.add(value);
	}

}