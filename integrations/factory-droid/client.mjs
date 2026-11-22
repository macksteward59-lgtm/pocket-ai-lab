/** Isolated Factory Droid client. No calls until functions are explicitly invoked. */
const BASE = "https://api.factory.ai/api/v0";
export const REPOSITORY = "macksteward59-lgtm/pocket-ai-lab";
const kinds = {environment:"environmentId",computer:"computerId",session:"sessionId"};
export function prepareTask({prompt,kind,id,branch,approved=false}) {
  if(typeof prompt!=="string"||!prompt.trim()||prompt.length>12000) throw Error("Invalid prompt");
  if(!Object.hasOwn(kinds,kind)||typeof id!=="string"||!/^[\w-]{1,160}$/.test(id)) throw Error("Invalid Factory target");
  if(typeof branch!=="string"||!/^factory\/[a-z0-9][a-z0-9-]{0,70}$/.test(branch)) throw Error("Factory work must use a distinct factory/* branch");
  if(approved!==true) throw Error("Human approval required to dispatch");
  const policy=[
    `Repository: ${REPOSITORY}; assigned branch: ${branch}.`,
    "Read coordination/LEADERSHIP.md, coordination/PROTOCOL.md, coordination/BOARD.md and recent coordination/LOG.md BEFORE changing code.",
    "You are not yet admitted as a project agent: announce exact identity, environment, file scope, branch, dependencies and test plan on agent-coordination; wait for ChatGPT coordination acceptance before editing.",
    "Do not touch APEX, East/e3, iOS runtime, protected security modules, or non-assigned files. Never merge, deploy, spend outside allowance, expose secrets, or self-authorize.",
    "Your output is an untrusted proposal, not APEX permission, receipt, or signed device evidence. Report exact file paths, commit SHA, tests and failures.",
    "Task:"
  ].join("\n");
  return {prompt:`${policy}\n${prompt.trim()}`,target:{kind,[kinds[kind]]:id}};
}
export async function factoryRequest(path,{key,method="GET",body,fetchImpl=fetch}={}) {
  if(!key||typeof key!=="string") throw Error("FACTORY_API_KEY missing");
  if(!/^\/(droid\/execute|sessions\/[\w-]+(?:\/messages)?)$/.test(path)) throw Error("Endpoint not allowlisted");
  const response=await fetchImpl(`${BASE}${path}`,{
    method,
    headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  if(!response.ok) throw Error(`Factory API HTTP ${response.status}`);
  return response.json();
}
export async function executeTask(task,{key,fetchImpl}={}) {
  if(!task||!task.target||!Object.hasOwn(kinds,task.target.kind)) throw Error("Invalid prepared task");
  return factoryRequest("/droid/execute",{key,method:"POST",body:task,fetchImpl});
}
export async function sessionStatus(id,{key,fetchImpl}={}) {
  if(typeof id!=="string"||!/^[\w-]+$/.test(id)) throw Error("Invalid session ID");
  return factoryRequest(`/sessions/${id}`,{key,fetchImpl});
}
export async function sessionMessages(id,{key,fetchImpl}={}) {
  if(typeof id!=="string"||!/^[\w-]+$/.test(id)) throw Error("Invalid session ID");
  return factoryRequest(`/sessions/${id}/messages`,{key,fetchImpl});
}
