import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSessions, sessionsFor, snapshot, adapt, type Feedback } from './model.ts';
import { normalizeActivity, fetchGarmin } from './garmin.ts';
const log = (sessionId: string, extra: Partial<Feedback> = {}): Feedback => ({sessionId,version:1,status:'done',option:'standard',actualMinutes:45,effort:4,signal:'normal',comment:'',reviewed:true,interpretation:'',activityId:null,plannedMinutes:45,...extra});
test('all 24 weekly totals match the agreed plan, including first week and taper',()=>{
 const totals=[310,395,435,325,465,485,405,335,480,515,540,395,560,580,595,455,580,605,620,440,535,540,350,105];
 for(let w=1;w<=24;w++)assert.equal(sessionsFor(w).reduce((n,s)=>n+s.minutes,0),totals[w-1],'Week '+w);
 assert.equal(new Set(allSessions.map(s=>s.id)).size,allSessions.length);
 assert.ok(allSessions.every(s=>s.day!==4));
 assert.ok(sessionsFor(1).every(s=>s.day>0));
 assert.ok(sessionsFor(24).every(s=>!['lower','upper','plyo'].includes(s.kind)));
});
test('fatigue reduces the next comparable workout; completed history stays fixed',()=>{
 const target=sessionsFor(11).find(s=>s.slot==='longrun')!;
 const logs=[log('w10-longrun',{signal:'fatigue',actualMinutes:75,plannedMinutes:80})];
 assert.equal(adapt(target,logs).minutes,65);
 const completed=log(target.id,{plannedMinutes:65});
 assert.equal(adapt(target,[...logs,completed]).minutes,65);
 assert.equal(adapt(target,[...logs,completed]).locked,true);
});
test('pain pauses upcoming leg work, pending comments hold progression, preferences carry',()=>{
 const run=sessionsFor(11).find(s=>s.slot==='longrun')!;
 assert.equal(adapt(run,[log('w11-lower',{signal:'pain'})]).minutes,0);
 assert.equal(adapt(run,[log('w10-longrun',{comment:'Unclear recovery',reviewed:false})]).minutes,80);
 const bike=sessionsFor(11).find(s=>s.slot==='long')!;
 assert.equal(adapt(bike,[log('w10-long',{option:'interval2'})]).option,'interval2');
 assert.equal(snapshot(11,[]).overview[10].completed,0);
});
test('Garmin units remain explicit; parent multisport summaries are excluded',()=>{
 const a=normalizeActivity({activityId:123,activityName:'Ride',startTimeLocal:'2026-11-12 08:30:00',activityType:{typeKey:'road_cycling'},duration:3600,distance:25000,averageHR:140,avgPower:170})!;
 assert.equal(a.minutes,60);assert.equal(a.distanceKm,25);assert.equal(a.averagePower,170);assert.equal(a.date,'2026-11-12');
 assert.equal(normalizeActivity({activityId:123,isParent:true,duration:100}),null);
 assert.equal(normalizeActivity({activityId:1,duration:-1}),null);
});
test('Garmin token is raw text, secrets stay in authorization headers, and pagination ends',async()=>{
 const calls: {url:string; headers:Headers}[]=[];
 const fake = (async(url: string | URL | Request,init?: RequestInit)=>{
  calls.push({url:String(url),headers:new Headers(init?.headers)});
  return calls.length===1?new Response('header.payload.signature'):Response.json([]);
 }) as typeof fetch;
 const result=await fetchGarmin('test-secret','2026-11-09','2026-11-15',fake);
 assert.equal(result.records.length,0);assert.equal(calls.length,2);
 assert.equal(calls[0].headers.get('Authorization'),'ApiKey test-secret');
 assert.equal(calls[1].headers.get('Authorization'),'Bearer header.payload.signature');
 assert.ok(calls.every(c=>!c.url.includes('test-secret')));
});
test('Garmin display metrics preserve local start time, precise duration and missing values',()=>{
 const source={activityId:456,startTimeLocal:'2026-11-09 23:45:12',activityType:{typeKey:'strength_training'},duration:4842,elapsedDuration:5100,calories:420,averageHR:114,maxHR:151,averageSpeed:0};
 const a=normalizeActivity(source)!;
 assert.equal(a.kind,'strength');assert.equal(a.startTimeLocal,'2026-11-09T23:45:12');
 assert.equal(a.durationSeconds,4842);assert.equal(a.elapsedMinutes,85);assert.equal(a.calories,420);assert.equal(a.maxHR,151);
 assert.equal(a.distanceKm,null);assert.equal(a.averageSpeedMps,0);
 const missing=normalizeActivity({...source,startTimeLocal:'2026-11-09',calories:NaN,maxHR:-10,elapsedDuration:undefined,averageSpeed:'4'})!;
 assert.equal(missing.startTimeLocal,null);assert.equal(missing.calories,null);assert.equal(missing.maxHR,null);
 assert.equal(missing.elapsedMinutes,null);assert.equal(missing.averageSpeedMps,null);
 assert.equal(normalizeActivity({...source,startTimeLocal:'2026-11-09T29:99:99'})!.startTimeLocal,null);
});
