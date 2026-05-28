export function formatWithOptions(opts, ...args) {
  return args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
}
export const types = {};
export default { formatWithOptions, types };
