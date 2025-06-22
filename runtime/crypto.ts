// deno-lint-ignore-file no-async-promise-executor
import { logger } from "../utils/global_values.ts";
import { Endpoint, Target, WildcardTarget } from "../types/addressing.ts";
import { SecurityError, ValueError } from "../types/errors.ts";
import { NetworkUtils } from "../network/network_utils.ts";
import { Storage } from "../storage/storage.ts";
import { Runtime } from "./runtime.ts";
import { displayFatalError } from "./display.ts";
import { Supranet } from "../network/supranet.ts";
import { Compiler, to } from "../datex_all.ts";
import { communicationHub } from "../network/communication-hub.ts";

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
    public static public_keys = new WeakMap<Endpoint, [CryptoKey|null, CryptoKey|null]>(); // verify_key, enc_key
    private static public_keys_exported = new WeakMap<Endpoint, [ArrayBuffer, ArrayBuffer]>(); // only because node crypto is causing problems

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
    public static readonly sign_key_options = {
        name: "ECDSA",
        hash: {name: "SHA-384"},
    }

    // used to create a new sign/verify key pair
    public static readonly sign_key_generator = {
        name: "ECDSA",
        namedCurve: "P-384"
    }

    // used for encryption/decryption keys
    public static readonly enc_key_options = {
        name: "RSA-OAEP",
        modulusLength: 4096,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
    }
    // used for import
    public static readonly enc_key_import = {
        name: "RSA-OAEP",
        hash: "SHA-256"
    }

    static readonly SIGN_BUFFER_SIZE = 96;
    static readonly IV_BUFFER_SIZE = 16;

    /** Sign + Verify */
    static async sign(buffer:ArrayBuffer): Promise<ArrayBuffer> {
        if (!this.available) {
            displayFatalError('missing-private-keys');
            throw new SecurityError("Cannot sign DATEX requests, missing private keys");
        }
        return await crypto.subtle.sign(this.sign_key_options, this.rsa_sign_key, buffer);
    }
    static async verify(data:ArrayBuffer, signature:ArrayBuffer, endpoint:Endpoint): Promise<boolean> {
        const keys = await this.getKeysForEndpoint(endpoint);
        if (!keys || !keys[0]) return false;
        return await crypto.subtle.verify(this.sign_key_options, keys[0], signature, data);
    }

    /** Encypt + Decrypt (RSA) */
    static async encrypt(buffer:ArrayBuffer, endpoint:Endpoint): Promise<ArrayBuffer> {
        if (!this.available) {
            displayFatalError('missing-private-keys');
            throw new SecurityError("Cannot encrypt DATEX requests, missing private keys");
        }
        const keys = await this.getKeysForEndpoint(endpoint);
        if (!keys || keys[1]==null) throw new SecurityError("Cannot encrypt DATEX requests, could not get keys for endpoint");
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
    static getKeysForEndpoint(endpoint:Endpoint) {
        if (this.public_keys.has(endpoint) || this.public_keys.has(endpoint.main)) {
            return (this.public_keys.get(endpoint)||this.public_keys.get(endpoint.main)) as [CryptoKey, CryptoKey];
        }
        // keys not found, request from network
        else {
            return this.requestKeys(endpoint.main);
        }
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

        // always bind to main endpoint
        endpoint = endpoint.main;

        if (this.public_keys.has(endpoint)) return false; // keys already exist
 
        try {      
            const keys = [
                verify_key ? await Crypto.importVerifyKey(verify_key) : null,
                enc_key ? await Crypto.importEncKey(enc_key): null
            ] as [CryptoKey | null, CryptoKey | null];      
            const exportedKeys = [verify_key, enc_key] as [ArrayBuffer, ArrayBuffer];

            this.public_keys.set(endpoint, keys)
            this.public_keys_exported.set(endpoint, exportedKeys);

            return true;
        } catch(e) {
            logger.error(e);
            throw new Error("Could not register keys for endpoint " + endpoint + " (invalid keys or no permisssion)");
        }
    }

    // list of all endpoints with actively used keys
    static #activeEndpoints = new WeakSet<Endpoint>();


    /**
     * Adds an endpoint to the list of active endpoints and makes
     * sure the keys are stored persistently
     * @returns true if keys could be stored
     */
    static activateEndpoint(endpoint: Endpoint) {
        endpoint = endpoint.main;
        if (!this.#activeEndpoints.has(endpoint)) {
            this.#activeEndpoints.add(endpoint)
            return true;
            // return this.storeKeys(endpoint);
        }
        return Promise.resolve(true)
    }

    /**
     * Stores the keys for an endpoint persistently and
     * updates the last used timestamp
     */
    static async storeKeys(endpoint:Endpoint, exportedKeys?: [ArrayBuffer, ArrayBuffer]) {
        // always bind to main endpoint
        endpoint = endpoint.main;

        if (!exportedKeys && !this.public_keys_exported.has(endpoint)) return false;
        if (!exportedKeys) exportedKeys = this.public_keys_exported.get(endpoint)!;

        const storage_item_key = "keys_"+endpoint;
        if (await Storage.hasItem(storage_item_key)) return true; // keys already in storage
        else {
            // validate with stored hash if exists
            const storedHash = await Storage.getItem('hash_keys_' + endpoint) as string;
            const currentHash = await Compiler.getValueHashString(exportedKeys);
            if (storedHash && storedHash !== currentHash) {
                throw new SecurityError("Keys for " + endpoint + " are not valid (Fingerprint mismatch)");
            }
            logger.debug("Storing keys for " + endpoint + " persistently")
            await Storage.setItem(storage_item_key, [...exportedKeys, Date.now()]);
            if (storedHash) await Storage.removeItem('hash_keys_' + endpoint);
            return true;
        }
    }

    static KEY_CLEANUP_INTERVAL = 1000*60*60; // 1 hour
    static MAX_KEY_LIFETIME = 1000*60*60*24*7; // 7 days

    static initCleanup() {
        // run cleanup once at startup
        this.cleanupKeys();
        // run cleanup every hour
        setInterval(() => this.cleanupKeys(), this.KEY_CLEANUP_INTERVAL);
    }

    static async cleanupKeys() {
        let removeCount = 0;
        let totalCount = 0;

        for (const key of await Storage.getItemKeysStartingWith("keys_")) {
            try {
                totalCount++;
                const endpoint = Endpoint.get(key.replace('keys_', ''))

                let isActiveEndpoint = false
                // is active endpoint if in activeEndpoints list and endpoint still online
                if (endpoint instanceof Endpoint && this.#activeEndpoints.has(endpoint)) {
                    isActiveEndpoint = await endpoint.isOnline();
                    this.#activeEndpoints.delete(endpoint);
                }
                
                const data = await Storage.getItem(key);
                if (!(data instanceof Array)) {
                    await Storage.removeItem(key);
                    continue;
                }
                const [verifyKey, encKey, timestamp] = data;
                if (!isActiveEndpoint && (!timestamp || Date.now() - timestamp > this.MAX_KEY_LIFETIME)) {
                    await Storage.removeItem(key);
                    // store key hash
                    await Storage.setItem('hash_keys_' + endpoint, await Compiler.getValueHashString([verifyKey, encKey]));
                    removeCount++;
                }
                else {
                    await Storage.setItem(key, [verifyKey, encKey, Date.now()]);
                }
            }
            catch (e) {
                console.error(e)
            }
        }

        const totalKeyHashCount = await Storage.getItemCountStartingWith('hash_keys_');

        logger.debug(`Cleaned up ${removeCount} stored keys. Remaining: ${totalCount-removeCount} keys and ${totalKeyHashCount} key hashes.`);

        if (totalCount > 1000) {
            logger.warn("Stored keys entries exceed 1000");
        }
        if (totalKeyHashCount > 5000) {
            logger.warn("Stored key hash entries exceed 5000");
        }

    }

    static #waiting_key_requests = new Map<Endpoint, Promise<[CryptoKey, CryptoKey]>>();

    /**
     * Checks if the current public keys match the offical public keys for this endpoint
     */
    static async validateOwnKeysAgainstNetwork() {
        if (!communicationHub.connected) {
            logger.debug("Could not validate local keys against registered public keys, not connected to Supranet")
            return
        }
        try {
            const ownKeys = await Promise.all(
                this.getOwnPublicKeys().map(k => this.exportPublicKeyBase64(k))
            )
            const networkKeys = await Promise.all(
                (await this.requestKeys(Runtime.endpoint)).map(k => k ? this.exportPublicKeyBase64(k) : null)
            );
            if (ownKeys[0] !== networkKeys[0] || ownKeys[1] !== networkKeys[1]) {
                logger.error `The local keys for ${Runtime.endpoint} do not match the registered public keys.`
                displayFatalError("invalid-local-keys")
            }
        }
        catch {
            logger.debug("Could not validate local keys against registered public keys")
        }
    }
    
    // loads keys from network or cache
    static requestKeys(endpoint:Endpoint):Promise<[CryptoKey?, CryptoKey?]> {

        endpoint = endpoint.main;

        // already requesting/loading keys for this endpoint
        if (this.#waiting_key_requests.has(endpoint)) return <Promise<[CryptoKey, CryptoKey]>>this.#waiting_key_requests.get(endpoint);

        let keyPromise:Promise<[CryptoKey, CryptoKey]>;
        this.#waiting_key_requests.set(endpoint, keyPromise = new Promise(async (resolve, reject)=>{

            let exported_keys:[ArrayBuffer, ArrayBuffer]|void = undefined;

            // first check cache:
            if (await Storage.hasItem("keys_"+endpoint)) {
                exported_keys = await Storage.getItem("keys_"+endpoint)
                logger.debug("getting keys from cache for " + endpoint);
            }
            if (!exported_keys) {
                logger.debug("requesting keys for " + endpoint);

                // get endpoint public keys
                // TODO: don't sign?, does not work when running as @+unyt2: await datex('#public.Blockchain.getEndpointPublicKeys(?)', [endpoint], Target.get('@+unyt2'), false)
                try {
                    try {
                        exported_keys = await Runtime.Blockchain!.getEndpointPublicKeys(endpoint);
                    }
                    catch {
                        logger.debug("Blockchain request failed, trying network interface");
                    }
                    if (!exported_keys) exported_keys = await NetworkUtils.get_keys(endpoint);
                    // if (exported_keys) await this.storeKeys(endpoint, exported_keys);
                    if (!exported_keys) {
                        reject(new Error("could not get keys from network"));
                        this.#waiting_key_requests.delete(endpoint); // remove from key promises
                        return;
                    }
                }
                catch (e) {
                    console.error(e);
                    reject(new Error("could not get keys for " + endpoint + " from network"));
                    this.#waiting_key_requests.delete(endpoint); // remove from key promises
                    return;
                }
            }
    
            // convert to CryptoKeys
            try {
                const keys:[CryptoKey, CryptoKey] = [await this.importVerifyKey(exported_keys[0])||null, await this.importEncKey(exported_keys[1])||null];
                this.public_keys.set(endpoint, keys);
                this.public_keys_exported.set(endpoint, exported_keys);
                logger.debug("saving keys for " + endpoint);
                resolve(keys);
                this.#waiting_key_requests.delete(endpoint); // remove from key promises
                return;
            }
            catch (e) {
                console.log(e);
                reject(new Error("Error importing keys for " + endpoint));
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


    static saveOwnPublicKeysInEndpointKeyMap () {
        // save in local endpoint key storage
        if (!this.public_keys.has(Runtime.endpoint)) this.public_keys.set(Runtime.endpoint.main, [null,null]);
        (<[CryptoKey?, CryptoKey?]>this.public_keys.get(Runtime.endpoint.main))[0] = this.rsa_verify_key;
        (<[CryptoKey?, CryptoKey?]>this.public_keys.get(Runtime.endpoint.main))[1] = this.rsa_enc_key;
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
        // create new encrpytion + sign key pair
        const [enc_key_pair, sign_key_pair] = await this.generateNewKeyPair();
    
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

    static async generateNewKeys(): Promise<Crypto.ExportedKeySet> { 
        // create new encrpytion + sign key pair
        const [enc_key_pair, sign_key_pair] = await this.generateNewKeyPair();
    
        const rsa_enc_key_exported = await this.exportPublicKey(enc_key_pair.publicKey);
        const rsa_dec_key_exported = await this.exportPrivateKey(enc_key_pair.privateKey);
        const rsa_verify_key_exported = await this.exportPublicKey(sign_key_pair.publicKey);
        const rsa_sign_key_exported = await this.exportPrivateKey(sign_key_pair.privateKey);

        return {
            sign: [rsa_verify_key_exported, rsa_sign_key_exported],
            encrypt: [rsa_enc_key_exported, rsa_dec_key_exported]
        }
    }

    private static async generateNewKeyPair() {
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
        return [enc_key_pair, sign_key_pair];
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