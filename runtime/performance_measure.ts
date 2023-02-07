// used for Runtime/Compiler performance measuring

import { DatexObject } from "../types/object.ts";
import { logger } from "../utils/global_values.ts";


// average measured durations are available as DatexObjects
export class RuntimePerformance {

    static enabled = false;

    /** adds a new marker and measures + logs the time from a given start marker to the new marker*/

    static marker(description:string, new_marker:string, start_marker:string){
        if (!globalThis.performance?.getEntriesByName) return;
        if (!globalThis.performance.getEntriesByName("runtime_start").length) globalThis.performance.mark("runtime_start");
    
        const meas_name = start_marker+"-"+new_marker;
        globalThis.performance.mark(new_marker);
        globalThis.performance.measure(meas_name, start_marker);
        
        // TODO reenable
        //logger.info(`${description}: ${ Math.round(globalThis.performance.getEntriesByName(meas_name, 'measure')[0]?.duration)}ms`)
    }

    static #marker_count = new Map<string,number>();

    static #measurements_groups = new Map<string,object>(); // group name, measurement

    static MEAS_COUNT = Symbol("MEAS_COUNT")

    /** define/create a new measurement group object to save the average measured times */
    static createMeasureGroup(name:string, measurement_names:string[]=[]){
        const obj = Object.fromEntries(measurement_names.map(n=>[n,0]));
        const group = DatexObject.seal({[this.MEAS_COUNT]:obj, ...obj})
        this.#measurements_groups.set(name, group)
        return group;
    }

    // get a measure group object (DatexObject) for a previously defined measure group
    static getMeasureGroup(name:string){
        return this.#measurements_groups.get(name)
    }

    static startMeasure(group:string, name:string):PerformanceMark{
        if (!globalThis.performance?.getEntriesByName || !RuntimePerformance.enabled) return;
        if (!this.#measurements_groups.has(group)) throw new Error("Measurement group '"+group+"' is not defined");

        const count = (this.#marker_count.get(name)??0);
        this.#marker_count.set(name, count+1)

        const marker = globalThis.performance.mark(group+'_'+name+'_'+count, {detail:{group, name}})

        return marker;
    }

    static endMeasure(mark:string|PerformanceMark){
        if (!globalThis.performance?.getEntriesByName || !RuntimePerformance.enabled) return;
        const performance_mark = mark instanceof PerformanceMark ? mark : <PerformanceMark> globalThis.performance.getEntriesByName(mark, 'mark')[0];
        const mark_name = performance_mark.name;
        const name = performance_mark.detail.name;
        if (!performance_mark.detail.group) throw new Error("Performance mark has no assigned measurment group");

        const duration = globalThis.performance.measure(mark_name, mark_name).duration;
        const group = this.#measurements_groups.get(performance_mark.detail.group)
        const count = ++group[this.MEAS_COUNT][name];

        // calculate new average value
        group[name] = group[name] + (duration - group[name]) / count;

        return group
    }
}

globalThis.DatexRuntimePerformance = RuntimePerformance;
