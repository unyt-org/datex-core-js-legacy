import { client_type } from "../utils/constants.ts";

export const onlineStatus = $$(navigator?.onLine ?? true);
if (client_type === "deno") {
    // TODO
}
else {
    globalThis.addEventListener("online", () => onlineStatus.val = true);
    globalThis.addEventListener("offline", () => onlineStatus.val = false);
}