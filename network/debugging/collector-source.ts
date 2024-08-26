import { Endpoint } from "../../datex_all.ts";
import { ObjectRef } from "../../runtime/pointers.ts";
import { CollectorDebuggingInterface } from "./collector-target.ts";
import { DebuggingInterface } from "./debugging-interface.ts";

let debuggingInterface: ObjectRef<DebuggingInterface> | undefined;
export const shareDebuggingInterface = async (collectorTarget: Endpoint) => {
	debuggingInterface = $$(new DebuggingInterface());
	await CollectorDebuggingInterface.registerInterface.to(collectorTarget)(debuggingInterface);
}