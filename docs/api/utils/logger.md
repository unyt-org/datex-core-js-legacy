## interface **LogFormatter**

## enum **LOG_LEVEL**

## enum **LOG_FORMATTING**

## class **Logger**
### Constructors
 **constructor**(origin?: string, production?: boolean, formatting?: LOG_FORMATTING)

 **constructor**(for_value: any, production?: boolean, formatting?: LOG_FORMATTING)

 **constructor**(origin: any, production: any, formatting: LOG_FORMATTING)

### Properties
**formatting**: LOG_FORMATTING<br>
**log_to_console**: boolean<br>
**log_to_cache**: boolean<br>
**cache**?: string<br>
**cursor_x**: WeakMap<br>
**cursor_y**: WeakMap<br>
**loggersForStream**: Map<br>


## const **UNYT_COLORS**: {RED: number[],GREEN: number[],BLUE: number[],YELLOW: number[],MAGENTA: number[],CYAN: number[],BLACK: number[],WHITE: number[],GREY: number[],}
Predefined unyt specific color scheme.

## const **ESCAPE_SEQUENCES**: {CLEAR: string,RESET: string,BOLD: string,DEFAULT: string,ITALIC: string,UNDERLINE: string,INVERSE: string,HIDDEN: string,RESET_UNDERLINE: string,RESET_INVERSE: string,BLACK: string,RED: string,GREEN: string,YELLOW: string,BLUE: string,MAGENTA: string,CYAN: string,WHITE: string,GREY: string,COLOR_DEFAULT: string,BG_BLACK: string,BG_RED: string,BG_GREEN: string,BG_YELLOW: string,BG_BLUE: string,BG_MAGENTA: string,BG_CYAN: string,BG_WHITE: string,BG_GREY: string,BG_COLOR_DEFAULT: string,UNYT_RED: string,UNYT_GREEN: string,UNYT_BLUE: string,UNYT_CYAN: string,UNYT_MAGENTA: string,UNYT_YELLOW: string,UNYT_BLACK: string,UNYT_WHITE: string,UNYT_GREY: string,UNYT_BG_RED: string,UNYT_BG_GREEN: string,UNYT_BG_BLUE: string,UNYT_BG_CYAN: string,UNYT_BG_MAGENTA: string,UNYT_BG_YELLOW: string,UNYT_BG_GREY: string,UNYT_POINTER: string,}
Common ANSI esacpe sequences for colors and text style

## let **console_theme**: dark | light

## let **font_family**: string

