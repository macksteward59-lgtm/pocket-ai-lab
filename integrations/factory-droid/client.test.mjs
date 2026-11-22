import test from "node:test";
import assert from "node:assert/strict";
import {prepareTask,executeTask,sessionStatus,factoryRequest} from "./client.mjs";
const input={prompt:"Review tests only",kind:"environment",id:"env_123",branch:"factory/review-tests"};
test("explicit approval and separate branch",()=>{
  assert.throws(()=>prepareTask(input),/approval/);
  assert.throws(()=>prepareTask({...input,approved:true,branch:"main"}),/branch/);
  const task=prepareTask({...input,approved:true});
  assert.deepEqual(task.target,{kind:"environment",environmentId:"env_123"});
  assert.match(task.prompt,/not yet admitted/);
});
test("mocked request uses official API",async()=>{
  let n=0;
  const fetchImpl=async(url,opts)=>{
    n++;
    assert.equal(url,"https://api.factory.ai/api/v0/droid/execute");
    assert.equal(opts.method,"POST");
    assert.equal(opts.headers.Authorization,"Bearer test-key");
    assert.equal(JSON.parse(opts.body).target.environmentId,"env_123");
    return {ok:true,json:async()=>({sessionId:"s1",computerId:"c1",messageId:"m1"})};
  };
  const r=await executeTask(prepareTask({...input,approved:true}),{key:"test-key",fetchImpl});
  assert.equal(n,1);assert.equal(r.sessionId,"s1");
});
test("fail closed on missing key and nonallowlisted endpoints",async()=>{
  await assert.rejects(factoryRequest("/droid/execute"),/missing/);
  await assert.rejects(factoryRequest("/secrets",{key:"test"}),/allowlisted/);
  await assert.rejects(sessionStatus("../unknown",{key:"test"}),/session ID/);
});
test("do not leak API response bodies on failures",async()=>{
  await assert.rejects(factoryRequest("/droid/execute",{key:"secret",fetchImpl:async()=>({ok:false,status:403,text:async()=>"private"})}),/HTTP 403/);
});
