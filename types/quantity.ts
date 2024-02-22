import { Unit, UnitCodeBySymbol, UnitCodeBySymbolShortForms, UnitPrefixCodeBySymbol, UnitSymbolShortFormsByCode, unit_factor, unit, unit_symbol, UnitSymbol, code_to_extended_symbol, UnitAliases, DerivedUnits, unit_base_symbol } from "../compiler/unit_codes.ts";
import { RuntimeError, SyntaxError, ValueError } from "./errors.ts";


/**
 * 
 * let x:Unit.METRE = new Unit(11, "cm");
 * let x:Unit.EUR   = new Unit(10000, "€");
 * 
 */

// deno-lint-ignore no-namespace
export namespace Quantity {

    export type SECOND  = Quantity<Unit.SECOND>
    export type METRE   = Quantity<Unit.METRE>
    export type GRAM    = Quantity<Unit.GRAM>
    export type AMPERE  = Quantity<Unit.AMPERE>
    export type KELVIN  = Quantity<Unit.KELVIN>
    export type MOLE    = Quantity<Unit.MOLE>
    export type CANDELA = Quantity<Unit.CANDELA>

    export type CMO     = Quantity<Unit.CMO>

    export type EUR     = Quantity<Unit.EUR>
    export type USD     = Quantity<Unit.USD>
    export type GBP     = Quantity<Unit.GBP>
    export type RUB     = Quantity<Unit.RUB>
    export type JPY     = Quantity<Unit.JPY>
    export type CNY     = Quantity<Unit.CNY>

}


type expanded_symbol = [factor_num:number|bigint, factor_den:number|bigint, unit:Unit, exponent?:number][];




// Quantity with unit
export class Quantity<U extends Unit = Unit> {

    static cached_binaries = new Map<string, ArrayBuffer>();

    static known_aliases = [
        ["g*m^2/A/s^3", "V", 1000n],
        ["g*m^2/s^2", "J", 1000n],
        ["g*m/s^2", "N", 1000n],
        ["g*m^2/s^3", "W", 1000n],
        ["A^2*s^4/g/m^2", "F", 1000n],
        ["g*m^2/A^2/s^3", "Ω", 1000n],
        ["s^-1", "Hz"],
        ["A*s", "C"],

        ["g", "kg", 1000n],

    ] as const


    static readonly EXPONENT_MIN = -128
    static readonly EXPONENT_MAX = 127

    #numerator!: bigint
    #denominator!: bigint

    get numerator():bigint {return this.#numerator}
    get denominator():bigint {return this.#denominator}

    get is_finite_decimal():boolean {return this.#hasFiniteDecimalRep(this.#denominator)}


    get sign():-1|0|1 {
        if (this.#numerator === 0n) return 0;
        return this.#numerator>0 ? 1 : -1; 
    }

    set value(value:number|bigint|string) {
        this.setFraction(...this.convertToFraction(value))
    }

    get value():number {
        return Number(this.#numerator)/Number(this.#denominator)
    }

    // returns quantity with value 1 and same unit
    #base_value?:Quantity<U>;
    get base_value():Quantity<U> {
        if (this.#base_value) return this.#base_value;
        else return this.#base_value = new Quantity(1, this.unit);
    }

    readonly unit: unit = []
    unit_binary!: ArrayBuffer
    unit_formatted!: string
    unit_formatted_short!: string
    short_divisor!: bigint

    get unit_factor_number() {return this.unit.length}

    /**
     * 
     * @param value can be a number, bigint, or string: '1.25', '1', '0.5e12', '1/10', or [numerator, denominator]
     * @param unit 
     */
    constructor(value?:number|bigint|string|[num:number|bigint, den:number|bigint], unit?:code_to_extended_symbol<U>)
    constructor(value?:number|bigint|string|[num:number|bigint, den:number|bigint], encoded_unit?:unit)
    constructor(value:number|bigint|string|[num:number|bigint, den:number|bigint] = 1, symbol_or_encoded_unit:string|unit = 'x') {

        // set value:
        if (typeof value == "number" || typeof value == "bigint" || typeof value == "string") this.value = value;
        else if (value instanceof Array) this.setFraction(value[0], value[1]);

        // set unit:
        // encoded array
        if (symbol_or_encoded_unit instanceof Array) this.unit = symbol_or_encoded_unit;
        // symbol string, parse
        else if (symbol_or_encoded_unit) {
            const [factor_num, factor_den, unit] = this.parseUnit(symbol_or_encoded_unit);
            this.unit = unit;
            this.multiply(factor_num);
            this.divide(factor_den);
        }

        this.setFormattedUnit();
        this.setUnitBinary();
    }


    // fraction/value handling ----------------------------------------------------------------------------------------------

    
    // numerator and denominator must be integer values!
    setFraction(numerator:number|bigint, denominator:number|bigint) {
        [this.#numerator, this.#denominator] = Quantity.#normalizeFraction(numerator, denominator)
    }

    static #normalizeFraction(numerator:number|bigint, denominator:number|bigint):[numerator:bigint, denominator:bigint] {
        // denominator always positive, numerator has sign
        if (numerator<0 && denominator <0) {
            numerator = -numerator;
            denominator = -denominator;
        }
        else if (numerator>=0 && denominator <0) {
            numerator = -numerator;
            denominator = -denominator;
        }

        numerator = BigInt(numerator)
        denominator = BigInt(denominator)


        // reduce to lowest terms
        const gcd = this.#gcd(numerator, denominator)

        if (gcd > 1n) {
            numerator /= gcd;
            denominator /= gcd;
        }
        else if (gcd < -1n) {
            numerator /= -gcd;
            denominator /= -gcd;
        }
        
        return [numerator, denominator];
    }

    // convert float or integer to (decimal) fraction
    convertToFraction(number:number|bigint|string):[numerator:bigint, denominator:bigint] {

        if (typeof number == "number" && (!Number.isFinite(number) || Number.isNaN(number))) throw new ValueError("Quantity value must be a finite number");

        try {
            let factor = 1n;
            let divisor = 1n;
    
            // remove underscores and spaces
            if (typeof number == "string") number = number.replace(/\ |\_/g, "");
    
            // fraction
            if (typeof number == "string" && number.includes("/")) {
                const [n, d] = number.split("/");
                return [BigInt(n), BigInt(d)]
            }
    
            // e
            if (typeof number == "string" && (number.includes("e") || number.includes("E"))) {
                const [n, e] = number.split(/e|E/);
                number = n;
                // negative exponent
                if (e[0] == '-') divisor = 10n ** BigInt(e.slice(1))
                // positive exponent
                else if (e[0] == '+') factor = 10n ** BigInt(e.slice(1))
                else factor = 10n ** BigInt(e)
            }
    
    
            // convert number to decimal fraction
            const value_parts = number.toString().split(".");
            const numerator = BigInt(value_parts.join(""));
            const denominator = value_parts[1] ? 10n**BigInt(value_parts[1].length) : 1n; // comma shift
    
            return [factor*numerator, divisor*denominator]
        }

        catch {
            throw new SyntaxError("Invalid quantity value '"+number+"'")
        }
        
    }   


    // greates common divisor (Euclidian algorithm)
    static #gcd (n1:bigint, n2:bigint):bigint {
        while (n2 !== 0n) {
            const t = n2;
            n2 = n1 % n2;
            n1 = t;
        }
        return n1;
    }
    

    // least common multiple
    static #lcm (n1:bigint, n2:bigint):bigint {
        return (n1 * n2) / this.#gcd(n1, n2);
    }
    

    static #isPowerOf10(n:bigint) {
        while(n > 1n && n % 10n == 0n){
            n /= 10n;
        }
        return n === 1n;
    }

    // prime factorization - complexity O(sqrt(n)) - probably more efficient
    // checks if only prime factors 2 and 5 are present
    #hasFiniteDecimalRep(denominator:bigint) {
        while (denominator % 2n == 0n) {
            denominator /= 2n;
        }
        for (let i = 3n; i * i <= denominator; i += 2n) {
            while (denominator % i == 0n) {
                denominator /= i;
                if (i != 2n && i != 5n) {
                    return false // not allowed
                }
            }
        }
        if (denominator > 2) { // for primes larger than 2
            if (denominator != 2n && denominator != 5n) {
                return false // not allowed
            }
        }

        return true;
    }

    #raiseUnitToPower(unit:unit, power:bigint|number) {
        power = Number(power);
        const new_exp = [];
        for (const u of unit) new_exp.push([u[0], u[1] * power]);
        return new_exp;
    }

    // returns buffer for absolute bigint value
    static bigIntToBuffer(n:bigint):Uint8Array {
        let hex = BigInt(n).toString(16).replace('-', '');
        if (hex.length % 2) { hex = '0' + hex; }
      
        const len = hex.length / 2;
        const u8 = new Uint8Array(len);
      
        let i = 0;
        let j = 0;
        while (i < len) {
          u8[i] = parseInt(hex.slice(j, j+2), 16);
          i += 1;
          j += 2;
        }
      
        return u8;
    }

    static bufferToBigInt(buffer:Uint8Array) {
        const hex:string[] = [];
      
        buffer.forEach(function (i) {
          let h = i.toString(16);
          if (h.length % 2) { h = '0' + h; }
          hex.push(h);
        });
      
        return BigInt('0x' + hex.join(''));
    }

    // unit handling ---------------------------------------------------------------------------------------------------------


    // TODO: type guard currently not working properly in TS (https://github.com/microsoft/TypeScript/issues/13995)
    hasBaseUnit<SYMBOL extends unit_base_symbol>(unit: Extract<SYMBOL, U extends Unit ? code_to_extended_symbol<U> : unknown>) { //: this is Quantity<symbol_to_code[SYMBOL]> {
        return this.unit_formatted_short === unit;
    }



    setUnitBinary() {
        const buffer = new ArrayBuffer(1+this.unit.length*2);
        const uint8 = new Uint8Array(buffer);
        const dataview = new DataView(buffer);

        // factor number
        uint8[0] = this.unit.length;

        let i = 1;
        // [unit_code] [exponent (-127 to 128)]
        for (const [code, exponent] of this.unit) {
            uint8[i++] = code;
            dataview.setInt8(i++, exponent)
        }

    
        // get cached
        if (Quantity.cached_binaries.has(this.unit_formatted)) this.unit_binary = <ArrayBuffer> Quantity.cached_binaries.get(this.unit_formatted)
        // save in cache
        else {
            this.unit_binary = buffer;
            Quantity.cached_binaries.set(this.unit_formatted, buffer)
        }
    }

    // parse unit and return updated value with factor
    parseUnit(unit?:string):[factor_num:bigint, factor_den:bigint, unit:unit] {

        // dimensionless
        if (!unit) return [1n, 1n, []];

        const encoded:unit = [];

        // combined factor k,M,G, ... prefixes
        let combined_factor_num = 1n; 
        let combined_factor_den = 1n; 

        const parts = unit.replace(/(\*|\/)/g, '#$1').split('#');

        for (let part of parts) {
            let exp = 1;
            // negative exponent
            if (part.startsWith("/")) {
                part = part.slice(1);
                exp = -1;
            }
            // positive exponent
            if (part.startsWith("*")) {
                part = part.slice(1);
            }

            const [symbol, exponent_string] = <[unit_symbol, string]>part.split("^");

            // ^ exponent
            if (exponent_string) exp *= parseInt(exponent_string);

            // exponent in valid range?
            if (exp < Quantity.EXPONENT_MIN) throw new SyntaxError("Minimum unit exponent is " + Quantity.EXPONENT_MIN)
            if (exp > Quantity.EXPONENT_MAX) throw new SyntaxError("Maximum unit exponent is " + Quantity.EXPONENT_MAX)

            // get expanded components from the symbol
            const expanded_symbol = this.getExpandedSymbolWithPrefix(symbol);

            for (const [factor_num, factor_den, unit, _exp] of expanded_symbol) {
                const exponent = (_exp??1) * exp; // multiply implicit exponent from expansion with exponent from unit string

                if (Math.sign(exponent) == 1) {
                    combined_factor_num *= BigInt(factor_num) // factor numerator
                    combined_factor_den *= BigInt(factor_den) // factor denominator
                }
                else {
                    combined_factor_num *= BigInt(factor_den) // inverse factor numerator
                    combined_factor_den *= BigInt(factor_num) // inverse factor denominator
                }

                // combine with existing
                this.#addUnitAndExponent(encoded, unit, exponent)
            }
            
        }

        this.#sortEncodedUnit(encoded)

        return [combined_factor_num, combined_factor_den, encoded];
    }

    

    // get binary code and factor from string symbol with prefix
    getExpandedSymbolWithPrefix(prefixed_symbol:string): expanded_symbol {
        const expanded_symbol = this.getExpandedSymbol(<unit_symbol>prefixed_symbol);
        // no prefix
        if (expanded_symbol != null) return expanded_symbol;

        // prefix
        else {
            const prefix_exp = UnitPrefixCodeBySymbol[prefixed_symbol[0]];
            // no valid prefix found
            if (prefix_exp == null) throw new SyntaxError("Invalid unit symbol '" + prefixed_symbol + "'")
           
            const expanded_symbol = this.getExpandedSymbol(<unit_symbol>prefixed_symbol.slice(1));
            // no valid symbol found
            if (expanded_symbol == null) throw new SyntaxError("Invalid unit symbol '" + prefixed_symbol + "'");

            // add prefix factor to first unit
            expanded_symbol.push([
                prefix_exp > 0 ? (10n ** BigInt(prefix_exp)) : 1, 
                prefix_exp < 0 ? (10n ** BigInt(-prefix_exp)) : 1, 
                Unit.DIMENSIONLESS
            ])

            return expanded_symbol;
        }
    }

    // get binary code from string symbol
    getExpandedSymbol(symbol:unit_symbol): expanded_symbol|undefined {
        if (symbol in UnitCodeBySymbol) return [[1, 1, UnitCodeBySymbol[symbol]]];
        else if (symbol in UnitCodeBySymbolShortForms) return [[1, 1, UnitCodeBySymbolShortForms[symbol]]];
        else if (symbol in UnitAliases) return [UnitAliases[symbol]];
        else if (symbol in DerivedUnits) return [...DerivedUnits[symbol]];
    }

    getCodeSymbol(symbol:Unit|unit_factor, abs_exponent = false) {
        const exponent = abs_exponent ? Math.abs(symbol[1]) : symbol[1];
        if (symbol instanceof Array) return `${this.getCodeSymbol(symbol[0])}${exponent==1 ? '' : '^'+exponent}`
        else return UnitSymbolShortFormsByCode[symbol] ?? UnitSymbol[symbol];
    }

    setFormattedUnit(){
        let formatted = "";
        let is_first = true;
        let format_divisor = 1n;

        for (const encoded of this.unit) {
            if (is_first) formatted += encoded[1] < 0 ? 'x/' : ''
            else formatted += encoded[1] < 0 ? '/' : '*'
            formatted += this.getCodeSymbol(encoded, true);

            is_first = false;
        }

        this.unit_formatted = formatted || UnitSymbol[Unit.DIMENSIONLESS];

        // replace with shortcut aliases
        for (const [expression, alias, divisor] of Quantity.known_aliases) {
            if (formatted.startsWith(expression)) {
                formatted = formatted.replace(expression, alias);
                if (divisor) format_divisor *= divisor;
            }
        }
        
        this.unit_formatted_short = formatted || UnitSymbol[Unit.DIMENSIONLESS];
        this.short_divisor = format_divisor;

    }


    equals(other:Quantity) {
        return this.hasSameDimension(other) && this.denominator === other.denominator && this.numerator === other.numerator
    }

    // operations

    product<F extends number|bigint|Quantity>(factor:F): F extends Quantity ? Quantity : Quantity<U> {
        if (factor instanceof Quantity) return new Quantity([this.numerator*factor.numerator,this.denominator*factor.denominator], this.#combineEncodedUnits(this.unit, factor.unit))
        else {
            const [num, den] = this.convertToFraction(factor);
            return new Quantity([this.numerator*num, this.denominator*den], this.unit)
        }
    }
    multiply(factor:number|bigint) {
        if (factor === 1n || factor === 1) return;
        const [num, den] = this.convertToFraction(factor);
        this.setFraction(this.numerator*num, this.denominator*den);
        return this;
    }

    quotient<D extends number|bigint|Quantity>(divisor:D): D extends Quantity ? Quantity : Quantity<U> {
        if (divisor instanceof Quantity) return new Quantity([this.numerator*divisor.denominator,this.denominator*divisor.numerator], this.#combineEncodedUnits(this.unit, this.#invertEncodedUnit(divisor.unit)))
        else {
            const [num, den] = this.convertToFraction(divisor);
            return new Quantity([this.numerator*den, this.denominator*num], this.unit)
        }
    }
    divide(divisor:number|bigint) {
        if (divisor === 1n || divisor === 1) return;
        const [num, den] = this.convertToFraction(divisor);
        this.setFraction(this.numerator*den, this.denominator*num);
        return this;
    }


    sum(summand:Quantity):Quantity<U> {        
        if (!this.hasSameDimension(summand)) throw new ValueError("Cannot add quantities, dimensions '"+this.unit_formatted+"' and '"+summand.unit_formatted+"' do not match");
        else {
            // same denominator
            if (this.denominator === summand.denominator) return new Quantity([this.numerator + summand.numerator, this.denominator], this.unit);

            // find common denominator
            const lcm = Quantity.#lcm(this.denominator, summand.denominator); 
            return new Quantity([this.numerator*(lcm/this.denominator) + summand.numerator*(lcm/summand.denominator), lcm], this.unit);
        }
    }
    add(summand:Quantity) {
        if (!this.hasSameDimension(summand)) throw new ValueError("Cannot add quantities, dimensions '"+this.unit_formatted+"' and '"+summand.unit_formatted+"' do not match");
        else {
            // same denominator
            if (this.denominator === summand.denominator) {
                this.setFraction(this.numerator + summand.numerator, this.denominator);
                return this;
            }

            // find common denominator
            const lcm = Quantity.#lcm(this.denominator, summand.denominator); 
            this.setFraction(this.numerator*(lcm/this.denominator) + summand.numerator*(lcm/summand.denominator), lcm);
            return this;
        }
    }


    difference(subtrahend:Quantity):Quantity<U> {
        if (!this.hasSameDimension(subtrahend)) throw new ValueError("Cannot subtract quantities, dimensions '"+this.unit_formatted+"' and '"+subtrahend.unit_formatted+"' do not match");
        else {
            // same denominator
            if (this.denominator === subtrahend.denominator) return new Quantity([this.numerator - subtrahend.numerator, this.denominator], this.unit);

            // find common denominator
            const lcm = Quantity.#lcm(this.denominator, subtrahend.denominator); 
            return new Quantity([this.numerator*(lcm/this.denominator) - subtrahend.numerator*(lcm/subtrahend.denominator), lcm], this.unit);
        }
    }
    subtract(subtrahend:Quantity) {
        if (!this.hasSameDimension(subtrahend)) throw new ValueError("Cannot subtract quantities, dimensions '"+this.unit_formatted+"' and '"+subtrahend.unit_formatted+"' do not match");
        else {
            // same denominator
            if (this.denominator === subtrahend.denominator) {
                this.setFraction(this.numerator - subtrahend.numerator, this.denominator);
                return this;
            }

            // find common denominator
            const lcm = Quantity.#lcm(this.denominator, subtrahend.denominator); 
            this.setFraction(this.numerator*(lcm/this.denominator) - subtrahend.numerator*(lcm/subtrahend.denominator), lcm);
            return this;
        }
    }

    power(exponent:number|bigint) {
        if (typeof exponent == "bigint" || Number.isInteger(exponent)) {
            console.log(this.numerator, this.denominator, exponent)
            if (exponent > 0) return new Quantity([this.numerator**BigInt(exponent), this.denominator**BigInt(exponent)], this.#raiseUnitToPower(this.unit, exponent))
            else return new Quantity([this.denominator**BigInt(-exponent), this.numerator**BigInt(-exponent)], this.#raiseUnitToPower(this.unit, exponent))
        }
        else throw new ValueError("Quantity exponentiation requires an integer exponent");
    }

    static compare(first:Quantity, second:Quantity):-1|0|1 {        
        if (!first.hasSameDimension(second)) throw new ValueError("Cannot compare quantities, dimensions '"+first.unit_formatted+"' and '"+second.unit_formatted+"' do not match");
        else {
            // find common denominator
            const lcm = Quantity.#lcm(first.denominator, second.denominator); 

            return <(-1|0|1)> Math.sign(Number(first.numerator*(lcm/first.denominator) - second.numerator*(lcm/second.denominator)));
        }
    }


    hasSameDimension(other:Quantity) {
        return this.unit_binary === other?.unit_binary; // same binaries are always pointing to the same arraybuffer
    }


    // add addtional unit with exponent to encoded unit factor list
    #addUnitAndExponent(encoded:unit, code:Unit, exponent:number){
        // ignore dimensionless
        if(code==Unit.DIMENSIONLESS) return;
            
        // combine with existing
        let existing = false;
        for (const el of encoded) {
            if (el[0] == code)  {
                el[1] += exponent;
                // remove
                if (el[1] == 0) encoded.splice(encoded.indexOf(el), 1);
                existing = true;
                break;
            }
        }
        // add new
        if (!existing) encoded.push([code, exponent])
    }

    #sortEncodedUnit(unit:unit) {
        unit.sort((v1,v2)=>{
            // '*' first, '/' last
            if (v2[1] > 0 && v1[1] < 0) return 1;
            if (v1[1] > 0 && v2[1] < 0) return -1;
            return v2[0]-v1[0];
        })
    } 
    
    // switch numerator and denominator
    #invertEncodedUnit(unit:unit):unit {
        return unit.map(val=>[val[0], -val[1]])
    }

    // add addtional unit with exponent to encoded unit factor list
    #combineEncodedUnits(unit1:unit, unit2:unit) {
        const new_unit = [...unit1];
        for (const part of unit2) this.#addUnitAndExponent(new_unit, ...part);
        this.#sortEncodedUnit(new_unit);
        return new_unit;
    }

    valueOf() {
        return this.value;
    }


    toString(formatting:Quantity.Formatting = Quantity.Formatting.WITH_ALIAS_UNIT, decimals?:number){
        if (formatting == Quantity.Formatting.NO_UNIT) return this.#valueToString(false, decimals);
        else return this.#valueToString(formatting == Quantity.Formatting.WITH_ALIAS_UNIT, decimals) + (formatting == Quantity.Formatting.WITH_ALIAS_UNIT ? this.unit_formatted_short : this.unit_formatted);
    }

    #valueToString(alias_factor=true, decimals?:number){
        let numerator = this.#numerator;
        let denominator = this.#denominator;

        // divide by short_divisor to match alias factor
        if (alias_factor) [numerator, denominator] = Quantity.#normalizeFraction(numerator, denominator*this.short_divisor);

        // fixed decimals
        if (decimals != undefined) return (Number(numerator)/Number(denominator)).toFixed(decimals);
        // finite decimal representation
        if (this.#hasFiniteDecimalRep(denominator)) return this.#finiteFractionToDecimalString(numerator, denominator);
        // fraction
        else  return `${numerator}/${denominator}`
    }

    // assumes that the fraction can be represented as a finite decimal value!
    #finiteFractionToDecimalString(numerator:bigint, denominator:bigint) {

        let shift = denominator.toString().length; // absolute value

        // TODO more efficient algorithm for this?

        // get next higher denominator with power of 10

        if (!Quantity.#isPowerOf10(denominator)) {

            let found = false;
            for (let x=0;x<10000;x++) { // only try 10000 iterations, works in first iteration in most cases


                // d % 10^x = 0 => solve s

                const new_denominator = 10n ** BigInt(shift) // new possible base 10 denominator

                // is integer factor, can use as new denominator
                if (new_denominator % denominator == 0n) {
                    numerator *= new_denominator / denominator;
                    found = true;
                    break;
                }
                // try higher denominator 
                else shift++; 
            }

            if (!found) throw new RuntimeError("Cannot convert unit to decimal fraction")
        }
        else {
            shift--;
        }


        const string = (numerator*BigInt(this.sign)).toString().padStart(shift,'0');
        const comma_shift = string.length-shift;
        const p1 = string.slice(0,comma_shift);
        const p2 = string.slice(comma_shift)

        return (this.sign==-1?'-':'') + p1 + (p2.length?(p1.length?'.':'0.'):'') + p2;
    }

}


// deno-lint-ignore no-namespace
export namespace Quantity {
    export enum Formatting {
        WITH_ALIAS_UNIT,
        WITH_UNIT,
        NO_UNIT
    }
}