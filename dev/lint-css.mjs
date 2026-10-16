import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const rules = [[/!important\b/g, "Use scoped selector specificity instead of !important"], [/:has\s*\(/g, "Use an explicit component state class instead of :has"]];
let failures = 0;
for (const [pattern, message] of rules) for (const match of css.matchAll(pattern)) {
  console.error(`styles.css:${css.slice(0, match.index).split("\n").length}: ${message}`);
  failures++;
}
if (failures) process.exitCode = 1;
else console.log("CSS review checks passed");
