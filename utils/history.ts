import { Ref, RefOrValue } from "../runtime/pointers.ts";

type HistoryStateChange = {
	type: Ref.UPDATE_TYPE,
	value: any,
	key?: any
}

export class History {

	#changes = new Array<HistoryStateChange>()

	include(val: RefOrValue<unknown>) {
		console.log("adding to history", val);
		Ref.observe(val, (value, key, type) => {
			console.warn(value,key,type);
			this.#changes.push({
				type,
				value,
				key
			})
		})
	}

	back() {

	}

	forward() {

	}

}