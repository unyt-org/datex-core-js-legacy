# DATEX Core Adapter

JS Adapter for the Rust Libraries datex_core and datex_cli_core

## Build WebAssembly
```
wasm-pack build --release --target web
```
This generates a `datex.js` file in the `pkg` directory which exports the required WASM functions.