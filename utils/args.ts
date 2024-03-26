import {CommandLineOptions} from "./command-line-args/main.ts";

export const commandLineOptions = new CommandLineOptions("DATEX Core", "DATEX Runtime for JavaScript/TypeScript.\nVisit https://unyt.org/datex for more information");
export const clear = commandLineOptions.option("clear", {type:"boolean", description: "Clear all eternal states on the backend"});
