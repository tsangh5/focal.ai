/**
 * In-chat UI (MCP Apps, spec SEP-1865): self-contained `ui://` HTML resources
 * that hosts render for `rank_list` and `recommend` results. No SDK, no
 * external fetches — each view speaks JSON-RPC to the host over postMessage
 * and builds its DOM with text only (results are untrusted data).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const RANKED_LIST_URI = "ui://focal/ranked-list-v1.html";
export const RECOMMENDATIONS_URI = "ui://focal/recommendations-v1.html";

const MIME = "text/html;profile=mcp-app";

const CSS = [
  ":root{color-scheme:light dark}",
  "body{margin:0;padding:10px 12px;font:13px/1.45 system-ui,-apple-system,sans-serif;",
  "background:light-dark(#ffffff,#191919);color:light-dark(#1a1a1a,#ececec)}",
  ".head{margin:0 0 8px;font-weight:600}",
  ".note{margin:0 0 8px;opacity:.65}",
  ".item{padding:6px 8px;border-radius:8px;margin-bottom:4px;background:light-dark(#f5f5f4,#262626)}",
  ".item .lbl{display:block;font-size:11px;opacity:.7;margin-top:2px}",
  ".item.folded{opacity:.55}",
  ".item.lifted{outline:1px solid light-dark(#d6d3d1,#3f3f3f)}",
  ".card{padding:8px;border-radius:8px;margin-bottom:6px;background:light-dark(#f5f5f4,#262626)}",
  ".card .dis{font-size:11px;opacity:.65;margin-top:1px}",
  ".actions{display:flex;gap:6px;align-items:center;margin-top:6px}",
  "button{font:inherit;font-size:12px;padding:3px 10px;border-radius:6px;cursor:pointer;",
  "border:1px solid light-dark(#d6d3d1,#4a4a4a);background:light-dark(#ffffff,#333);color:inherit}",
  "button:disabled{opacity:.5;cursor:default}",
  ".status{font-size:11px;opacity:.7}",
].join("");

// Shared view↔host bridge: ui/initialize handshake, tool-result delivery,
// tools/call requests, size reports. window.renderFocal(data) renders; the
// widget scripts below define it.
const BRIDGE = `(function(){
var nextId=1,pending={};
function send(m){window.parent.postMessage(m,"*")}
function request(method,params){return new Promise(function(resolve,reject){
var id=nextId++;pending[id]={resolve:resolve,reject:reject};
send({jsonrpc:"2.0",id:id,method:method,params:params})})}
function notify(method,params){send({jsonrpc:"2.0",method:method,params:params})}
function dataOf(r){if(!r||typeof r!=="object")return null;
if(r.structuredContent&&typeof r.structuredContent==="object")return r.structuredContent;
var c=r.content;if(c&&c[0]&&typeof c[0].text==="string"){try{return JSON.parse(c[0].text)}catch(e){}}
return null}
function deliver(r){var d=dataOf(r);if(d&&typeof window.renderFocal==="function")window.renderFocal(d)}
window.addEventListener("message",function(event){
if(event.source!==window.parent)return;
var msg=event.data;
if(!msg||msg.jsonrpc!=="2.0")return;
if(msg.id!==undefined&&Object.prototype.hasOwnProperty.call(pending,msg.id)){
var p=pending[msg.id];delete pending[msg.id];
if(msg.error)p.reject(new Error((msg.error&&msg.error.message)||"request failed"));else p.resolve(msg.result);
return}
if(msg.method==="ui/notifications/tool-result")deliver(msg.params);
else if(msg.id!==undefined)send({jsonrpc:"2.0",id:msg.id,result:{}})});
window.callTool=function(name,args){return request("tools/call",{name:name,arguments:args}).then(dataOf)};
request("ui/initialize",{appInfo:{name:"focal",version:"1"},appCapabilities:{},protocolVersion:"2026-01-26"})
.then(function(result){
notify("ui/notifications/initialized");
var theme=result&&result.hostContext&&result.hostContext.theme;
if(theme==="light"||theme==="dark")document.documentElement.style.colorScheme=theme})
.catch(function(){});
function openaiOutput(){if(window.openai&&window.openai.toolOutput)deliver({structuredContent:window.openai.toolOutput})}
window.addEventListener("openai:set_globals",openaiOutput);openaiOutput();
var last="";
function reportSize(){var w=document.documentElement.clientWidth,h=document.documentElement.clientHeight;
var k=w+"x"+h;if(k!==last){last=k;notify("ui/notifications/size-changed",{width:w,height:h})}}
if(typeof ResizeObserver==="function")new ResizeObserver(reportSize).observe(document.body);
window.addEventListener("load",reportSize)})();`;

const RENDER_HELPERS = `function el(tag,cls,text){var n=document.createElement(tag);
if(cls)n.className=cls;n.textContent=text;return n}
function reset(){var root=document.getElementById("app");root.textContent="";return root}`;

const RANKED_LIST_JS = `window.renderFocal=function(data){
var root=reset();
var items=data&&data.items?data.items:[];
if(!data||data.status!=="ranked"){
var msg=data&&data.status==="no_signals"
?"No likes saved yet, so this list stays in its original order."
:"No clear matches, so this list stays in its original order.";
root.appendChild(el("p","note",msg));
items.slice().sort(function(a,b){return a.original_position-b.original_position})
.forEach(function(it){root.appendChild(el("div","item",it.name))});
return}
var lifted=items.filter(function(i){return i.lifted}).length;
root.appendChild(el("p","head","focal lifted "+lifted+" for you"));
items.forEach(function(it){
var row=el("div","item"+(it.lifted?" lifted":"")+(it.folded_by?" folded":""),it.name);
if(it.label)row.appendChild(el("span","lbl",it.label));
if(it.folded_by&&it.folded_by.length)row.appendChild(el("span","lbl","hidden by your rules ("+it.folded_by.join(", ")+")"));
root.appendChild(row)})};`;

const RECOMMENDATIONS_JS = `var shown=null;
window.renderFocal=function(data){
shown=data;
var root=reset();
var results=data&&data.results?data.results:[];
if(!results.length){root.appendChild(el("p","note","Nothing to recommend yet."));return}
root.appendChild(el("p","head","Picks for you"+(data.city?" in "+data.city:"")));
results.forEach(function(r){
var card=el("div","card","");card.appendChild(el("div","",r.name));
if(r.disambiguation)card.appendChild(el("div","dis",r.disambiguation));
var actions=el("div","actions","");
var status=el("span","status","");
[["love","Love"],["like","Like"]].forEach(function(pair){
var b=document.createElement("button");b.type="button";b.textContent=pair[1];
b.addEventListener("click",function(){save(card,status,r,pair[0])});
actions.appendChild(b)});
actions.appendChild(status);card.appendChild(actions);root.appendChild(card)})};
function save(card,status,r,strength){
var buttons=card.querySelectorAll("button");
for(var i=0;i<buttons.length;i++)buttons[i].disabled=true;
var args={name:r.name,type:shown.type,strength:strength,entity_id:r.entity_id};
if(shown.city)args.city=shown.city;
window.callTool("add_thing",args).then(function(res){
if(res&&res.saved===true){status.textContent="Saved";return}
for(var i=0;i<buttons.length;i++)buttons[i].disabled=false;
status.textContent="Couldn't save, ask in chat"}).catch(function(){
for(var i=0;i<buttons.length;i++)buttons[i].disabled=false;
status.textContent="Couldn't save, ask in chat"})}`;

function page(script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body><div id="app"></div><script>${BRIDGE}</script><script>${RENDER_HELPERS}${script}</script></body></html>`;
}

/** Registers the two in-chat widgets as ui:// resources on the hosted server. */
export function registerWidgets(server: McpServer): void {
  const meta = { ui: { prefersBorder: true, csp: { connectDomains: [] as string[], resourceDomains: [] as string[] } } };
  const views: [string, string, string][] = [
    ["ranked-list", RANKED_LIST_URI, RANKED_LIST_JS],
    ["recommendations", RECOMMENDATIONS_URI, RECOMMENDATIONS_JS],
  ];
  for (const [name, uri, script] of views) {
    server.registerResource(name, uri, { mimeType: MIME, _meta: meta }, (u) => ({
      contents: [{ uri: u.href, mimeType: MIME, text: page(script), _meta: meta }],
    }));
  }
}
