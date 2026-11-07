import { formatLlamaServerCommand, llamaServerArgv, modelDestination, resolveSelectedPin } from "./lib.mjs";

const pin = await resolveSelectedPin();
const modelPath = process.env.POCKET_GGUF_PATH?.trim() || modelDestination(pin);
const allowRemote = process.env.POCKET_LAB_ALLOW_REMOTE_LLAMA === "1";
const argv = llamaServerArgv({
  binary: process.env.LLAMA_SERVER_BIN?.trim() || "llama-server",
  modelPath,
  host: process.env.LLAMA_SERVER_HOST?.trim() || "127.0.0.1",
  port: process.env.LLAMA_SERVER_PORT ? Number(process.env.LLAMA_SERVER_PORT) : 8080,
  context: 8192,
  allowRemote
});
process.stdout.write(formatLlamaServerCommand(argv) + "\n");
