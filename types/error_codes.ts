
// error codes
export const DATEX_ERROR = {
    // ValueError
    NO_VALUE: 0x00,
    
    // NetworkError
    NO_EXTERNAL_CONNECTION: 0x10,
    NO_OUTPUT: 0x11,
    NO_RECEIVERS: 0x12,
    TOO_MANY_REDIRECTS: 0x13,
}

// error messages
export const DATEX_ERROR_MESSAGE = {
    // ValueError
    [DATEX_ERROR.NO_VALUE]: "No value provided",
    
    // NetworkError
    [DATEX_ERROR.NO_EXTERNAL_CONNECTION]: "No external connections, can only execute DATEX locally",
    [DATEX_ERROR.NO_OUTPUT]:  "No DATEX output available",
    [DATEX_ERROR.NO_RECEIVERS]: "DATEX has no receivers and is not flooding, cannot send",
    [DATEX_ERROR.TOO_MANY_REDIRECTS]: "Too many redirects",

}