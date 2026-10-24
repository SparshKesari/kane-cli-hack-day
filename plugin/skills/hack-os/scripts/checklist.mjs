#!/usr/bin/env node
// Private navigation cache. This never verifies a server claim.
import {readFileSync,writeFileSync,mkdirSync,renameSync,chmodSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const gates=JSON.parse(readFileSync(new URL('../references/gates.json',import.meta.url),'utf8'));
const args=process.argv.slice(2), command=args[0];
const flag=n=>args.includes(n)?args[args.indexOf(n)+1]:null;
const die=m=>{throw new Error(m)};
try {
 const path=flag('--state'); if(!path) die('Use status|record --state PRIVATE_PATH [--input RECORD.json]');
 let state=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{version:1,scope:{},items:{}};
 if(state.version!==1||!state.items||!state.scope) die('Unsupported or corrupt state; preserve it and choose a fresh private state path');
 if(command==='record') {
  const input=flag('--input'); if(!input) die('record requires --input JSON file');
  const data=JSON.parse(readFileSync(input,'utf8'));
  const allowedScope=['event_id','participant_id','team_id','git_sha','plan_revision'];
  if(data.scope) {
   if(Object.keys(data.scope).some(k=>!allowedScope.includes(k))) die('Unsupported scope field');
   if(Object.values(data.scope).some(v=>v!==null&&(typeof v!=='string'||v.length>128))) die('Use only opaque bounded scope IDs');
   const changed=k=>Object.hasOwn(data.scope,k)&&data.scope[k]!==state.scope[k];
   const identity=['event_id','participant_id','team_id'].some(changed);
   const source=['git_sha','plan_revision'].some(changed);
   for(const [id,item] of Object.entries(state.items)) {
    if(identity||source&&['plan','execution','proof','public_evidence','video_upload','submission_page','submission','showcase','x','eligibility'].includes(id)) state.items[id]={...item,status:'stale',reason:'Scope changed; recheck canonical state'};
   }
   state.scope={...state.scope,...data.scope};
  }
  if(!Array.isArray(data.items)) die('items must be an array');
  for(const row of data.items) {
   if(!gates.some(g=>g.id===row.id)) die('Unknown gate ID');
   if(!['unknown','pending','blocked','waiting_human','building','done','waived','stale'].includes(row.status)) die('Unknown status');
   if(row.status==='building'&&row.id!=='build') die('building status is reserved for build');
   if(['done','waived'].includes(row.status)&&!row.evidence_ref) die('Done/waived requires observed evidence reference');
   const clean={status:row.status,checked_at:new Date().toISOString()};
   for(const k of ['evidence_ref','reason']) if(row[k]!==undefined) {
    if(typeof row[k]!=='string'||row[k].length>300||/khk_|bearer\s|password\s*[:=]|token\s*[:=]/i.test(row[k])) die('Use short nonsecret evidence IDs/reasons');
    clean[k]=row[k];
   }
   state.items[row.id]=clean;
  }
  mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
  const tmp=path+'.tmp-'+process.pid; writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600});
  renameSync(tmp,path); chmodSync(path,0o600);
 } else if(command!=='status') die('Expected status or record');
 const rows=gates.map(g=>({...g,...(state.items[g.id]??{status:'unknown'}),cached:true}));
 const actionable=rows.filter(g=>!['done','waived'].includes(g.status)&&g.depends_on.every(id=>['done','waived'].includes(state.items[id]?.status)));
 const next=actionable.find(g=>!['advisory','artifact_option','milestone'].includes(g.required_for))??actionable[0];
 console.log(JSON.stringify({navigation_cache_only:true,recheck_cached_done_before_skipping:true,scope:state.scope,rows,waiting_for_participant:state.items.build?.status==='building',resume_prompt:state.items.build?.status==='building'?'$hack-os, ready to submit':null,next:next?.id??null},null,2));
} catch(e) {console.error(JSON.stringify({error:e.message}));process.exitCode=2;}
