
/**
 * Must be loaded in an iframe to allow communication with parent window
 */

import { Datex } from "../mod.ts";
import "./iframe-com-interface.ts";

await Datex.Supranet.connect();
await Datex.InterfaceManager.connect("iframe", undefined, [parent])