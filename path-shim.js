export function normalize(p) { return p; }
export function dirname(p) { return p.split("/").slice(0, -1).join("/") || "/"; }
export function basename(p) { return p.split("/").pop() || p; }
export function extname(p) { const m = p.match(/\.[^./]+$/); return m ? m[0] : ""; }
export function join(...parts) { return parts.join("/").replace(/\/+/g, "/"); }
export function resolve(...parts) { return parts.join("/").replace(/\/+/g, "/"); }
export const sep = "/";
export default { normalize, dirname, basename, extname, join, resolve, sep };
