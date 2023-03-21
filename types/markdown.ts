import "../lib/marked.js"; // required for Markdown highlighting
declare const marked:Function;

/** <text/markdown> */
export class Markdown {
    content:string
    constructor(content:string|ArrayBuffer|Uint8Array = "") {
        if (content instanceof ArrayBuffer || content instanceof Uint8Array) this.content = new TextDecoder().decode(content);
        else this.content = content;
    }
    toString(){
        return this.content;
    }

    private static code_colorizer:globalThis.Function
    static setCodeColorizer(code_colorizer:globalThis.Function){
        this.code_colorizer = code_colorizer;
    }

    // return formatted HTML for markdown
    getHTML(container=true){

        // @ts-ignore for browser contexts
        if (!globalThis.document) return "[Cannot generate HTML]";
        // @ts-ignore for browser contexts
        
        const code = container ? document.createElement("code") : document.createElement("div");
        code.style.paddingLeft = "10px";
        code.style.paddingRight = "10px";
        code.style.marginTop = "10px";
        code.style.marginBottom = "10px";
        code.innerHTML = marked(this.content);
        
        // higlight code
        if (Markdown.code_colorizer) {
            code.querySelectorAll("code").forEach(async (c:any)=>{
                const lang = c.getAttribute("class")?.replace("language-", "") || "datex";
                if (lang) {
                    c.innerHTML = await Markdown.code_colorizer(c.innerText, lang)
                }
            })
        }

        return code;
    }
}

