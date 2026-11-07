// The browser build never reads local files; these stubs satisfy the imports.
const unsupported = () => { throw new Error("not available in the browser"); };
export const readFile = unsupported, writeFile = unsupported, mkdir = unsupported;
export const pathToFileURL = (p) => new URL("file://" + p);
export const fileURLToPath = (u) => String(u).replace(/^file:\/\//, "");
export const resolve = (...p) => p.join("/");
export const join = (...p) => p.join("/");
export const dirname = (p) => String(p).replace(/\/[^/]*$/, "");
export const isAbsolute = (p) => String(p).startsWith("/");
export default {};
