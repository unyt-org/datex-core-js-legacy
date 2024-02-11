function showOpenFilePickerPolyfill(options) {
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = options.multiple;
        input.accept = options.types
            .map((type) => type.accept)
            .flatMap((inst) => Object.keys(inst).flatMap((key) => inst[key]))
            .join(",");

        input.addEventListener("change", () => {
            resolve(
                [...input.files].map((file) => {
                    return {
                        getFile: async () =>
                            new Promise((resolve) => {
                                resolve(file);
                            }),
                    };
                })
            );
        });

        input.click();
    });
}

if (typeof globalThis.showOpenFilePicker !== 'function') {
    globalThis.showOpenFilePicker = showOpenFilePickerPolyfill
}

/* Polyfill for SaFaRi https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map/groupBy */
Object.groupBy ??= function groupBy (iterable, callbackfn) {
    const obj = Object.create(null)
    let i = 0
    for (const value of iterable) {
      const key = callbackfn(value, i++)
      key in obj ? obj[key].push(value) : (obj[key] = [value])
    }
    return obj
}
Map.groupBy ??= function groupBy (iterable, callbackfn) {
    const map = new Map()
    let i = 0
    for (const value of iterable) {
        const key = callbackfn(value, i++), list = map.get(key)
        list ? list.push(value) : map.set(key, [value])
    }
    return map
}
