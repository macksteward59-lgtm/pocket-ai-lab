import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.mjs";

async function withServer(fn,env={}){const previous={};for(const key of ["LLM_BASE_URL","LLM_MODEL","LLM_API_KEY"]){previous[key]=process.env[key];delete process.env[key];}Object.assign(process.env,env);const server=createServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url="http://127.0.0.1:"+server.address().port;try{await fn(url);}finally{await new Promise(resolve=>server.close(resolve));for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}}
test("health reports unconfigured without model secrets",async()=>withServer(async url=>{const r=await fetch(url+"/api/health");assert.equal(r.status,200);assert.equal((await r.json()).configured,false);}));
test("chat rejects empty messages",async()=>withServer(async url=>{const r=await fetch(url+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:" "})});assert.equal(r.status,400);}));
test("chat fails closed when no model is configured",async()=>withServer(async url=>{const r=await fetch(url+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:"hello"})});assert.equal(r.status,503);}));
test("static app shell is served",async()=>withServer(async url=>{const r=await fetch(url+"/");assert.equal(r.status,200);assert.match(await r.text(),/Pocket AI Lab/);}));
