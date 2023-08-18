// TODO: fix this (cdn problems)
let CommandLineOptions: any // typeof import("https://dev.cdn.unyt.org/command-line-args/main.ts").CommandLineOptions;
try {
    ({CommandLineOptions} = await import("https://dev.cdn.unyt.org/"+"command-line-args/main.ts"));
}
catch {
    console.warn("using fallback CommandLineOptions module, cdn not reachable");
    ({CommandLineOptions} = <any> await import("./_command_line_options.ts"));
}

export const commandLineOptions = new CommandLineOptions("DATEX Core", "DATEX Runtime for JavaScript/TypeScript.\nVisit https://unyt.org/datex for more information");