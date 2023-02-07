// deno-lint-ignore-file no-async-promise-executor
import { logger } from "../utils/global_values.ts";
import { Endpoint } from "../types/addressing.ts";
import { SecurityError, ValueError } from "../types/errors.ts";
import { NetworkUtils } from "../network/network_utils.ts";
import { Storage } from "../runtime/storage.ts";
import { Runtime } from "./runtime.ts";

// crypto
export const crypto = globalThis.crypto
if (!crypto) throw new Error("The Web Crypto API is required for the DATEX Runtime");


// deno-lint-ignore no-namespace
export namespace Crypto {
    export interface ExportedKeySet {
        sign: [ArrayBuffer, ArrayBuffer],
        encrypt: [ArrayBuffer, ArrayBuffer]
    }
}

/** takes care of encryption, signing, etc.. */
export class Crypto {
    
    // cached public keys for endpoints
    private static public_keys = new Map<Endpoint, [CryptoKey|null, CryptoKey|null]>(); // verify_key, enc_key
    private static public_keys_exported = new Map<Endpoint, [ArrayBuffer, ArrayBuffer]>(); // only because node crypto is causing problems

    // own keys
    private static rsa_sign_key:CryptoKey
    private static rsa_verify_key:CryptoKey
    private static rsa_dec_key:CryptoKey
    private static rsa_enc_key:CryptoKey

    // own keys as exported ArrayBuffers
    private static rsa_sign_key_exported:ArrayBuffer
    private static rsa_verify_key_exported:ArrayBuffer
    private static rsa_dec_key_exported:ArrayBuffer
    private static rsa_enc_key_exported:ArrayBuffer

    public static available = false; // true if own keys loaded


    // used for signing/verifying with a sign/verify key
    private static readonly sign_key_options = {
        name: "ECDSA",
        hash: {name: "SHA-384"},
    }

    // used to create a new sign/verify key pair
    private static readonly sign_key_generator = {
        name: "ECDSA",
        namedCurve: "P-384"
    }

    // used for encryption/decryption keys
    private static readonly enc_key_options = {
        name: "RSA-OAEP",
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
    }
    // used for import
    private static readonly enc_key_import = {
        name: "RSA-OAEP",
        hash: "SHA-256"
    }

    static readonly SIGN_BUFFER_SIZE = 96;
    static readonly IV_BUFFER_SIZE = 16;

    /** Sign + Verify */
    static async sign(buffer:ArrayBuffer): Promise<ArrayBuffer> {
        if (!this.available) throw new SecurityError("Cannot sign DATEX requests, missing private keys");
        return await crypto.subtle.sign(this.sign_key_options, this.rsa_sign_key, buffer);
    }
    static async verify(data:ArrayBuffer, signature:ArrayBuffer, endpoint:Endpoint): Promise<boolean> {
        const keys = await this.getKeysForEndpoint(endpoint);
        if (!keys || !keys[0]) return false;
        return await crypto.subtle.verify(this.sign_key_options, keys[0], signature, data);
    }

    /** Encypt + Decrypt (RSA) */
    static async encrypt(buffer:ArrayBuffer, endpoint:Endpoint): Promise<ArrayBuffer|null> {
        if (!this.available) throw new SecurityError("Cannot encrypt DATEX requests, missing private keys");
        const keys = await this.getKeysForEndpoint(endpoint);
        if (!keys || keys[1]==null) return null;
        return await crypto.subtle.encrypt("RSA-OAEP", keys[1], buffer);
    }
    static async decrypt(data:ArrayBuffer): Promise<ArrayBuffer> {
        return await crypto.subtle.decrypt("RSA-OAEP", this.rsa_dec_key, data);
    }


    /** Symmetric Encypt + Decrypt (AES-GCM) */
    // returns [encrypted, iv]
    static async encryptSymmetric(data:ArrayBuffer, key:CryptoKey): Promise<[ArrayBuffer,Uint8Array]> {
        const iv = crypto.getRandomValues(new Uint8Array(this.IV_BUFFER_SIZE));
        return [await crypto.subtle.encrypt({name:"AES-GCM", iv: iv}, key, data), iv]
    }

    // returns decrypted
    static async decryptSymmetric(encrypted:ArrayBuffer, key:CryptoKey, iv:Uint8Array): Promise<ArrayBuffer> {
        try {
            return await crypto.subtle.decrypt({name:"AES-GCM", iv: iv}, key, encrypted);
        } catch {
            throw new SecurityError("Invalid encrypted DATEX");
        }
    }

    // returns an assymetrically encrypted symmetric key
    static async encryptSymmetricKeyForEndpoint(key:CryptoKey, endpoint:Endpoint) {
        const exported_key = await crypto.subtle.exportKey("raw", key);
        return this.encrypt(exported_key, endpoint);
    }

    // returns a symmetric encryption key
    static async extractEncryptedKey(encrypted: ArrayBuffer): Promise<CryptoKey> {
        const key_data = await this.decrypt(encrypted);
        return crypto.subtle.importKey("raw",  key_data, "AES-GCM", true, ["encrypt", "decrypt"]);
    }

    // generates a new symmetric (AES) key
    static generateSymmetricKey():Promise<CryptoKey> {
        return crypto.subtle.generateKey({
                name: "AES-GCM",
                length: 256
            },true, ["encrypt", "decrypt"]
        );
    }


    // returns the public verify + encrypt keys for an endpoint (from cache or from network)
    static getKeysForEndpoint(endpoint:Endpoint):Promise<[CryptoKey?, CryptoKey?]>|[CryptoKey?, CryptoKey?] {
        if (this.public_keys.has(endpoint)) return <[CryptoKey, CryptoKey]>this.public_keys.get(endpoint);
        // keys not found, request from network
        else return this.requestKeys(endpoint); 
    }

    static async getExportedKeysForEndpoint(endpoint:Endpoint):Promise<[ArrayBuffer?, ArrayBuffer?]> {
        const keys = await this.getKeysForEndpoint(endpoint);
        return [
            keys[0] ? await this.exportPublicKey(keys[0]) : undefined,
            keys[1] ? await this.exportPublicKey(keys[1]) : undefined
        ];
    }

    // saves public verify and encrypt keys for an endpoint locally
    static async bindKeys(endpoint:Endpoint, verify_key:ArrayBuffer, enc_key:ArrayBuffer):Promise<boolean> {
        if (!(endpoint instanceof Endpoint)) throw new ValueError("Invalid endpoint");
        if (verify_key && !(verify_key instanceof ArrayBuffer)) throw new ValueError("Invalid verify key");
        if (enc_key && !(enc_key instanceof ArrayBuffer)) throw new ValueError("Invalid encryption key");

        if (this.public_keys.has(endpoint)) return false; // keys already exist
 
        const storage_item_key = "keys_"+endpoint;
        if (await Storage.hasItem(storage_item_key)) return false; // keys already in storage

        try {            
            this.public_keys.set(endpoint, [
                verify_key ? await Crypto.importVerifyKey(verify_key) : null,
                enc_key ? await Crypto.importEncKey(enc_key): null
            ])
            this.public_keys_exported.set(endpoint, [verify_key, enc_key]);
            await Storage.setItem(storage_item_key, [verify_key, enc_key]);
            return true;
        } catch(e) {
            logger.error(e);
            throw new Error("Could not register keys for endpoint " + endpoint + " (invalid keys or no permisssion)");
        }
    }

    static #waiting_key_requests = new Map<Endpoint, Promise<[CryptoKey, CryptoKey]>>();
    
    // loads keys from network or cache
    static requestKeys(endpoint:Endpoint):Promise<[CryptoKey?, CryptoKey?]> {
        
        // already requesting/loading keys for this endpoint
        if (this.#waiting_key_requests.has(endpoint)) return <Promise<[CryptoKey, CryptoKey]>>this.#waiting_key_requests.get(endpoint);

        let keyPromise:Promise<[CryptoKey, CryptoKey]>;
        this.#waiting_key_requests.set(endpoint, keyPromise = new Promise(async (resolve, reject)=>{

            let exported_keys:[ArrayBuffer, ArrayBuffer];

            // first check cache:
            if (exported_keys=await Storage.getItem("keys_"+endpoint)) {
                logger.debug("getting keys from cache for " + endpoint);
            }
            if (!exported_keys) {
                logger.debug("requesting keys for " + endpoint);
                exported_keys = await NetworkUtils.get_keys(endpoint); // fetch keys from network; TODO blockchain                   

                if (exported_keys) await Storage.setItem("keys_"+endpoint, exported_keys);
                else {
                    reject(new Error("could not get keys from network"));
                    this.#waiting_key_requests.delete(endpoint); // remove from key promises
                    return;
                }
            }
    
            // convert to CryptoKeys
            try {
                const keys:[CryptoKey, CryptoKey] = [await this.importVerifyKey(exported_keys[0])||null, await this.importEncKey(exported_keys[1])||null];
                this.public_keys.set(endpoint, keys);
                resolve(keys);
                this.#waiting_key_requests.delete(endpoint); // remove from key promises
                return;
            }
            catch (e) {
                reject(new Error("Error importing keys"));
                await Storage.removeItem("keys_"+endpoint);
                this.#waiting_key_requests.delete(endpoint); // remove from key promises
                return;
            }

        }));

        return keyPromise;
    }


    // set own public and private keys, returns the exported base64 keys
    static async loadOwnKeys(verify_key:ArrayBuffer|CryptoKey, sign_key:ArrayBuffer|CryptoKey, enc_key:ArrayBuffer|CryptoKey, dec_key:ArrayBuffer|CryptoKey) {
        
        // export/load keys

        if (verify_key instanceof ArrayBuffer) {
            this.rsa_verify_key_exported = verify_key;
            this.rsa_verify_key = await this.importVerifyKey(this.rsa_verify_key_exported);
        }
        else {
            this.rsa_verify_key_exported = await this.exportPublicKey(verify_key);
            this.rsa_verify_key = verify_key;
        }
        
        if (sign_key instanceof ArrayBuffer) {
            this.rsa_sign_key_exported = sign_key;
            this.rsa_sign_key = await this.importSignKey(this.rsa_sign_key_exported);
        }
        else {
            this.rsa_sign_key_exported = await this.exportPrivateKey(sign_key);
            this.rsa_sign_key = sign_key;
        }

        if (enc_key instanceof ArrayBuffer) {
            this.rsa_enc_key_exported = enc_key;
            this.rsa_enc_key = await this.importEncKey(this.rsa_enc_key_exported);
        }
        else {
            this.rsa_enc_key_exported = await this.exportPublicKey(enc_key);
            this.rsa_enc_key = enc_key;
        }

        if (dec_key instanceof ArrayBuffer) {
            this.rsa_dec_key_exported = dec_key;
            this.rsa_dec_key = await this.importDecKey(this.rsa_dec_key_exported);
        }
        else {
            this.rsa_dec_key_exported = await this.exportPrivateKey(dec_key);
            this.rsa_dec_key = dec_key;
        }

        // save in local endpoint key storage
        this.saveOwnPublicKeysInEndpointKeyMap();
        this.available = true; // encryption / signing now possible

        return [this.rsa_verify_key_exported, this.rsa_sign_key_exported, this.rsa_enc_key_exported, this.rsa_dec_key_exported]
    }

    private static saveOwnPublicKeysInEndpointKeyMap () {
        // save in local endpoint key storage
        if (!this.public_keys.has(Runtime.endpoint)) this.public_keys.set(Runtime.endpoint, [null,null]);
        (<[CryptoKey?, CryptoKey?]>this.public_keys.get(Runtime.endpoint))[0] = this.rsa_verify_key;
        (<[CryptoKey?, CryptoKey?]>this.public_keys.get(Runtime.endpoint))[1] = this.rsa_enc_key;
    }

    // returns current public verify + encrypt keys
    static getOwnPublicKeysExported():[ArrayBuffer, ArrayBuffer] {
        return [this.rsa_verify_key_exported, this.rsa_enc_key_exported]
    }
    static getOwnPublicKeys():[CryptoKey, CryptoKey] {
        return [this.rsa_verify_key, this.rsa_enc_key]
    }


    // returns the current private sign and decrypt keys
    static getOwnPrivateKeysExported():[ArrayBuffer, ArrayBuffer] {
        return [this.rsa_sign_key_exported, this.rsa_dec_key_exported]
    }
    static getOwnPrivateKeys():[CryptoKey, CryptoKey] {
        return [this.rsa_sign_key, this.rsa_dec_key]
    }


    // // returns current exported public sign + encrypt key for an endpoint, if found
    // static async getEndpointPublicKeys(endpoint:Endpoint):Promise<[ArrayBuffer, ArrayBuffer]> {
    //     let keys:[CryptoKey, CryptoKey];
    //     if (this.public_keys.has(endpoint)) keys = this.public_keys.get(endpoint);
    //     else throw new Error("No public keys available for this endpoint: " + endpoint);
    //     return [
    //         keys[0] ? await this.exportPublicKey(keys[0]) : null,
    //         keys[1] ? await this.exportPublicKey(keys[1]) : null
    //     ];
    // }

    // // return already exported keys
    // static async getEndpointPublicKeys2(endpoint:Endpoint):Promise<[ArrayBuffer, ArrayBuffer]> {
    //     if (this.public_keys_exported.has(endpoint)) return this.public_keys_exported.get(endpoint);
    //     else throw new Error("no public keys available for this endpoint: " + endpoint);
    // }


    // generate new sign + encryption (public + private) keys, returns base64 verify, sign, enc, dec keys
    static async createOwnKeys(): Promise<Crypto.ExportedKeySet> { 
        // create new encrpytion key pair
        const enc_key_pair = <CryptoKeyPair> await crypto.subtle.generateKey(
            this.enc_key_options,
            true,
            ["encrypt", "decrypt"]
        );

        // create new sign key pair
        const sign_key_pair = <CryptoKeyPair>await crypto.subtle.generateKey(
            this.sign_key_generator,
            true,
            ["sign", "verify"]
        );
    
        this.rsa_dec_key = enc_key_pair.privateKey
        this.rsa_enc_key = enc_key_pair.publicKey
        this.rsa_sign_key = sign_key_pair.privateKey
        this.rsa_verify_key = sign_key_pair.publicKey

        this.rsa_enc_key_exported = await this.exportPublicKey(this.rsa_enc_key);
        this.rsa_dec_key_exported = await this.exportPrivateKey(this.rsa_dec_key);
        this.rsa_verify_key_exported = await this.exportPublicKey(this.rsa_verify_key);
        this.rsa_sign_key_exported = await this.exportPrivateKey(this.rsa_sign_key);

        // save in local endpoint key storage
        this.saveOwnPublicKeysInEndpointKeyMap();
        this.available = true; // encryption / signing now possible

        return {
            sign: [this.rsa_verify_key_exported, this.rsa_sign_key_exported],
            encrypt: [this.rsa_enc_key_exported, this.rsa_dec_key_exported]
        }
    }

    // export an public key to base64
    public static async exportPublicKeyBase64(key: CryptoKey): Promise<string> {
        return btoa(globalThis.String.fromCharCode.apply(null, [...new Uint8Array(await this.exportPublicKey(key))]));
    }
    // export a private key to base64
    public static async exportPrivateKeyBase64(key: CryptoKey): Promise<string> {
        return btoa(globalThis.String.fromCharCode.apply(null, [...new Uint8Array(await this.exportPrivateKey(key))]));
    }

    // export an public key
    public static exportPublicKey(key: CryptoKey): Promise<ArrayBuffer> {
        return crypto.subtle.exportKey("spki", key);
    }
    // export a private key
    public static exportPrivateKey(key: CryptoKey): Promise<ArrayBuffer> {
        return crypto.subtle.exportKey("pkcs8", key);
    }

    // import private keys: sign, dec
    public static async importSignKey(key: string|ArrayBuffer): Promise<CryptoKey> {
        const key_buffer = key instanceof ArrayBuffer ? new Uint8Array(key) : Uint8Array.from(atob(key), c => c.charCodeAt(0)).buffer;
        return await crypto.subtle.importKey("pkcs8", key_buffer, this.sign_key_generator, true, ["sign"])
    }
    public static async importDecKey(key: string|ArrayBuffer): Promise<CryptoKey> {
        const key_buffer = key instanceof ArrayBuffer ? new Uint8Array(key) : Uint8Array.from(atob(key), c => c.charCodeAt(0)).buffer;
        return await crypto.subtle.importKey("pkcs8", key_buffer, this.enc_key_import, true, ["decrypt"])
    }
    
    // import public keys: enc, verify
    public static async importVerifyKey(key: string|ArrayBuffer): Promise<CryptoKey> {
        const key_buffer = key instanceof ArrayBuffer ? new Uint8Array(key) : Uint8Array.from(atob(key), c => c.charCodeAt(0)).buffer;
        return await crypto.subtle.importKey("spki", key_buffer, this.sign_key_generator, true, ["verify"])
    }
    public static async importEncKey(key: string|ArrayBuffer): Promise<CryptoKey> {
        const key_buffer = key instanceof ArrayBuffer ? new Uint8Array(key) : Uint8Array.from(atob(key), c => c.charCodeAt(0));
        return await crypto.subtle.importKey("spki", key_buffer, this.enc_key_import, true, ["encrypt"])
    }

}
