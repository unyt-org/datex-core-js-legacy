import { Unit, code_to_extended_symbol} from "../compiler/unit_codes.ts";
import { Quantity } from "./quantity.ts";

export class Time extends Date {


	constructor(time:string|number|Date = new Date()) {
		if (typeof time == "string") super(Date.parse(time.replace(/~/g,"")))
		else if (time instanceof Date) super(time)
		else super(time);
	}

	override toString(): string {
		return `~${this.toISOString().replace("T"," ").replace("Z","")}~`
	}

	plus(time:Quantity<Unit.SECOND|Unit.CMO>): Time
	plus(amount: number, unit: code_to_extended_symbol<Unit.SECOND|Unit.CMO>): Time
	plus(time:Quantity<Unit.SECOND|Unit.CMO>|number, unit?: code_to_extended_symbol<Unit.SECOND|Unit.CMO>) {
		if (typeof time == "number") {
			if (unit == undefined) throw new Error("unit is required")
			else time = new Quantity(time, unit)
		}

		if (time.hasBaseUnit('s')) {
			return new Time(this.getTime()+(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			const new_time = new Time(this);
			new_time.add(time);
			return new_time
		}
		else {
			throw new Error("Invalid time unit")
		}
	}

	minus(time:Quantity<Unit.SECOND|Unit.CMO>): Time
	minus(amount: number, unit: code_to_extended_symbol<Unit.SECOND|Unit.CMO>): Time
	minus(time:Quantity<Unit.SECOND|Unit.CMO>|number, unit?: code_to_extended_symbol<Unit.SECOND|Unit.CMO>) {
		if (typeof time == "number") {
			if (unit == undefined) throw new Error("unit is required")
			else time = new Quantity(time, unit)
		}

		if (time.hasBaseUnit('s')) {
			return new Time(this.getTime()-(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			const new_time = new Time(this);
			new_time.subtract(time);
			return new_time
		}
		else {
			throw new Error("Invalid time unit")
		}
	}



	add(time:Quantity<Unit.SECOND|Unit.CMO>): void
	add(amount: number, unit: code_to_extended_symbol<Unit.SECOND|Unit.CMO>): void
	add(time:Quantity<Unit.SECOND|Unit.CMO>|number, unit?: code_to_extended_symbol<Unit.SECOND|Unit.CMO>) {
		if (typeof time == "number") {
			if (unit == undefined) throw new Error("unit is required")
			else time = new Quantity(time, unit)
		}

		if (time.hasBaseUnit('s')) {
			this.setTime(this.getTime()+(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			this.setMonth(this.getMonth()+time.value);
		}
		else {
			throw new Error("Invalid time unit")
		}
	}

	subtract(time:Quantity<Unit.SECOND|Unit.CMO>): void
	subtract(amount: number, unit: code_to_extended_symbol<Unit.SECOND|Unit.CMO>): void
	subtract(time:Quantity<Unit.SECOND|Unit.CMO>|number, unit?: code_to_extended_symbol<Unit.SECOND|Unit.CMO>) {
		if (typeof time == "number") {
			if (unit == undefined) throw new Error("unit is required")
			else time = new Quantity(time, unit)
		}

		if (time.hasBaseUnit('s')) {
			this.setTime(this.getTime()-(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			this.setMonth(this.getMonth()-time.value);
		}
		else {
			throw new Error("Invalid time unit")
		}
	}

}