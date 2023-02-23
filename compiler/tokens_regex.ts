export const Regex = {
    CLOSE_AND_STORE: /^(;\s*)+/, // one or multiple ;

    VAR_REF_VAL: /^(export )? *(var|ref|val|const)\b\s*([A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*)\s*(\:)?= *(\()?/, // var x, val x, ref x, export val x;
    DIRECT_EXPORT: /^export\s+([A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*)/, // export x;

    ROOT_VARIABLE: /^()([A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*)(\s*[+-/*&|$]?=(?![=>/]))?/, // var_xxx or _ffefe
    INTERNAL_VAR: /^(#)([A-Za-z0-9À-ž_]+)(\s*[:+-/*&|$^]?=(?![=>/]))? *(\()?/, //  __internal_var

    LABELED_POINTER: /^(\$)([A-Za-z0-9À-ž_]{1,25})(\s*[:+-/*&|^]?=(?![=>/]))? *(\()?/, // #label

    HEX_VARIABLE: /^[A-Fa-f0-9_]*$/, // variable with hexadecimal name

    JUMP: /^(jmp|jtr|jfa) +([A-Za-z_]\w*)?/, // jmp x, jeq x, ...
    JUMP_LBL: /^lbl *([A-Za-z_]\w*)?/, // lbl x

    ERROR: /^\!(\w|\.)+/,

    URL: /^[a-zA-Z0-9_]+:\/\/((?:[-a-zA-Z0-9(@:%_\+.~#?&//=]|\\.)+)/,// ]);, not allowed (telegram-parsing), can be escaped with \

	RELATIVE_PATH: /^\.\.?\/(?:[-a-zA-Z0-9(@:%_\+.~#?&//=]|\\.)+/, // ]);, not allowed (telegram-parsing), can be escaped with \

    SUBSCOPE_START: /^\(/,
    SUBSCOPE_END: /^\)/,

    DYNAMIC_KEY_END: /^\) *:/,

    SYNC: /^\<\=\=/,
    STOP_SYNC: /^\<\/\=/,

    SYNC_SILENT: /^\<\=\=\:/,

    ADD: /^\+/,
    SUBTRACT: /^\-/,
    MULTIPLY: /^\*/,
    DIVIDE: /^\//,
    POWER: /^\^/,
    MODULO: /^\%/,

    INCREMENT: /^\+\+/,
    DECREMENT: /^\-\-/,

    SEPERATOR: /^=>/, // ignore

    ASSIGN_SET: /^\=/,
    ASSIGN_REFERENCE: /^\$\=/,
    ASSIGN_ADD: /^\+\=/,
    ASSIGN_MUTIPLY: /^\*\=/,
    ASSIGN_DIVIDE: /^\/\=/,
    ASSIGN_SUB: /^\-\=/,
    ASSIGN_AND: /^\&\=/,
    ASSIGN_OR: /^\|\=/,
    ASSIGN_POWER: /^\^\=/,

    EQUAL_VALUE: /^\=\=/,
    NOT_EQUAL_VALUE: /^\!\=/,
    EQUAL: /^\=\=\=/,
    NOT_EQUAL: /^\!\=\=/,
    GREATER: /^\>/,
    GREATER_EQUAL: /^\>\=/,
    LESS: /^\</,
    LESS_EQUAL: /^\<\=/,

    STRING_OR_ESCAPED_KEY: /^("(?:(?:.|\n)*?[^\\])??(?:(?:\\\\)+)?"|'(?:(?:.|\n)*?[^\\])??(?:(?:\\\\)+)?')( *\:(?!:))?/,
    INT: /^(-|\+)?(\d_?)+\b(?!\.\d)/,
    HEX: /^0x([0-9a-fA-F_]+)/,
    BIN: /^0b([01_]+)/,
    OCT: /^0o([0-7_]+)/,

    QUANTITY: /^((?:(?:\d_?)+(?:(?:E|e)(?:-|\+)?(?:\d_?)+)?\/)|(?:(?:-|\+)?(?:(?:\d_?)*\.)?(?:\d_?)+(?:(?:E|e)(?:-|\+)?(?:\d_?)+)?|(?:-|\+)?(?:\d_?)+\.(?:\d_?)+))((?:[YZEPTGMkhdcmµunpfazy]?[A-Za-z€¢$¥Ω£₽⁄⁄]{1,4}(?:\^-?\d{1,4})?)(?:[*\/][YZEPTGMkhdcmµunpfazy]?[A-Za-z€¢$%¥Ω£₽]{1,4}(?:\^-?\d{1,4})?)*)(?!\d)(?!-)/,

    TIME: /^~((\d{1,5}-\d{1,2}-\d{1,2})|(\d{1,5}-\d{1,2}-\d{1,2}(T| )\d{1,2}:\d{1,2}(:\d{1,2}(.\d{1,3})?)?Z?)|(\d{1,2}:\d{1,2}(:\d{1,2}(.\d{1,3})?)?))~/,

    TSTRING_START: /^'(?:(?:[^\\']|)\\(?:\\\\)*'|(?:\\)*[^'\\])*?(?:[^'\\(](\\\\)*|(\\\\)*)\(/, // check before string
    TSTRING_B_CLOSE: /^\)(?:(?:[^\\']|)\\(?:\\\\)*'|(?:\\)*[^'\\])*?(?:[^'\\(](\\\\)*|(\\\\)*)\(/,
    TSTRING_END: /^\)(?:(?:[^\\']|)\\(?:\\\\)*'|(?:\\)*[^'\\])*?(?:[^'\\(](\\\\)*|(\\\\)*)'/,

    // (old) only usable with SaFaRI negative lookbehind support
    // TSTRING_START: /^'([^']|[^\\]\\')*?(?<![^\\]\\)\(/, // check before string
    // TSTRING_B_CLOSE: /^(\)([^']|\\')*?(?<![^\\]\\)\()/,
    // TSTRING_END: /^\)(.|\n)*?(?<![^\\]\\)'/,
    
    FLOAT: /^(?:(?:-|\+)?(?:(?:\d_?)*\.)?(?:\d_?)*(?:(?:E|e)(?:-|\+)?(?:\d_?)+)|(?:-|\+)?(?:\d_?)+\.(?:\d_?)+)/,
    INFINITY: /^(-|\+)?infinity\b/,
    NAN: /^nan\b/,

    BOOLEAN: /^(true|false)\b/,
    USE_PROPS: /^use *\(?((?:(?:[A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*(?: * as *[A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*)?) *,? *)+)\)? *from/, // use (a,b,c) from xy
	USE_ALL: /^use +\* * as *([A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*) *from/, // use * as x from
	USE: /^use\b/, // use x;

    RANGE: /^\.\./,

    SPREAD: /^\.\.\./,

    NULL: /^null\b/,
    VOID: /^void\b/, // void 
    QUASI_VOID: /^\(\s*\)/, //  empty brackets ( )
    
    BROADCAST_ENDPOINT: /^\@(\*)((\.([A-Za-z0-9À-ž-_]{1,32}|\*))*)(\/(\*|[A-Za-z0-9À-ž-_]{1,8}))?/,
    ENDPOINT: /^\@\@([A-Fa-f0-9_-]{2,26})(\/(\*|[A-Za-z0-9À-ž-_]{1,8}))?/,
    PERSON_ALIAS: /^\@([A-Za-z0-9À-ž-_]{1,32})(\/(\*|[A-Za-z0-9À-ž-_]{1,8}))?/,
    INSTITUTION_ALIAS: /^\@\+([A-Za-z0-9À-ž-_]{1,32})(\/(\*|[A-Za-z0-9À-ž-_]{1,8}))?/,

    ANY_INSTITUTION: /^\+\+/,

    _ANY_FILTER_TARGET: /^\@\+?[A-Za-z0-9À-ž-_]{1,32}(\:[A-Za-z0-9À-ž-_]{1,32})*(\/(\*|[A-Za-z0-9À-ž-_]{1,8}))?|\@\@[A-Fa-f0-9_-]{2,53}(\/(\*|[A-Za-z0-9À-ž-_]{1,8}))?$/,

    KEY: /^(#)?[A-Za-z0-9À-ž_-]+?\s*:(?!:)/,
    
    PROPERTY: /^[A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*/,

    EMPTY_ARRAY: /^\[\s*]/,
    EMPTY_OBJECT: /^\{\s*}/,

    ARRAY_START: /^\[/,
    ARRAY_END: /^\]/,
    AND: /^\&/,
    OR: /^\|/,
    NOT: /^\!/,

    AND_OPERATOR: /^and\b/,
    OR_OPERATOR: /^or\b/,
    NOT_OPERATOR: /^not\b/,

    WILDCARD: /^\*(?!\+?[A-Za-zÀ-ž_])/,

    CODE_BLOCK_START: /^\( *((?:(?:(<(([^:>]*?):)?(.*?)> *)?[A-Za-z_][A-Za-z0-9À-ž_]*|with *\((?:[A-Za-z_][A-Za-z0-9À-ž_]*,? *)*\)) *,? *)*)\) *=> *(\(?)/,
    CODE_BLOCK_START_SINGLE_ARG: /^((?:(?:with *)?[A-Za-z_][A-Za-z0-9À-ž_]*)|with *\((?:[A-Za-z_][A-Za-z0-9À-ž_]*,? *)*\)) *=> *(\(?)/,
    
    REMOTE_CALL: /^(?:\:\: *)\s*(\()?/,

    FREEZE: /^freeze\b/,
    SEAL: /^seal\b/,
    HAS: /^has\b/,
    KEYS: /^keys\b/,
    ITERATE: /^iterate\b/,
    ITERATOR: /^iterator\b/,

    DELETE: /^delete\b/,
    NEXT: /^next\b/,
    COPY: /^copy\b/,
    CLONE: /^clone\b/,
    CLONE_COLLAPSE: /^clone_collapse\b/,
    GET_TYPE: /^type\b/,
    ORIGIN: /^origin\b/,
    SUBSCRIBERS: /^subscribers\b/,
    COLLAPSE: /^collapse\b/,

    TEMPLATE: /^template\b/,
    EXTENDS: /^extends\b/,
    IMPLEMENTS: /^implements\b/,
    MATCHES: /^matches\b/,
    DEBUGGER: /^debugger\b/,


	INSERT_COMMAND: /^insert\b\s*(\()?/,
	COMPILE: /^compile\b\s*(\()?/,

    SCOPE: /^scope\b\s*(\()?/,
    OBSERVE: /^observe\b/,
    ALWAYS: /^always\b\s*(\()?/,
    RUN: /^run\b\s*(\()?/,
    AWAIT: /^await\b/,
    DO: /^do\b\s*(\()?/,
    FUNCTION: /^function\s+([A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*)?\s*\(/,
    FUNCTION_PARAM: /^(\s*(?:export\s+)?(?:named\s+)?(?:(?:ref|val|var|const)\s+)?)?([A-Za-zÀ-ž_][A-Za-z0-9À-ž_]*)\s*(\:|\=|,|\))?/,
    ASSERT: /^assert\b\s*(\()?/,
    SKIP: /^skip\b\s*(\()?/,
    LEAVE: /^leave\b\s*(\()?/,
    NEW: /^new\b\s*(\()?/,
    MAYBE: /^maybe\b\s*(\()?/,
    RESPONSE: /^response\b\s*(\()?/,

    TRY: /^try\b\s*(\()?/,
    ACCEPT: /^accept\b/,
    YEET: /^yeet\b/,

    DEFAULT: /^default\b\s*(\()?/,

    CONSTRUCTOR_METHOD: /^constructor|destructor|replicator|creator\b/,

    OBJECT_START: /^\{/,
    OBJECT_END: /^\}/,

    BUFFER: /^\`([A-Fa-f0-9_]*)\`/,

    COMMENT: /^(# .*|\/\/.*|\/\*(.|\n)*?\*\/)/,

    DOC_COMMENT: /^((##+ +(?:.|\n)*?)|##+((?:.|\n)*?))##+(?! )/,

    COMMA: /^,/,
    PATH_SEPERATOR: /^\./,
    PATH_REF_SEPERATOR: /^\-\>/,

    EXIT: /^exit\b/,
    ABOUT: /^about\b/,
    COUNT: /^count\b/,
    GET: /^get\b/,

    RETURN: /^return\b/,

    WHILE: /^while\b/,

    ELSE: /^else\b/,
    ELSE_IF: /^(else\b)?\s*if\b/,

    FUN: /^fun\b/,

    TYPE:  /^<(?:(\w+?):)?([A-Za-z0-9À-ž_+-]+?)(\/[A-Za-z0-9À-ž_+-]*)*?(>|\()(\s*[:+-/*&|^]?=(?![=>/]))?/, // <type/xy>
    TYPE_FUNCTION_ARG_COMPAT:  /^<(?:(\w+?):)?([A-Za-z0-9À-ž_+-]+?)(\/[A-Za-z0-9À-ž_+-]*)*?(>|\()/, // <type/xy>

    STRING_PROPERTY: /^\s*([A-Za-z_][A-Za-z0-9À-ž_]*)/,

    POINTER: /^\$((?:[A-Fa-f0-9]{2}|[xX][A-Fa-f0-9]){1,26})(\s*[:+-/*&|^]?=(?![=>/]))? *(\()?/,
    CREATE_POINTER: /^\$\$/,
    CREATE_ANONYMOUS_POINTER: /^\$\*/,

    STREAM: /^\<\</,
    STOP_STREAM: /^\<\//,

    INSERT: /^\?(\d*)/,

    ESCAPE_SEQUENCE: /\\(.)/g,
    ESCAPE_BACKSPACE: /\\b/g,
    ESCAPE_FORM_FEED: /\\f/g,
    ESCAPE_LINE_FEED: /\\n/g,
    ESCAPE_CARRIAGE_RETURN: /\\r/g,
    ESCAPE_HORIZONTAL_TAB: /\\t/g,
    ESCAPE_VERTICAL_TAB: /\\v/g,

    ESCAPE_UNICODE: /\\u(.{0,4})/g,
    ESCAPE_HEX: /\\x(.{0,2})/g,
    ESCAPE_OCTAL: /\\([0]*[0-3][0-9][0-9]|[0-9]?[0-9])/g,

    HEX_STRING: /^[A-Fa-f0-9]+$/
}