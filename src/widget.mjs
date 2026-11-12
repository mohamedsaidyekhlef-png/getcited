// The in-chat getcited report card. One self-contained HTML page (no external
// requests) that MCP Apps hosts (Claude, VS Code, Goose…) and ChatGPT render
// next to the answer. It reads the tool's structuredContent and draws the
// audit, X-ray or arena result, with actions: re-run, copy a fix, open the page,
// and hand the next step back to the assistant.

export const WIDGET_URI = "ui://getcited/report.html";
export const WIDGET_URI_OPENAI = "ui://getcited/report-openai.html";

const LOGO = `<svg viewBox="0 0 64 64" width="20" height="20" aria-hidden="true"><defs><linearGradient id="gcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8794FF"/><stop offset="1" stop-color="#5B3FE0"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#gcg)"/><path d="M15 18h34a5 5 0 0 1 5 5v15a5 5 0 0 1-5 5H31l-9 7v-7h-7a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5z" fill="#fff"/><path d="M24 31l5 5 11-11" fill="none" stroke="#5B3FE0" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CSS = `
:root{--bg:#fff;--panel:#fff;--sunk:#F7F8FA;--line:#E7E9EE;--line2:#D9DCE3;--ink:#0F1320;--ink2:#3A4050;--mute:#6B7285;--brand:#5B3FE0;--brandSoft:#EEEBFF;--pass:#12875A;--passSoft:#E6F5EE;--warn:#A86A00;--warnSoft:#FFF4DB;--fail:#C4262E;--failSoft:#FDECEC;--onBrand:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0D1017;--panel:#121621;--sunk:#0F131C;--line:#222838;--line2:#2C3346;--ink:#ECEFF6;--ink2:#C3C8D6;--mute:#8B93A8;--brand:#9AA4FF;--brandSoft:#1D2140;--pass:#3CCB8C;--passSoft:#0F2A20;--warn:#F0B43C;--warnSoft:#2D2410;--fail:#FF6B6B;--failSoft:#331618;--onBrand:#0D1017}}
:root[data-theme=dark]{--bg:#0D1017;--panel:#121621;--sunk:#0F131C;--line:#222838;--line2:#2C3346;--ink:#ECEFF6;--ink2:#C3C8D6;--mute:#8B93A8;--brand:#9AA4FF;--brandSoft:#1D2140;--pass:#3CCB8C;--passSoft:#0F2A20;--warn:#F0B43C;--warnSoft:#2D2410;--fail:#FF6B6B;--failSoft:#331618;--onBrand:#0D1017}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.num{font-variant-numeric:tabular-nums}
.app{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.bar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--line);min-width:0}
.brand{display:flex;align-items:center;gap:7px;font-weight:700;letter-spacing:-.01em;flex:none}.brand i{font-style:normal;color:var(--brand)}
.tool{flex:none;font-size:11px;font-weight:600;color:var(--mute);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.target{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink2);font-size:12.5px}
.acts{display:flex;gap:6px;flex:none}
.btn{font:inherit;font-size:12px;font-weight:600;border-radius:8px;padding:5px 10px;cursor:pointer;border:1px solid var(--line2);background:var(--panel);color:var(--ink);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.btn:hover{background:var(--sunk)}.btn.p{background:var(--brand);border-color:var(--brand);color:var(--onBrand)}.btn.p:hover{filter:brightness(1.07)}
.btn svg{width:13px;height:13px}
.kpis{display:grid;grid-template-columns:auto 1fr;gap:18px;padding:16px 14px;align-items:center;border-bottom:1px solid var(--line)}
.gauge{position:relative;width:96px;height:96px}.gauge svg{transform:rotate(-90deg)}.gauge .v{position:absolute;inset:0;display:grid;place-items:center;text-align:center}
.gauge b{font-size:28px;line-height:1;font-weight:750;letter-spacing:-.02em}.gauge small{display:block;font-size:10.5px;color:var(--mute);font-weight:600;margin-top:3px;text-transform:uppercase;letter-spacing:.06em}
.verdict{font-size:15px;font-weight:700;letter-spacing:-.01em}.meta{color:var(--mute);font-size:12px;margin-top:2px}
.cats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;margin-top:12px}
.cat .h{display:flex;justify-content:space-between;font-size:12px;color:var(--ink2)}.cat .h b{color:var(--ink)}
.track{height:5px;border-radius:5px;background:var(--line);margin-top:4px;overflow:hidden}.track i{display:block;height:100%;border-radius:5px}
.tabs{display:flex;gap:2px;padding:0 10px;border-bottom:1px solid var(--line);overflow-x:auto}
.tab{font:inherit;font-size:12.5px;font-weight:600;color:var(--mute);background:none;border:0;border-bottom:2px solid transparent;padding:10px 8px;cursor:pointer;white-space:nowrap}
.tab[aria-selected=true]{color:var(--ink);border-color:var(--brand)}.tab .c{font-weight:600;color:var(--mute);background:var(--sunk);border-radius:9px;padding:0 6px;margin-left:5px;font-size:11px}
.pane{padding:6px 14px 12px}
table{width:100%;border-collapse:collapse}th{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--mute);font-weight:650;text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
td{padding:9px 6px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}th.r,td.r{text-align:right}
.pill{display:inline-block;font-size:11px;font-weight:650;border-radius:5px;padding:1px 6px;white-space:nowrap}
.pill.pass{background:var(--passSoft);color:var(--pass)}.pill.warn{background:var(--warnSoft);color:var(--warn)}.pill.fail{background:var(--failSoft);color:var(--fail)}.pill.info{background:var(--sunk);color:var(--mute)}
.gain{font-weight:700;color:var(--pass)}
.row{cursor:pointer}.row:hover td{background:var(--sunk)}.chev{color:var(--mute);transition:transform .15s;display:inline-block}.open .chev{transform:rotate(90deg)}
.detail td{background:var(--sunk);padding:10px 12px 12px}.detail p{margin:0 0 6px;color:var(--ink2)}.detail .k{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--mute);font-weight:650;margin:8px 0 3px}
pre{margin:4px 0 0;background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:var(--ink)}
.dim{color:var(--mute)}.sm{font-size:12px}
.foot{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;border-top:1px solid var(--line);background:var(--sunk)}
.foot .src{margin-left:auto;font-size:11px;color:var(--mute)}
.heat{display:flex;flex-wrap:wrap;gap:2px;margin-top:10px}.heat i{width:9px;height:14px;border-radius:2px}
.q{background:var(--pass)}.w{background:var(--warn);opacity:.75}.d{background:var(--fail);opacity:.7}
.legend{display:flex;gap:12px;font-size:11.5px;color:var(--mute);margin-top:8px}.legend span{display:inline-flex;align-items:center;gap:5px}.legend i{width:9px;height:9px;border-radius:2px;display:inline-block}
.share{display:grid;grid-template-columns:minmax(0,1fr) 46%;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)}.share:last-child{border:0}
.share .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.share .n.me{font-weight:700;color:var(--brand)}
.sbar{display:flex;align-items:center;gap:8px}.sbar .track{flex:1;height:8px;margin:0}.sbar b{width:38px;text-align:right}
blockquote{margin:8px 0 0;padding:8px 12px;border-left:3px solid var(--brand);background:var(--sunk);border-radius:0 8px 8px 0;color:var(--ink2)}
.skel{height:12px;border-radius:5px;background:var(--line);margin:10px 14px;animation:pl 1.2s infinite}@keyframes pl{50%{opacity:.45}}
.vs{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px}.ans{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--sunk);min-width:0}.ans.a{border-color:var(--brand);background:var(--panel)}.ans .ah{font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:6px}.ans p{margin:0;color:var(--ink2)}.ans .mine{background:var(--brandSoft);color:var(--ink);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;padding:0 2px}.ans sup{font-size:9.5px;font-weight:700;color:var(--mute);margin-left:1px}.srcs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.srcs span{font-size:11px;color:var(--mute);border:1px solid var(--line);border-radius:6px;padding:1px 6px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.srcs span b{margin-right:4px;color:var(--ink2)}.srcs span.me{color:var(--brand);border-color:var(--brand)}
@media (max-width:520px){.vs{grid-template-columns:1fr}}
.err{padding:14px;color:var(--fail);font-weight:600}
.inp{display:block;width:100%;margin:3px 0 8px;font:inherit;font-size:13px;color:var(--ink);background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:7px 9px}textarea.inp{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.toast{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:var(--ink);color:var(--bg);font-size:12px;font-weight:600;border-radius:8px;padding:6px 12px;opacity:0;transition:opacity .2s;pointer-events:none}.toast.on{opacity:1}
@media (max-width:520px){.kpis{grid-template-columns:1fr;justify-items:start}.cats{grid-template-columns:1fr}.acts .lbl{display:none}.hide-sm{display:none}}
`;

const JS = String.raw`
(function(){
var root=document.getElementById("root"),LOGO=__LOGO__,state={data:null,input:null,tool:null,tab:null,open:{}};
var I={run:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"/></svg>',ext:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h4v4M13 3L7 9M12 9.5V13H3V4h3.5"/></svg>',copy:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10.5V3h7.5"/></svg>',spark:'<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z"/></svg>'};
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function tone(v){return v>=75?"pass":v>=50?"warn":"fail"}
function pct(x){return Math.round((x||0)*100)+"%"}
function when(iso){try{return new Date(iso).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" · "+new Date(iso).toLocaleDateString([],{month:"short",day:"numeric"})}catch(e){return iso}}
function host(u){try{return new URL(u).host.replace(/^www\./,"")}catch(e){return u}}
function shortUrl(u){try{var x=new URL(u);return (x.host.replace(/^www\./,"")+x.pathname).replace(/\/+$/,"")}catch(e){return u}}
var WORD={pass:"Pass",warn:"Warning",fail:"Fail",info:"Note"};
var TOOL={site:"getcited_site",live:"getcited_live",audit:"getcited_audit",xray:"getcited_xray",arena:"getcited_arena",simulate:"getcited_simulate",takeover:"getcited_takeover",vitals:"getcited_vitals",fixkit:"getcited_fixkit"};
var LABEL={site:"Site Explorer",live:"Live AI answers",audit:"Audit",xray:"X-ray",arena:"Citation Arena",simulate:"Rewrite simulator",takeover:"Takeover",vitals:"Core Web Vitals",fixkit:"Fix kit"};

// Host bridge: MCP Apps (Claude, VS Code…) and the ChatGPT Apps SDK.
var nextId=1,pending={};
function post(m){try{window.parent.postMessage(m,"*")}catch(e){}}
function request(method,params,ms){var id=nextId++;post({jsonrpc:"2.0",id:id,method:method,params:params||{}});return new Promise(function(res,rej){pending[id]={res:res,rej:rej};setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},ms||5000)})}
function notify(method,params){post({jsonrpc:"2.0",method:method,params:params||{}})}
var oa=function(){return window.openai||null};
function openLink(url){if(oa()&&oa().openExternal){try{oa().openExternal({href:url});return}catch(e){}}request("ui/open-link",{url:url}).catch(function(){window.open(url,"_blank","noopener")})}
function ask(text){if(oa()&&oa().sendFollowUpMessage){oa().sendFollowUpMessage({prompt:text});toast("Sent to the chat");return}request("ui/message",{role:"user",content:[{type:"text",text:text}]}).then(function(){toast("Sent to the chat")}).catch(function(){copy(text,"Prompt copied: paste it in the chat")})}
function rerun(){
  var d=state.data;if(!d)return;var name=TOOL[d.kind];var args=state.input||(d.kind==="arena"||d.kind==="simulate"||d.kind==="takeover"?null:{url:d.url});
  if(!args){if(d.kind==="simulate"||d.kind==="takeover"){toast("Ask in the chat to test a revised passage");return}state.form=true;render(d);return}
  root.querySelector(".kpis,.pane")&&(root.querySelector(".pane").style.opacity=".5");toast("Re-running live…");
  var p=oa()&&oa().callTool?oa().callTool(name,args):request("tools/call",{name:name,arguments:args},120000);
  Promise.resolve(p).then(function(r){var sc=r&&(r.structuredContent||r);if(sc&&sc.kind)render(sc);else throw 0}).catch(function(){var a=root.querySelector(".pane");if(a)a.style.opacity="";toast("This app can't run tools here. Ask in the chat instead.")});
}
function copy(text,msg){
  var done=function(){toast(msg||"Copied")};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done).catch(fallback)}else fallback();
  function fallback(){var t=document.createElement("textarea");t.value=text;t.style.position="fixed";t.style.opacity="0";document.body.appendChild(t);t.select();try{document.execCommand("copy");done()}catch(e){toast("Select the text to copy it")}t.remove()}
}
var tt;function toast(m){var el=document.getElementById("toast");el.textContent=m;el.className="toast on";clearTimeout(tt);tt=setTimeout(function(){el.className="toast"},1800)}
function size(){notify("ui/notifications/size-changed",{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight});if(oa()&&oa().notifyIntrinsicHeight){try{oa().notifyIntrinsicHeight(document.documentElement.scrollHeight)}catch(e){}}}

function gauge(v,label,sub){
  var r=42,c=2*Math.PI*r,t=tone(v);
  return '<div class="gauge"><svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="'+r+'" fill="none" stroke="var(--line)" stroke-width="8"/>'+(v>0?'<circle cx="48" cy="48" r="'+r+'" fill="none" stroke="var(--'+t+')" stroke-width="8" stroke-linecap="round" stroke-dasharray="'+(c*Math.min(v,100)/100).toFixed(1)+' '+c.toFixed(1)+'"/>':'')+'</svg><div class="v"><div><b class="num">'+esc(label)+'</b><small>'+esc(sub)+'</small></div></div></div>';
}
function track(v,color){return '<div class="track"><i style="width:'+Math.max(2,v)+'%;background:var(--'+(color||tone(v))+')"></i></div>'}
function header(d,target){
  return '<div class="bar"><span class="brand">'+LOGO+'<span>get<i>cited</i></span></span><span class="tool">'+LABEL[d.kind]+'</span><span class="target" title="'+esc(target)+'">'+esc(target)+'</span><span class="acts">'+
  '<button class="btn" data-act="rerun" title="Fetch again and re-score">'+I.run+'<span class="lbl">Re-run</span></button>'+
  (d.url?'<button class="btn hide-sm" data-open="'+esc(d.url)+'" title="Open the page">'+I.ext+'<span class="lbl">Open</span></button>':'')+'</span></div>';
}
function footer(d,primary){
  return '<div class="foot">'+primary+'<span class="src">Live fetch '+esc(when(d.measuredAt))+(d.responseMs!=null?' · '+d.responseMs+' ms':'')+' · <a href="#" data-open="https://www.scairos.com/getcited" style="color:inherit">getcited</a></span></div>';
}
function tabs(list){
  if(!state.tab||!list.some(function(t){return t.id===state.tab}))state.tab=list[0].id;
  return '<div class="tabs" role="tablist">'+list.map(function(t){return '<button class="tab" role="tab" data-tab="'+t.id+'" aria-selected="'+(t.id===state.tab)+'">'+esc(t.label)+(t.count!=null?'<span class="c num">'+t.count+'</span>':'')+'</button>'}).join("")+'</div><div class="pane">'+list.filter(function(t){return t.id===state.tab})[0].html()+'</div>';
}

function code(f){var i=f.indexOf("\n");return i>0&&/:\s*$/.test(f.slice(0,i))?f.slice(i+1):f}
function fixBody(f){var c=code(f);return c===f?(f.indexOf("\n")>=0?'<pre>'+esc(f)+'</pre>':'<p>'+esc(f)+'</p>'):'<p>'+esc(f.slice(0,f.length-c.length).trim())+'</p><pre>'+esc(c)+'</pre>'}
function cap(s){s=String(s||"");return s.charAt(0).toUpperCase()+s.slice(1)}
function arenaForm(mine,q,comps){
  if(!state.form)return '';
  return '<div class="pane" style="border-top:1px solid var(--line);background:var(--sunk)"><div class="k" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--mute);font-weight:650;margin:6px 0">Citation Arena</div>'+
  '<label class="sm dim">Your page</label><input id="fMine" class="inp" value="'+esc(mine)+'" placeholder="https://yoursite.com/page">'+
  '<label class="sm dim">The question your buyers ask</label><input id="fQ" class="inp" value="'+esc(q)+'" placeholder="How much does it cost to sell a structured settlement?">'+
  '<label class="sm dim">Pages that answer it now (one URL per line)</label><textarea id="fC" class="inp" rows="3" placeholder="https://competitor.com/guide">'+esc((comps||[]).join("\n"))+'</textarea>'+
  '<div style="display:flex;gap:6px;margin-top:8px"><button class="btn p" data-act="arena-run">Run the arena</button><button class="btn" data-act="arena-close">Cancel</button></div></div>';
}
function call(name,args){
  var p=oa()&&oa().callTool?oa().callTool(name,args):request("tools/call",{name:name,arguments:args},120000);
  var pane=root.querySelector(".app");if(pane)pane.style.opacity=".55";toast("Running live…");
  return Promise.resolve(p).then(function(r){var sc=r&&(r.structuredContent||r);if(sc&&(sc.kind||sc.error)){state.form=false;state.tab=null;state.open={};state.input=args;render(sc)}else throw 0})
  .catch(function(){if(pane)pane.style.opacity="";toast("This app can't run tools here. Ask in the chat instead.")});
}
function audit(d){
  var s=d.score.overall;
  var verdict=s>=85?"Ready to be cited":s>=70?"Citable, with gaps":s>=50?"At risk of being skipped":"Not citable as it stands";
  var h=header(d,shortUrl(d.url));
  h+='<div class="kpis">'+gauge(s,s,"Grade "+d.score.grade)+'<div style="min-width:0"><div class="verdict">'+verdict+'</div><div class="meta num">'+d.passed+' of '+d.total+' checks pass'+(d.browserStatus?' · HTTP '+d.browserStatus:'')+(d.responseMs!=null?' · '+d.responseMs+' ms':'')+(d.facts&&d.facts.words?' · '+Number(d.facts.words).toLocaleString()+' words in HTML':'')+'</div>'+
  '<div class="cats">'+d.categories.filter(function(c){return c.score!=null}).map(function(c){return '<div class="cat" title="'+esc(c.question)+'"><div class="h"><span>'+esc(c.label)+'</span><b class="num">'+c.score+'</b></div>'+track(c.score)+'</div>'}).join("")+'</div></div></div>';
  var crawl=d.crawlers.filter(function(b){return b.role!=="training"||b.live});
  h+=tabs([
    {id:"fixes",label:"Fixes",count:d.priorities.length,html:function(){
      if(!d.priorities.length)return '<p class="dim" style="padding:10px 0">No open issues on this page.</p>';
      return '<table><thead><tr><th style="width:18px"></th><th>Issue</th><th class="hide-sm">Status</th><th class="r">Gain</th><th class="r hide-sm">Effort</th></tr></thead><tbody>'+d.priorities.map(function(p,i){
        var o=state.open["f"+i];
        return '<tr class="row'+(o?' open':'')+'" data-tog="f'+i+'"><td><span class="chev">›</span></td><td><b>'+esc(p.title)+'</b><div class="dim sm">'+esc(cap(p.category))+'</div></td><td class="hide-sm"><span class="pill '+p.status+'">'+WORD[p.status]+'</span></td><td class="r num gain">+'+p.gain+'</td><td class="r hide-sm num dim">'+esc(p.effort)+'</td></tr>'+
        (o?'<tr class="detail"><td></td><td colspan="4"><div class="k">Evidence</div><p>'+esc(p.evidence)+'</p>'+(p.why?'<div class="k">Why it matters</div><p>'+esc(p.why)+'</p>':'')+(p.fix?'<div class="k">Fix</div>'+fixBody(p.fix)+'<div style="display:flex;gap:6px;margin-top:8px"><button class="btn" data-copy="'+esc(code(p.fix))+'">'+I.copy+'Copy fix</button></div>':'')+'</td></tr>':'');
      }).join("")+'</tbody></table>';
    }},
    {id:"crawlers",label:"AI crawlers",count:crawl.length,html:function(){
      if(!crawl.length)return '<p class="dim" style="padding:10px 0">robots.txt could not be read, so every crawler is treated as allowed.</p>';
      return '<table><thead><tr><th>Crawler</th><th class="hide-sm">Operator</th><th class="hide-sm">Purpose</th><th>robots.txt</th><th>Live request</th></tr></thead><tbody>'+crawl.map(function(b){
        var rob=b.allowed==null?'<span class="pill info">not read</span>':b.allowed?'<span class="pill pass">Allowed</span>':'<span class="pill fail">Blocked</span>';
        var live=b.live?(b.live.blocked?'<span class="pill fail num">'+esc(b.live.status||b.live.error)+' rejected</span>':'<span class="pill pass num">'+esc(b.live.status)+' OK</span>'):'<span class="dim sm" title="Search engines verify these crawlers by IP, so a spoofed request proves nothing">–</span>';
        return '<tr><td><b>'+esc(b.bot)+'</b><div class="dim sm" title="'+esc(b.rule)+'" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(b.rule||"")+'</div></td><td class="hide-sm">'+esc(b.owner)+'</td><td class="hide-sm dim">'+esc(b.role)+'</td><td>'+rob+'</td><td>'+live+'</td></tr>';
      }).join("")+'</tbody></table><p class="dim sm" style="margin:8px 0 0">Live request: the page fetched with each crawler\'s real user agent, compared with a browser'+(d.browserStatus?' ('+d.browserStatus+')':'')+'. Catches CDN and firewall blocks that robots.txt doesn\'t show.</p>';
    }},
    {id:"checks",label:"All checks",count:d.checks.length,html:function(){
      return '<table><tbody>'+d.checks.map(function(c){return '<tr><td style="width:82px"><span class="pill '+c.status+'">'+WORD[c.status]+'</span></td><td><b>'+esc(c.title)+'</b><div class="dim sm">'+esc(c.evidence)+'</div></td></tr>'}).join("")+'</tbody></table>';
    }}
  ]);
  h+=footer(d,'<button class="btn p" data-act="arena-form">'+I.spark+'Who gets cited instead?</button><button class="btn" data-act="xray">X-ray the sentences</button>')+arenaForm(d.url,'');
  return h;
}

function xray(d){
  var S=d.summary,strip=String(d.strip||"");
  var h=header(d,shortUrl(d.url));
  h+='<div class="kpis">'+gauge(S.quotableShare,S.quotableShare+"%","quotable")+'<div style="min-width:0"><div class="verdict num">'+S.quotable+' of '+S.sentences+' sentences are worth quoting</div><div class="meta num">'+S.dead+' dead weight carrying '+S.deadWordShare+'% of the words · average '+S.average+'/100'+(S.firstQuotable>2?' · first quotable is #'+(S.firstQuotable+1):'')+'</div>'+
  (strip?'<div class="heat" title="Every sentence on the page, in order">'+strip.split("").map(function(c){return '<i class="'+c+'"></i>'}).join("")+'</div><div class="legend"><span><i class="q"></i>Quotable '+S.quotable+'</span><span><i class="w"></i>Weak '+S.weak+'</span><span><i class="d"></i>Dead '+S.dead+'</span></div>':'')+'</div></div>';
  h+=tabs([
    {id:"worst",label:"Rewrite first",count:d.worst.length,html:function(){return sentTable(d.worst,"fail","Problem")}},
    {id:"best",label:"Most quotable",count:d.best.length,html:function(){return sentTable(d.best,"pass","Why it works")}}
  ]);
  h+=footer(d,'<button class="btn p" data-act="audit">'+I.spark+'Audit this page</button><button class="btn" data-act="arena-form">Who gets cited instead?</button>')+arenaForm(d.url,'');
  return h;
}
function sentTable(list,t,col){
  return '<table><thead><tr><th>Sentence</th><th class="r">Score</th></tr></thead><tbody>'+list.map(function(s){return '<tr><td>“'+esc(s.text)+'”<div class="sm" style="margin-top:3px;color:var(--'+t+')">'+esc((s.why||[]).join(t==="fail"?"; ":", "))+'</div></td><td class="r num"><b>'+s.score+'</b></td></tr>'}).join("")+'</tbody></table>';
}

function arena(d){
  var me=d.standings.filter(function(s){return s.mine})[0],lead=d.standings[0];
  var verdict=me?(d.gap&&d.gap.won?me.label+" wins this question":me.share>0?me.label+" holds "+pct(me.share)+"; "+lead.label+" leads":me.label+" is not cited"):"Citation share";
  var h=header(d,"“"+d.question+"”");
  var total=d.standings.reduce(function(a,s){return a+(s.passages||0)},0);
  h+='<div class="kpis">'+gauge(Math.round((me?me.share:0)*100),me?pct(me.share):"–","your share")+'<div style="min-width:0"><div class="verdict">'+esc(verdict)+'</div><div class="meta num">'+d.standings.length+' pages · '+total+' passages · '+d.fanout.length+' query variants · '+esc(d.retrieval)+'</div><div style="margin-top:10px">'+
  d.standings.map(function(s){return '<div class="share"><span class="n'+(s.mine?" me":"")+'" title="'+esc(s.url)+'">'+esc(s.label)+(s.mine?" · you":"")+'</span><span class="sbar">'+(s.ok?'<span class="track"><i style="width:'+Math.max(2,Math.round(s.share*100))+'%;background:'+(s.mine?"var(--brand)":"var(--mute)")+'"></i></span><b class="num">'+pct(s.share)+'</b>':'<span class="pill fail">failed to load</span>')+'</span></div>'}).join("")+'</div></div></div>';
  h+=tabs([
    {id:"todo",label:"What to change",count:d.gap&&d.gap.advice?d.gap.advice.length:0,html:function(){
      var a=d.gap&&d.gap.advice||[];if(!a.length)return '<p class="dim" style="padding:10px 0">Your page already holds the top passage for this question.</p>';
      return '<table><tbody>'+a.map(function(x,i){return '<tr><td class="num dim" style="width:22px">'+(i+1)+'</td><td>'+esc(x)+'</td></tr>'}).join("")+'</tbody></table>';
    }},
    {id:"fan",label:"Query fan-out",count:d.fanout.length,html:function(){
      return '<table><thead><tr><th>Variant the engine searches</th><th class="hide-sm">Intent</th><th>Top passage from</th></tr></thead><tbody>'+d.fanout.map(function(f){var mine=me&&f.winner===me.label;return '<tr><td>'+esc(f.q)+'</td><td class="hide-sm dim">'+esc(f.why)+'</td><td><span class="pill '+(mine?"pass":"info")+'">'+esc(f.winner||"none")+'</span></td></tr>'}).join("")+'</tbody></table>';
    }},
    {id:"pass",label:"Passages read",count:d.context.length,html:function(){
      return '<table><tbody>'+d.context.map(function(p){return '<tr><td class="num" style="width:26px"><b>#'+p.rank+'</b></td><td><b'+(p.mine?' style="color:var(--brand)"':'')+'>'+esc(p.source)+'</b>'+(p.heading?' <span class="dim">· '+esc(p.heading)+'</span>':'')+'<blockquote>'+esc(p.text)+'</blockquote></td></tr>'}).join("")+'</tbody></table>';
    }}
  ]);
  h+=footer(d,'<button class="btn p" data-act="arena-form">'+I.spark+'Try another question</button>'+(me?'<button class="btn" data-act="audit" data-url="'+esc(me.url)+'">Audit my page</button>':''))+arenaForm(me?me.url:'',d.question,d.standings.filter(function(s){return !s.mine}).map(function(s){return s.url}));
  return h;
}

function simulate(d){
  var b=Math.round(d.before.share*100),a=Math.round(d.after.share*100),delta=a-b;
  var verdict=d.after.won&&d.after.leads?"This passage takes the citation":d.after.won?"Your passage becomes the #1 passage":d.after.rank&&(!d.before.rank||d.after.rank<d.before.rank)&&delta<=0?"Closer: #"+(d.before.rank||"–")+" → #"+d.after.rank+", not in the answer yet":delta>0?"Share rises, "+d.after.leader+" still leads":"No gain yet";
  var h=header(d,"“"+d.question+"”");
  h+='<div class="kpis">'+gauge(a,a+"%","after")+'<div style="min-width:0"><div class="verdict">'+esc(verdict)+'</div><div class="meta num">Citation share '+b+'% → <b style="color:var(--'+(delta>0?"pass":"fail")+')">'+a+'%</b> · best passage #'+(d.before.rank||"–")+' → #'+(d.after.rank||"–")+' · nothing published</div><div style="margin-top:10px">'+
  d.standings.map(function(s){return '<div class="share"><span class="n'+(s.mine?" me":"")+'" title="'+esc(s.url)+'">'+esc(s.label)+(s.mine?" · you":"")+'</span><span class="sbar" style="display:block"><span class="sbar"><span class="track"><i style="width:'+Math.max(2,Math.round(s.before*100))+'%;background:var(--line2)"></i></span><b class="num dim">'+pct(s.before)+'</b></span><span class="sbar" style="margin-top:3px"><span class="track"><i style="width:'+Math.max(2,Math.round(s.after*100))+'%;background:'+(s.mine?"var(--brand)":"var(--mute)")+'"></i></span><b class="num">'+pct(s.after)+'</b></span></span></div>'}).join("")+
  '<div class="legend"><span><i style="background:var(--line2)"></i>Before</span><span><i style="background:var(--brand)"></i>After, with your passage</span></div></div></div></div>';
  h+=tabs([
    {id:"passage",label:"Your passage",count:d.sentences.length,html:function(){
      return '<p class="sm dim" style="margin:8px 0 4px">Tested under the heading “'+esc(d.heading)+'”, at the top of the page\'s main content.</p><table><tbody>'+d.sentences.map(function(x){var t=x.verdict==="quotable"?"pass":x.verdict==="weak"?"warn":"fail";return '<tr><td>'+esc(x.text)+'<div class="sm" style="margin-top:3px;color:var(--'+t+')">'+esc((x.why||[]).join(", "))+'</div></td><td class="r num" style="width:56px"><span class="pill '+t+'">'+x.score+'</span></td></tr>'}).join("")+'</tbody></table>';
    }},
    {id:"reads",label:"What the engine reads",count:d.context.length,html:function(){
      return '<table><tbody>'+d.context.map(function(p){return '<tr><td class="num" style="width:26px"><b>#'+p.rank+'</b></td><td><b'+(p.mine?' style="color:var(--brand)"':'')+'>'+esc(p.source)+'</b>'+(p.heading?' <span class="dim">· '+esc(p.heading)+'</span>':'')+'<blockquote>'+esc(p.text)+'</blockquote></td></tr>'}).join("")+'</tbody></table>';
    }},
    {id:"gap",label:"To close the gap",count:d.after.won?0:d.advice.length,html:function(){
      if(d.after.won||!d.advice.length)return '<p class="dim" style="padding:10px 0">Nothing left: publish the passage exactly as tested.</p>';
      return '<table><tbody>'+d.advice.map(function(x,i){return '<tr><td class="num dim" style="width:22px">'+(i+1)+'</td><td>'+esc(x)+'</td></tr>'}).join("")+'</tbody></table>';
    }}
  ]);
  h+=footer(d,'<button class="btn p" data-copy="'+esc((d.heading?d.heading+"\n\n":"")+d.passage)+'">'+I.copy+'Copy the tested passage</button><button class="btn" data-act="audit">Audit my page</button>');
  return h;
}
function answerBlock(ans,title,cls){
  if(!ans||!ans.sentences.length)return '<div class="ans '+cls+'"><div class="ah">'+esc(title)+'</div><p class="dim sm">No passage from your page reaches the engine.</p></div>';
  return '<div class="ans '+cls+'"><div class="ah">'+esc(title)+'</div><p>'+ans.sentences.map(function(x){return '<span class="'+(x.mine?"mine":"")+'">'+esc(x.text)+'</span><sup>'+x.cite+'</sup>'}).join(" ")+'</p><div class="srcs">'+ans.sources.map(function(x,i){return '<span class="'+(x.mine?"me":"")+'"><b>'+(i+1)+'</b>'+esc(x.label)+(x.mine?" · you":"")+'</span>'}).join("")+'</div></div>';
}
function takeoverView(d){
  var b=d.before,a=d.after,h=header(d,"“"+d.question+"”");
  var verdict=!a?"Nothing on your page answers this yet":b.leads&&b.rank===1?"You already hold this answer":a.won?"Takeover found: #"+(b.rank||"–")+" → #1":"Closer: #"+(b.rank||"–")+" → #"+(a.rank||"–");
  var sa=a?Math.round(a.share*100):0;
  h+='<div class="kpis">'+gauge(sa,sa+"%","after")+'<div style="min-width:0"><div class="verdict">'+esc(verdict)+'</div><div class="meta num">Citation share '+pct(b.share)+(a?' → <b style="color:var(--'+(a.share>b.share?"pass":"fail")+')">'+pct(a.share)+'</b>':'')+' · '+d.tried.length+' shapes tested'+(d.winner?' · every sentence already on your page':'')+' · nothing published</div></div></div>';
  h+='<div class="vs">'+answerBlock(b.answer,"The answer today","b")+(a?answerBlock(a.answer,"The answer with your passage","a"):'')+'</div><p class="sm dim" style="margin:0;padding:0 14px 10px">Assembled from the top passages by getcited\'s open retriever. A real engine\'s wording will differ.</p>';
  var o=d.offsite||{},tl=[];
  if(d.winner)tl.push({id:"passage",label:"The passage",count:d.winner.sentences.length,html:function(){return '<p class="sm dim" style="margin:8px 0 4px">'+esc(d.winner.shape)+': '+esc(d.winner.note)+' Heading: “'+esc(d.question)+'”.</p><pre>'+esc(d.winner.passage)+'</pre><table style="margin-top:6px"><tbody>'+d.tried.map(function(t){return '<tr><td>'+esc(t.shape)+(t.shape===d.winner.shape?' <span class="pill pass">picked</span>':'')+'</td><td class="r num">#'+(t.rank||"–")+'</td><td class="r num">'+pct(t.share)+'</td></tr>'}).join("")+'</tbody></table>'}});
  if(d.template&&d.template.length)tl.push({id:"tpl",label:"Facts you need",count:d.template.length,html:function(){return '<p class="sm dim" style="margin:8px 0 4px">What the winning passage says that your page doesn\'t. Supply your own real figures.</p><table><tbody>'+d.template.map(function(t){return '<tr><td>'+esc(t)+'</td></tr>'}).join("")+'</tbody></table>'}});
  if(o.authority&&o.authority.length)tl.push({id:"auth",label:"Authority",count:o.authority.length,html:function(){return '<table><thead><tr><th>Domain</th><th class="r">OA</th><th class="r">Ref. domains</th></tr></thead><tbody>'+o.authority.map(function(x,i){return '<tr><td><b'+(i===0?' style="color:var(--brand)"':'')+'>'+esc(x.domain)+(i===0?" · you":"")+'</b></td><td class="r num">'+(x.oa==null?"–":x.oa)+'</td><td class="r num">'+(x.referringDomains==null?"–":Number(x.referringDomains).toLocaleString())+'</td></tr>'}).join("")+'</tbody></table><p class="sm dim">Open Authority from Common Crawl\'s web graph.</p>'}});
  if(o.linkGap&&o.linkGap.domains.length)tl.push({id:"gap",label:"Link gap",count:o.linkGap.domains.length,html:function(){return '<p class="sm dim" style="margin:8px 0 4px">Sites that link to '+esc(o.linkGap.winner)+' but not to you.</p><table><tbody>'+o.linkGap.domains.map(function(x){return '<tr><td><a href="#" data-open="https://'+esc(x.domain)+'" style="color:var(--ink)">'+esc(x.domain)+'</a></td><td class="r num">'+x.oa+'</td></tr>'}).join("")+'</tbody></table>'}});
  if(d.advice&&d.advice.length)tl.push({id:"adv",label:"Next",count:d.advice.length,html:function(){return '<table><tbody>'+d.advice.map(function(x,i){return '<tr><td class="num dim" style="width:22px">'+(i+1)+'</td><td>'+esc(x)+'</td></tr>'}).join("")+'</tbody></table>'}});
  if(tl.length)h+=tabs(tl);
  var ship=d.winner?d.winner.html+'\n<script type="application/ld+json">'+JSON.stringify(d.faq)+'<\/script>':'';
  h+=footer(d,(d.winner?'<button class="btn p" data-copy="'+esc(ship)+'">'+I.copy+'Copy the HTML to ship</button>':'')+'<button class="btn" data-act="audit">Audit my page</button>');
  return h;
}
function vitalsView(d){
  var f=d.page||d.origin,h=header(d,shortUrl(d.url));
  var fm=function(m){return m.unit==="ms"?(m.p75>=1000?(m.p75/1000).toFixed(1)+" s":Math.round(m.p75)+" ms"):m.p75.toFixed(2)};
  var tn=function(r){return r==="good"?"pass":r==="poor"?"fail":"warn"};
  h+='<div class="kpis">'+gauge(d.lab.performance||0,d.lab.performance==null?"–":d.lab.performance,"lab")+'<div style="min-width:0"><div class="verdict">'+(!f?"No field data from real Chrome users":f.passes?"Passes Core Web Vitals":f.passes===false?"Fails Core Web Vitals":"Partial field data")+'</div><div class="meta">'+(f?(d.page?"This page":"Whole origin")+" · real Chrome users, p75, last 28 days · "+esc(d.strategy):"Lab run only")+'</div></div></div>';
  if(f)h+='<div class="pane"><table><thead><tr><th>Metric</th><th class="r">p75</th><th>Rating</th><th class="hide-sm">Good · needs work · poor</th></tr></thead><tbody>'+f.metrics.map(function(m){var ds=m.distribution;return '<tr><td>'+esc(m.label)+'</td><td class="r num"><b>'+fm(m)+'</b></td><td><span class="pill '+tn(m.rating)+'">'+esc(m.rating)+'</span></td><td class="hide-sm"><span class="track" style="display:flex;height:8px">'+(ds.length===3?'<i style="width:'+ds[0]*100+'%;background:var(--pass);border-radius:0"></i><i style="width:'+ds[1]*100+'%;background:var(--warn);border-radius:0"></i><i style="width:'+ds[2]*100+'%;background:var(--fail);border-radius:0"></i>':'')+'</span></td></tr>'}).join("")+'</tbody></table></div>';
  h+=footer(d,'<button class="btn" data-act="audit">Audit the page</button>');
  return h;
}
function fixkit(d){
  var h=header(d,shortUrl(d.url));
  var todos=d.files.reduce(function(a,f){return a+f.todos},0);
  h+='<div class="kpis" style="grid-template-columns:1fr"><div><div class="verdict">'+d.files.length+' fixes, generated from the page as it is now</div><div class="meta">'+(todos?todos+' values getcited could not verify are marked TODO. Fill them with real facts before publishing.':'Every value comes from the page. Review, then paste.')+'</div></div></div>';
  h+=tabs(d.files.map(function(f,i){return {id:"f"+i,label:f.file,count:f.todos||null,html:function(){return '<p class="sm dim" style="margin:8px 0 4px">'+esc(f.note)+'</p><pre>'+esc(f.content)+'</pre><div style="margin-top:8px"><button class="btn p" data-copy="'+esc(f.content)+'">'+I.copy+'Copy '+esc(f.file)+'</button></div>'}}}));
  h+=footer(d,'<button class="btn" data-act="audit">Re-audit the page</button>');
  return h;
}

function siteView(d){
  var y=d.you,all=[y].concat(d.competitors||[]);var n=function(x){return x==null?"–":Number(x).toLocaleString()};
  var h=header({kind:"site",url:"https://"+d.domain,measuredAt:d.builtAt},d.domain);
  h+='<div class="kpis">'+gauge(y.oa||0,y.oa==null?"–":y.oa,"authority")+'<div style="min-width:0"><div class="verdict num">'+(y.oa==null?esc(d.domain)+" is not in the published top domains":n(y.referringDomains)+" referring domains · rank #"+n(y.harmonicRank))+'</div><div class="meta">Common Crawl web graph '+esc(d.release)+' · '+n(d.domainsInGraph)+' domains · open data</div><div style="margin-top:10px">'+
  all.map(function(c){return '<div class="share"><span class="n'+(c===y?" me":"")+'">'+esc(c.domain)+(c===y?" · you":"")+'</span><span class="sbar"><span class="track"><i style="width:'+Math.max(2,c.oa||0)+'%;background:'+(c===y?"var(--brand)":"var(--mute)")+'"></i></span><b class="num">'+(c.oa==null?"–":c.oa)+'</b></span></div>'}).join("")+'</div></div></div>';
  var tl=[{id:"cmp",label:"Comparison",count:all.length,html:function(){return '<table><thead><tr><th>Domain</th><th class="r">OA</th><th class="r">Rank</th><th class="r">Ref. domains</th><th class="r hide-sm">PageRank #</th></tr></thead><tbody>'+all.map(function(c){return '<tr><td><b'+(c===y?' style="color:var(--brand)"':'')+'>'+esc(c.domain)+'</b></td><td class="r num"><b>'+(c.oa==null?"–":c.oa)+'</b></td><td class="r num">'+(c.harmonicRank?"#"+n(c.harmonicRank):"–")+'</td><td class="r num">'+n(c.referringDomains)+'</td><td class="r num hide-sm">'+(c.pagerankRank?"#"+n(c.pagerankRank):"–")+'</td></tr>'}).join("")+'</tbody></table>'}}];
  if(d.referring)tl.push({id:"refs",label:"Referring domains",count:d.referring.total,html:function(){return '<table><thead><tr><th>Referring domain</th><th class="r">OA</th></tr></thead><tbody>'+d.referring.top.map(function(x){return '<tr><td><a href="#" data-open="https://'+esc(x.domain)+'" style="color:var(--ink)">'+esc(x.domain)+'</a></td><td class="r num">'+x.oa+'</td></tr>'}).join("")+'</tbody></table>'}});
  h+=tabs(tl);
  h+=footer({measuredAt:d.builtAt},'<button class="btn" data-act="audit" data-url="https://'+esc(d.domain)+'">Audit the site</button>');
  return h;
}

function liveView(d){
  var me=d.shareOfVoice.filter(function(s){return s.own})[0];
  var h=header({kind:"live",measuredAt:d.measuredAt},d.collected+" real answers · "+d.engines.join(", "));
  var share=me&&me.of?Math.round(me.mentioned/me.of*100):0;
  h+='<div class="kpis">'+gauge(share,share+"%","named")+'<div style="min-width:0"><div class="verdict">'+(me?esc(me.brand)+' named in '+me.mentioned+' of '+me.of+' real answers':'Real answers')+'</div><div class="meta num">'+esc(d.engines.join(", "))+' · market '+esc(d.market)+' · cost $'+d.costUsd+'</div><div style="margin-top:10px">'+
  d.shareOfVoice.map(function(s){var v=s.of?s.mentioned/s.of:0;return '<div class="share"><span class="n'+(s.own?" me":"")+'">'+esc(s.brand)+(s.own?" · you":"")+'</span><span class="sbar"><span class="track"><i style="width:'+Math.max(2,Math.round(v*100))+'%;background:'+(s.own?"var(--brand)":"var(--mute)")+'"></i></span><b class="num">'+s.mentioned+'/'+s.of+'</b></span></div>'}).join("")+'</div></div></div>';
  h+=tabs([
    {id:"src",label:"Cited sources",count:d.sources.length,html:function(){return '<table><thead><tr><th>Source</th><th>Type</th><th class="r">Citations</th><th class="r hide-sm">Engines</th></tr></thead><tbody>'+d.sources.map(function(x){return '<tr><td><b>'+esc(x.domain)+'</b></td><td><span class="pill '+(x.type==="own"?"pass":x.type==="competitor"?"fail":"info")+'">'+esc(x.type)+'</span></td><td class="r num">'+x.citations+'</td><td class="r num hide-sm">'+x.engines+'</td></tr>'}).join("")+'</tbody></table>'}},
    {id:"why",label:"Why they win",count:d.winners.length,html:function(){return d.winners.length?'<table><tbody>'+d.winners.map(function(w){var p=w.passages[0];return '<tr><td><b>'+esc(w.domain)+'</b> <span class="dim sm">'+esc(w.type)+' · '+w.n+' citations</span><blockquote>'+(p.heading?'<b>'+esc(p.heading)+'</b>: ':'')+esc(p.text)+'</blockquote></td></tr>'}).join("")+'</tbody></table>':'<p class="dim" style="padding:10px 0">The cited pages could not be read.</p>'}},
    {id:"place",label:"Where to get placed",count:d.opportunities.length,html:function(){return d.opportunities.length?'<table><tbody>'+d.opportunities.map(function(o){return '<tr><td><a href="#" data-open="'+esc(o.url)+'" style="color:var(--ink);font-weight:600">'+esc(o.domain)+'</a><div class="dim sm" style="word-break:break-all">'+esc(o.url)+'</div></td><td><span class="pill info">'+esc(o.type)+'</span></td><td class="r num">'+o.answers+' answers</td></tr>'}).join("")+'</tbody></table>':'<p class="dim" style="padding:10px 0">No gaps: no answer named a competitor without you.</p>'}},
    {id:"ans",label:"The answers",count:d.answers.length,html:function(){return '<table><tbody>'+d.answers.map(function(a){return '<tr><td><b>'+esc(a.engine)+'</b> <span class="dim sm">'+esc(a.prompt)+'</span><div class="sm" style="margin-top:4px">Names: '+esc(a.named.join(", ")||"none of the tracked brands")+(a.newNames.length?' · also '+esc(a.newNames.join(", ")):'')+'</div><blockquote>'+esc(a.excerpt)+'</blockquote></td></tr>'}).join("")+'</tbody></table>'}}
  ]);
  h+=footer({measuredAt:d.measuredAt},'');
  return h;
}

function render(d){
  if(!d||typeof d!=="object")return;
  state.data=d;
  if(d.kind==="error"||d.error){root.innerHTML='<div class="app"><div class="bar"><span class="brand">'+LOGO+'<span>get<i>cited</i></span></span></div><div class="err">'+esc(d.error)+'</div></div>';size();return}
  try{root.innerHTML='<div class="app">'+(d.kind==="audit"?audit(d):d.kind==="xray"?xray(d):d.kind==="arena"?arena(d):d.kind==="live"?liveView(d):d.kind==="site"?siteView(d):d.kind==="simulate"?simulate(d):d.kind==="takeover"?takeoverView(d):d.kind==="vitals"?vitalsView(d):d.kind==="fixkit"?fixkit(d):"")+'</div>'}catch(e){root.innerHTML='<div class="err">Could not draw this result.</div>'}
  size();
}
document.addEventListener("click",function(e){
  var t=e.target.closest("[data-tab],[data-tog],[data-open],[data-ask],[data-copy],[data-act]");if(!t)return;e.preventDefault();
  if(t.dataset.tab){state.tab=t.dataset.tab;render(state.data)}
  else if(t.dataset.tog){state.open[t.dataset.tog]=!state.open[t.dataset.tog];render(state.data)}
  else if(t.dataset.open)openLink(t.dataset.open);
  else if(t.dataset.copy)copy(t.dataset.copy);
  else if(t.dataset.ask)ask(t.dataset.ask);
  else if(t.dataset.act==="rerun")rerun();
  else if(t.dataset.act==="xray")call("getcited_xray",{url:state.data.url});
  else if(t.dataset.act==="audit")call("getcited_audit",{url:t.dataset.url||state.data.url});
  else if(t.dataset.act==="arena-form"){state.form=true;render(state.data);var q=document.getElementById("fQ");if(q)q.focus()}
  else if(t.dataset.act==="arena-close"){state.form=false;render(state.data)}
  else if(t.dataset.act==="arena-run"){
    var mine=document.getElementById("fMine").value.trim(),q=document.getElementById("fQ").value.trim(),c=document.getElementById("fC").value.split(/\s+/).filter(Boolean).slice(0,6);
    if(!mine||!q||!c.length){toast("Add your page, the question and at least one page that answers it");return}
    call("getcited_arena",{question:q,mine:mine,competitors:c});
  }
});
function theme(t){if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}
window.addEventListener("message",function(ev){
  var m=ev.data;if(!m||m.jsonrpc!=="2.0")return;
  if(m.id!=null&&pending[m.id]){var p=pending[m.id];delete pending[m.id];m.error?p.rej(m.error):p.res(m.result);return}
  if(m.method==="ui/notifications/tool-input"&&m.params)state.input=m.params.arguments||null;
  if(m.method==="ui/notifications/tool-result"){var r=m.params||{};render(r.structuredContent||r)}
  if(m.method==="ui/notifications/host-context-changed"&&m.params)theme(m.params.theme);
});
var tries=0;(function hello(){
  request("ui/initialize",{appInfo:{name:"getcited",version:"1.2.0"},appCapabilities:{},protocolVersion:"2026-01-26"})
  .then(function(r){if(r&&r.hostContext)theme(r.hostContext.theme);notify("ui/notifications/initialized",{});size()})
  .catch(function(){if(++tries<5)setTimeout(hello,300*tries)});
})();
function fromOpenAI(){var o=oa();if(!o)return;theme(o.theme);if(o.toolInput)state.input=o.toolInput;if(o.toolOutput&&o.toolOutput.kind&&o.toolOutput!==state.data)render(o.toolOutput)}
window.addEventListener("openai:set_globals",fromOpenAI);fromOpenAI();
if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
})();
`.replace("__LOGO__", JSON.stringify(LOGO));

export const WIDGET_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>getcited report</title><style>${CSS}</style></head>
<body><div id="root"><div class="app"><div class="bar"><span class="brand">${LOGO}<span>get<i>cited</i></span></span><span class="target">Fetching live…</span></div><div class="skel" style="width:55%"></div><div class="skel" style="width:80%"></div><div class="skel" style="width:35%;margin-bottom:16px"></div></div></div><div id="toast" class="toast"></div>
<script>${JS}</script></body></html>`;
