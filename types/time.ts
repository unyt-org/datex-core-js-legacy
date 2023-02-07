import { Unit } from "../compiler/unit_codes.ts";
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


	plus(time:Quantity<Unit.SECOND|Unit.CMO>) {
		if (time.hasBaseUnit('s')) {
			return new Time(this.getTime()+(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			const new_time = new Time(this);
			new_time.add(time);
			return new_time
		}
	}

	minus(time:Quantity<Unit.SECOND|Unit.CMO>) {
		if (time.hasBaseUnit('s')) {
			return new Time(this.getTime()-(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			const new_time = new Time(this);
			new_time.subtract(time);
			return new_time
		}
	}



	add(time:Quantity<Unit.SECOND|Unit.CMO>) {
		if (time.hasBaseUnit('s')) {
			this.setTime(this.getTime()+(time.value*1000))
			console.log(this.getTime(), time.value*1000, this.getTime()+(time.value*1000))

		}
		else if (time.hasBaseUnit('Cmo')) {
			this.setMonth(this.getMonth()+time.value);
		}
	}

	subtract(time:Quantity<Unit.SECOND|Unit.CMO>) {
		if (time.hasBaseUnit('s')) {
			this.setTime(this.getTime()-(time.value*1000))
		}
		else if (time.hasBaseUnit('Cmo')) {
			this.setMonth(this.getMonth()-time.value);
		}
	}

}