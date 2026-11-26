import { downloadPinnedModel } from "./download.mjs";
import { resolveSelectedPin } from "./lib.mjs";

console.log(JSON.stringify(await downloadPinnedModel(await resolveSelectedPin())));
