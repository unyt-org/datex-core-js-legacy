import { Type } from "../types/type.ts";


export class Debugger {

}


// only temporary, remove
Type.std.Debugger.setJSInterface({
    class: Debugger,

    is_normal_object: true,
    proxify_children: true,
    visible_children: new Set(["pause"]),
})