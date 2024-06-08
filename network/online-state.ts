import { Pointer } from "../runtime/pointers.ts";
import { client_type } from "../utils/constants.ts";
let onlineStatus: Pointer<boolean> | undefined = undefined;

export function getOnlineState() {
    if (!onlineStatus)
        onlineStatus = Pointer.createOrGet<boolean>(navigator?.onLine ?? true);
    if (client_type === "deno") {
        // TODO
    }
    else {
        globalThis.addEventListener("online", () => onlineStatus!.val = true);
        globalThis.addEventListener("offline", () => onlineStatus!.val = false);
    }
    return onlineStatus;
}
