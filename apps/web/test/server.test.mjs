import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.mjs";

async function withServer(fn,env={}){const previous={};for(const key of ["LLM_BASE_URL","LLM_MODEL","LLM_API_KEY"]){previous[key]=process.env[key];delete process.env[key];}Object.assign(process.env,env);const server=createServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url="http://127.0.0.1:"+server.address().port;try{await fn(url);}finally{await new Promise(resolve=>server.close(resolve));for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}}
test("health reports unconfigured without model secrets",async()=>withServer(async url=>{const r=await fetch(url+"/api/health");assert.equal(r.status,200);assert.equal((await r.json()).configured,false);}));
test("chat rejects empty messages",async()=>withServer(async url=>{const r=await fetch(url+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:" "})});assert.equal(r.status,400);}));
test("chat fails closed when no model is configured",async()=>withServer(async url=>{const r=await fetch(url+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"hello"})});assert.equal(r.status,503);}));
test("static app shell is served",async()=>withServer(async url=>{const r=await fetch(url+"/");assert.equal(r.status,200);assert.match(await r.text(),/Pocket AI Lab/);}));

test("chat forwards to the configured OpenAI-compatible endpoint without exposing the key",async()=>withServer(async url=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(input,init)=>{captured={url:String(input),headers:init.headers,body:JSON.parse(init.body)};return new Response(JSON.stringify({choices:[{message:{content:"real model reply"}}]}),{status:200,headers:{"content-type":"application/json"}});};
 try{const r=await fetch(url+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"hello"})});assert.equal(r.status,200);assert.equal((await r.json()).reply,"real model reply");assert.equal(captured.url,"http://127.0.0.1:8080/v1/chat/completions");assert.equal(captured.headers.authorization,"Bearer server-secret");assert.equal(captured.body.model,"test-model");}finally{globalThis.fetch=original;}
},{LLM_BASE_URL:"http://127.0.0.1:8080/v1",LLM_MODEL:"test-model",LLM_API_KEY:"server-secret"}));
