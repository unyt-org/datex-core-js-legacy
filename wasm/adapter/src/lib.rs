#![feature(generator_trait)]
#![feature(generators)]

use std::io;
use std::io::Write;
use std::io::Read;

// use datex_cli_core::CLI;
use datex_core::compiler;
use datex_core::datex_values::Value;
use datex_core::datex_values::ValueResult;
use datex_core::decompiler;

use datex_core::runtime;
use datex_core::runtime::Runtime;
use datex_core::utils::logger::LoggerContext;
use datex_core::utils::logger::Logger;
use datex_core::utils::rust_crypto::RustCrypto;
use lazy_static::lazy_static;
use wasm_bindgen::prelude::*;

use web_sys::console;

use std::panic;

// use console_error_panic_hook::set_once as set_panic_hook;


// #[wasm_bindgen]
// pub fn init_panic_hook() {
//     set_panic_hook();
// }


// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;


// lazy_static! {

//     static ref RUNTIME:Runtime<'static> = Runtime::new_with_crypto_and_logger(&RustCrypto{}, LoggerContext {
//         log_redirect: Some(|s:&str| -> () {console::log_1(&s.into())})
//     });
// }

lazy_static! {
    static ref LOGGER:LoggerContext = LoggerContext {
        log_redirect: Some(|s:&str| -> () {console::log_1(&s.into())})
    };
}



// console.log
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, final)]
    pub fn log(s: &str);
}



// export compiler/runtime functions to JavaScript
#[wasm_bindgen]
pub fn init_runtime() {
    // let logger = Logger::new_for_development(&LOGGER, "DATEX");
    // logger.success("initialized");
    // init_panic_hook();
    return 
}


#[wasm_bindgen]
pub fn compile(datex_script:&str) -> String {
    "TODO".to_string()
    // compiler::compile(datex_script).expect("compiler error").to_string()
}

#[wasm_bindgen]
pub fn decompile(dxb:&[u8], formatted: bool, colorized:bool, resolve_slots:bool) -> String {
    return decompiler::decompile(&LOGGER, dxb, formatted, colorized, resolve_slots);
}

// #[wasm_bindgen]
// pub fn execute(dxb:&[u8]) -> Result<String, JsError> {
//     let result = runtime::execute(&RUNTIME.ctx, dxb);
//     match result {
//         Ok(val) => Ok(val.to_string()),
//         Err(err) => Err(JsError::new(&err.message))
//     }
// }

struct IOWrite {}
struct IORead {}

impl Write for IOWrite {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let logger = Logger::new_for_development(&LOGGER, "DATEX");
        logger.success("...write!");
        return Ok(buf.len());
    }

    fn flush(&mut self) -> io::Result<()> {
        let logger = Logger::new_for_development(&LOGGER, "DATEX");
        logger.success("...flush!");
        return Ok(());
    }
}

impl Read for IORead {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        todo!()
    }
}

// #[wasm_bindgen]
// pub fn cli() {
//     let cli = CLI::new(Runtime::new_with_crypto_and_logger(&RustCrypto{}, LoggerContext {
//         log_redirect: Some(|s:&str| -> () {console::log_1(&s.into())})
//     }), IOWrite{}, IORead{});
// }