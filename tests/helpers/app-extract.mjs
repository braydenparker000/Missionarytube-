/** Pull one indented classic-script function out of assets/js/app.js. */
export function extractIndentedFunction(source, name) {
  const start = source.search(new RegExp(`^    (?:async )?function ${name}\\(`, "m"));
  if (start < 0) return "";
  const lines = source.slice(start).split("\n");
  if (lines[0].trimEnd().endsWith("}")) return lines[0];
  const end = lines.findIndex((line, index) => index > 0 && /^    }\s*$/.test(line));
  if (end < 0) throw new Error(`Find the end of ${name}`);
  return lines.slice(0, end + 1).join("\n");
}
