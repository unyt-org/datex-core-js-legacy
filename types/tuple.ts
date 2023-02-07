import { ValueError } from "./errors.ts";
import { DatexObject } from "./object.ts";

// Tuple
export class Tuple<T=any> {

    // '#' not working with proxy?
    _indexed:Array<T> = [];
    _named:Map<string,T> = new Map();

    constructor(initial_value?:T[]|Set<T>|Map<string,T>|Object){
        if (initial_value instanceof Array || initial_value instanceof Set) {
            this._indexed.push(...initial_value);
        }
        else if (initial_value instanceof Map) {
            for (const [k,v] of initial_value) this._named.set(k,v);
        }
        else if (typeof initial_value === "object"){
            for (let [name,value] of Object.entries(initial_value)) this._named.set(name, value);
        }
        else if (initial_value != null) throw new ValueError("Invalid initial value for <Tuple>");
    }

    seal(){
        DatexObject.seal(this);
        return this;
    }

    get indexed(){
        return this._indexed;
    }

    get named(){
        return this._named;
    }

    // total size (number + string indices)
    get size(){
        return this._named.size + this._indexed.length;
    }

    // set value at index
    set(index:number|bigint|string, value:any) {
        if (typeof index === "number" || typeof index === "bigint") this._indexed[Number(index)] = value;
        else if (typeof index === "string") this._named.set(index, value);
        else throw new ValueError("<Tuple> key must be <text> or <integer>")
    }

    // get value at index
    get(index:number|bigint|string) {
        if (typeof index === "number" || typeof index === "bigint") return this._indexed[Number(index)];
        else if (typeof index === "string") return this._named.get(index);
        else throw new ValueError("<Tuple> key must be <text> or <integer>")
    }

    // get value at index
    has(index:number|bigint|string) {
        if (typeof index === "number" || typeof index === "bigint") return Number(index) in this._indexed;
        else if (typeof index === "string") return this._named.has(index);
        else throw new ValueError("<Tuple> key must be <text> or <integer>")
    }
    
    hasValue(value:any) {
        return this._indexed.includes(value) || [...this._named.values()].includes(value)
    }

    // return copy of internal array if only number indices
    toArray() {
        if (this._named.size == 0) return [...this._indexed];
        else throw new ValueError("<Tuple> has non-integer indices");
    }

    // to object
    toObject() {
        if (this._indexed.length == 0) return Object.fromEntries(this._named);
        else throw new ValueError("<Tuple> has integer indices");
    }

    entries(): Iterable<readonly [bigint|string, T]> {
        return this[Symbol.iterator]();
    }

    *keys(): Iterable<bigint|string> {
        for (const entry of this._indexed.keys()) yield BigInt(entry[0]);
        for (const entry of this._named.keys()) yield entry;
    }

    // create full copy
    clone(){
        const cloned = new Tuple(this.named);
        cloned.indexed.push(...this.indexed)
        return cloned;
    }

    // push to array
    push(...values:any[]){
        this._indexed.push(...values);
    }


    // push and add
    spread(other:Tuple) {
        this._indexed.push(...other.indexed);
        for (let [name,value] of other.named.entries()) this._named.set(name, value);
    }

    *[Symbol.iterator]() {
        for (const entry of this._indexed.entries()) {
            yield [BigInt(entry[0]), entry[1]];
        }
        for (const entry of this._named.entries()) yield entry;
    }

    // generate Tuple of start..end
    static generateRange(start:bigint|number, end:bigint|number): Tuple<bigint>{
        if (typeof start == "number") start = BigInt(start);
        if (typeof end == "number") end = BigInt(end);

        if (typeof start != "bigint" || typeof end != "bigint") throw new ValueError("Range only accepts <integer> as boundaries");
        if (end<start) throw new ValueError("Second range boundary must be greater than or equal to the first boundary");

        const N = Number(end-start), range = new Tuple<bigint>();
        let i = 0n;
        while (i < N) range[Number(i)] = start + i++;

        return range.seal();
    }
}