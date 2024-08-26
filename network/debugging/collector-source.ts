import { Endpoint } from "../../datex_all.ts";
import { f } from "../../datex_short.ts";
import { ObjectRef } from "../../runtime/pointers.ts";
import { DebuggingInterface } from "./debugging-interface.ts";

let debuggingInterface: ObjectRef<DebuggingInterface> | undefined;
export const shareDebuggingInterface = async (collectorTarget: Endpoint = f('@+unyt2')) => {
	debuggingInterface = $$(new DebuggingInterface());
	await DebuggingInterface.registerInterface.to(collectorTarget)(debuggingInterface);
}