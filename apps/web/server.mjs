import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||4173);
const maxBody=64*1024;
const mime={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".webmanifest":"application/manifest+json",".json":"application/json",".svg":"image/svg+xml"};
function json(res,status,payload){res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(payload));}
async function body(req){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>maxBody)throw Object.assign(new Error("Request too large"),{status:413});}try{return JSON.parse(raw);}catch{throw Object.assign(new Error("Invalid JSON"),{status:400});}}
function configured(){return Boolean(process.env.LLM_BASE_URL&&process.env.LLM_MODEL);}
export function createServer(){return http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url||"/","http://localhost");
 if(url.pathname==="/api/health"&&req.method==="GET")return json(res,200,{configured:configured(),model:configured()?process.env.LLM_MODEL:null,provider:configured()?"configured-server-provider":null,mode:"local-first"});
 if(url.pathname==="/api/agent-health"&&req.method==="GET"){
  const [{createLlamaCppInferenceProvider}]=await Promise.all([import("../../runtime/adapters/llama-cpp/index.ts")]);
  const provider=createLlamaCppInferenceProvider({
   baseUrl:process.env.LLAMACPP_BASE_URL||"http://127.0.0.1:8080",
   api:process.env.LLAMACPP_API==="openai-chat"?"openai-chat":"completion",
   modelAlias:process.env.LLAMACPP_MODEL_ALIAS||undefined,
   timeoutMs:30000
  });
  await provider.checkHealth();
  return json(res,200,{ready:true,baseUrl:process.env.LLAMACPP_BASE_URL||"http://127.0.0.1:8080",api:process.env.LLAMACPP_API||"completion"});
 }
 if(url.pathname==="/api/agent-tasks"&&req.method==="POST"){
  let input;try{input=await body(req);}catch(e){return json(res,e.status||400,{error:e.message});}
  if(typeof input.objective!=="string"||!input.objective.trim())return json(res,400,{error:"A non-empty objective is required."});
  if(input.objective.length>4000)return json(res,413,{error:"Objective exceeds 4,000 characters."});
  const [{runLabSession},{createLlamaCppInferenceProvider}]=await Promise.all([
   import("../../runtime/lab/session.ts"),
   import("../../runtime/adapters/llama-cpp/index.ts")
  ]);
  const provider=createLlamaCppInferenceProvider({
   baseUrl:process.env.LLAMACPP_BASE_URL||"http://127.0.0.1:8080",
   api:process.env.LLAMACPP_API==="openai-chat"?"openai-chat":"completion",
   modelAlias:process.env.LLAMACPP_MODEL_ALIAS||undefined,
   timeoutMs:120000
  });
  await provider.checkHealth();
  res.writeHead(200,{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache","connection":"keep-alive"});
  const controller=new AbortController();
  res.on("close",()=>{if(!res.writableEnded)controller.abort();});
  await runLabSession({
   objective:input.objective,
   provider,
   modelId:process.env.LLAMACPP_MODEL_ALIAS||"local",
   signal:controller.signal,
   onEvent:event=>{if(!res.destroyed&&!res.writableEnded)res.write("data: "+JSON.stringify(event)+"\n\n");}
  });
  if(!res.writableEnded)res.end();
  return;
 }
 if(url.pathname==="/api/chat"&&req.method==="POST"){
  let input;try{input=await body(req);}catch(e){return json(res,e.status||400,{error:e.message});}
  if(typeof input.message!=="string"||!input.message.trim())return json(res,400,{error:"A non-empty message is required."});
  if(input.message.length>12000)return json(res,413,{error:"Message exceeds 12,000 characters."});
  if(!configured())return json(res,503,{error:"No model is configured. Set LLM_BASE_URL and LLM_MODEL on the server."});
  let target;try{target=new URL("chat/completions",process.env.LLM_BASE_URL.endsWith("/")?process.env.LLM_BASE_URL:process.env.LLM_BASE_URL+"/");}catch{return json(res,500,{error:"Invalid server model endpoint."});}
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),60000);
  try{
   const headers={"content-type":"application/json"};if(process.env.LLM_API_KEY)headers.authorization="Bearer "+process.env.LLM_API_KEY;
   const upstream=await fetch(target,{method:"POST",headers,signal:controller.signal,body:JSON.stringify({model:process.env.LLM_MODEL,messages:[{role:"user",content:input.message}],temperature:0.7})});
   const data=await upstream.json().catch(()=>({}));
   if(!upstream.ok)return json(res,502,{error:"Model provider returned HTTP "+upstream.status+". Check the server logs and provider configuration."});
   const reply=data.choices?.[0]?.message?.content;
   if(typeof reply!=="string")return json(res,502,{error:"Model response did not contain a chat completion."});
   return json(res,200,{reply,model:process.env.LLM_MODEL,provider:"configured-server-provider"});
  }catch(e){return json(res,e.name==="AbortError"?504:502,{error:e.name==="AbortError"?"Model request timed out.":"Could not connect to the configured model provider."});}
  finally{clearTimeout(timeout);}
 }
 if(req.method!=="GET"&&req.method!=="HEAD")return json(res,405,{error:"Method not allowed."});
 const requested=url.pathname==="/"?"index.html":url.pathname.slice(1);
 const resolved=path.resolve(root,requested);
 if(!resolved.startsWith(root+path.sep))return json(res,403,{error:"Forbidden."});
 try{const content=await readFile(resolved);res.writeHead(200,{"content-type":mime[path.extname(resolved)]||"application/octet-stream","cache-control":resolved.endsWith("index.html")?"no-cache":"public, max-age=3600"});res.end(req.method==="HEAD"?undefined:content);}catch{return json(res,404,{error:"Not found."});}
 }catch(error){
  if(res.headersSent){res.end();return;}
  const code=error&&typeof error==="object"?error.code:"";
  const status=code==="backend_unreachable"||code==="http_error"?502:code==="invalid_request"||code==="invalid_config"?400:500;
  return json(res,status,{error:error instanceof Error?error.message:"Request failed."});
 }
 });}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const host=process.env.HOST||"127.0.0.1";
 createServer().listen(port,host,()=>console.log("Pocket AI Lab web app listening on http://"+host+":"+port));
}