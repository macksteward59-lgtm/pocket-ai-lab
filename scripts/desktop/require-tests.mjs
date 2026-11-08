import { globSync } from "node:fs";

const args = process.argv.slice(2);
let count = 0;
for (const arg of args) {
  if (arg.includes("*")) count += globSync(arg).length;
  else count += 1;
}
if (count === 0) {
  console.error("No test files matched: " + (args.join(" ") || "(none)"));
  process.exit(1);
}
