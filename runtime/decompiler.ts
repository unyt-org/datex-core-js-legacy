/**
 * Decompiles datex parser
 * @param dxb Valid compiled datex binary
 * @param [comments] show debug comments
 * @param [formatted] format automatically (new lines, indentation)
 * @param [formatted_strings] display new lines in strings as actual new lines
 * @returns decompiled datex
 */


import { base64ToArrayBuffer, BinaryCode, Endpoint, Logger, Pointer, Runtime, Target, Type, Quantity, Disjunction, Connective } from "../datex_all.ts";
import { Time } from "../types/time.ts";


const logger = new Logger("DATEX Decompiler");


const utf8_decoder = new TextDecoder("utf-8");

export class Decompiler {
	  

		 static decompile(dxb:ArrayBuffer, comments=true, formatted=true, formatted_strings=true, has_header=true): string {

			let uint8 = new Uint8Array(dxb);          
	
			if (!dxb) {
				logger.error("DATEX missing");
				return "/* INVALID DATEX */"
			}
	
			// first extract body from datex
			if (has_header) {
				try {
					let res = Runtime.parseHeaderSynchronousPart(dxb);
					if (!(res instanceof Array)) return "/* ERROR: Invalid DATEX Header */";
					uint8 = res[1];
				} catch (e) {
					return "/* ERROR: Invalid DATEX Header */";
				}
			}
		  
			
			let buffer    = uint8.buffer;
			let data_view = new DataView(buffer);  
	
			let append_comments = "";
	
			let current_index = 0;
	
			enum TOKEN_TYPE  {
				VALUE, SUBSCOPE
			}
	
			type token = {type?:TOKEN_TYPE, value?:any, string?:string, meta_string?:string, bin?:BinaryCode};
			type token_list = token[] & {connective_size?:number};
	 
			let tokens:token_list = [{type:TOKEN_TYPE.SUBSCOPE, value:[]}] 
			let current_scope:token_list = tokens[0].value;
			let parent_scopes:token_list[] = [];
	
			const extractVariableName = ():string|number => {
				let length = uint8[current_index++];
				let name:string|number;
				if (length == 0) { // binary name (2 byte number)
					name = data_view.getUint16(current_index, true);
					current_index += Uint16Array.BYTES_PER_ELEMENT;
				}
				else {
					name = utf8_decoder.decode(uint8.subarray(current_index, current_index+length));
					current_index += length;
				}
				return name;
			}
	
			const extractType = (is_extended = false):[Type,boolean] => {
				let ns_length = uint8[current_index++];
				let name_length = uint8[current_index++];
				let variation_length = 0;
				let has_parameters;
	
				if (is_extended) {
					variation_length = uint8[current_index++];
					has_parameters = uint8[current_index++] ? true : false;
				}
	
				let ns = utf8_decoder.decode(uint8.subarray(current_index, current_index += ns_length));
				let type = utf8_decoder.decode(uint8.subarray(current_index, current_index += name_length));
				let varation = is_extended ?  utf8_decoder.decode(uint8.subarray(current_index, current_index += variation_length)) : undefined;
	
				return [Type.get(ns, type, varation), has_parameters]
			}
	
			const actionToString = (action:BinaryCode) => {
				let action_string:string;
				switch (action) {
					case BinaryCode.ADD: action_string = "+";break;
					case BinaryCode.SUBTRACT: action_string = "-";break;
					case BinaryCode.MULTIPLY: action_string = "*";break;
					case BinaryCode.POWER: action_string = "^";break;
					case BinaryCode.MODULO: action_string = "%";break;
					case BinaryCode.DIVIDE: action_string = "/";break;
					case BinaryCode.AND: action_string = "and";break;
					case BinaryCode.OR: action_string = "or";break;
					case BinaryCode.CREATE_POINTER: action_string = ":";break;
	
				}
				return action_string;
			}
	
			const enterSubScope = (type:BinaryCode) => {
				parent_scopes.push(current_scope);
				current_scope.push({type:TOKEN_TYPE.SUBSCOPE, bin:type, value:[]});
				current_scope = current_scope[current_scope.length-1].value;
			}
	
			const exitSubScope = () => {
				if (!parent_scopes.length) {
					logger.error("No parent scope to go to");
					append_comments += "/* ERROR: No parent scope to go to */"
					throw "No parent scope to go to";
				}
				current_scope = parent_scopes.pop(); // go back to parent scope
			}
	
	
			const constructFilterElement = (type:BinaryCode, target_list?:Endpoint[]):Target => {
	
				const name_is_binary = type == BinaryCode.ENDPOINT || type == BinaryCode.ENDPOINT_WILDCARD;
	
				let instance:string;
	
				let name_length = uint8[current_index++]; // get name length
				let subspace_number = uint8[current_index++]; // get subspace number
				let instance_length = uint8[current_index++]; // get instance length
	
				if (instance_length == 0) instance = "*";
				else if (instance_length == 255) instance_length = 0;
	
				let name_binary = uint8.subarray(current_index, current_index+=name_length);
				let name = name_is_binary ? name_binary : utf8_decoder.decode(name_binary)  // get name
				let subspaces:string[] = [];
				for (let n=0; n<subspace_number; n++) {
					let length = uint8[current_index++];
					if (length == 0) {
						subspaces.push("*");
					}
					else {
						let subspace_name = utf8_decoder.decode(uint8.subarray(current_index, current_index+=length));
						subspaces.push(subspace_name);
					}
				}
				
				if (!instance) instance = utf8_decoder.decode(uint8.subarray(current_index, current_index+=instance_length))  // get instance
	
				let app_index:number
				if (target_list) app_index = uint8[current_index++];
	
				return Target.get(name, instance, type);
			}
	
			// loop through instructions
			loop: while (true) {
	
				// pause scope - not necessarily end
				if (current_index>=uint8.byteLength) {
					break;
				}

				let was_value = true; // token injected value
	
				let token = uint8[current_index++];
				if (token == undefined) break;
	
				// ASSIGN_SET = 
				switch (token) {
	
					// end scope
					case BinaryCode.EXIT: { 
						current_scope.push({string:"exit"})
						was_value = false;
						break;
					}
	
					// STRING
					case BinaryCode.SHORT_TEXT:
					case BinaryCode.TEXT: {
	
						let length:number;
						if (token == BinaryCode.SHORT_TEXT) {
							length = uint8[current_index++];
						}
						else {
							length = data_view.getUint32(current_index, true);
							current_index += Uint32Array.BYTES_PER_ELEMENT;
						}
					  
										
						let string = utf8_decoder.decode(uint8.subarray(current_index, current_index+length));
						current_index += length;
	
						current_scope.push({type:TOKEN_TYPE.VALUE, string:Runtime.valueToDatexString(string, formatted_strings)});
						break;
					}
	
	
					// BUFFER 
					case BinaryCode.BUFFER: {   
	
						let buffer_length = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						
						let _buffer = buffer.slice(current_index, current_index+buffer_length);
						current_index += buffer_length;
	
						current_scope.push({type:TOKEN_TYPE.VALUE, string:Runtime.valueToDatexString(_buffer)});
						break;
					}
	
					// CHILD_SET =
					case BinaryCode.CHILD_SET: { 
						was_value = false;
						current_scope.push({bin:BinaryCode.CHILD_SET, string:"."});
						break;
					}
	
					// CHILD_ACTION (+=, -=, ...)
					case BinaryCode.CHILD_ACTION: { 
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
						current_scope.push({bin:BinaryCode.CHILD_ACTION, string:".", meta_string:action_string});
						break;
					}
	
					// RANGE ..
					case BinaryCode.RANGE: {    
						was_value = false;         
						current_scope.push({bin:BinaryCode.RANGE});
						break;
					}
	
					// SPREAD ...
					case BinaryCode.EXTEND: {     
						was_value = false;        
						current_scope.push({string:"..."});
						break;
					}
	
					// ERROR
					case BinaryCode.YEET: {
						was_value = false;
						current_scope.push({string:"yeet "});
						break;
					}
	
					// COMPARE
					case BinaryCode.EQUAL_VALUE: {
						was_value = false;
						current_scope.push({string:"=="});
						break;
					}
					case BinaryCode.EQUAL: {
						was_value = false;
						current_scope.push({string:"==="});
						break;
					}
					case BinaryCode.NOT_EQUAL_VALUE:{
						was_value = false;
						current_scope.push({string:"!="});
						break;
					}
					case BinaryCode.NOT_EQUAL:{
						was_value = false;
						current_scope.push({string:"!=="});
						break;
					}
					case BinaryCode.GREATER:{
						was_value = false;
						current_scope.push({string:">"});
						break;
					}
					case BinaryCode.GREATER_EQUAL:{
						was_value = false;
						current_scope.push({string:">="});
						break;
					}
					case BinaryCode.LESS:{
						was_value = false;
						current_scope.push({string:"<"});
						break;
					}
					case BinaryCode.LESS_EQUAL:{
						was_value = false;
						current_scope.push({string:"<="});
						break;
					}
					
					// PATH_GET
					case BinaryCode.CHILD_GET: { 
						was_value = false;
						current_scope.push({bin:BinaryCode.CHILD_GET, string:"."});
						break;
					}
					
					// CHILD_GET_REF
					case BinaryCode.CHILD_GET_REF: { 
						was_value = false;
						current_scope.push({bin:BinaryCode.CHILD_GET_REF, string:"->"});
						break;
					}
	
					// CACHE POINTS
					case BinaryCode.CACHE_POINT: {
						was_value = false;
						current_scope.push({bin:BinaryCode.CACHE_POINT});
						break;
					}
					case BinaryCode.CACHE_RESET: {
						was_value = false;
						current_scope.push({bin:BinaryCode.CACHE_RESET});
						break;
					}
	
	
					// REMOTE Call (::)
					case BinaryCode.REMOTE:{
						was_value = false;
						current_scope.push({string:" :: "});
						break;
					}
	
					// JMPS
					case BinaryCode.JMP: {
						was_value = false;
						let index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string: "jmp " + index.toString(16)});
						break;
					}
	
					case BinaryCode.JTR: {
						was_value = false;
						let index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string: "jtr " + index.toString(16) + " "});
						break;
					}
	
					case BinaryCode.JFA: {
						was_value = false;
						let index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string: "jfa " + index.toString(16) + " "});
						break;
					}
	
	
					// SET_LABEL  
					case BinaryCode.SET_LABEL: { 
						was_value = false;
						let name = extractVariableName();
						current_scope.push({string: Runtime.formatVariableName(name, '$') + " = "});
						break;
					}

					// INIT_LABEL  
					case BinaryCode.INIT_LABEL: { 
						was_value = false;
						let name = extractVariableName();
						let jmp_index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string: Runtime.formatVariableName(name, '$') + " := /*jmp:" + jmp_index + "*/" });
						break;
					}
	
					// LABEL  
					case BinaryCode.LABEL: { 
						let name = extractVariableName();
						current_scope.push({type:TOKEN_TYPE.VALUE, string: Runtime.formatVariableName(name, '$')});
						break;
					}
	
					// LABEL_ACTION  
					case BinaryCode.LABEL_ACTION: { 
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
						let name = extractVariableName()
						current_scope.push({string: Runtime.formatVariableName(name, '$') + ` ${action_string}= `});
						break;
					}
	
	
					
					// ASSIGN_INTERNAL_VAR  
					case BinaryCode.SET_INTERNAL_VAR: { 
						was_value = false;
						let name = extractVariableName();
						current_scope.push({string: Runtime.formatVariableName(name, '#') + " = "});
						break;
					}
	
					// INIT_INTERNAL_VAR  
					case BinaryCode.INIT_INTERNAL_VAR: { 
						was_value = false;
						let name = extractVariableName();
						let jmp_index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string: Runtime.formatVariableName(name, '#') + " := /*jmp:" + jmp_index + "*/" });
						break;
					}

					// SET_INTERNAL_VAR_REFERENCE  
					case BinaryCode.SET_INTERNAL_VAR_REFERENCE: { 
						was_value = false;
						let name = extractVariableName();
						current_scope.push({string: Runtime.formatVariableName(name, '#') + " $= "});
						break;
					}
	
					// INTERNAL_VAR  
					case BinaryCode.INTERNAL_VAR: { 
						let name = extractVariableName();
						current_scope.push({type:TOKEN_TYPE.VALUE, string: Runtime.formatVariableName(name, '#')});
						break;
					}
	
					// INTERNAL_VAR_ACTION  
					case BinaryCode.INTERNAL_VAR_ACTION: { 
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
						let name = extractVariableName()
						current_scope.push({string: Runtime.formatVariableName(name, '#') + ` ${action_string}= `});
						break;
					}
	
	
					// INTERNAL VAR shorthands
					case BinaryCode.VAR_RESULT:{ 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#result"});
						break;
					}
					case BinaryCode.VAR_SUB_RESULT: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#sub_result"});
						break;
					}
					// case BinaryCode.VAR_ENCRYPTED: { 
					// 	current_scope.push({type:TOKEN_TYPE.VALUE, string: "#encrypted"});
					// 	break;
					// }
					// case BinaryCode.VAR_SIGNED: { 
					// 	current_scope.push({type:TOKEN_TYPE.VALUE, string: "#signed"});
					// 	break;
					// }
					case BinaryCode.VAR_SENDER: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#sender"});
						break;
					}
					case BinaryCode.VAR_CURRENT: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#current"});
						break;
					}
					case BinaryCode.VAR_LOCATION: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#location"});
						break;
					}

					case BinaryCode.VAR_ENV: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#env"});
						break;
					}
					case BinaryCode.VAR_ENTRYPOINT: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#entrypoint"});
						break;
					}
					// case BinaryCode.VAR_TIMESTAMP: { 
					// 	current_scope.push({type:TOKEN_TYPE.VALUE, string: "#timestamp"});
					// 	break;
					// }
					case BinaryCode.VAR_META: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#meta"});
						break;
					}
					case BinaryCode.VAR_REMOTE: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#remote"});
						break;
					}
	
					case BinaryCode.VAR_PUBLIC: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#public"});
						break;
					}
					case BinaryCode.VAR_VOID: { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#void"});
						break;
					}
					case BinaryCode.VAR_THIS:  { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#this"});
						break;
					}
					case BinaryCode.VAR_IT:  { 
						current_scope.push({type:TOKEN_TYPE.VALUE, string: "#it"});
						break;
					}
	
	
					case BinaryCode.SET_VAR_RESULT: { 
						was_value = false;
						current_scope.push({string: "#result = "});
						break;
					}
					case BinaryCode.SET_VAR_SUB_RESULT: { 
						was_value = false;
						current_scope.push({string: "#sub_result = "});
						break;
					}
					case BinaryCode.SET_VAR_VOID:  { 
						was_value = false;
						current_scope.push({string: "#void = "});
						break;
					}
	
	
					case BinaryCode.VAR_SUB_RESULT_ACTION: {
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
						current_scope.push({string:  "#sub_result" + ` ${action_string}= `});
						break;
					}
					case BinaryCode.VAR_RESULT_ACTION: { 
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
						current_scope.push({string:  "#result" + ` ${action_string}= `});
						break;
					}
					case BinaryCode.VAR_REMOTE_ACTION: { 
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
						current_scope.push({string:  "#remote" + ` ${action_string}= `});
						break;
					}
	
	
					// COMMAND END  
					case BinaryCode.CLOSE_AND_STORE: {
						was_value = false;
						current_scope.push({string: ";\n"});
						break;
					}
	
					// CODE_BLOCK 
					case BinaryCode.SCOPE_BLOCK: {  
					   
						let size = data_view.getUint32(current_index, true);   // buffer length
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						const buffer = uint8.subarray(current_index, current_index+size);
						const decompiled = this.decompile(buffer, comments, formatted, formatted_strings, false);
						current_index += size;
						// current_index += Uint16Array.BYTES_PER_ELEMENT;
						// let args = [];
	
						// // variables
						// for (let i=0;i<nr_of_args;i++) {
						//     let type:Type|typeof WITH;
	
						//     let token = uint8[current_index++];
	
						//     // get type
						//     if (token == BinaryCode.TYPE) [type] = extractType();
						//     else if (token >= BinaryCode.STD_TYPE_STRING && token <= BinaryCode.STD_TYPE_FUNCTION) type = Type.short_types[token];
						//     else if (token == 1) type = WITH
	
						//     let length = uint8[current_index++];
	
						//     args.push([type, utf8_decoder.decode(uint8.subarray(current_index, current_index+length))]);
						//     current_index += length;
						// }
						
						// // Compiled buffer
	
						// let buffer_length = data_view.getUint32(current_index, true);
						// current_index += Uint32Array.BYTES_PER_ELEMENT;
	
						// let _buffer = buffer.slice(current_index, current_index+buffer_length);
						// current_index += buffer_length;
	
						// // show datex block as default 
						// let code_block_string = Runtime.valueToDatexString(new ScopeBlock(args, _buffer), formatted)
	
						current_scope.push({type: TOKEN_TYPE.VALUE, string:'('+decompiled+')'});
	
						break;
					}
	
					// NULL
					case BinaryCode.NULL: {
						current_scope.push({type: TOKEN_TYPE.VALUE, string:"null"});
						break;
					}
	
					// VOID
					case BinaryCode.VOID: {
						current_scope.push({type: TOKEN_TYPE.VALUE, string:"void"});
						break;
					}
	
					// WILDCARD
					case BinaryCode.WILDCARD: {
						was_value = false;
						current_scope.push({type: TOKEN_TYPE.VALUE, string:"*"});
						break;
					}
	
					// RETURN
					case BinaryCode.RETURN: {
						was_value = false;
						current_scope.push({string:"return"});
						break;
					}
	
					// ABOUT
					case BinaryCode.ABOUT: {
						was_value = false;
						current_scope.push({string:"about "});
						break;
					}
	
					// COUNT
					case BinaryCode.COUNT: {
						was_value = false;
						current_scope.push({string:"count "});
						break;
					}
	
					// FREEZE
					case BinaryCode.FREEZE: {
						was_value = false;
						current_scope.push({string:"freeze "});
						break;
					}
	
					// SEAL
					case BinaryCode.SEAL: {
						was_value = false;
						current_scope.push({string:"seal "});
						break;
					}
	
					// HAS
					case BinaryCode.HAS: {
						was_value = false;
						current_scope.push({string:" has "});
						break;
					}
	
					// KEYS
					case BinaryCode.KEYS: {
						was_value = false;
						current_scope.push({string:"keys "});
						break;
					}
	
					// TEMPLATE
					case BinaryCode.TEMPLATE: {
						was_value = false;
						current_scope.push({string:"template "});
						break;
					}
	
					// EXTENDS
					case BinaryCode.EXTENDS: {
						was_value = false;
						current_scope.push({string:" extends "});
						break;
					}
	
					// SCOPE
					case BinaryCode.PLAIN_SCOPE: {
						was_value = false;
						current_scope.push({string:"scope "});
						break;
					}
	
					// TRANSFORM
					case BinaryCode.TRANSFORM: {
						was_value = false;
						current_scope.push({string:"always "});
						break;
					}
	
					// RUN
					case BinaryCode.RUN: {
						was_value = false;
						current_scope.push({string:"run "});
						break;
					}

					// DO
					case BinaryCode.DO: {
						was_value = false;
						current_scope.push({string:"do "});
						break;
					}

					// ITERATOR
					case BinaryCode.ITERATOR: {
						was_value = false;
						current_scope.push({string:"iterator "});
						break;
					}

					// NEXT
					case BinaryCode.NEXT: {
						was_value = false;
						current_scope.push({string:"next "});
						break;
					}

					// ASSERT
					case BinaryCode.ASSERT: {
						was_value = false;
						current_scope.push({string:"assert "});
						break;
					}
	
					// AWAIT
					case BinaryCode.AWAIT: {
						was_value = false;
						current_scope.push({string:"await "});
						break;
					}
	
					// FUNCTION
					case BinaryCode.FUNCTION: {
						was_value = false;
						current_scope.push({string:"function "});
						break;
					}
	
	
					// MAYBE
					case BinaryCode.MAYBE: {
						was_value = false;
						current_scope.push({string:"maybe "});
						break;
					}
	
					// OBSERVE
					case BinaryCode.OBSERVE: {
						was_value = false;
						current_scope.push({string:"observe "});
						break;
					}
	
					// IMPLEMENTS
					case BinaryCode.IMPLEMENTS: {
						was_value = false;
						current_scope.push({string:" implements "});
						break;
					}
	
					// MATCHES
					case BinaryCode.MATCHES: {
						was_value = false;
						current_scope.push({string:" matches "});
						break;
					}

					// DEFAULT
					case BinaryCode.DEFAULT: {
						was_value = false;
						let jmp_index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string:" default /*jmp:" + jmp_index + "*/"});
						break;
					}

					case BinaryCode.DISJUNCTION: {
						enterSubScope(BinaryCode.DISJUNCTION);
						current_scope.connective_size = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						break;
					}

					case BinaryCode.CONJUNCTION: {
						enterSubScope(BinaryCode.CONJUNCTION);
						current_scope.connective_size = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						break;
					}

	
					// DEBUGGER
					case BinaryCode.DEBUGGER: {
						was_value = false;
						current_scope.push({string:"debugger"});
						break;
					}
	
					// NEW
					case BinaryCode.NEW: {
						was_value = false;
						current_scope.push({string:"new "});
						break;
					}
	
					// GET
					case BinaryCode.GET: {
						was_value = false;
						current_scope.push({string:"get "});
						break;
					}
	
					// URL
					case BinaryCode.URL: {
						let length = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
										
						let url = new URL(utf8_decoder.decode(uint8.subarray(current_index, current_index+length)));
						current_index += length;
	
						current_scope.push({type:TOKEN_TYPE.VALUE, string:Runtime.valueToDatexString(url, formatted_strings)});
						break;
					}

					// RESOLVE_RELATIVE_PATH
					case BinaryCode.RESOLVE_RELATIVE_PATH: {
						was_value = false;
						let length = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
										
						let path = utf8_decoder.decode(uint8.subarray(current_index, current_index+length));
						current_index += length;
	
						current_scope.push({type:TOKEN_TYPE.VALUE, string:path});
						break;
					}
	
					// ARRAY_START
					case BinaryCode.ARRAY_START: {
						enterSubScope(BinaryCode.ARRAY_START);
						break;
					}
	
					// TUPLE_START
					case BinaryCode.TUPLE_START: {
						enterSubScope(BinaryCode.TUPLE_START);
						break;
					}
	
					// OBJECT_START
					case BinaryCode.OBJECT_START: {
						enterSubScope(BinaryCode.OBJECT_START);
						break;
					}
	
	
					// list element with key
					case BinaryCode.ELEMENT_WITH_KEY: {
						was_value = false;
						let length = uint8[current_index++];
						let key = utf8_decoder.decode(uint8.subarray(current_index, current_index+length));
						current_index += length;
	
						current_scope.push({bin:BinaryCode.ELEMENT_WITH_KEY, string:`"${key.replace(/\'/g, "\\'")}": `});
						break;
					}
	
					case BinaryCode.ELEMENT_WITH_INT_KEY: {
						was_value = false;
						let key = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
	
						current_scope.push({bin:BinaryCode.ELEMENT_WITH_KEY, string:`${key}: `});
						break;
					}
	
					case BinaryCode.ELEMENT_WITH_DYNAMIC_KEY: {
						was_value = false;
						current_scope.push({bin:BinaryCode.ELEMENT_WITH_KEY, string:`: `});
						break;
					}
	
					case BinaryCode.KEY_PERMISSION: {
						was_value = false;
						current_scope.push({string:`!!`});
						break;
					}
	
	
					// keyless list element 
					case BinaryCode.ELEMENT: {
						was_value = false;
						current_scope.push({bin:BinaryCode.ELEMENT});
						break;
					}
					
					// ARRAY_END, OBJECT_END, TUPLE_END, RECORD_END
					case BinaryCode.ARRAY_END:
					case BinaryCode.OBJECT_END:
					case BinaryCode.TUPLE_END: {
						try {
							exitSubScope()
						} catch (e) {
							break loop;
						}
						break;
					}
	
					// STD SHORT TYPES
					case BinaryCode.STD_TYPE_TEXT: 
					case BinaryCode.STD_TYPE_INT:
					case BinaryCode.STD_TYPE_FLOAT:
					case BinaryCode.STD_TYPE_BOOLEAN:
					case BinaryCode.STD_TYPE_NULL:
					case BinaryCode.STD_TYPE_VOID:
					case BinaryCode.STD_TYPE_BUFFER:
					case BinaryCode.STD_TYPE_CODE_BLOCK:
					case BinaryCode.STD_TYPE_UNIT:
					case BinaryCode.STD_TYPE_TIME:
					case BinaryCode.STD_TYPE_URL:
					case BinaryCode.STD_TYPE_ARRAY:
					case BinaryCode.STD_TYPE_OBJECT:
					case BinaryCode.STD_TYPE_SET:
					case BinaryCode.STD_TYPE_MAP:
					case BinaryCode.STD_TYPE_TUPLE:
					case BinaryCode.STD_TYPE_STREAM:
					case BinaryCode.STD_TYPE_ANY:
					case BinaryCode.STD_TYPE_ASSERTION:
					case BinaryCode.STD_TYPE_TASK:
					case BinaryCode.STD_TYPE_ITERATOR:
					case BinaryCode.STD_TYPE_FUNCTION: {
						current_scope.push({type: TOKEN_TYPE.VALUE, string: Type.short_types[token].toString()});
						break;
					}
	
					// INCREMENT (++)
					case BinaryCode.INCREMENT: {
						was_value = false;
						current_scope.push({string:"++"});
						break;
					}
					// DECREMENT (--)
					case BinaryCode.DECREMENT: {
						was_value = false;
						current_scope.push({string:"--"});
						break;
					}

					// ADD (+)
					case BinaryCode.ADD: {
						was_value = false;
						current_scope.push({string:" + "});
						break;
					}
	
					// SUBTRACT (-)
					case BinaryCode.SUBTRACT: {
						was_value = false;
						current_scope.push({string:" - "});
						break;
					}
	
					// MULTIPLY (*)
					case BinaryCode.MULTIPLY: {
						was_value = false;
						current_scope.push({string:" * "});
						break;
					}
	
					// POWER (^)
					case BinaryCode.POWER: {
						was_value = false;
						current_scope.push({string:" ^ "});
						break;
					}

					// MODULO (%)
					case BinaryCode.MODULO: {
						was_value = false;
						current_scope.push({string:" % "});
						break;
					}
	
					// DIVIDE (/)
					case BinaryCode.DIVIDE: {
						was_value = false;
						current_scope.push({string:" / "});
						break;
					}
	
					// SYNC (<==)
					case BinaryCode.SYNC: {
						was_value = false;
						current_scope.push({string:" <== "});
						break;
					}
	
					// STOP_SYNC (</=)
					case BinaryCode.STOP_SYNC: {
						was_value = false;
						current_scope.push({string:" </= "});
						break;
					}
	
					// AND (&)
					case BinaryCode.AND: {
						was_value = false;
						current_scope.push({string:" and "});
						break;
					}
	
					// OR (|)
					case BinaryCode.OR: {
						was_value = false;
						current_scope.push({string:" or "});
						break;
					}
	
					// NOT (!)
					case BinaryCode.NOT: {
						was_value = false;
						current_scope.push({string:"not "});
						break;
					}
	
					// SUBSCOPE_START
					case BinaryCode.SUBSCOPE_START: {
						enterSubScope(BinaryCode.SUBSCOPE_START);
						break;
					}
					// SUBSCOPE_END
					case BinaryCode.SUBSCOPE_END: {   
						try {
							exitSubScope()
						} catch (e) {
							break loop;
						}
						break;
					}
				
					// TRUE
					case BinaryCode.TRUE: {
						current_scope.push({type: TOKEN_TYPE.VALUE, string: "true"});
						break;
					}
	
					// FALSE
					case BinaryCode.FALSE: {
						current_scope.push({type: TOKEN_TYPE.VALUE, string: "false"});
						break;
					}
	
					// UNIT
					case BinaryCode.QUANTITY: {

						const sign = uint8[current_index++] == 0 ? -1n : 1n;  // 0 for negative, 1 for positive (and 0)

						// buffer sizes
						const num_size = data_view.getUint16(current_index, true)
						current_index+=Uint16Array.BYTES_PER_ELEMENT;
						const den_size = data_view.getUint16(current_index, true)
						current_index+=Uint16Array.BYTES_PER_ELEMENT;

						// numerator
						const num_buffer = uint8.subarray(current_index, current_index+=num_size);
						const den_buffer = uint8.subarray(current_index, current_index+=den_size)

						const num = Quantity.bufferToBigInt(num_buffer) * sign;
						const den = Quantity.bufferToBigInt(den_buffer);

						const factor_count = uint8[current_index++];
						const unit_factors = [];
						for (let i=0; i<factor_count; i++) {
							const code = uint8[current_index++];
							const exponent = data_view.getInt8(current_index++);
							unit_factors.push([code, exponent]);
						}

						let unit = new Quantity([num, den], unit_factors);
						current_scope.push({type: TOKEN_TYPE.VALUE, string: unit.toString()});
						break;
					}
	
					// INT_8
					case BinaryCode.INT_8: {
						let integer:bigint|number = data_view.getInt8(current_index);
						current_index += Int8Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: integer.toString()});
						break;
					}
	
					// INT_16
					case BinaryCode.INT_16: {
						let integer:bigint|number = data_view.getInt16(current_index, true);
						current_index += Int16Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: integer.toString()});
						break;
					}
	
					// INT_32
					case BinaryCode.INT_32: {
						let integer:bigint|number = data_view.getInt32(current_index, true);
						current_index += Int32Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: integer.toString()});
						break;
					}
	
					// INT_64
					case BinaryCode.INT_64: {
						let integer:bigint|number = data_view.getBigInt64(current_index, true);
						current_index += BigInt64Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: integer.toString()});
						break;
					}
	
					// FLOAT
					case BinaryCode.FLOAT_64: {
						let float = data_view.getFloat64(current_index, true);
						current_index += Float64Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: Runtime.valueToDatexString(float)});
						break;
					}
	
				
					// FLOAT
					case BinaryCode.FLOAT_AS_INT: {
						let float = data_view.getInt32(current_index, true);
						current_index += Int32Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: Runtime.valueToDatexString(float)});
						break;
					}
	
					// TIME
					case BinaryCode.TIME: {
						let millis:bigint = data_view.getBigUint64(current_index, true);
						current_index += BigUint64Array.BYTES_PER_ELEMENT;
						current_scope.push({type: TOKEN_TYPE.VALUE, string: new Time(Number(millis)).toString()});
						break;
					}
					
					// TYPE
					case BinaryCode.TYPE: {
						const [type] = extractType();
						current_scope.push({type: TOKEN_TYPE.VALUE, string: type.toString()});
						break;
					}
	
					// EXTENDED_TYPE
					case BinaryCode.EXTENDED_TYPE: {
						const [type, has_parameters] = extractType(true);
						if (has_parameters) current_scope.push({type: TOKEN_TYPE.VALUE, bin:BinaryCode.EXTENDED_TYPE, string: type.toString().slice(0,-1)});
						else current_scope.push({type: TOKEN_TYPE.VALUE, string: type.toString()});
						break;
					}
	
					// // FILTER
					// case BinaryCode.FILTER: {
					// 	let targets_size = uint8[current_index++];
					// 	let target_list = [];
	
					// 	for (let n=0; n<targets_size; n++) {
					// 		let type = uint8[current_index++];
					// 		const target = constructFilterElement(type, target_list);
					// 		target_list.push(target);
					// 	}
	
					// 	let cnf:CNF = new AndSet();
	
					// 	// filter clauses part
						
					// 	let ands_nr = uint8[current_index++];
	
					// 	for (let n=0; n<ands_nr; n++) {
					// 		let ors_nr = uint8[current_index++];
	
					// 		let ors = new Set<Target | Not<Target>>();
					// 		for (let m=0; m<ors_nr; m++) {
					// 			let index = data_view.getInt8(current_index++);
					// 			ors.add(index<0 ? Not.get(target_list[-index-1]) : target_list[index-1]);
					// 		}
					// 		cnf.add(ors);
					// 	}
						
					// 	current_scope.push({type: TOKEN_TYPE.VALUE, string: new Filter(...cnf).toString()});
					// 	break;
					// }
	
	
					// ENDPOINTS / ALIASES
					case BinaryCode.PERSON_ALIAS: 
					case BinaryCode.PERSON_ALIAS_WILDCARD:
					case BinaryCode.INSTITUTION_ALIAS:
					case BinaryCode.INSTITUTION_ALIAS_WILDCARD:
					case BinaryCode.BOT:
					case BinaryCode.BOT_WILDCARD:
					case BinaryCode.ENDPOINT:
					case BinaryCode.ENDPOINT_WILDCARD:
					{
						const f = constructFilterElement(token);
						current_scope.push({type: TOKEN_TYPE.VALUE, string: f.toString()});
						break;
					}
	
	
					// SET_POINTER
					case BinaryCode.SET_POINTER: {
						was_value = false;
						let id = uint8.slice(current_index, current_index+=Pointer.MAX_POINTER_ID_SIZE);
						current_scope.push({string: `$${Pointer.normalizePointerId(id)}=`});
						break;
					}

					// INIT_POINTER  
					case BinaryCode.INIT_POINTER: { 
						was_value = false;
						let id = uint8.slice(current_index, current_index+=Pointer.MAX_POINTER_ID_SIZE);
						let jmp_index = data_view.getUint32(current_index, true);
						current_index += Uint32Array.BYTES_PER_ELEMENT;
						current_scope.push({string: "$" + Pointer.normalizePointerId(id) + " := /*jmp:" + jmp_index + "*/" });
						break;
					}
	
					// DELETE_POINTER
					case BinaryCode.DELETE_POINTER: {
						was_value = false;
						current_scope.push({string: `delete `});
						break;
					}
	
					// SCOPE
					case BinaryCode.PLAIN_SCOPE: {
						current_scope.push({string: `scope `});
						break;
					}
	
					// COPY
					case BinaryCode.COPY: {
						was_value = false;
						current_scope.push({string: `copy `});
						break;
					}
	
					// CLONE
					case BinaryCode.CLONE: {
						was_value = false;
						current_scope.push({string: `deepcopy `});
						break;
					}

					// COLLAPSE
					case BinaryCode.COLLAPSE: {
						was_value = false;
						current_scope.push({string: `collapse `});
						break;
					}
	
					// GET_TYPE
					case BinaryCode.GET_TYPE: {
						was_value = false;
						current_scope.push({string: `type `});
						break;
					}
	
					// ORIGIN
					case BinaryCode.ORIGIN: {
						was_value = false;
						current_scope.push({string: `origin `});
						break;
					}
	
					// SUBSCRIBERS
					case BinaryCode.SUBSCRIBERS: {
						was_value = false;
						current_scope.push({string: `subscribers `});
						break;
					}
	
					// POINTER
					case BinaryCode.POINTER: {
						let id = uint8.slice(current_index, current_index+=Pointer.MAX_POINTER_ID_SIZE);
						current_scope.push({string: `$${Pointer.normalizePointerId(id)}`});
						break;
					}
	
					// POINTER_ACTION
					case BinaryCode.POINTER_ACTION: {
						was_value = false;
						let action_string = actionToString(uint8[current_index++]) // get action specifier
	
						let id = uint8.slice(current_index, current_index+=Pointer.MAX_POINTER_ID_SIZE);
						current_scope.push({string: `$${Pointer.normalizePointerId(id)} ${action_string}= `});
						break;
					}
	
					// CREATE_POINTER ($$ ())
					case BinaryCode.CREATE_POINTER: {
						was_value = false;
						current_scope.push({string: `$$`});
						break;
					}
	
					
					
					// STREAM (<<)
					case BinaryCode.STREAM: {
						was_value = false;
						current_scope.push({string: ` << `});
						break;
					}
	
					case BinaryCode.STOP_STREAM: {
						was_value = false;
						current_scope.push({string: ` </ `});
						break;
					}
	
	
					default: {
						was_value = false;
						current_scope.push({string: `/*${token?.toString(16)??'?'}*/`});
					}
	
				}

				if (was_value && 'connective_size' in current_scope) {
					if (current_scope.connective_size == 0) exitSubScope();
					current_scope.connective_size--;
				}
						
			}
	
	
			// now parse tokens to DATEX script
	
			const parse_tokens = (tokens:token_list, indentation=0, seperator?:string)=> {
				let datex_tmp = "";
	
				let append:string;
	

				if (seperator) datex_tmp += "("
				let had_value = false;

				for (let t=0;t<tokens.length;t++) {
					let current_token = tokens[t];

					if (seperator && had_value) {
						datex_tmp += `) ${seperator} (`;
						had_value = false;
					}

					if (current_token.type == TOKEN_TYPE.VALUE || current_token.type == TOKEN_TYPE.SUBSCOPE) {
						had_value = true;
					}
	
					if (current_token.type == TOKEN_TYPE.SUBSCOPE) {
						let indentation = 0;
						// open bracket
						if (current_token.bin == BinaryCode.SUBSCOPE_START) {
							datex_tmp += "("
							//indentation = 5;
						} 
						else if (current_token.bin == BinaryCode.TUPLE_START) datex_tmp += "("
						else if (current_token.bin == BinaryCode.ARRAY_START) datex_tmp += "["
						else if (current_token.bin == BinaryCode.OBJECT_START) datex_tmp += "{"
						else if (current_token.bin == BinaryCode.DISJUNCTION) datex_tmp += "("
						else if (current_token.bin == BinaryCode.CONJUNCTION) datex_tmp += "("

						// recursive sub-part
						if (current_token.bin == BinaryCode.DISJUNCTION) datex_tmp += parse_tokens(<token_list>current_token.value, indentation, '|') // recursive call with indentation
						else if (current_token.bin == BinaryCode.CONJUNCTION) datex_tmp += parse_tokens(<token_list>current_token.value, indentation, '&') // recursive call with indentation
						else datex_tmp += parse_tokens(<token_list>current_token.value, indentation) // recursive call with indentation
	
						// close bracket
						if (current_token.bin == BinaryCode.SUBSCOPE_START) datex_tmp += ")"
						else if (current_token.bin == BinaryCode.TUPLE_START) datex_tmp += ")"
						else if (current_token.bin == BinaryCode.ARRAY_START) datex_tmp += "]"
						else if (current_token.bin == BinaryCode.OBJECT_START) datex_tmp += "}"
						else if (current_token.bin == BinaryCode.DISJUNCTION) datex_tmp += ")"
						else if (current_token.bin == BinaryCode.CONJUNCTION) datex_tmp += ")"
					}
		
	
					// string value
					else {
						if (current_token.string) datex_tmp += current_token.string;
					}
	
					// add comma after element (before new element)
					if (tokens[t+1]?.bin == BinaryCode.ELEMENT_WITH_KEY || tokens[t+1]?.bin == BinaryCode.ELEMENT) datex_tmp += ","
	
					// append something
					if (append) {
						datex_tmp += append;
						append = null;
					}
	
					// =, +=, -=, ...
					if (current_token.bin == BinaryCode.CHILD_SET) append = " = ";
					else if (current_token.bin == BinaryCode.RANGE) append = "..";
					else if (current_token.bin == BinaryCode.EXTENDED_TYPE) append = ">";
					else if (current_token.bin == BinaryCode.CHILD_ACTION) append = ` ${current_token.meta_string}= `;

				}
	
				if (seperator) datex_tmp += ")"

				// add indentation at newlines
				return (indentation? " ".repeat(indentation) : "") +  datex_tmp.replace(/\n/g, "\n" + (" ".repeat(indentation)))
			}
	
			let datex_string = (parse_tokens(tokens) + append_comments).replace(/\n$/,''); // remove last newline
			
			return datex_string;
		}
	
		static decompileBase64(dxb_base64: string, formatted = false, has_header = true) {
			return this.decompile(base64ToArrayBuffer(dxb_base64), false, formatted, false, has_header);
		}
	
}


globalThis.decompile = Decompiler.decompile;
globalThis.decompileBase64 = Decompiler.decompileBase64;