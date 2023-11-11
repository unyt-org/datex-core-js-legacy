export enum ProtocolDataType {
    REQUEST     = 0, // default datex request
    RESPONSE    = 1, // response to a request (can be empty)

    DATA        = 2, // data only (limited execution permission)
    TMP_SCOPE   = 3, // resettable scope
    
    LOCAL       = 4, // default datex request, but don't want a response (use for <Function> code blocks, ....), must be sent and executed on same endpoint

    HELLO       = 5, // info message that endpoint is online
    DEBUGGER    = 6, // get a debugger for a scope
    SOURCE_MAP  = 7, // send a source map for a scope
    UPDATE      = 8, // like normal request, but don't propgate updated pointer values back to sender (prevent recursive loop)
    GOODBYE     = 9, // info message that endpoint is offline
}