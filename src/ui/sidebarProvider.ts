import * as vscode from 'vscode';
import { GnanaSession } from '../agents/sessionManager';

export class GnanaSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gnana.sidebarView';
    private _view?: vscode.WebviewView;
    private _onMessage: (msg: any) => void;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        onMessage: (msg: any) => void
    ) {
        this._onMessage = onMessage;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this._getHtml();
        webviewView.webview.onDidReceiveMessage((msg: any) => this._onMessage(msg));
    }

    syncState(session: GnanaSession | null): void {
        this._view?.webview.postMessage({ type: 'state_sync', session });
    }

    postMessage(msg: any): void {
        this._view?.webview.postMessage(msg);
    }

    private _getHtml(): string {
        return /*html*/`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}

:root {
  --bg: var(--vscode-sideBar-background);
  --fg: var(--vscode-foreground);
  --fg2: var(--vscode-descriptionForeground);
  --input-bg: var(--vscode-input-background);
  --input-fg: var(--vscode-input-foreground);
  --input-border: var(--vscode-input-border);
  --card: var(--vscode-editor-background);
  --border: var(--vscode-panel-border);
  --focus: var(--vscode-focusBorder);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --badge-bg: var(--vscode-badge-background);
  --badge-fg: var(--vscode-badge-foreground);
  --error: var(--vscode-errorForeground, #f44);
  --success: #3fb950;
  --warn: #d29922;
}

body {
  font-family: var(--vscode-font-family);
  font-size: 12px;
  color: var(--fg);
  background: var(--bg);
  line-height: 1.45;
}

::-webkit-scrollbar { width: 6px }
::-webkit-scrollbar-track { background: transparent }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px }

/* ── Buttons ── */
button {
  cursor: pointer;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: inherit;
  transition: opacity .12s;
}
button:hover { opacity: .85 }

.btn-primary { background: var(--btn-bg); color: var(--btn-fg) }
.btn-ghost {
  background: transparent;
  color: var(--fg2);
  border: 1px solid var(--border);
  padding: 5px 11px;
}
.btn-ghost:hover { color: var(--fg); border-color: var(--fg2) }
.btn-danger { background: var(--error); color: #fff }
.btn-sm { padding: 3px 8px; font-size: 11px }
.btn-block { width: 100% }

/* ── Inputs ── */
input, textarea {
  background: var(--input-bg);
  color: var(--input-fg);
  border: 1px solid var(--input-border);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  outline: none;
  transition: border-color .12s;
}
input:focus, textarea:focus { border-color: var(--focus) }

/* ── Layout ── */
.setup {
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-height: 85vh;
  padding: 24px 20px;
  gap: 12px;
}
.setup-brand {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--fg);
  margin-bottom: 2px;
}
.setup-sub {
  font-size: 11px;
  color: var(--fg2);
  margin-bottom: 12px;
  line-height: 1.5;
}
.sep {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--fg2);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .8px;
  margin: 6px 0;
}
.sep::before, .sep::after { content:''; flex:1; height:1px; background:var(--border) }

/* ── Session bar ── */
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
}
.bar-role {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .6px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--badge-bg);
  color: var(--badge-fg);
}
.bar-addr {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 10px;
  color: var(--fg2);
}
.bar-spacer { flex:1 }
.bar-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--success);
}

/* ── Tabs ── */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
}
.tab {
  flex: 1;
  padding: 8px 0;
  text-align: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--fg2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all .12s;
}
.tab:hover { color: var(--fg) }
.tab.on { color: var(--fg); border-bottom-color: var(--btn-bg) }

/* ── King/Chat panel ── */
.chat-wrap { display: flex; flex-direction: column; height: calc(100vh - 82px) }
.chat-scroll { flex:1; overflow-y:auto; padding:12px }
.chat-empty {
  padding: 16px;
  font-size: 11px;
  color: var(--fg2);
  line-height: 1.6;
}
.chat-empty dt { font-weight: 600; color: var(--fg); margin-top: 8px }
.chat-empty dd { margin-left: 0; margin-bottom: 4px; color: var(--fg2) }
.chat-empty code {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  background: var(--input-bg);
  padding: 1px 5px;
  border-radius: 3px;
}
.msg {
  max-width: 90%;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 8px;
  word-break: break-word;
}
.msg-out { margin-left: auto; background: var(--btn-bg); color: var(--btn-fg); border-bottom-right-radius: 2px }
.msg-in {
  background: var(--card);
  border: 1px solid var(--border);
  border-bottom-left-radius: 2px;
  white-space: pre-wrap;
  font-family: var(--vscode-editor-font-family, monospace);
}
.msg-sys { text-align: center; color: var(--fg2); font-size: 10px; font-style: italic; background: none }
.chat-bar {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
}
.chat-bar textarea { resize:none; min-height:32px; max-height:100px; flex:1 }

/* ── Tasks panel ── */
.tasks-wrap { padding:12px; overflow-y:auto; height:calc(100vh - 82px) }
.col-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--fg2);
  text-transform: uppercase;
  letter-spacing: .5px;
  margin-top: 12px;
}
.col-head:first-child { margin-top: 0 }
.col-pip { width:8px; height:8px; border-radius:2px }
.col-n {
  margin-left: auto;
  font-size: 10px;
  font-weight: 400;
  color: var(--fg2);
}
.tcard {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 4px 0;
  transition: border-color .12s;
}
.tcard:hover { border-color: var(--fg2) }
.tcard-title { font-size: 12px; font-weight: 500 }
.tcard-owner { font-size: 10px; color: var(--fg2); margin-top: 2px }
.tcard-actions { display:flex; gap:4px; margin-top:6px; flex-wrap:wrap }
.add-form {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ── Feed panel ── */
.feed-wrap { padding:12px; overflow-y:auto; height:calc(100vh - 82px) }
.post-row { display:flex; gap:6px; margin-bottom:10px }
.post-row input { flex:1 }
.fi {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-left: 2px solid var(--border);
  font-size: 12px;
}
.fi[data-t=task_update] { border-left-color: var(--success) }
.fi[data-t=review_request] { border-left-color: var(--warn) }
.fi[data-t=review_response] { border-left-color: var(--success) }
.fi[data-t=message] { border-left-color: var(--btn-bg) }
.fi-top { display:flex; align-items:center; gap:6px; margin-bottom:3px }
.fi-who { font-weight:600; font-size:11px }
.fi-type {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: .3px;
  background: var(--input-bg);
  color: var(--fg2);
}
.fi-when { margin-left:auto; font-size:10px; color:var(--fg2) }
.fi-body { font-size:12px; color:var(--fg); line-height:1.4 }

/* ── Team panel ── */
.team-wrap { padding:12px; overflow-y:auto; height:calc(100vh - 82px) }
.section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .6px;
  color: var(--fg2);
  margin: 12px 0 6px;
}
.section-title:first-child { margin-top: 0 }
.mcard {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-bottom: 4px;
}
.avatar {
  width: 28px; height: 28px;
  border-radius: 4px;
  background: var(--badge-bg);
  color: var(--badge-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
}
.minfo { flex:1 }
.mname { font-size:12px; font-weight:500 }
.mrole { font-size:10px; color:var(--fg2) }
.rcard {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 10px;
  margin-bottom: 6px;
}
.rcard-top { display:flex; align-items:center; gap:6px; margin-bottom:6px }
.rcard-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
}
.rb-ok { background: var(--success); color: #fff }
.rb-nw { background: var(--warn); color: #000 }
.rb-rej { background: var(--error); color: #fff }
.rcard-body {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  white-space: pre-wrap;
  max-height: 160px;
  overflow-y: auto;
  line-height: 1.5;
  color: var(--fg2);
}
.empty-msg { font-size:11px; color:var(--fg2); padding:8px 0 }

/* ── Share panel ── */
.share {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 10px;
}
.share-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .6px;
  color: var(--fg2);
  margin-bottom: 8px;
}
.share-addr {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 3px;
  padding: 6px 10px;
  margin-bottom: 8px;
  word-break: break-all;
  line-height: 1.5;
}
.share-note {
  font-size: 10px;
  color: var(--fg2);
  line-height: 1.5;
  margin-top: 6px;
}
</style></head>
<body><div id="app"></div>
<script>
(function(){
const vscode=acquireVsCodeApi();
let S={session:null,tab:'king',showAdd:false,tunnel:{status:'idle',url:null,error:null}};
const $=id=>document.getElementById(id);
const app=document.getElementById('app');

function ago(ts){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60)return s+'s ago';
  const m=Math.floor(s/60);if(m<60)return m+'m ago';
  const h=Math.floor(m/60);return h<24?h+'h ago':Math.floor(h/24)+'d ago';
}
function e(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'):''}

function render(){
  if(!S.session){app.innerHTML=setupView();bindSetup();return}
  app.innerHTML=barView(S.session)+tabsView()+panelView(S.session);
  bindAll()
}

// ── Setup ──
function setupView(){
  return '<div class="setup">'+
    '<div class="setup-brand">Gnana</div>'+
    '<div class="setup-sub">Collaborative coding for Antigravity agents. Connect multiple machines under one orchestrator.</div>'+
    '<button class="btn-primary btn-block" id="startBtn" style="padding:10px;font-weight:600">Start as King</button>'+
    '<div class="sep"><span>join existing</span></div>'+
    '<div style="display:flex;gap:6px"><input id="hostIn" placeholder="King IP" style="flex:2"/><input id="portIn" placeholder="9777" style="flex:1"/></div>'+
    '<input id="secretIn" placeholder="Session secret" style="font-family:var(--vscode-editor-font-family,monospace);font-size:11px"/>'+
    '<button class="btn-ghost btn-block" id="joinBtn">Connect</button>'+
    '<button class="btn-ghost btn-sm" id="setBtn" style="align-self:center;margin-top:4px">Settings</button></div>'
}
function bindSetup(){
  const sb=$('startBtn'),jb=$('joinBtn'),st=$('setBtn');
  if(sb)sb.onclick=()=>vscode.postMessage({type:'start_king'});
  if(jb)jb.onclick=()=>{
    const h=$('hostIn'),p=$('portIn'),s=$('secretIn');
    if(h&&h.value&&s&&s.value)vscode.postMessage({type:'join_session',host:h.value.trim(),port:(p&&p.value.trim())||'9777',secret:s.value.trim()});
    else if(!s||!s.value){alert('Session secret is required')}
  };
  if(st)st.onclick=()=>vscode.postMessage({type:'open_settings'})
}

// ── Bar ──
function barView(s){
  const role=s.isKing?'KING':'AGENT';
  const addr=s.serverAddress?'<span class="bar-addr">'+e(s.serverAddress)+'</span>':'';
  return '<div class="bar">'+
    '<span class="bar-role">'+role+'</span>'+
    '<span>'+e(s.agentName)+'</span>'+
    addr+
    '<span class="bar-dot"></span>'+
    '<span class="bar-spacer"></span>'+
    '<button class="btn-ghost btn-sm" id="cpBtn" title="Copy connection info">Copy</button>'+
    '<button class="btn-danger btn-sm" id="dcBtn">End</button></div>'
}

// ── Tabs ──
function tabsView(){
  const items=[['king','Orchestrate'],['tasks','Tasks'],['feed','Feed'],['team','Team']];
  return '<div class="tabs">'+items.map(([k,l])=>
    '<div class="tab'+(S.tab===k?' on':'')+'" data-tab="'+k+'">'+l+'</div>'
  ).join('')+'</div>'
}

// ── Panels ──
function panelView(s){
  if(S.tab==='king')return kingView(s);
  if(S.tab==='tasks')return tasksView(s);
  if(S.tab==='feed')return feedView(s);
  if(S.tab==='team')return teamView(s);
  return ''
}

function kingView(s){
  const chat=s.kingChatLog||[];
  let h='<div class="chat-wrap"><div class="chat-scroll" id="chatScroll">';

  // Share panel for King
  if(s.isKing){
    h+='<div class="share" style="margin:12px">';
    h+='<div class="share-title">Invite teammates</div>';
    h+='<div class="share-addr">'+e(s.serverAddress||'Starting...')+'</div>';
    h+='<button class="btn-primary btn-block" id="shareBtn">Copy connection info</button>';

    // Tunnel section
    h+='<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">';
    h+='<div class="share-title">Internet access (ngrok)</div>';
    if(S.tunnel.status==='idle'||S.tunnel.status==='disconnected'||S.tunnel.status==='error'){
      h+='<button class="btn-ghost btn-block" id="tunnelBtn">Share over internet</button>';
      if(S.tunnel.status==='error'){
        h+='<div style="font-size:10px;color:var(--error);margin-top:4px">'+e(S.tunnel.error||'Tunnel failed')+'</div>';
      }
    } else if(S.tunnel.status==='connecting'){
      h+='<div style="font-size:11px;color:var(--fg2)">Connecting tunnel...</div>';
    } else if(S.tunnel.status==='connected'){
      h+='<div class="share-addr" style="border-color:var(--success)">'+e(S.tunnel.url||'')+'</div>';
      h+='<button class="btn-ghost btn-block btn-sm" id="tunnelStopBtn" style="color:var(--error)">Stop tunnel</button>';
    }
    h+='<div class="share-note">Requires <a href="https://ngrok.com/download" style="color:var(--btn-bg)">ngrok</a> CLI installed. Set auth token in Settings.</div>';
    h+='</div>';

    h+='</div>';
  }

  if(!chat.length){
    h+='<div class="chat-empty">';
    if(!s.isKing){
      h+='<p>Connected to King. Waiting for instructions.</p>';
    } else {
      h+='<p>Use the API or chat below to orchestrate your team.</p>'+
        '<dl>'+
        '<dt>Post messages</dt><dd><code>POST /api/chat</code></dd>'+
        '<dt>Send reviews</dt><dd><code>POST /api/review</code></dd>'+
        '<dt>Create tasks</dt><dd><code>POST /api/task</code></dd>'+
        '<dt>Session info</dt><dd><code>GET /api/status</code></dd>'+
        '</dl>'+
        '<p style="margin-top:12px;font-size:10px;color:var(--fg2)">API: <code>127.0.0.1:9778</code></p>';
    }
    h+='</div>';
  }

  for(const m of chat){
    const cls=m.role==='king'?'msg msg-in':(m.role==='user'?'msg msg-out':'msg msg-sys');
    h+='<div class="'+cls+'">'+e(m.content)+'</div>';
  }
  h+='</div>';
  h+='<div class="chat-bar"><textarea id="chatIn" rows="1" placeholder="Message..."></textarea><button class="btn-primary btn-sm" id="chatSend">Send</button></div></div>';
  return h
}

function tasksView(s){
  const cols=[
    {k:'todo',l:'Todo',c:'var(--fg2)'},
    {k:'in_progress',l:'In Progress',c:'var(--btn-bg)'},
    {k:'in_review',l:'In Review',c:'var(--warn)'},
    {k:'done',l:'Done',c:'var(--success)'},
    {k:'blocked',l:'Blocked',c:'var(--error)'}
  ];
  const sts=['todo','in_progress','in_review','done','blocked'];
  let h='<div class="tasks-wrap">';
  for(const col of cols){
    const tasks=(s.tasks||[]).filter(t=>t.status===col.k);
    h+='<div class="col-head"><span class="col-pip" style="background:'+col.c+'"></span>'+col.l+'<span class="col-n">'+tasks.length+'</span></div>';
    for(const t of tasks){
      const acts=sts.filter(x=>x!==t.status).map(x=>
        '<button class="btn-ghost btn-sm tmv" data-id="'+e(t.id)+'" data-s="'+x+'">'+x.replace(/_/g,' ')+'</button>'
      ).join('');
      h+='<div class="tcard"><div class="tcard-title">'+e(t.title)+'</div><div class="tcard-owner">'+e(t.owner)+'</div><div class="tcard-actions">'+acts+'</div></div>'
    }
  }
  h+='<button class="btn-ghost btn-block" id="togAdd" style="margin-top:8px">Add task</button>';
  if(S.showAdd)h+='<div class="add-form"><input id="nTitle" placeholder="Title"/><input id="nOwner" placeholder="Owner"/><input id="nDesc" placeholder="Description"/><button class="btn-primary" id="addBtn">Create</button></div>';
  return h+'</div>'
}

function feedView(s){
  let h='<div class="feed-wrap"><div class="post-row"><input id="postIn" placeholder="Post an update..."/><button class="btn-primary btn-sm" id="postBtn">Post</button></div>';
  const items=[...(s.liveFeed||[])].reverse();
  if(!items.length) h+='<div class="empty-msg">No activity yet.</div>';
  for(const f of items){
    h+='<div class="fi" data-t="'+e(f.type)+'">'+
      '<div class="fi-top"><span class="fi-who">'+e(f.agentName)+'</span><span class="fi-type">'+e(f.type)+'</span><span class="fi-when">'+ago(f.timestamp)+'</span></div>'+
      '<div class="fi-body">'+e(f.content)+'</div></div>';
  }
  return h+'</div>'
}

function teamView(s){
  let h='<div class="team-wrap"><div class="section-title">Members</div>';
  for(const m of(s.team||[])){
    const dot='<span class="bar-dot" style="width:5px;height:5px;'+(m.connected?'':'background:var(--fg2);opacity:.4')+'"></span>';
    h+='<div class="mcard"><div class="avatar">'+e((m.name||'?')[0].toUpperCase())+'</div><div class="minfo"><div class="mname">'+e(m.name)+'</div><div class="mrole">'+e(m.role)+'</div></div>'+dot+'</div>'
  }
  h+='<div class="section-title">Reviews</div>';
  const rv=(s.kingMessages||[]).slice().reverse();
  if(!rv.length) h+='<div class="empty-msg">No reviews yet.</div>';
  for(const r of rv){
    let bc='rb-nw',lb='REVIEW';
    if(r.content.includes('APPROVED')){bc='rb-ok';lb='APPROVED'}
    else if(r.content.includes('REJECTED')){bc='rb-rej';lb='REJECTED'}
    else if(r.content.includes('NEEDS WORK')){bc='rb-nw';lb='NEEDS WORK'}
    h+='<div class="rcard"><div class="rcard-top"><span class="fi-who">To: '+e(r.to)+'</span><span class="rcard-badge '+bc+'">'+lb+'</span><span class="fi-when">'+ago(r.timestamp)+'</span></div><div class="rcard-body">'+e(r.content)+'</div></div>'
  }
  return h+'</div>'
}

// ── Bindings ──
function bindAll(){
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{S.tab=t.getAttribute('data-tab')||'king';render()}));
  const dc=$('dcBtn');if(dc)dc.onclick=()=>vscode.postMessage({type:'disconnect'});
  const cp=$('cpBtn');if(cp)cp.onclick=()=>vscode.postMessage({type:'copy_info'});
  const sh=$('shareBtn');if(sh)sh.onclick=()=>vscode.postMessage({type:'copy_info'});
  const tn=$('tunnelBtn');if(tn)tn.onclick=()=>vscode.postMessage({type:'start_tunnel'});
  const ts=$('tunnelStopBtn');if(ts)ts.onclick=()=>vscode.postMessage({type:'stop_tunnel'});

  const ci=$('chatIn'),cs=$('chatSend');
  if(ci&&cs){
    cs.onclick=()=>{const t=ci.value.trim();if(t){vscode.postMessage({type:'post_chat',content:t});ci.value=''}};
    ci.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){ev.preventDefault();cs.click()}})
  }
  const cm=$('chatScroll');if(cm)cm.scrollTop=cm.scrollHeight;

  document.querySelectorAll('.tmv').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:'update_task_status',taskId:b.getAttribute('data-id'),status:b.getAttribute('data-s')})));
  const ta=$('togAdd');if(ta)ta.onclick=()=>{S.showAdd=!S.showAdd;render()};
  const ab=$('addBtn');if(ab)ab.onclick=()=>{
    const t=$('nTitle'),o=$('nOwner'),d=$('nDesc');
    if(t&&t.value.trim()){
      vscode.postMessage({type:'add_task',title:t.value.trim(),owner:o?o.value.trim():'',description:d?d.value.trim():''});
      S.showAdd=false;render()
    }
  };
  const pb=$('postBtn'),pi=$('postIn');
  if(pb&&pi)pb.onclick=()=>{if(pi.value.trim()){vscode.postMessage({type:'send_agent_update',text:pi.value.trim(),updateType:'status'});pi.value=''}}
}

// ── Messages ──
window.addEventListener('message',ev=>{
  const m=ev.data;
  if(m.type==='state_sync'){S.session=m.session;render()}
  else if(m.type==='session_started'){
    S.session={isKing:m.isKing,agentName:m.agentName,agentRole:m.agentRole||'',serverAddress:m.address,team:[],tasks:[],liveFeed:[],kingMessages:[],kingChatLog:[]};
    render()
  }
  else if(m.type==='tunnel_status'){
    S.tunnel={status:m.status,url:m.url||null,error:m.error||null};
    render()
  }
  else if(m.type==='error'){
    if(S.session&&S.session.kingChatLog){
      S.session.kingChatLog.push({role:'system',content:'Error: '+m.text,timestamp:Date.now()});
    }
    render()
  }
});
render()
})();
</script></body></html>`;
    }
}
