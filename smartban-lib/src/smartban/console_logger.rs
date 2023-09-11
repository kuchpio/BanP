use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    // Import console.log
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[allow(unused_macros)]
macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

