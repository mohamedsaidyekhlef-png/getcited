// The in-chat getcited report card. One self-contained HTML page (no external
// requests) that MCP Apps hosts (Claude, VS Code, Goose…) and ChatGPT render
// next to the answer. It reads the tool's structuredContent and draws the
// audit, X-ray or arena result in getcited's own look.

export const WIDGET_URI = "ui://getcited/report.html";
export const WIDGET_URI_OPENAI = "ui://getcited/report-openai.html";

const LOGO = `<svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8794FF"/><stop offset="1" stop-color="#5B3FE0"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><path d="M15 18h34a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H31l-9 7v-7h-7a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5z" fill="#fff"/><path d="M24 31l5 5 11-11" fill="none" stroke="#5B3FE0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>getcited report</title>
<style>
:root{--bg:#ffffff;--card:#F6F7FB;--line:#E6E8F0;--ink:#121626;--mute:#5E6478;--brand:#5B3FE0;--brand2:#8794FF;--pass:#16A36A;--warn:#C98A0B;--fail:#D9363E;--chip:#EEF0FA}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0B0E17;--card:#141927;--line:#232A3D;--ink:#EEF1F8;--mute:#9AA2B8;--brand:#8794FF;--brand2:#B4BCFF;--pass:#3CCB8C;--warn:#F0B43C;--fail:#FF6B6B;--chip:#1C2236}}
:root[data-theme=dark]{--bg:#0B0E17;--card:#141927;--line:#232A3D;--ink:#EEF1F8;--mute:#9AA2B8;--brand:#8794FF;--brand2:#B4BCFF;--pass:#3CCB8C;--warn:#F0B43C;--fail:#FF6B6B;--chip:#1C2236}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{padding:16px;max-width:760px}
.top{display:flex;align-items:center;gap:8px;font-weight:800;letter-spacing:-.01em}
.top .b{color:var(--brand)}.live{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--mute)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--pass);box-shadow:0 0 0 3px color-mix(in srgb,var(--pass) 25%,transparent)}
.url{margin-top:10px;font-size:12.5px;color:var(--mute);word-break:break-all}
h2{margin:4px 0 0;font-size:19px;line-height:1.25;letter-spacing:-.01em}
.hero{display:flex;gap:16px;align-items:center;margin-top:14px}
.ring{--p:0;--c:var(--pass);width:92px;height:92px;flex:none;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c) calc(var(--p)*1%),var(--line) 0)}
.ring>div{width:74px;height:74px;border-radius:50%;background:var(--bg);display:grid;place-items:center;text-align:center}
.ring b{font-size:26px;line-height:1}.ring small{display:block;font-size:11px;color:var(--mute);font-weight:600}
.verdict{font-weight:700;font-size:15px}.sub{color:var(--mute);font-size:12.5px;margin-top:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:14px}
.cat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.cat b{font-size:20px}.cat span{display:block;font-size:12px;color:var(--mute)}
.bar{height:6px;border-radius:9px;background:var(--line);overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;border-radius:9px}
.sec{margin-top:18px}.sec>p{margin:0 0 8px;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-top:6px}
.item .t{display:flex;gap:8px;align-items:flex-start;font-weight:650}
.item .e{color:var(--mute);font-size:12.5px;margin-top:4px}.item .f{font-size:12.5px;margin-top:6px}.item .f b{color:var(--brand)}
.st{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;color:#fff;margin-top:1px}
.st.pass{background:var(--pass)}.st.warn{background:var(--warn)}.st.fail{background:var(--fail)}.st.info{background:var(--mute)}
.pass{color:var(--pass)}.warn{color:var(--warn)}.fail{color:var(--fail)}
.row{display:grid;grid-template-columns:minmax(0,1fr) 120px 44px;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)}
.row:last-child{border:0}.row .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row .n.me{font-weight:800;color:var(--brand)}
.row .v{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.q{font-size:13px}.q em{display:block;font-style:normal;color:var(--mute);font-size:12px;margin-top:3px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--chip);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--mute)}
.cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
button{font:inherit;font-size:13px;font-weight:650;border-radius:10px;padding:8px 14px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button.p{background:var(--brand);border-color:var(--brand);color:#fff}
.foot{margin-top:14px;font-size:11.5px;color:var(--mute)}
.skel{height:14px;border-radius:6px;background:var(--line);margin-top:10px;animation:pulse 1.2s infinite}@keyframes pulse{50%{opacity:.5}}
.err{color:var(--fail);font-weight:600;margin-top:12px}
</style></head>
<body><div class="wrap" id="app">
<div class="top">${LOGO}<span>get<span class="b">cited</span></span><span class="live" id="live"><span class="dot"></span>Running live…</span></div>
<div class="skel" style="width:60%"></div><div class="skel" style="width:85%"></div><div class="skel" style="width:40%"></div>
</div>
<script>
(function(){
var app=document.getElementById("app"),LOGO=${JSON.stringify(LOGO)};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})};
var tone=function(v){return v>=75?"pass":v>=50?"warn":"fail"};
var pct=function(x){return Math.round((x||0)*100)+"%"};
var when=function(iso){try{return new Date(iso).toLocaleString([], {dateStyle:"medium",timeStyle:"short"})}catch(e){return iso}};
var host=function(u){try{return new URL(u).host.replace(/^www\\./,"")}catch(e){return u}};
var mark={pass:"✓",warn:"!",fail:"✕",info:"i"};
var nextId=1,pending={};
function post(m){try{window.parent.postMessage(m,"*")}catch(e){}}
function request(method,params){var id=nextId++;post({jsonrpc:"2.0",id:id,method:method,params:params||{}});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},4000)})}
function notify(method,params){post({jsonrpc:"2.0",method:method,params:params||{}})}
function open(url){
  if(window.openai&&window.openai.openExternal){try{window.openai.openExternal({href:url});return}catch(e){}}
  request("ui/open-link",{url:url}).catch(function(){window.open(url,"_blank","noopener")});
}
function ask(text){
  if(window.openai&&window.openai.sendFollowUpMessage){window.openai.sendFollowUpMessage({prompt:text});return}
  request("ui/message",{role:"user",content:[{type:"text",text:text}]}).catch(function(){});
}
function size(){notify("ui/notifications/size-changed",{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})}
function head(d,title){
  return '<div class="top">'+LOGO+'<span>get<span class="b">cited</span></span><span class="live"><span class="dot"></span>Live result · '+esc(when(d.measuredAt))+'</span></div>'+title;
}
function foot(d,extra){
  return '<div class="cta">'+(extra||"")+'<button data-open="https://www.scairos.com/getcited">Open getcited ↗</button></div>'+
  '<div class="foot">Fetched '+esc(when(d.measuredAt))+(d.responseMs!=null?' · page served in '+d.responseMs+' ms':'')+' · read as raw HTML, the way AI crawlers see it · open source, MIT</div>';
}
function audit(d){
  var s=d.score.overall,c=tone(s);
  var verdict=s>=75?"AI engines can reach, read and quote this page.":s>=50?"Citable, with gaps an engine will notice.":"AI engines will struggle to cite this page.";
  var h=head(d,'<div class="url">'+esc(d.url)+'</div>');
  h+='<div class="hero"><div class="ring" style="--p:'+s+';--c:var(--'+c+')"><div><div><b>'+s+'</b><small>Grade '+esc(d.score.grade)+'</small></div></div></div><div><h2>'+esc(verdict)+'</h2><div class="sub">AI-citation readiness for ChatGPT, Perplexity, Claude, Gemini and Google AI Overviews.</div></div></div>';
  h+='<div class="grid">'+d.categories.filter(function(x){return x.score!=null}).map(function(x){var t=tone(x.score);return '<div class="cat"><b class="'+t+'">'+x.score+'</b><span>'+esc(x.label)+'</span><div class="bar"><i style="width:'+x.score+'%;background:var(--'+t+')"></i></div></div>'}).join("")+'</div>';
  var ACC=["robots-ai","cdn-block","server-rendered","indexable","llms-txt"];var acc=d.checks.filter(function(x){return ACC.indexOf(x.id)>=0});
  if(acc.length)h+='<div class="sec"><p>Evidence: AI crawler access</p>'+acc.map(item).join("")+'</div>';
  if(d.priorities.length)h+='<div class="sec"><p>Fix these first</p>'+d.priorities.slice(0,5).map(function(p){return item(ACC.indexOf(p.id)>=0?{title:p.title,status:p.status,fix:p.fix}:p,true)}).join("")+'</div>';
  else h+='<div class="sec"><div class="item"><div class="t"><span class="st pass">✓</span>Nothing urgent. This page is ready to be cited.</div></div></div>';
  h+=foot(d,'<button class="p" data-ask="Run the getcited Citation Arena for '+esc(host(d.url))+': who gets cited instead of us for our buyers\\' main question?">Who gets cited instead? →</button><button data-ask="Run a getcited X-ray on '+esc(d.url)+' and rewrite the weakest sentences.">X-ray the sentences</button>');
  return h;
}
function item(x,fix){
  return '<div class="item"><div class="t"><span class="st '+esc(x.status)+'">'+(mark[x.status]||"•")+'</span><span>'+esc(x.title)+'</span></div>'+(x.evidence?'<div class="e">'+esc(x.evidence)+'</div>':'')+(fix&&x.fix?'<div class="f"><b>Fix</b> '+esc(x.fix)+'</div>':'')+'</div>';
}
function xray(d){
  var S=d.summary,t=tone(S.quotableShare*1.6);
  var h=head(d,'<div class="url">'+esc(d.url)+'</div>');
  h+='<div class="hero"><div class="ring" style="--p:'+S.quotableShare+';--c:var(--'+t+')"><div><div><b>'+S.quotableShare+'%</b><small>quotable</small></div></div></div><div><h2>'+S.quotable+' of '+S.sentences+' sentences are worth quoting.</h2><div class="sub">'+S.dead+' are dead weight ('+S.deadWordShare+'% of the words). Answer engines lift sentences that stand alone, name their subject and state one specific fact.</div></div></div>';
  h+='<div class="grid"><div class="cat"><b class="pass">'+S.quotable+'</b><span>Quotable</span></div><div class="cat"><b class="warn">'+S.weak+'</b><span>Weak</span></div><div class="cat"><b class="fail">'+S.dead+'</b><span>Dead weight</span></div></div>';
  if(d.best.length)h+='<div class="sec"><p>What an AI would quote</p>'+d.best.map(function(s){return '<div class="item q"><div class="t"><span class="st pass">✓</span><span>“'+esc(s.text)+'”</span></div><div class="e">'+s.score+'/100 · '+esc((s.why||[]).join(", "))+'</div></div>'}).join("")+'</div>';
  if(d.worst.length)h+='<div class="sec"><p>Rewrite these first</p>'+d.worst.map(function(s){return '<div class="item q"><div class="t"><span class="st fail">✕</span><span>“'+esc(s.text)+'”</span></div><div class="e">'+esc((s.why||[]).join("; "))+'</div></div>'}).join("")+'</div>';
  h+=foot(d,'<button class="p" data-ask="Rewrite the weakest sentences from that getcited X-ray so an AI engine would quote them. Keep every fact true.">Rewrite them for me →</button>');
  return h;
}
function arena(d){
  var me=d.standings.filter(function(s){return s.mine})[0],lead=d.standings[0];
  var title=me?(d.gap&&d.gap.won?esc(me.label)+" wins this question.":me.share>0?esc(me.label)+" is in the answer, but "+esc(lead.label)+" leads.":esc(me.label)+" is not cited. "+esc(lead.label)+" takes the answer."):"Who gets cited";
  var h=head(d,'<div class="url">Question: “'+esc(d.question)+'”</div><h2 style="margin-top:10px">'+title+'</h2>');
  h+='<div class="sec"><p>Citation share</p><div class="item">'+d.standings.map(function(s){var col=s.mine?"var(--brand)":"var(--mute)";return '<div class="row"><span class="n'+(s.mine?" me":"")+'">'+esc(s.label)+(s.mine?" (you)":"")+'</span><div class="bar" style="margin:0"><i style="width:'+Math.max(2,Math.round(s.share*100))+'%;background:'+col+'"></i></div><span class="v">'+(s.ok?pct(s.share):"–")+'</span></div>'}).join("")+'</div></div>';
  if(d.gap&&d.gap.advice&&d.gap.advice.length)h+='<div class="sec"><p>How to take the citation</p>'+d.gap.advice.map(function(a){return '<div class="item"><div class="t"><span class="st warn">!</span><span style="font-weight:500">'+esc(a)+'</span></div></div>'}).join("")+'</div>';
  if(d.context.length)h+='<div class="sec"><p>Passages the engine would read</p>'+d.context.slice(0,3).map(function(p){return '<div class="item q"><div class="t"><span class="st '+(p.mine?"pass":"info")+'">'+p.rank+'</span><span>'+esc(p.source)+(p.heading?' · '+esc(p.heading):'')+'</span></div><div class="e">“'+esc(p.text)+'”</div></div>'}).join("")+'</div>';
  h+='<div class="sec"><p>Query fan-out</p><div class="chips">'+d.fanout.map(function(f){return '<span class="chip">'+esc(f)+'</span>'}).join("")+'<span class="chip">'+esc(d.retrieval)+'</span></div></div>';
  h+=foot(d,'<button class="p" data-ask="Write the passage my page needs to win that getcited arena question, using only facts from my page.">Write the winning passage →</button>');
  return h;
}
function render(d){
  if(!d||typeof d!=="object")return;
  if(d.error){app.innerHTML='<div class="top">'+LOGO+'<span>get<span class="b">cited</span></span></div><div class="err">'+esc(d.error)+'</div>';size();return}
  try{app.innerHTML=d.kind==="audit"?audit(d):d.kind==="xray"?xray(d):d.kind==="arena"?arena(d):"";}catch(e){app.innerHTML='<div class="err">Could not draw this result.</div>'}
  size();
}
document.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.dataset.open)open(b.dataset.open);if(b.dataset.ask)ask(b.dataset.ask)});
function theme(t){if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}
window.addEventListener("message",function(ev){
  var m=ev.data;if(!m||m.jsonrpc!=="2.0")return;
  if(m.id!=null&&pending[m.id]){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
  if(m.method==="ui/notifications/tool-result"){var r=m.params||{};render(r.structuredContent||r)}
  if(m.method==="ui/notifications/host-context-changed"&&m.params)theme(m.params.theme);
});
// MCP Apps handshake, retried while the host starts up.
var tries=0;(function hello(){
  request("ui/initialize",{appInfo:{name:"getcited",version:"1.2.0"},appCapabilities:{},protocolVersion:"2026-01-26"})
  .then(function(r){if(r&&r.hostContext)theme(r.hostContext.theme);notify("ui/notifications/initialized",{});size()})
  .catch(function(){if(++tries<5)setTimeout(hello,300*tries)});
})();
// ChatGPT Apps SDK.
function fromOpenAI(){if(window.openai){theme(window.openai.theme);if(window.openai.toolOutput)render(window.openai.toolOutput)}}
window.addEventListener("openai:set_globals",fromOpenAI);fromOpenAI();
if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
})();
</script></body></html>`;
