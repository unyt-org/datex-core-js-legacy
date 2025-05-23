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


import { Logger, console_theme, ESCAPE_SEQUENCES } from "../utils/logger.ts";
import { Runtime } from "../runtime/runtime.ts";
import { Supranet } from "./supranet.ts";
import { Endpoint } from "../types/addressing.ts";
import { CommunicationInterfaceSocket } from "./communication-interface.ts";
import { communicationHub } from "./communication-hub.ts";
import { endpoint_config } from "../runtime/endpoint_config.ts";

const logger = new Logger("unyt");

Supranet.onConnect = ()=>{
    Unyt.endpoint_info.endpoint = Runtime.endpoint,
    Unyt.endpoint_info.node = communicationHub.defaultSocket?.endpoint,
    Unyt.endpoint_info.interface = communicationHub.defaultSocket;
    Unyt.endpoint_info.datex_version = Runtime.VERSION;
    Unyt.using_http_over_datex = endpoint_config.usingHTTPoverDATEX

    Unyt.logEndpointInfo(); 
}

export interface AppInfo {
    name?: string
    version?: string
    stage?: string
    backend?: Endpoint,
    host?: Endpoint,
    dynamicData?: {
        domains?: string[]
    }
    
}

export interface EndpointInfo {
    app?: AppInfo
    endpoint?: Endpoint
    node?: Endpoint
    interface?: CommunicationInterfaceSocket
    uix_version?: string
    datex_version?: string
}

export class Unyt {

    static endpoint_info:EndpointInfo = {}

    static using_http_over_datex = false;

    static setAppInfo(app_info:AppInfo) {
        this.endpoint_info.app = app_info;
    }

    static setUIXVersion(version:string) {
        this.endpoint_info.uix_version = version;
    }

    // TODO: remove
    private static setUIXData(version:string) {
        this.setUIXVersion(version)
    }
    private static setApp(name:string, version:string, stage:string, backend:Endpoint) {
        this.setAppInfo({name, version, stage, backend})
    }

    private static logo_dark = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+Cjxzdmcgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgdmlld0JveD0iMCAwIDE3NiA1OCIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bWw6c3BhY2U9InByZXNlcnZlIiB4bWxuczpzZXJpZj0iaHR0cDovL3d3dy5zZXJpZi5jb20vIiBzdHlsZT0iZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjI7Ij4KICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsLTc2Ny4xNzgsLTEyOC4zMzQpIj4KICAgICAgICA8ZyBpZD0idGV4dF93aGl0ZSIgdHJhbnNmb3JtPSJtYXRyaXgoMC44NjExMTgsMCwwLDAuODQ2NjM4LDg0LjQ3NzEsLTE5Ni44NzgpIj4KICAgICAgICAgICAgPHJlY3QgeD0iNzkyLjgwNyIgeT0iMzg0LjEyMiIgd2lkdGg9IjIwMy4yNjIiIGhlaWdodD0iNjguNDEzIiBzdHlsZT0iZmlsbDpub25lOyIvPgogICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLjE2MTI4LDAsMCwxLjE4MTE0LDM4MS41MDUsLTYuNjA5MTkpIj4KICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuNTA5NTQ5LDAsMCwwLjUwOTU0OSwyNTIuMjIzLDIwMC4zMDgpIj4KICAgICAgICAgICAgICAgICAgICA8dGV4dCB4PSIyOTUuODc2cHgiIHk9IjM0MS41MzVweCIgc3R5bGU9ImZvbnQtZmFtaWx5OidBcmlhbFJvdW5kZWRNVEJvbGQnLCAnQXJpYWwgUm91bmRlZCBNVCBCb2xkJywgc2Fucy1zZXJpZjtmb250LXNpemU6MTE0LjE2N3B4O2ZpbGw6d2hpdGU7Ij51bnl0PC90ZXh0PgogICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMC43NDc1NCwwLDAsMC43NDc1NCwzMTQuOTUyLDE2MC43MzYpIj4KICAgICAgICAgICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwxLC0xNjYuMDU0LC02OS4xNzAyKSI+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yNTguNDc2LDMyMi43MTVDMjY2LjgzOCwzMzEuNTc0IDI3MS45NjUsMzQzLjUyMSAyNzEuOTY1LDM1Ni42NjVMMjU4LjQ3NiwzNTYuNjY1TDI1OC40NzYsMzIyLjcxNVoiIHN0eWxlPSJmaWxsOnJnYigyNTUsMCw4OSk7Ii8+CiAgICAgICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsLTE2Ni4wNTQsLTY5LjE3MDIpIj4KICAgICAgICAgICAgICAgICAgICAgICAgPHBhdGggZD0iTTI1Ni40NzYsMzI0LjFMMjU2LjQ3NiwzNTYuNjY1TDIyMy45MTEsMzU2LjY2NUwyNTYuNDc2LDMyNC4xWiIgc3R5bGU9ImZpbGw6cmdiKDQyLDE3MCwyMTUpOyIvPgogICAgICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwxLC0xNjYuMDU0LC02OS4xNzAyKSI+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yMjIuNDk2LDM1NS4yNTFMMjU2Ljc2MSwzMjAuOTg2QzI0Ny44NywzMTIuNDQ1IDIzNS43OTYsMzA3LjE5NyAyMjIuNDk2LDMwNy4xOTdMMjIyLjQ5NiwzNTUuMjUxWiIgc3R5bGU9ImZpbGw6d2hpdGU7Ii8+CiAgICAgICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICAgICAgPC9nPgogICAgICAgICAgICA8L2c+CiAgICAgICAgPC9nPgogICAgPC9nPgo8L3N2Zz4K';
    private static logo_light = 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhRE9DVFlQRSBzdmcgUFVCTElDICItLy9XM0MvL0RURCBTVkcgMS4xLy9FTiIgImh0dHA6Ly93d3cudzMub3JnL0dyYXBoaWNzL1NWRy8xLjEvRFREL3N2ZzExLmR0ZCI+Cjxzdmcgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgdmlld0JveD0iMCAwIDE3NSA1OSIgdmVyc2lvbj0iMS4xIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bWw6c3BhY2U9InByZXNlcnZlIiB4bWxuczpzZXJpZj0iaHR0cDovL3d3dy5zZXJpZi5jb20vIiBzdHlsZT0iZmlsbC1ydWxlOmV2ZW5vZGQ7Y2xpcC1ydWxlOmV2ZW5vZGQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjI7Ij4KICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDEsLTc2Ny40MzQsLTIwNS40ODIpIj4KICAgICAgICA8ZyBpZD0idGV4dF9kYXJrIiB0cmFuc2Zvcm09Im1hdHJpeCgxLjAwMzA0LDAsMCwwLjk1NzYyOSw3NjguMjQxLDEzMS44MDQpIj4KICAgICAgICAgICAgPHJlY3QgeD0iLTAuODA0IiB5PSI3Ni45MzgiIHdpZHRoPSIxNzMuODMxIiBoZWlnaHQ9IjYwLjgzMyIgc3R5bGU9ImZpbGw6bm9uZTsiLz4KICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMC45OTY5NjgsMCwwLDEuMDQ0MjUsLTM1NC4xNjUsLTI2OC4xNTgpIj4KICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuNTA5NTQ5LDAsMCwwLjUwOTU0OSwyNTIuMjIzLDIwMC4zMDgpIj4KICAgICAgICAgICAgICAgICAgICA8dGV4dCB4PSIyOTUuODc2cHgiIHk9IjM0MS41MzVweCIgc3R5bGU9ImZvbnQtZmFtaWx5OidBcmlhbFJvdW5kZWRNVEJvbGQnLCAnQXJpYWwgUm91bmRlZCBNVCBCb2xkJywgc2Fucy1zZXJpZjtmb250LXNpemU6MTE0LjE2N3B4OyI+dW55dDwvdGV4dD4KICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgIDxnIHRyYW5zZm9ybT0ibWF0cml4KDAuNzQ3NTQsMCwwLDAuNzQ3NTQsMzE0Ljk1MiwxNjAuNzM2KSI+CiAgICAgICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsMSwtMTY2LjA1NCwtNjkuMTcwMikiPgogICAgICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPSJNMjU4LjQ3NiwzMjIuNzE1QzI2Ni44MzgsMzMxLjU3NCAyNzEuOTY1LDM0My41MjEgMjcxLjk2NSwzNTYuNjY1TDI1OC40NzYsMzU2LjY2NUwyNTguNDc2LDMyMi43MTVaIiBzdHlsZT0iZmlsbDpyZ2IoMjU1LDAsODkpOyIvPgogICAgICAgICAgICAgICAgICAgIDwvZz4KICAgICAgICAgICAgICAgICAgICA8ZyB0cmFuc2Zvcm09Im1hdHJpeCgxLDAsMCwxLC0xNjYuMDU0LC02OS4xNzAyKSI+CiAgICAgICAgICAgICAgICAgICAgICAgIDxwYXRoIGQ9Ik0yNTYuNDc2LDMyNC4xTDI1Ni40NzYsMzU2LjY2NUwyMjMuOTExLDM1Ni42NjVMMjU2LjQ3NiwzMjQuMVoiIHN0eWxlPSJmaWxsOnJnYig0MiwxNzAsMjE1KTsiLz4KICAgICAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgICAgICAgICAgPGcgdHJhbnNmb3JtPSJtYXRyaXgoMSwwLDAsMSwtMTY2LjA1NCwtNjkuMTcwMikiPgogICAgICAgICAgICAgICAgICAgICAgICA8cGF0aCBkPSJNMjIyLjQ5NiwzNTUuMjUxTDI1Ni43NjEsMzIwLjk4NkMyNDcuODcsMzEyLjQ0NSAyMzUuNzk2LDMwNy4xOTcgMjIyLjQ5NiwzMDcuMTk3TDIyMi40OTYsMzU1LjI1MVoiLz4KICAgICAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgICAgICA8L2c+CiAgICAgICAgICAgIDwvZz4KICAgICAgICA8L2c+CiAgICA8L2c+Cjwvc3ZnPgo=';

    public static endpointDomains() {
        const info = this.endpoint_info;
        // const urlEndpoint = (client_type == "browser" ? info.app?.backend : info.endpoint);
        // const endpointURLs = urlEndpoint ? [this.formatEndpointURL(urlEndpoint)] : [];
        // if (info.app?.domains) endpointURLs.unshift(...info.app.domains.map(d=>'https://'+d))
        const domains = info.app?.dynamicData?.domains ? info.app.dynamicData.domains.map(d=>'https://'+d.toLowerCase()) : [];

        // remove own domain
        const ownDomain = globalThis.location?.origin.toLowerCase();
        if (ownDomain && domains.includes(ownDomain)) {
            domains.splice(domains.indexOf(ownDomain),1);
        }

        // add own domain to the front
        if (ownDomain) domains.unshift(ownDomain + (this.using_http_over_datex?ESCAPE_SEQUENCES.UNYT_CYAN+' (HTTP-over-DATEX)'+ESCAPE_SEQUENCES.RESET:''));

        return domains;
    }

    /**
     * Don't delete: required in docker-host
     */
    public formatEndpointURL(endpoint: Endpoint) {
        const endpointName = endpoint.toString();
        if (endpointName.startsWith("@+")) return `${endpointName.replace("@+","")}.unyt.app`
        else if (endpointName.startsWith("@@")) return `${endpointName.replace("@@","")}.unyt.app`
        else if (endpointName.startsWith("@")) return `${endpointName.replace("@","")}.unyt.me`
    }

    // TODO add colored logo dark - light mode
    public static async logEndpointInfo(){
        const info = this.endpoint_info;

        let content = "";

        const endpoint = info.endpoint ? await this.formatEndpoint(info.endpoint) : undefined;
        const endpointURLs = this.endpointDomains();
        const host = info.app?.host ? await this.formatEndpoint(info.app.host) : undefined;

        const backend = info.app?.backend ? await this.formatEndpoint(info.app.backend) : undefined;

        if (info.app?.name) content += `${ESCAPE_SEQUENCES.UNYT_GREY}APP${ESCAPE_SEQUENCES.UNYT_CYAN}           ${info.app.name}${ESCAPE_SEQUENCES.RESET}\n`
        if (endpoint) content += `${ESCAPE_SEQUENCES.UNYT_GREY}ENDPOINT${ESCAPE_SEQUENCES.COLOR_DEFAULT}      ${endpoint}${ESCAPE_SEQUENCES.RESET}\n`
        if (endpointURLs.length) content += `${ESCAPE_SEQUENCES.UNYT_GREY}APP URL${ESCAPE_SEQUENCES.COLOR_DEFAULT}       ${endpointURLs.join("\n              ")}\n`
        if (backend) content += `${ESCAPE_SEQUENCES.UNYT_GREY}BACKEND${ESCAPE_SEQUENCES.COLOR_DEFAULT}       ${backend}\n`

        content += `\n`

        if (info.app?.version) content += `${ESCAPE_SEQUENCES.UNYT_GREY}VERSION${ESCAPE_SEQUENCES.COLOR_DEFAULT}       ${info.app.version}\n`
        if (info.app?.stage) content += `${ESCAPE_SEQUENCES.UNYT_GREY}STAGE${ESCAPE_SEQUENCES.COLOR_DEFAULT}         ${info.app.stage}\n`
        if (host) content += `${ESCAPE_SEQUENCES.UNYT_GREY}HOST${ESCAPE_SEQUENCES.COLOR_DEFAULT}          ${host}\n`

        content += `\n`

        if (info.uix_version == "0.0.0") content += `${ESCAPE_SEQUENCES.UNYT_GREY}UIX VERSION${ESCAPE_SEQUENCES.COLOR_DEFAULT}${ESCAPE_SEQUENCES.ITALIC}   unmarked${ESCAPE_SEQUENCES.RESET}\n`
        else if (info.uix_version) content += `${ESCAPE_SEQUENCES.UNYT_GREY}UIX VERSION${ESCAPE_SEQUENCES.COLOR_DEFAULT}   ${info.uix_version.replaceAll('\n','')}\n`

        if (info.datex_version == "0.0.0") content += `${ESCAPE_SEQUENCES.UNYT_GREY}DATEX VERSION${ESCAPE_SEQUENCES.COLOR_DEFAULT}${ESCAPE_SEQUENCES.ITALIC} unmarked${ESCAPE_SEQUENCES.RESET}\n`
        else if (info.datex_version) content += `${ESCAPE_SEQUENCES.UNYT_GREY}DATEX VERSION${ESCAPE_SEQUENCES.COLOR_DEFAULT} ${info.datex_version.replaceAll('\n','')}\n`

        if (globalThis.Deno) content += `${ESCAPE_SEQUENCES.UNYT_GREY}DENO VERSION${ESCAPE_SEQUENCES.COLOR_DEFAULT}  ${Deno.version.deno}\n`
        content += `\n`

        // if (info.app?.stage == "dev" && info.app.backend) content += `Worbench Access for this App: https://workbench.unyt.org/\?e=${info.app.backend.toString()}\n`

        content += `${ESCAPE_SEQUENCES.UNYT_GREY}© ${new Date().getFullYear().toString()} unyt.org`

        logger.plain `#image(70,'unyt')${console_theme == "dark" ? this.logo_dark : this.logo_light}
Connected to the Supranet via ${ESCAPE_SEQUENCES.BOLD}${info.node?.toString()}${ESCAPE_SEQUENCES.RESET} ${info.interface ? `(${info.interface.interfaceProperties?.type}${info.interface.interfaceProperties?.name?` to ${ESCAPE_SEQUENCES.UNYT_GREY}${info.interface.interfaceProperties?.name}`:''}${ESCAPE_SEQUENCES.WHITE})` : ''} 

${content}
`


    }

    private static async formatEndpoint(endpoint:Endpoint) {        
        // @alias.x.y (@@2435)
        try {
            const alias = await endpoint?.getAlias();
            if (alias) {
                return `${ESCAPE_SEQUENCES.BOLD}${alias} (${endpoint}${ESCAPE_SEQUENCES.COLOR_DEFAULT})`
            }
        }
        catch {
            // ignore
        }
        // @@2134565, @endpoint
        return ESCAPE_SEQUENCES.BOLD + endpoint.toString() + ESCAPE_SEQUENCES.RESET;
    }


}