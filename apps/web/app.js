const $ = (id) => document.getElementById(id);
const state = { model: "model not connected", busy: false };
const views = ["chat","agents","memory","activity","settings"];
function setView(name){views.forEach(v=>$(v+"-view").classList.toggle("hidden",v!==name));document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===name));$("page-name").textContent=name[0].toUpperCase()+name.slice(1);$("sidebar").classList.remove("open");if(name==="agents")checkAgentHealth();}
function appendMessage(role,text){const row=document.createElement("article");row.className="message "+role;const label=document.createElement("div");label.className="message-label";label.textContent=role==="user"?"YOU":"POCKET AI LAB · MODEL RESPONSE";const body=document.createElement("div");body.className="message-body";body.textContent=text;row.append(label,body);$("messages").append(row);row.scrollIntoView({block:"nearest"});return body;}
function setConnection(ready,label){$("connection").classList.toggle("ready",ready);$("connection").lastChild.textContent=label;$("model-pill").textContent=ready?state.model+" · local":"Local model · not connected";}
async function health(){try{const r=await fetch("/api/health");const j=await r.json();state.model=j.model||"local model";const hint=document.querySelector(".privacy-hint");if(j.reachable&&j.loopback){setConnection(true,"Local model ready");if(hint)hint.textContent="◉ Prompts stay on this device";}else if(j.reachable){setConnection(false,"Remote model reachable");if(hint)hint.textContent="◉ Remote model — prompts leave this device";}else if(j.configured){setConnection(false,"Model configured but unreachable");if(hint)hint.textContent="◉ Local model is not reachable";}else{setConnection(false,"Model not connected");if(hint)hint.textContent="◉ Private when using local inference";}}catch{setConnection(false,"Server unavailable");}}
let agentController=null;
async function checkAgentHealth(){
 const status=$("agent-status");
 if(!status)return;
 status.textContent="Checking local llama-server…";
 try{
  const response=await fetch("/api/agent-health");
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||"Local model unavailable");
  status.textContent="Connected · "+data.baseUrl+" · "+data.api;
 }catch(error){status.textContent="Local model unavailable. Start llama-server on 127.0.0.1:8080. "+error.message;}
}
function appendAgentEvent(event){
 if(event.type==="stage")$("agent-status").textContent="Running stage: "+event.stage;
 if(event.type==="message"){
  const item=document.createElement("li");
  const heading=document.createElement("strong");
  heading.textContent=event.message.role+" · "+event.message.stage;
  const payload=document.createElement("pre");
  payload.textContent=JSON.stringify(event.message.payload,null,2);
  item.append(heading,payload);
  $("agent-transcript").append(item);
 }
 if(event.type==="error")$("agent-status").textContent="Run stopped: "+event.message;
 if(event.type==="done"){
  const result=event.result;
  $("agent-result").classList.remove("hidden");
  $("agent-result").textContent=(result.synthesis||"No final synthesis was produced.")+"\n\nAuthorized: "+String(result.authorized)+" · Memory verified: "+String(result.memoryVerified)+"\n"+result.disclaimer;
  $("agent-status").textContent=result.error?"Run ended with an error: "+result.error.message:result.messages.length+" real model messages completed.";
 }
}
$("agent-form").addEventListener("submit",async event=>{
 event.preventDefault();
 const objective=$("agent-objective").value.trim();
 if(!objective||agentController)return;
 agentController=new AbortController();
 $("agent-run").disabled=true;$("agent-stop").disabled=false;
 $("agent-transcript").replaceChildren();$("agent-result").classList.add("hidden");
 $("agent-status").textContent="Starting local agent team…";
 try{
  const response=await fetch("/api/agent-tasks",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({objective}),signal:agentController.signal});
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||"Could not start the agent run.");}
  if(!response.body)throw new Error("Streaming is not supported by this browser.");
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
  while(true){
   const chunk=await reader.read();if(chunk.done)break;
   buffer+=decoder.decode(chunk.value,{stream:true});
   let boundary;
   while((boundary=buffer.indexOf("\n\n"))>=0){
    const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
    const line=block.split("\n").find(value=>value.startsWith("data: "));
    if(line)appendAgentEvent(JSON.parse(line.slice(6)));
   }
  }
 }catch(error){if(error.name!=="AbortError")$("agent-status").textContent=error.message;}
 finally{agentController=null;$("agent-run").disabled=false;$("agent-stop").disabled=true;}
});
$("agent-stop").addEventListener("click",()=>agentController?.abort());

async function sendMessage(text){if(!text.trim()||state.busy)return; $("welcome").classList.add("hidden");appendMessage("user",text);$("prompt").value="";state.busy=true;$("send").disabled=true;const output=appendMessage("assistant","Connecting to your configured model…");try{const response=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,model:state.model})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Model request failed");output.textContent=data.reply||"The model returned an empty response."; }catch(error){output.textContent="I couldn't reach a configured model. "+error.message+"\n\nConnect a local llama.cpp server in Settings, then try again. No simulated answer was generated.";}finally{state.busy=false;$("send").disabled=false;health();}}
$("composer").addEventListener("submit",e=>{e.preventDefault();sendMessage($("prompt").value);});
$("prompt").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("composer").requestSubmit();}});
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>sendMessage(b.dataset.prompt)));
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
$("settings-shortcut").addEventListener("click",()=>setView("settings"));
$("new-chat").addEventListener("click",()=>{$("messages").replaceChildren();$("welcome").classList.remove("hidden");setView("chat");});
$("mobile-menu").addEventListener("click",()=>$("sidebar").classList.toggle("open"));
$("settings-form").addEventListener("submit",e=>{e.preventDefault();$("settings-status").textContent="The server endpoint is controlled by the app host. Nothing was saved in this browser.";});
$("test-connection").addEventListener("click",async()=>{await health();$("settings-status").textContent=$("connection").classList.contains("ready")?"Local llama-server responded to a health check.":"The model is not a reachable local llama-server. No simulated status was saved.";});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
health();