#!/usr/bin/env node
// Matches the deployed kanehack 0.1.3 JSON MCP transport; never prints its credentials.
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
const a=process.argv.slice(2), mode=a[0], name=a[1];
const readOnly=new Set(['event_get_brief','participant_get_status','activation_get_checkpoint','team_find','help_get_status','submission_preflight','showcase_preview','deck_get','harness_get_capabilities','get_github_repo_status','eligibility_get','showcase_share_preview','milestones_list','telemetry_get_status','public_builder_get','public_ship_get','public_builder_preview']);
let credential='';
const scrub=x=>{
 if(typeof x==='string'&&/^[{[]/.test(x.trim())) {try{return JSON.stringify(scrub(JSON.parse(x)));}catch{}}
 if(typeof x==='string') return x.replaceAll(credential||'\u0000','[redacted]').replace(/khk_[A-Za-z0-9_-]+/g,'[redacted]').replace(/Bearer\s+[^\s"<>]+/gi,'Bearer [redacted]');
 if(Array.isArray(x)) return x.map(scrub);
 if(x&&typeof x==='object') return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,/token|secret|password|authorization|device_code|poll_token/i.test(k)?'[redacted]':scrub(v)]));
 return x;
};
try {
 if(!['list','call'].includes(mode)) throw new Error('Use list OR call TOOL --args PRIVATE_JSON [--confirmed]');
 let c={}; try{c=JSON.parse(readFileSync(join(homedir(),'.kanehack/config.json'),'utf8'));}catch{}
 const base=new URL(process.env.KANEHACK_API||c.api||'https://www.kaneclihack.sh');
 const trusted=u=>u.protocol==='https:'&&['kaneclihack.sh','www.kaneclihack.sh'].includes(u.hostname)&&!u.port&&!u.username&&!u.password;
 if(!trusted(base)) throw new Error('Untrusted API origin; use native configured MCP for organizer-approved custom servers');
 credential=process.env.KANEHACK_TOKEN||c.token||'';
 if(!credential) throw new Error('NOT_PAIRED: kanehack pair --start --json');
 const rpc=async(method,params)=>{
  let url=new URL('/mcp',base);
  for(let i=0;i<4;i++) {
   const response=await fetch(url,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json',accept:'application/json, text/event-stream',authorization:`Bearer ${credential}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
   if(response.status>=300&&response.status<400) {
    const location=response.headers.get('location'); if(!location) throw new Error('Redirect without location');
    const next=new URL(location,url); if(!trusted(next)||next.pathname!=='/mcp') throw new Error('Redirect refused'); url=next;continue;
   }
   if(response.status===401) throw new Error('UNAUTHENTICATED: re-pair, then retry');
   if(response.status===403) throw new Error('FORBIDDEN: check desk check-in, role and team');
   if(response.status===429) throw new Error('RATE_LIMITED: retry after '+(response.headers.get('retry-after')||'server-directed backoff'));
   if(!response.ok) throw new Error(`HTTP ${response.status}: outcome uncertain for writes; read back before replay`);
   const body=await response.json();
   if(body.error) throw new Error('MCP error: '+JSON.stringify(scrub(body.error)));
   if(!body.result) throw new Error('Missing JSON MCP result; use native MCP for SSE/session transports');
   return body.result;
  }
  throw new Error('Too many redirects');
 };
 const listed=await rpc('tools/list',{});
 if(mode==='list') console.log(JSON.stringify(scrub(listed),null,2));
 else {
  let tools=listed.tools??[], cursor=listed.nextCursor;
  for(let n=0;cursor&&n<10;n++){const page=await rpc('tools/list',{cursor});tools.push(...(page.tools??[]));cursor=page.nextCursor;}
  if(!tools.some(t=>t.name===name)) throw new Error('TOOL_UNAVAILABLE: use web/staff fallback; do not invent a call');
  if(!readOnly.has(name)&&!a.includes('--confirmed')) throw new Error('Mutation needs actual approval of these arguments, then --confirmed');
  const pos=a.indexOf('--args'); if(pos<0||!a[pos+1]) throw new Error('Provide --args PRIVATE_JSON (use {} for no arguments)');
  const args=JSON.parse(readFileSync(a[pos+1],'utf8'));
  if(!args||Array.isArray(args)||typeof args!=='object') throw new Error('Arguments must be an object matching the discovered schema');
  const result=await rpc('tools/call',{name,arguments:args});
  console.log(JSON.stringify(scrub(result),null,2));
  if(result.isError) process.exitCode=1;
  for(const part of result.content??[]) if(part.type==='text') {try{if(JSON.parse(part.text).status==='error')process.exitCode=1;}catch{}}
 }
}catch(e){console.error(JSON.stringify({error:scrub(e.message),no_automatic_write_retry:true}));process.exitCode=2;}
