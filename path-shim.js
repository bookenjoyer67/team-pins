export function normalize(p) { return p; }
export function dirname(p) { return p.split("/").slice(0, -1).join("/") || "/"; }
export function basename(p) { return p.split("/").pop() || p; }
export function extname(p) { const m = p.match(/\.[^./]+$/); return m ? m[0] : ""; }
function resolveDots(parts) {
  const stack = [];
  for (const p of parts) {
    if (p === "..") { if (stack.length > 0) stack.pop(); }
    else if (p !== "." && p !== "") stack.push(p);
  }
  return stack;
}
export function join(...parts) { return "/" + resolveDots(parts.flatMap(p => p.split("/"))).join("/"); }
export function resolve(...parts) { return join(...parts); }
export const sep = "/";
export default { normalize, dirname, basename, extname, join, resolve, sep };
