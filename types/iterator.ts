import { Tuple } from "./tuple.ts";
import type { datex_scope } from "../utils/global_types.ts";
import type { ValueConsumer } from "./abstract_types.ts";

export class Iterator<T> {

    val?: T;
    #done = false;

    // can be reiterated
    reiterate = true
    #recording = true;
    #recorded:T[] = [];


    internal_iterator: globalThis.Iterator<T>|globalThis.AsyncIterator<T>

    constructor(iterator?:globalThis.Iterator<T>|globalThis.AsyncIterator<T>) {
        this.internal_iterator = iterator ?? this.generator();
    }

    async next(): Promise<boolean> {
        if (this.#done) return false; // already done

        // use internal JS iterator / generator method
        const res = await this.internal_iterator.next()

        // not done
        if (!res.done) {
            this.val = res.value;
            if (this.reiterate && this.#recording) this.#recorded.push(this.val);
        }
        // done
        else this.#done = res.done;

        // reset
        if (this.#done && this.reiterate) {
            this.reset();
            return false; // is done for now
        }
        return !this.#done;
    }

    private reset(){
        if (!this.reiterate) return;
        // has recorded now
        if (this.#recording) this.#recording = false;

        // create new iterator
        this.internal_iterator = Iterator.getJSIterator(this.#recorded) // iterate recorded

        this.#done = false;
    }


    async *[Symbol.iterator] (){
        while (await this.next()) yield this.val;
    }

    async collapse():Promise<Tuple>{
        // already recorded everything
        if (this.reiterate && !this.#recording) return new Tuple(this.#recorded);
        
        // record
        this.reiterate = true;
        while (await this.next());
        return new Tuple(this.#recorded);
    }

    // convert value to default iterator
    public static get<T>(iterator_or_iterable:globalThis.Iterator<T>|globalThis.Iterable<T>|Iterator<T>|IterationFunction):Iterator<T> {
        if (iterator_or_iterable instanceof Iterator) return iterator_or_iterable;
        else if (iterator_or_iterable instanceof IterationFunction) {
            console.log("iterator for iteration function", iterator_or_iterable)
        }
        // indexed tuple
        else if (iterator_or_iterable instanceof Tuple && iterator_or_iterable.named.size == 0) return new Iterator(Iterator.getJSIterator(iterator_or_iterable.toArray()))
        return new Iterator(Iterator.getJSIterator(iterator_or_iterable)); // create any other iterator or single value iterator
    }

    protected static getJSIterator<T>(iterator_or_iterable:Iterator<T>|globalThis.Iterator<T>|globalThis.Iterable<T>):globalThis.Iterator<T>|globalThis.AsyncIterator<T> {
        if (iterator_or_iterable instanceof Iterator) return iterator_or_iterable.internal_iterator;
        else if (typeof iterator_or_iterable == "function") return iterator_or_iterable;
        else return (typeof iterator_or_iterable != "string" && iterator_or_iterable?.[Symbol.iterator]) ? 
            iterator_or_iterable?.[Symbol.iterator]() : 
            [iterator_or_iterable][Symbol.iterator]()
    }

    // map globalThis.Iterator with function
    
    public static map<T,N>(iterator_or_iterable:Iterator<T>|globalThis.Iterator<T>|globalThis.Iterable<T>, map:(value:T)=>N):MappingIterator<T,N> {
        return new MappingIterator(iterator_or_iterable, map);
    }


    protected *generator():Generator<T>{}
}


class MappingIterator<T,N> extends Iterator<N> {

    #iterator:globalThis.Iterator<T>|globalThis.AsyncIterator<T>;
    #map:(value:T)=>Promise<N>|N;

    constructor(iterator_or_iterable:Iterator<T>|globalThis.Iterator<T>|globalThis.Iterable<T>, map:(value:T)=>Promise<N>|N) {
        super();
        this.internal_iterator = this.asyncGenerator();
        this.#iterator = Iterator.getJSIterator(iterator_or_iterable);
        this.#map = map;
    }

    protected async *asyncGenerator() {
        let result = await this.#iterator?.next();
        while (!result?.done) {
            yield await this.#map(result.value);
            result = await this.#iterator.next();
        }
    }
    
}



export class RangeIterator extends Iterator<bigint> {

    #min:bigint;
    #max:bigint;

    constructor(min:number|bigint, max:number|bigint) {
        super();

        this.#min = typeof min == "number" ? BigInt(Math.floor(min)) : min;
        this.#max = typeof max == "number" ? BigInt(Math.floor(max)) : max;

    }

    protected override *generator() {
        while (this.#min < this.#max) {
            yield this.#min;
            this.#min++;
        }
    }
    
}


export class IterationFunction implements ValueConsumer  {

    handleApply(value: any, SCOPE?: datex_scope) {
        // don't await result
        this.handleApply(value, SCOPE);
    }

}