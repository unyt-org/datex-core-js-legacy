/**
 ╔══════════════════════════════════════════════════════════════════════════════════════╗
 ║  UNYT Interface                                                                      ║
 ╠══════════════════════════════════════════════════════════════════════════════════════╣
 ║  Handler for unyt login and communication                                            ║
 ║  Visit docs.unyt.cc/unyt for more information                                        ║
 ╠═════════════════════════════════════════╦════════════════════════════════════════════╣
 ║  © 2020 Jonas & Benedikt Strehle        ║                                            ║
 ╚═════════════════════════════════════════╩════════════════════════════════════════════╝
 */


import { Logger, console_theme } from "../utils/logger.ts";
import { CommonInterface } from "./client.ts";
import { remote, scope, to } from "../js_adapter/legacy_decorators.ts";
import { Runtime } from "../runtime/runtime.ts";
import { Endpoint } from "../types/addressing.ts";
import { crypto, Crypto } from "../runtime/crypto.ts";
import { NetworkUtils } from "./network_utils.ts";
import { Datex } from "../datex.ts";

const logger = new Logger("unyt");

Datex.Supranet.onConnect = ()=>{
    Unyt.logStatus({endpoint:Runtime.endpoint, node:Runtime.main_node, type: CommonInterface.default_interface.type}); 
}

export class Unyt {

    static app_name?:string
    static app_version?:string
    static app_stage?:string
    static app_backend?:Datex.Endpoint

    static uix_version?:string

    static setApp(name:string, version:string, stage:string, backend:Datex.Endpoint) {
        this.app_name = name;
        this.app_version = version;
        this.app_stage = stage;
        this.app_backend = backend;
    }

    static setUIXData(version:string) {
        this.uix_version = version;
    }

    static async login(endpoint: Endpoint, password: string):Promise<boolean> {
        if (!endpoint) return false
        if (!password) return false

        // create hash from password
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password))
        try {
            //let res:[ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer] = await datex('get_private_keys(?,?)', [endpoint, hash], '+unyt/auth', false) // get private key data from unyt auth server
            const res = await Auth.get_private_keys(endpoint, hash);
            const [sign_key, dec_key] = await this.decryptPrivateKeys(...res, password); // extract private keys from data
            logger.success("private keys reconstructed for ?", endpoint);

            // workaround first register
            await this.register(endpoint, password);

            const public_keys_base64 = await NetworkUtils.get_keys(endpoint); //  get public keys (TODO get from blockchain)
            // load public keys
            const verify_key = await Crypto.importVerifyKey(public_keys_base64[0]);
            const enc_key = await Crypto.importEncKey(public_keys_base64[1]);

            Datex.Supranet.connect(endpoint, Runtime.endpoint.id_endpoint, true, [verify_key, sign_key], [enc_key, dec_key]);

            return true;

        } catch (e) {
            console.error(e)
            return false
        }
    }

    static async registerAccount(endpoint: Endpoint, email: string, password: string): Promise<boolean> {
        if (!endpoint || !password || !email) return false;
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));

        console.log(
            Crypto.getOwnPrivateKeys(),
            Crypto
        )

        const result = await Auth.registerAccount(endpoint, email, hash, ...(await this.encryptPrivateKeys(...Crypto.getOwnPrivateKeys(), password)))
        console.log(result)
    
        return true;
    }

    static async register(endpoint: Endpoint, password: string):Promise<boolean> {
        if (!endpoint) return false
        if (!password) return false

        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password))

        try {
            // send private key data to unyt auth server
            let res = await Auth.set_private_keys(endpoint, hash, ...(await this.encryptPrivateKeys(...Crypto.getOwnPrivateKeys(), password)))
            let current_endpoint = Runtime.endpoint.id_endpoint;
            // --- TODO just temporary; save in blockchain
            if (!endpoint.id_endpoint) endpoint.setIdEndpoint(current_endpoint);
            Runtime.endpoint = endpoint;
            await Datex.Supranet.sayHello();  // say hello, send current public keys to server
            Runtime.endpoint = current_endpoint;
            logger.success("register: " + endpoint + ", password = " + password, res);
            return true;
        } catch (e) {
            console.error(e)
            return false;
        }
    }

    /** returns password-encrypted sign and encryption keys and respective ivs */
    static async encryptPrivateKeys(sign_key:CryptoKey, dec_key:CryptoKey, password: string): Promise<[ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer]>{
        // get buffers from keys
        const sign_key_buffer = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", sign_key))
        const dec_key_buffer  = new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", dec_key))
    
        // generate ivs
        const iv_sign = globalThis.crypto.getRandomValues(new Uint8Array(16));
        const iv_dec  = globalThis.crypto.getRandomValues(new Uint8Array(16));

        // get key from password
        const key = await this.getKeyFromPassword(password);
       
        // encrypt keys
        const sign_key_dec = await crypto.subtle.encrypt({name: 'AES-GCM', tagLength: 32, iv: iv_sign}, key, sign_key_buffer)
        const dec_key_enc  = await crypto.subtle.encrypt({name: 'AES-GCM', tagLength: 32, iv: iv_dec}, key, dec_key_buffer)
       
        return [sign_key_dec, dec_key_enc, iv_sign.buffer, iv_dec.buffer]
    }

    /** returns decrypted sign and encryption keys */
    static async decryptPrivateKeys(sign_key_enc: ArrayBuffer, dec_key_enc: ArrayBuffer, iv_sign: ArrayBuffer, iv_dec: ArrayBuffer, password: string) {
        // get key from password
        const key = await this.getKeyFromPassword(password);

        const sign_key_buffer = await crypto.subtle.decrypt({name: 'AES-GCM', tagLength: 32, iv: iv_sign}, key, sign_key_enc)
        const dec_key_buffer = await crypto.subtle.decrypt({name: 'AES-GCM', tagLength: 32, iv: iv_dec}, key, dec_key_enc)
        
        // decrypt keys
        const sign_key = await Crypto.importSignKey(sign_key_buffer)
        const dec_key =  await Crypto.importDecKey(dec_key_buffer)
        
        return [sign_key, dec_key]
    }

    private static async getKeyFromPassword(password: string): Promise<CryptoKey> {
        const d_key = await window.crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"]);
        return await window.crypto.subtle.deriveKey(
            {
              "name": "PBKDF2",
              salt: Uint8Array.from([1,2,3,4,5,6,7,8]),
              "iterations": 100000,
              "hash": "SHA-256"
            },
            d_key,
            { "name": "AES-GCM", "length": 256},
            true,
            [ "encrypt", "decrypt" ]
        );
    }

    private static logo_dark = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+Cjxzdmcgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgdmlld0JveD0iMCAwIDE3NiA1OCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bWw6c3BhY2U9InByZXNlcnZlIiB4bWxuczpzZXJpZj0iaHR0cDovL3d3dy5zZXJpZi5jb20vIiBzdHlsZT0iZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjI7Ij4KICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsLTc2Ny4xNzgsLTEyOC4zMzQpIj4KICAgICAgICA8ZyBpZD0idGV4dF93aGl0ZSIgdHJhbnNmb3JtPSJtYXRyaXgoMC44NjExMTgsMCwwLDAuODQ2NjM4LDg0LjQ3NzEsLTE5Ni44NzgpIj4KICAgICAgICAgICAgPHJlY3QgeD0iNzkyLjgwNyIgeT0iMzg0LjEyMiIgd2lkdGg9IjIwMy4yNjIiIGhlaWdodD0iNjguNDEzIiBzdHlsZT0iZmlsbDpub25lOyIvPgogICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLjE2MTI4LDAsMCwxLjE4MTE0LDM4MS41MDUsLTYuNjA5MTkpIj4KICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuNTA5NTQ5LDAsMCwwLjUwOTU0OSwyNTIuMjIzLDIwMC4zMDgpIj4KICAgICAgICAgICAgICAgICAgICA8dGV4dCB4PSIyOTUuODc2cHgiIHk9IjM0MS41MzVweCIgc3R5bGU9ImZvbnQtZmFtaWx5OidBcmlhbFJvdW5kZWRNVEJvbGQnLCAnQXJpYWwgUm91bmRlZCBNVCBCb2xkJywgc2Fucy1zZXJpZjtmb250LXNpemU6MTE0LjE2N3B4O2ZpbGw6d2hpdGU7Ij51bnl0PC90ZXh0PgogICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMC43NDc1NCwwLDAsMC43NDc1NCwzMTQuOTUyLDE2MC43MzYpIj4KICAgICAgICAgICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwxLC0xNjYuMDU0LC02OS4xNzAyKSI+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yNTguNDc2LDMyMi43MTVDMjY2LjgzOCwzMzEuNTc0IDI3MS45NjUsMzQzLjUyMSAyNzEuOTY1LDM1Ni42NjVMMjU4LjQ3NiwzNTYuNjY1TDI1OC40NzYsMzIyLjcxNVoiIHN0eWxlPSJmaWxsOnJnYigyNTUsMCw4OSk7Ii8+CiAgICAgICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsLTE2Ni4wNTQsLTY5LjE3MDIpIj4KICAgICAgICAgICAgICAgICAgICAgICAgPHBhdGggZD0iTTI1Ni40NzYsMzI0LjFMMjU2LjQ3NiwzNTYuNjY1TDIyMy45MTEsMzU2LjY2NUwyNTYuNDc2LDMyNC4xWiIgc3R5bGU9ImZpbGw6cmdiKDQyLDE3MCwyMTUpOyIvPgogICAgICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwxLC0xNjYuMDU0LC02OS4xNzAyKSI+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yMjIuNDk2LDM1NS4yNTFMMjU2Ljc2MSwzMjAuOTg2QzI0Ny44NywzMTIuNDQ1IDIzNS43OTYsMzA3LjE5NyAyMjIuNDk2LDMwNy4xOTdMMjIyLjQ5NiwzNTUuMjUxWiIgc3R5bGU9ImZpbGw6d2hpdGU7Ii8+CiAgICAgICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICA8L2c+CiAgICAgICAgPC9nPgogICAgPC9nPgo8L3N2Zz4K';
    private static logo_light = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+Cjxzdmcgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgdmlld0JveD0iMCAwIDE3NSA1OSIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bWw6c3BhY2U9InByZXNlcnZlIiB4bWxuczpzZXJpZj0iaHR0cDovL3d3dy5zZXJpZi5jb20vIiBzdHlsZT0iZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjI7Ij4KICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsLTc2Ny40MzQsLTIwNS40ODIpIj4KICAgICAgICA8ZyBpZD0idGV4dF9kYXJrIiB0cmFuc2Zvcm09Im1hdHJpeCgxLjAwMzA0LDAsMCwwLjk1NzYyOSw3NjguMjQxLDEzMS44MDQpIj4KICAgICAgICAgICAgPHJlY3QgeD0iLTAuODA0IiB5PSI3Ni45MzgiIHdpZHRoPSIxNzMuODMxIiBoZWlnaHQ9IjYwLjgzMyIgc3R5bGU9ImZpbGw6bm9uZTsiLz4KICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMC45OTY5NjgsMCwwLDEuMDQ0MjUsLTM1NC4xNjUsLTI2OC4xNTgpIj4KICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuNTA5NTQ5LDAsMCwwLjUwOTU0OSwyNTIuMjIzLDIwMC4zMDgpIj4KICAgICAgICAgICAgICAgICAgICA8dGV4dCB4PSIyOTUuODc2cHgiIHk9IjM0MS41MzVweCIgc3R5bGU9ImZvbnQtZmFtaWx5OidBcmlhbFJvdW5kZWRNVEJvbGQnLCAnQXJpYWwgUm91bmRlZCBNVCBCb2xkJywgc2Fucy1zZXJpZjtmb250LXNpemU6MTE0LjE2N3B4OyI+dW55dDwvdGV4dD4KICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuNzQ3NTQsMCwwLDAuNzQ3NTQsMzE0Ljk1MiwxNjAuNzM2KSI+CiAgICAgICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsMSwtMTY2LjA1NCwtNjkuMTcwMikiPgogICAgICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPSJNMjU4LjQ3NiwzMjIuNzE1QzI2Ni44MzgsMzMxLjU3NCAyNzEuOTY1LDM0My41MjEgMjcxLjk2NSwzNTYuNjY1TDI1OC40NzYsMzU2LjY2NUwyNTguNDc2LDMyMi43MTVaIiBzdHlsZT0iZmlsbDpyZ2IoMjU1LDAsODkpOyIvPgogICAgICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwxLC0xNjYuMDU0LC02OS4xNzAyKSI+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yNTYuNDc2LDMyNC4xTDI1Ni40NzYsMzU2LjY2NUwyMjMuOTExLDM1Ni42NjVMMjU2LjQ3NiwzMjQuMVoiIHN0eWxlPSJmaWxsOnJnYig0MiwxNzAsMjE1KTsiLz4KICAgICAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsMSwtMTY2LjA1NCwtNjkuMTcwMikiPgogICAgICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPSJNMjIyLjQ5NiwzNTUuMjUxTDI1Ni43NjEsMzIwLjk4NkMyNDcuODcsMzEyLjQ0NSAyMzUuNzk2LDMwNy4xOTcgMjIyLjQ5NiwzMDcuMTk3TDIyMi40OTYsMzU1LjI1MVoiLz4KICAgICAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgIDwvZz4KICAgICAgICA8L2c+CiAgICA8L2c+Cjwvc3ZnPgo=';

    // TODO add colored logo dark - light mode
    public static logStatus(data:any){

        const stage = data.stage||this.app_stage;
        let uix_version = data.uix_version||this.uix_version;
        if (uix_version == "0.0.0") uix_version = Datex.ESCAPE_SEQUENCES.UNYT_GREY+'unmarked'
        let dx_version = Datex.Runtime.VERSION;
        if (dx_version == "0.0.0") dx_version = Datex.ESCAPE_SEQUENCES.UNYT_GREY+'unmarked'

        if (this.app_backend) {
            logger.plain `
#image(70,'unyt')${console_theme == "dark" ? this.logo_dark : this.logo_light}
Connected to the supranet via ${data.node} (${data.type})
    
#color(grey)[APP]           ${data.app||this.app_name||'-'}
#color(grey)[VERSION]       ${data.version||this.app_version||'-'}
#color(grey)[STAGE]         ${stage||'-'}
#color(grey)[ENDPOINT]      ${data.endpoint||'-'}
#color(grey)[BACKEND]       ${this.app_backend}${stage=="Development"?`\n\nWorbench Access for this App: https://workbench.unyt.org/\?e=${this.app_backend.toString()}`:'\n'}
#color(grey)[DATEX VERSION] ${dx_version}
#color(grey)[UIX VERSION]   ${uix_version}

#color(grey)© ${new Date().getFullYear().toString()} unyt.org
`;
        }

        else {
            logger.plain `
#image(70,'unyt')${console_theme == "dark" ? this.logo_dark : this.logo_light}
Connected to the supranet via ${data.node} (${data.type})
    
#color(grey)[APP]           ${data.app||this.app_name||'-'}
#color(grey)[VERSION]       ${data.version||this.app_version||'-'}
#color(grey)[STAGE]         ${stage||'-'}
#color(grey)[ENDPOINT]      ${data.endpoint||'-'}${stage=="Development"?`\n\nWorbench Access for this App: https://workbench.unyt.org/\?e=${data.endpoint?.toString()}`:'\n'}
#color(grey)[DATEX VERSION] ${dx_version}
#color(grey)[UIX VERSION]   ${uix_version}

#color(grey)© ${new Date().getFullYear().toString()} unyt.org
`;
        }



    }


}


@scope @to('@+unyt.auth') class Auth {
    @remote static get_private_keys(endpoint: Endpoint, hash: ArrayBuffer): Promise<[ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer]> {return null}
    @remote static set_private_keys(endpoint: Endpoint, hash: ArrayBuffer, sign_key: ArrayBuffer, dec_key: ArrayBuffer, iv_sign: ArrayBuffer, iv_dec: ArrayBuffer): Promise<boolean> {return null}
    @remote static registerAccount(endpoint: Endpoint, email: string, hash: ArrayBuffer, sign_key: ArrayBuffer, dec_key: ArrayBuffer, iv_sign: ArrayBuffer, iv_dec: ArrayBuffer): Promise<boolean> {return null}
}

globalThis.Unyt = Unyt