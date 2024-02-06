
/**
 * Must be loaded in an iframe to allow communication with parent window
 */

import { Datex } from "../datex.ts";
import { communicationHub } from "../network/communication-hub.ts";
import { WindowInterface } from "../network/communication-interfaces/window-interface.ts";

await Datex.Supranet.init();
const windowInterface = WindowInterface.createParentInterface(window.parent)
await communicationHub.addInterface(windowInterface, true)