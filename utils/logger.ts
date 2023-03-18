/*******************************************************************************************
 * ╔══════════════════════════════════════════════════════════════════════════════════════╗ *
 * ║  UNYT - logger                                                                       ║ *
 * ╠══════════════════════════════════════════════════════════════════════════════════════╣ *
 * ║ Console output for web or node.js                                                    ║ *
 * ║                                                                                      ║ *
 * ╠═════════════════════════════════════════╦════════════════════════════════════════════╣ *
 * ║  © 2022 unyt.org                        ║ ██████████████████████████████████████████ ║ *
 * ╚═════════════════════════════════════════╩════════════════════════════════════════════╝ *
 *******************************************************************************************/

import type { Runtime } from "../runtime/runtime.ts";
import type { Type } from "../types/type.ts";
import type { Pointer } from "../runtime/pointers.ts";
import { enableFullSupport, enableMinimal } from "./ansi_compat.ts";

let _Runtime:typeof Runtime; // to circular imports logger - Runtime
let _Type:typeof Type; // to circular imports logger - Type
let _Pointer:typeof Pointer; // to circular imports logger - Pointer

// copied from datex_runtime
interface StreamSink {
    write: (chunk:ArrayBuffer|string)=>Promise<any>|any
}

const client_type = "Deno" in globalThis ? 'deno' : 'browser';





export const UNYT_COLORS = {
    RED: [234,43,81],
    GREEN: [30,218,109],
    BLUE: [6,105,193],
    YELLOW: [235,182,38],
    MAGENTA: [196,112,222],
    CYAN: [79,169,232],
    BLACK: [5,5,5],
    WHITE: [250,250,250],
    GREY: [150,150,150]
}

export const ESCAPE_SEQUENCES = {

    CLEAR:      "\x1b[2J", // clear screen

    RESET:      "\x1b[0m",
    BOLD:       "\x1b[1m",
    DEFAULT:    "\x1b[2m",
    ITALIC:     "\x1b[3m",
    UNDERLINE: "\x1b[4m",
    INVERSE:    "\x1b[7m",
    HIDDEN:     "\x1b[8m",

    RESET_UNDERLINE: "\x1b[24m",
    RESET_INVERSE:    "\x1b[27m",

    BLACK:      "\x1b[30m",
    RED:        "\x1b[31m",
    GREEN:      "\x1b[32m",
    YELLOW:     "\x1b[33m",
    BLUE:       "\x1b[34m",
    MAGENTA:    "\x1b[35m",
    CYAN:       "\x1b[36m",
    WHITE:      "\x1b[37m",
    GREY:       "\x1b[90m",
    COLOR_DEFAULT: "\x1b[39m",

    BG_BLACK:   "\x1b[40m",
    BG_RED:     "\x1b[41m",
    BG_GREEN:   "\x1b[42m",
    BG_YELLOW:  "\x1b[43m",
    BG_BLUE:    "\x1b[44m",
    BG_MAGENTA: "\x1b[45m",
    BG_CYAN:    "\x1b[46m",
    BG_WHITE:   "\x1b[47m",
    BG_GREY:    "\x1b[100m",
    BG_COLOR_DEFAULT: "\x1b[49m",

    UNYT_RED:        `\x1b[38;2;${UNYT_COLORS.RED.join(';')}m`,
    UNYT_GREEN:      `\x1b[38;2;${UNYT_COLORS.GREEN.join(';')}m`,
    UNYT_BLUE:       `\x1b[38;2;${UNYT_COLORS.BLUE.join(';')}m`,
    UNYT_CYAN:       `\x1b[38;2;${UNYT_COLORS.CYAN.join(';')}m`,
    UNYT_MAGENTA:    `\x1b[38;2;${UNYT_COLORS.MAGENTA.join(';')}m`,
    UNYT_YELLOW:     `\x1b[38;2;${UNYT_COLORS.YELLOW.join(';')}m`,
    UNYT_BLACK:      `\x1b[38;2;${UNYT_COLORS.BLACK.join(';')}m`,
    UNYT_WHITE:      `\x1b[38;2;${UNYT_COLORS.WHITE.join(';')}m`,
    UNYT_GREY:       `\x1b[38;2;${UNYT_COLORS.GREY.join(';')}m`,

    UNYT_BG_RED:        `\x1b[48;2;${UNYT_COLORS.RED.join(';')}m`,
    UNYT_BG_GREEN:      `\x1b[48;2;${UNYT_COLORS.GREEN.join(';')}m`,
    UNYT_BG_BLUE:       `\x1b[48;2;${UNYT_COLORS.BLUE.join(';')}m`,
    UNYT_BG_CYAN:       `\x1b[48;2;${UNYT_COLORS.CYAN.join(';')}m`,
    UNYT_BG_MAGENTA:    `\x1b[48;2;${UNYT_COLORS.MAGENTA.join(';')}m`,
    UNYT_BG_YELLOW:     `\x1b[48;2;${UNYT_COLORS.YELLOW.join(';')}m`,
    UNYT_BG_GREY:       `\x1b[48;2;${UNYT_COLORS.GREY.join(';')}m`,


    UNYT_POINTER:  "\x1b[38;2;65;102;238m",

}



type COLOR = readonly [string,string];

// [4-bit color escape sequence, rgb color escape sequence]
const COLOR = {
    RED: [ESCAPE_SEQUENCES.RED, ESCAPE_SEQUENCES.UNYT_RED] as COLOR,
    GREEN: [ESCAPE_SEQUENCES.GREEN, ESCAPE_SEQUENCES.UNYT_GREEN] as COLOR,
    BLUE: [ESCAPE_SEQUENCES.BLUE, ESCAPE_SEQUENCES.UNYT_BLUE] as COLOR,
    CYAN: [ESCAPE_SEQUENCES.CYAN, ESCAPE_SEQUENCES.UNYT_CYAN] as COLOR,
    MAGENTA: [ESCAPE_SEQUENCES.MAGENTA, ESCAPE_SEQUENCES.UNYT_MAGENTA] as COLOR,
    YELLOW: [ESCAPE_SEQUENCES.YELLOW, ESCAPE_SEQUENCES.UNYT_YELLOW] as COLOR,
    BLACK: [ESCAPE_SEQUENCES.BLACK, ESCAPE_SEQUENCES.UNYT_BLACK] as COLOR,
    WHITE: [ESCAPE_SEQUENCES.WHITE, ESCAPE_SEQUENCES.UNYT_WHITE] as COLOR,
    GREY: [ESCAPE_SEQUENCES.GREY, ESCAPE_SEQUENCES.UNYT_GREY] as COLOR,

    POINTER:  [ESCAPE_SEQUENCES.BLUE, ESCAPE_SEQUENCES.UNYT_POINTER] as COLOR,
} as const;

export let console_theme:"dark"|"light" = (client_type=="deno" || (<any>globalThis).matchMedia && (<any>globalThis).matchMedia('(prefers-color-scheme: dark)')?.matches) ? "dark" : "light";

try {
    (<any>globalThis).matchMedia && (<any>globalThis).matchMedia('(prefers-color-scheme: dark)')?.addEventListener("change", (e:any)=>{
        console_theme = e.matches ? "dark" : "light";
    });
} catch (e){}


// handles console.log/error/debug

function console_log(log_data:any[], log_level:LOG_LEVEL=LOG_LEVEL.DEFAULT) {
    switch (log_level) {
        case LOG_LEVEL.ERROR: console.error(...log_data);break;
        case LOG_LEVEL.WARNING: console.warn(...log_data);break;
        case LOG_LEVEL.VERBOSE: console.debug(...log_data);break;
        default: console.log(...log_data);break;
    }
}



function rgbToHsl(r:number, g:number, b:number):[number, number, number] {
    r /= 255, g /= 255, b /= 255;
  
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s:number;
    const l = (max + min) / 2;
    if (max == min) h = s = 0; 
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h, s, l];
}

// h:0..1, s:0..1, l:0..1
function hslToRgb(h:number, s:number, l:number):[number, number, number] {
    h *= 360;
    const k = (n:number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n:number) =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
}

function brightenRgb(r:number, g:number, b:number):[number, number, number] {
    let [h,s,l] = rgbToHsl(r,g,b);
    l += 0.4;
    l = Math.min(0.85, l);
    return hslToRgb(h,s,l);
}


export enum LOG_LEVEL {
    VERBOSE,
    DEFAULT,
    WARNING,
    ERROR,
}

export enum LOG_FORMATTING {
    PLAINTEXT,
    COLOR_4_BIT,
    COLOR_RGB
}

export let font_family = 'font-family: Menlo, Monaco, "Courier New", monospace';


export interface LogFormatter {
    name: string,
    browser_compat_mode_required?: boolean

    variables?: {[name:string]:any}
    spread_variables?: {[name:string]:any} // 'tuple' values, get spread as multiple arguments

    formatInline?(text:string, params:any[], main_color:string):string  // apply a format to text content
    formatValue?(value:any, params:any[], main_color:string):string // apply a format to an inserted value
    formatMeta?(params:any[], main_color:string, formatting:LOG_FORMATTING):string // apply a format without text/value content
}


class ColorFormatter implements LogFormatter {

    name = 'color'

    variables = {
        red: {c:COLOR.RED},
        green: {c:COLOR.GREEN},
        yellow:{c:COLOR.YELLOW},
        blue: {c:COLOR.BLUE},
        magenta: {c:COLOR.MAGENTA},
        cyan: {c:COLOR.CYAN},
        black: {c:COLOR.BLACK},
        white: {c:COLOR.WHITE},
        grey: {c:COLOR.GREY},
    }

    formatMeta(params: any[], main_color:string, formatting:LOG_FORMATTING): string {
        // predefined color
        if (params[0].c) return Logger.getFormattingColor(params[0].c, formatting);

        // custom rgb color
        else if (formatting == LOG_FORMATTING.COLOR_RGB) {
            return `\x1b[38;2;${params.slice(0,3).map(v=>v??255).join(';')}m`;
        }

        else if (formatting == LOG_FORMATTING.PLAINTEXT) return ""
        else return ESCAPE_SEQUENCES.COLOR_DEFAULT;
    }
    
}


// just reflect text back, no changes
class TextFormatter implements LogFormatter {

    name = 'text'
    formatMeta(params: any[], main_color:string): string {
        return ''
    }
    formatInline(text: string, params: any[], main_color: string): string {
        return text;
    }
    formatValue(value: any, params: any[], main_color: string): string {
        return value?.toString();
    }
}

class ResetFormatter implements LogFormatter {

    name = 'reset'
    formatMeta(params: any[], main_color:string): string {
        return ESCAPE_SEQUENCES.RESET+main_color;
    }
}

class BoldFormatter implements LogFormatter {

    name = 'bold'
    formatMeta(params: any[]): string {
        return ESCAPE_SEQUENCES.BOLD;
    }
}

class BGColorFormatter implements LogFormatter {

    name = 'bg'

    variables = {
        red: {c:COLOR.RED},
        green: {c:COLOR.GREEN},
        yellow:{c:COLOR.YELLOW},
        blue: {c:COLOR.BLUE},
        magenta: {c:COLOR.MAGENTA},
        cyan: {c:COLOR.CYAN},
        black: {c:COLOR.BLACK},
        white: {c:COLOR.WHITE},
        grey: {c:COLOR.GREY},
    }


    formatMeta(params: any[], main_color:string, formatting:LOG_FORMATTING): string {
        // predefined color
        if (params[0].c) return Logger.getEscapedBackgroundColor(Logger.getFormattingColor(params[0].c, formatting));

        // custom rgb color
        else if (formatting == LOG_FORMATTING.COLOR_RGB) {
            return `\x1b[48;2;${params.slice(0,3).map(v=>v??255).join(';')}m`;
        }
        
        else if (formatting == LOG_FORMATTING.PLAINTEXT) return ""
        else return ESCAPE_SEQUENCES.BG_COLOR_DEFAULT;
    }
    
}

class DATEXFormatter implements LogFormatter {

    name = 'datex'

    formatValue(value: any, params: any[]): string {
        const collapse = params.includes("collapse");
        const color = !params.includes("plain");
        return _Runtime.valueToDatexStringExperimental(value, true, color, collapse, true, true);
    }
    
}

class ImageFormatter implements LogFormatter {

    name = 'image'

    browser_compat_mode_required = true

    formatValue(value: any, params: any[]): string {
        // currently only supported in browser console
        return client_type == "deno" ? '' : `\x1b[1337;File=;${params[0]?'height='+params[0]+'px;':''}inline=1:${value}\x07`
    }
    
}


export class Logger {

    private static loggers_by_origin = new Map<string,Set<Logger>>();
    private static global_log_streams = new Set<StreamSink>();

    private readonly origin:string|undefined;
    private readonly pointer:string|undefined;
    private readonly origin_value?:any;

    private locked = false;
    private lockedContent?: string;


    private box_width = 50;
    public formatting:LOG_FORMATTING;
    private production = false;

    private tags = new WeakMap<COLOR, string>();

    // @ts-ignore check for global chrome variable
    private static browser_supports_ansi_escape_codes = !!globalThis.chrome

    public log_to_console = true;
    private out_streams = new Set<StreamSink>();

    constructor(origin?:string, production?:boolean, formatting?:LOG_FORMATTING) 
    constructor(for_value:any, production?:boolean, formatting?:LOG_FORMATTING) 
    constructor(origin:any, production = false, formatting:LOG_FORMATTING = LOG_FORMATTING.COLOR_RGB) {
        
        this.formatting = formatting;
        this.production = production;

        if (typeof origin == "string") this.origin = origin;
        else if (origin) {
            this.origin_value = origin;
            if (_Type && _Pointer) {
                this.origin = _Type.ofValue(origin)?.toString().replace(">","").replace("<","")??'?';
                this.pointer = "$" + (_Pointer.getByValue(origin)?.id??'?');
            }
            else this.origin = (origin?.constructor.name??'') + "?";
        }

        if (this.origin) {
            if (!Logger.loggers_by_origin.has(this.origin)) Logger.loggers_by_origin.set(this.origin, new Set());
            Logger.loggers_by_origin.get(this.origin)?.add(this);
        }
    }

    public destroy(){
        if (this.origin) Logger.loggers_by_origin.get(this.origin)?.delete(this);
    }

    private log(color: COLOR, text: string, data:any[], log_level:LOG_LEVEL = LOG_LEVEL.DEFAULT, only_log_own_stream = false, add_tag = true) {

        if (this.production && (log_level < Logger.production_log_level)) return; // don't log for production
        if (!this.production && (log_level < Logger.development_log_level)) return; // don't log for development

        const browser_compat_mode_required:[boolean] = [false];
        const log_string = this.generateLogString(color, text, data, add_tag, browser_compat_mode_required);
        this.logRaw(log_string, log_level, only_log_own_stream, browser_compat_mode_required[0]);
    }

    // log_level: decides which console log method is used (log, error, warn, debug)
    // only_log_own_stream: if true, only streams where no other logger is piped in are affected (e.g. to prevent clear of all loggers)
    // force_browser_compat_mode: if true, browser console formatting falls back to %c sequences (required for non compatible ascii sequences or images)
    private logRaw(text:string, log_level:LOG_LEVEL = LOG_LEVEL.DEFAULT, only_log_own_stream = false, browser_compat_mode_required = false) {


        if (this.production && (log_level < Logger.production_log_level)) return; // don't log for production
        if (!this.production && (log_level < Logger.development_log_level)) return; // don't log for development

        // TODO: replace globalThis.process
        //Logger.setCursorY(globalThis.process?.stdout, Logger.getCursorY(globalThis.process?.stdout)+1);

        if (this.log_to_console) {
            if (this.locked) this.lockedContent = this.lockedContent ? this.lockedContent + '\n' + text : text;
            else console_log([text], log_level);
        }

        // handle log streams
        if (!only_log_own_stream) {
            for (const stream of Logger.global_log_streams) stream.write(text+"\r\n");
        }
        for (const stream of this.out_streams) {
            // is only stream for this logger or 'only_log_own_stream' disabled
            if (!only_log_own_stream || Logger.loggersForStream.get(stream)?.size == 1) stream.write(text+"\r\n");
        }
    }

    private static inverse_underline_block = /\x1b\[7m\x1b\[4m(\x1b\[(?:(?:\d{0,4};)*\d{0,4})?m)/g

    // removes/modifies certain esacpe sequences
    static convertLogStringForBrowser(text:string){
        return [
            text
                // replace UNDERLINE+INVERSE, (\x1b[7m is currently not supported by chrome)
                .replace(Logger.inverse_underline_block, (_,c) => Logger.getFormattingColor(console_theme == 'dark' ?  COLOR.BLACK : COLOR.WHITE, LOG_FORMATTING.COLOR_RGB) + Logger.getEscapedBackgroundColor(c))
                .replaceAll(ESCAPE_SEQUENCES.CLEAR, '')
        ]
    }


    private getTag(color:COLOR){
        if (this.tags.has(color)) return this.tags.get(color);
        else {
            this.tags.set(color, this.generateTag(color));
            return this.tags.get(color);
        }
    }

    private generateTag(color:COLOR) {
        const color_esc = this.getFormattingColor(color);
        let tag = ""

        // handle tag:
        const esc_tag = this.formatting != LOG_FORMATTING.PLAINTEXT && (this.origin || this.pointer);

        // start tag
        if (esc_tag) {
            tag += 
                ESCAPE_SEQUENCES.INVERSE+ESCAPE_SEQUENCES.UNDERLINE + Logger.getEscapedBackgroundColor(this.getFormattingColor(COLOR.BLACK)) +
                color_esc +
                (this.formatting == LOG_FORMATTING.COLOR_RGB ? ESCAPE_SEQUENCES.BOLD : '')
        }
        // tag content
        if (this.origin) {
            if (this.formatting == LOG_FORMATTING.PLAINTEXT) tag += `[${this.origin}]`;
            else tag +=  " " + this.origin  + " ";
        }
        if (this.pointer) {
            if (this.formatting == LOG_FORMATTING.PLAINTEXT) tag += `[${this.pointer}]`;
            else tag += ESCAPE_SEQUENCES.INVERSE+ESCAPE_SEQUENCES.UNDERLINE + this.getFormattingColor(COLOR.POINTER) + " " + this.pointer + " ";
        }
        // end tag
        if (esc_tag) tag += ESCAPE_SEQUENCES.RESET + " " + color_esc;
        else tag += " "

        return tag;
    }

    static getFormattingColor(color:COLOR, formatting:LOG_FORMATTING) {
        if (formatting == LOG_FORMATTING.COLOR_4_BIT) return color[0];
        else if (formatting == LOG_FORMATTING.COLOR_RGB) return color[1];
        else if (formatting == LOG_FORMATTING.PLAINTEXT) return ""
        else return ESCAPE_SEQUENCES.COLOR_DEFAULT;
    }

    private getFormattingColor(color:COLOR) {
        return Logger.getFormattingColor(color, this.formatting)
    }

    private generateLogString(color:COLOR, text:string, data:any[], add_tag = true, browser_compat_mode_required:[boolean]): string {

        const color_esc = this.getFormattingColor(color);


        const message = Logger.applyLogFormatters(Logger.formatEscapeSequences(text, color_esc), data, color_esc, browser_compat_mode_required, this.formatting)
            .replace(/\n/g, '\r\n');


            const log_data = this.formatting == LOG_FORMATTING.PLAINTEXT ? 
            (add_tag ? this.getTag(color) : '') + message:
            (add_tag ? this.getTag(color) : '') + message + ESCAPE_SEQUENCES.RESET;

        return log_data;
    }

    private static match_log_formatter = 
        // @ts-ignore
        (typeof globalThis.webkitConvertPointFromNodeToPage === 'function') ? // target only saFari
            /(?:#([a-zA-Z0-9_-]+)(?:\(((?:[^\)])*)\))?(?:(\[((?:[^\]])*)\]|\?))?|\?)/g : // TODO use regex with lookaheads when supported in safARi 
            new RegExp('(?:#([a-zA-Z0-9_-]+)(?:\\(((?:(?<=\\\\)\\)|[^\\)])*)\\))?(?:(\\[((?:(?<=\\\\)\\]|[^\\]])*)\\]|\\?))?|(?<!\\\\)\\?)','g')
            ///(?:#([a-zA-Z0-9_-]+)(?:\(((?:(?<=\\)\)|[^\)])*)\))?(?:(\[((?:(?<=\\)\]|[^\]])*)\]|\?))?|(?<!\\)\?)/g

    private static applyLogFormatters(text:string, data:any[], main_color:string, browser_compat_mode_required:[boolean], formatting:LOG_FORMATTING){
        text = text.replace(Logger.match_log_formatter, (all,name,_args,outer_content,content) => {

            // standalone '?'
            if (all == '?') {
                return this.parseInsertValueDefault(data.shift(), main_color);
            }
            // formatter command
            else {
                content = content?.replaceAll('\\]', ']');
                _args = _args?.replaceAll('\\)', ')');       

                const formatter:LogFormatter = this.formatters.get(name) ?? <LogFormatter>this.formatters.get('text'); // fallback formatter is 'text'
                let args:any[] = _args?.split(',').map((a:string)=>this.parseFormatterArgument(a,formatter.variables)) ?? [];

                // compat mode for formatter required?
                if (formatter.browser_compat_mode_required) browser_compat_mode_required[0] = true;

                // spread var
                if (args.length == 1 && formatter.spread_variables && (args[0] in formatter.spread_variables)) args = formatter.spread_variables[args[0]];  
                
                // insert value
                if (outer_content=='?' || content=='?') {
                    if (formatter.formatValue) return formatter.formatValue(data.shift(), args, main_color) + ESCAPE_SEQUENCES.RESET + main_color;
                    else if (formatter.formatInline) return formatter.formatInline(this.parseInsertValueDefault(data.shift(), main_color), args, main_color) + ESCAPE_SEQUENCES.RESET + main_color;
                    else if (formatter.formatMeta) return (formatter.formatMeta(args, main_color, formatting)??'') + this.parseInsertValueDefault(data.shift(), main_color) + ESCAPE_SEQUENCES.RESET + main_color;
                    else return content??'';
                }
                // inline text content
                if (outer_content!=undefined) {
                    if (formatter.formatInline) return formatter.formatInline(content, args, main_color) + ESCAPE_SEQUENCES.RESET + main_color;
                    else if (formatter.formatMeta) return (formatter.formatMeta(args, main_color, formatting)??'') + content + ESCAPE_SEQUENCES.RESET + main_color;
                    else return content??'';
                }
                // global (escape sequences not reset)
                if (content==undefined) {
                    if (formatter.formatMeta) return (formatter.formatMeta(args, main_color, formatting)??'');
                    else return content??''; 
                }
            
            }

        });

        // still data values left, without corresponding ?
        if (data.length) {
            for (const entry of data) {
                text += " " + this.parseInsertValueDefault(entry, main_color);
            }
        }

        return text.replaceAll("\\?","\?") // replace escaped question marks
    }

    private static parseInsertValueDefault(value:any, main_color:string) {
        if (typeof value == "string") return value;
        else if (value instanceof Error) return value.stack ?? "???";
        else return (this.formatters.get('datex')?.formatValue?.(value, [], main_color) ?? "???") + ESCAPE_SEQUENCES.RESET + main_color;
    }

    private static parseFormatterArgument(arg:string, vars?:Object): any {
        // variable
        if (vars && arg in vars) return (<any>vars)[arg];
        // strings (" or ')
        if ((arg.startsWith("'") && arg.endsWith("'"))) return arg.slice(1,-1);
        if ((arg.startsWith('"') && arg.endsWith('"'))) return arg.slice(1,-1);
        // number
        if (/^(((-|\+)?((\d_?)*\.)?(\d_?)*((E|e)(-|\+)?(\d_?)+)|(-|\+)?(\d_?)+\.(\d_?)+)|(-|\+)?(\d_?)+\b(?!\.\d))$/.test(arg)) return Number(arg);
        // otherwise also just a string
        else return arg.trim();
    }


    private static formatEscapeSequences(text:string, color:string=ESCAPE_SEQUENCES.WHITE):string {
        return text
        .replace(/\*\*[^*]*\*\*/g, (x)=>{
            return ESCAPE_SEQUENCES.BOLD+this.brightenEscapedColor(color)+x.replace(/\*/g, "")+ESCAPE_SEQUENCES.DEFAULT})
        .replace(/\#\#[^*]*\#\#/g, (x)=>{
            return ESCAPE_SEQUENCES.DEFAULT+this.brightenEscapedColor(color)+x.replace(/\#/g, "")+ESCAPE_SEQUENCES.RESET+color})
        .replace(/__[^_]*__/g, (x)=>{
            return ESCAPE_SEQUENCES.UNDERLINE+x.replace(/_/g, "")+ESCAPE_SEQUENCES.RESET_UNDERLINE})
        .replace(/\[\[[^[]*\]\]/g, (x)=>{
            return ESCAPE_SEQUENCES.RESET+ESCAPE_SEQUENCES.INVERSE+ESCAPE_SEQUENCES.UNDERLINE+color+x.replace(/\[/g, '').replace(/]/g, '')+ESCAPE_SEQUENCES.RESET+color})
    }
    private static removeEscapeFormatters(text:string):string {
        return text
        .replace(/\*\*/g, '')
        .replace(/\#\#/g, '')
        .replace(/__/g, '')
        .replace(/\[\[/g,'')
        .replace(/\]\]/g,'')
    }

    private static brightenEscapedColor(color:string): string {
        let match:RegExpMatchArray | null;
        // rgb color
        if (match = color.match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m/)) {
            let [r,g,b] = brightenRgb(Number(match[1]), Number(match[2]), Number(match[3]));
            return `\x1b[38;2;${r};${g};${b}m`
        }
        // rgb color bg
        if (match = color.match(/^\x1b\[48;2;(\d+);(\d+);(\d+)m/)) {
            let [r,g,b] = brightenRgb(Number(match[1]), Number(match[2]), Number(match[3]));
            return `\x1b[48;2;${r};${g};${b}m`
        }
        // default color
        else return color.substring(0, 2) + (parseInt(color.substring(2, 4))+60) + color.substring(4, 5);
    }

    static getEscapedBackgroundColor(color:string): string {
        let match:RegExpMatchArray | null;
        if (match = color.match(/^\x1b\[(\d*)(.*)$/)) {
            // +10 for bg color
            return '\x1b[' + (Number(match[1]) + 10) + match[2];
        }
        else return color;
    }

    private static async imageUrlToBase64(url:string) {
        const blob = await (await fetch(url)).blob();
        return new Promise(resolve=>{
            const reader = new FileReader();
            reader.onloadend = () => {
                resolve(<string>reader.result)
            };
            reader.readAsDataURL(blob);
        })
        
    }


    public box(title?:string, message?:string) {
        this.box_width = Math.max(title?.length??0, this.box_width);

        title = title?.toString() || "";
        message = message || "";

        const message_array = message?.match(new RegExp(`.{1,${this.box_width}}`,"g"))?.map(m=>m.split("\n")).flat();

        const date = new Date().toLocaleDateString()+" "+new Date().toLocaleTimeString();
        let text =  "\n" + ESCAPE_SEQUENCES.MAGENTA +"╭─" +  "".padEnd(this.box_width-date.length, "─") + Logger.brightenEscapedColor(ESCAPE_SEQUENCES.MAGENTA) + date + ESCAPE_SEQUENCES.MAGENTA +  "─╮\n";

        text += `${ESCAPE_SEQUENCES.MAGENTA}│${Logger.brightenEscapedColor(ESCAPE_SEQUENCES.WHITE)} ${title.padEnd(this.box_width, " ")} ${ESCAPE_SEQUENCES.MAGENTA}│\n`;
        text += ESCAPE_SEQUENCES.MAGENTA + "├" + "".padEnd(this.box_width+2, "─") + "┤\n";

        for (let m of message_array || []) {
            m = m.trim();
            const formatters_length = m.length - Logger.removeEscapeFormatters(m).length;
            text += `${ESCAPE_SEQUENCES.MAGENTA}│${ESCAPE_SEQUENCES.WHITE} ${Logger.formatEscapeSequences(m.trim().padEnd(this.box_width+formatters_length, " "))} ${ESCAPE_SEQUENCES.RESET+ESCAPE_SEQUENCES.MAGENTA}│\n`
        }

        text += ESCAPE_SEQUENCES.MAGENTA + "╰" + "".padEnd(this.box_width+2, "─") + "╯\n" + ESCAPE_SEQUENCES.RESET;

    }

    private normalizeLogText(text:string|TemplateStringsArray):string {
        if (typeof text == "string") return text;
        else if (text instanceof Array) return text.raw.join("?");
        else {
            throw Error("Invalid log text");
        }
    }

    private isTemplateStringArrayOrString(text: any): text is TemplateStringsArray|string { // @ts-expect-error
        return typeof text == "string" || (text instanceof Array && text.raw instanceof Array && text.length === text.length)
    }


    public table(){
        
    }


    public debug(text:TemplateStringsArray, ...data:any[]):void
    public debug(text:string, ...data:any[]):void
    public debug(value:any):void
    public debug(text:string|TemplateStringsArray|any,...data:any[]) {
        if (!this.isTemplateStringArrayOrString(text)) {data = [text];text = '?';} // text is a single non-string value
        this.log(COLOR.CYAN, this.normalizeLogText(text), data, LOG_LEVEL.VERBOSE)
    }

    public info(text:TemplateStringsArray, ...data:any[]):void
    public info(text:string, ...data:any[]):void
    public info(value:any):void
    public info(text:string|TemplateStringsArray|any,...data:any[]) {
        if (!this.isTemplateStringArrayOrString(text)) {data = [text];text = '?';} // text is a single non-string value
        this.log(console_theme == 'dark' ?  COLOR.WHITE : COLOR.BLACK, this.normalizeLogText(text), data, LOG_LEVEL.DEFAULT)
    }

    public warn(text:TemplateStringsArray, ...data:any[]):void
    public warn(text:string, ...data:any[]):void
    public warn(value:any):void
    public warn(text:string|TemplateStringsArray|any,...data:any[]) {
        if (!this.isTemplateStringArrayOrString(text)) {data = [text];text = '?';} // text is a single non-string value
        this.log(COLOR.YELLOW, this.normalizeLogText(text), data, LOG_LEVEL.WARNING)
    }

    public error(text:TemplateStringsArray, ...data:any[]):void
    public error(text:string, ...data:any[]):void
    public error(value:any):void
    public error(text:string|TemplateStringsArray|any,...data:any[]) {
        if (!this.isTemplateStringArrayOrString(text)) {data = [text];text = '?';} // text is a single non-string value
        this.log(COLOR.RED, this.normalizeLogText(text), data, LOG_LEVEL.ERROR)
    }

    public success(text:TemplateStringsArray, ...data:any[]):void
    public success(text:string, ...data:any[]):void
    public success(value:any):void
    public success(text:string|TemplateStringsArray|any,...data:any[]) {
        if (!this.isTemplateStringArrayOrString(text)) {data = [text];text = '?';} // text is a single non-string value
        this.log(COLOR.GREEN, this.normalizeLogText(text), data, LOG_LEVEL.DEFAULT)
    }

    public plain(text:TemplateStringsArray, ...data:any[]):void
    public plain(text:string, ...data:any[]):void
    public plain(value:any):void
    public plain(text:string|TemplateStringsArray|any,...data:any[]) {
        if (!this.isTemplateStringArrayOrString(text)) {data = [text];text = '?';} // text is a single non-string value
        this.log(console_theme == 'dark' ?  COLOR.WHITE : COLOR.BLACK, this.normalizeLogText(text), data, LOG_LEVEL.DEFAULT, false, false)
    }

    // does not have an effect in the native browser console or log streams with multiple logger inputs (intentionally)
    public clear(silent = false){
        this.logRaw(ESCAPE_SEQUENCES.CLEAR, LOG_LEVEL.DEFAULT, true)
        this.logRaw('\x1bc', LOG_LEVEL.DEFAULT, true)
        if (!silent) this.logRaw(ESCAPE_SEQUENCES.ITALIC + '[' + (this.origin??'?') + '] was cleared' + ESCAPE_SEQUENCES.RESET);
    }


    /**
     * accumulate all logs and only console.log() once when flush() called
     */
    public lock() {
        this.locked = true;
    }

    public flush() {
        this.locked = false;
        this.logRaw(this.lockedContent??'');
        this.lockedContent = null;
    }


    public dynamic(text:TemplateStringsArray, ...data:any[]):void
    public dynamic(text:string, ...data:any[]):void
    public dynamic(text:string|TemplateStringsArray,...data:any[]) {
        // TODO: replace node process

        // const y = Logger.getCursorY(globalThis.process?.stdout);
        // const x = Logger.getCursorX(globalThis.process?.stdout);

        // this.log(console_theme == 'dark' ?  COLOR.WHITE : COLOR.BLACK, this.normalizeLogText(text), data)
        
        // return {
        //     update: (text:string|TemplateStringsArray,...data:any[]) => {
        //         const dy = y-Logger.getCursorY(globalThis.process?.stdout);
        //         const dx = x-Logger.getCursorX(globalThis.process?.stdout);

        //         const browser_compat_mode_required:[boolean] = [false];
        //         const log_string = this.generateLogString(console_theme == 'dark' ?  COLOR.WHITE : COLOR.BLACK, this.normalizeLogText(text), data, true, browser_compat_mode_required);


        //         this.logRaw(
        //             Logger.moveCursor(dx,dy) + 
        //             log_string +
        //             Logger.moveCursor(-dx,-dy-1),
        //             LOG_LEVEL.DEFAULT,
        //             false,
        //             browser_compat_mode_required[0]
        //         )
        //         Logger.setCursorY(globalThis.process?.stdout, Logger.getCursorY(globalThis.process?.stdout)-1);
        //         // process.stdout.write(Logger.moveCursor(dx,dy));
        //         // process.stdout.write(this.normalizeLogText(text)+'\r\n');
        //         // process.stdout.write(Logger.moveCursor(-dx,-dy))
        //     }
        // }

    }



    static cursor_x = new WeakMap<any,number>();
    static cursor_y = new WeakMap<any,number>();


    static getCursorX(term:any) {
        if (this.cursor_x.has(term)) return this.cursor_x.get(term)
        else {
            this.cursor_x.set(term, 0);
            return this.cursor_x.get(term)
        }
    }

    static getCursorY(term={}) {
        if (this.cursor_y.has(term)) return this.cursor_y.get(term)
        else {
            this.cursor_y.set(term, 0);
            return this.cursor_y.get(term)
        }
    }

    static setCursorX(term={}, value:number) {
        this.cursor_x.set(term, value)
    }

    static setCursorY(term={}, value:number) {
        this.cursor_y.set(term, value)
    }

    private static setCursorPosition(x:number, y:number){
        return `\x1b[${y};${x}H`
    }


    private static moveCursor(x:number, y:number){
        let move = '';
        if (x > 0 ) move += `\x1b[${x}C`
        else if (x < 0 ) move += `\x1b[${-x}D`

        if (y > 0 ) move += `\x1b[${y}B`
        else if (y < 0 ) move += `\x1b[${-y}A`
        return move;
    }

    // workaround for ciruclar DATEX Runtime dependencies
    public static setRuntime(runtime:typeof Runtime) {
        _Runtime = runtime;
    }
    public static setType(type:typeof Type) {
        _Type = type;
    }
    public static setPointer(pointer:typeof Pointer) {
        _Pointer = pointer;
    }


    private static formatters = new Map<string, LogFormatter>();

    public static registerLogFormatter(formatter:LogFormatter) {
        this.formatters.set(formatter.name, formatter)
    }
    
 
    // set log levels for development / production
    static #development_log_level = LOG_LEVEL.VERBOSE;
    static #production_log_level = LOG_LEVEL.VERBOSE;

    public static set development_log_level(log_level:LOG_LEVEL) {
        this.#development_log_level = log_level;
    }
    public static get development_log_level() {
        return this.#development_log_level;
    }

    public static set production_log_level(log_level:LOG_LEVEL) {
        this.#production_log_level = log_level;
    }
    public static get production_log_level() {
        return this.#production_log_level;
    }
 



    // Log streams

    static loggersForStream = new Map<StreamSink, Set<Logger>>()

    static logToStream<S extends StreamSink>(stream:S, ...filter_origins:string[]):S {
        // global stream
        if (!filter_origins?.length) {
            this.global_log_streams.add(stream);
        }
        // stream for specific origins
        else {
            for (let origin of filter_origins) {
                for (let logger of this.loggers_by_origin.get(origin)??[]) {
                    logger.out_streams.add(stream);
                    if (!this.loggersForStream.has(stream)) this.loggersForStream.set(stream, new Set());
                    this.loggersForStream.get(stream)?.add(logger);
                }
            }
        }
        return stream;
    }

}


Logger.registerLogFormatter(new ColorFormatter);
Logger.registerLogFormatter(new BGColorFormatter);
Logger.registerLogFormatter(new BoldFormatter);
Logger.registerLogFormatter(new ResetFormatter);
Logger.registerLogFormatter(new DATEXFormatter);
Logger.registerLogFormatter(new ImageFormatter);
Logger.registerLogFormatter(new TextFormatter);


// @ts-ignore set global logger for dev console
globalThis.logger = new Logger("main");

enableFullSupport();


// set log level (browser default true, deno default false)
let verbose = true;

// command line args (--watch-backend)
if (globalThis.Deno) {
    verbose = false
    const parse = (await import("https://deno.land/std@0.168.0/flags/mod.ts")).parse;
    const flags = parse(Deno.args, {
        boolean: ["verbose"],
        alias: {
            v: "verbose",
        },
        default: {verbose}
    });
    verbose = flags["verbose"]
}

if (verbose) {
    Logger.development_log_level = LOG_LEVEL.VERBOSE;
    Logger.production_log_level = LOG_LEVEL.VERBOSE;
}
else {
    Logger.development_log_level = LOG_LEVEL.DEFAULT;
    Logger.production_log_level = LOG_LEVEL.DEFAULT;
}