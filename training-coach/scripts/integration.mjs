import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const base = 'http://localhost:8787';
const secret = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^OWNER_ACCESS_CODE="([^"]+)"/m)[1];
const jar = new Map();
async function request(path, init = {}, useCookies = true) {
  const headers = new Headers(init.headers);
  if (useCookies) headers.set('Cookie', [...jar].map(([k,v]) => `${k}=${v}`).join('; '));
  const response = await fetch(base + path, { ...init, headers, redirect: 'manual' });
  if (useCookies) for (const cookie of response.headers.getSetCookie()) { const [name, value] = cookie.split(';')[0].split('='); jar.set(name, value); }
  return response;
}
const post = body => ({ method: 'POST', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
const json = body => ({ method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const hidden = (html, name) => html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];
const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });

assert.equal((await request('/api/action', json({name:'get_plan',args:{week:1}}), false)).status, 401);
assert.equal((await request('/api/action', { ...json({name:'get_plan',args:{week:1}}), headers:{'Content-Type':'application/json',Origin:base,'X-ChatGPT-User-Id':'personal-owner'}},false)).status,401);
const challenge = await request('/mcp', json(rpc('initialize', {})), false);
assert.equal(challenge.status, 401);
assert.match(challenge.headers.get('WWW-Authenticate'), /resource_metadata/);
const metadata = await (await request('/.well-known/oauth-authorization-server', {}, false)).json();
assert.equal(metadata.authorization_endpoint, base+'/authorize');
console.log('PASS: private routes and OAuth discovery');

const loginResponse = await request('/login');
assert.match(loginResponse.headers.get('Content-Security-Policy'), /form-action 'self';/);
let login = await loginResponse.text();
assert.equal((await request('/login',post({code:secret,csrf:'wrong'}))).status,403);
assert.equal((await request('/login',post({code:'wrong',csrf:hidden(login,'csrf')}))).status,401);
login = await (await request('/login')).text();
assert.equal((await request('/login',post({code:secret,csrf:hidden(login,'csrf')}))).status,303);
const html=await (await request('/')).text();
assert.match(html,/<h1>Build your/);
assert.equal((await request('/api/action',{...json({name:'get_plan',args:{week:1}}),headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid'}})).status,403);
console.log('PASS: login, CSRF, and cross-origin protection');

async function action(name,args) {return (await request('/api/action',json({name,args}))).json();}
const plan=await action('get_plan',{week:1});
assert.equal(plan.overview.length,24);
const session=plan.sessions[0];
const feedback={sessionId:session.id,version:session.log?.version||0,status:'done',option:session.options[0].id,actualMinutes:30,effort:8,signal:'fatigue',comment:'Integration test: tired legs. '+Date.now(),activityId:null};
const saved=await action('save_feedback',feedback);
assert.equal(saved.needsCommentReview,true);
assert.match((await action('save_feedback',feedback)).error,/another device/);
const reviewed=await action('interpret_feedback',{sessionId:session.id,version:saved.saved.version,signal:'fatigue',interpretation:'Hold progression after fatigue.'});
assert.equal(reviewed.saved.reviewed,true);
assert.ok((await action('get_history',{sessionId:session.id})).history.length>=2);
console.log('PASS: durable saves, stale-write rejection, and history');

async function authorize(scope) {
  const clientResponse=await request('/oauth/register',json({client_name:'Local integration test',redirect_uris:['http://localhost:9909/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'}),false);
  const client=await clientResponse.json();
  assert.ok(client.client_id,JSON.stringify(client));
  const verifier=randomBytes(32).toString('base64url');
  const params=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:'http://localhost:9909/callback',scope,resource:base+'/mcp',state:'integration',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  const consentResponse=await request('/authorize?'+params);
  const consent=await consentResponse.text();
  assert.equal(consentResponse.status,200,consent);
  assert.match(consent,/localhost/);
  assert.match(consentResponse.headers.get('Content-Security-Policy'), /form-action 'self' http:\/\/localhost:9909;/);
  const forged = new URLSearchParams(params);
  forged.set('redirect_uri', 'https://unregistered.invalid/callback');
  const rejected = await request('/authorize?'+forged);
  assert.equal(rejected.status,400);
  assert.match(rejected.headers.get('Content-Security-Policy'), /form-action 'self';/);
  assert.equal((await request('/authorize',post({handle:'forged',decision:'approve'}))).status,400);
  const body=new URLSearchParams({handle:hidden(consent,'handle'),decision:'approve'});
  for(const item of scope.split(' '))body.append('scope',item);
  const approved=await request('/authorize',post(body));
  assert.equal(approved.status,302,await approved.text());
  const code=new URL(approved.headers.get('Location')).searchParams.get('code');
  const tokenRequest=post({grant_type:'authorization_code',client_id:client.client_id,code,redirect_uri:'http://localhost:9909/callback',code_verifier:verifier,resource:base+'/mcp'});
  const token=await (await request('/oauth/token',tokenRequest,false)).json();
  assert.ok(token.access_token,JSON.stringify(token));
  const call=async(method,params)=>(await request('/mcp',{...json(rpc(method,params)),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token.access_token}},false)).json();
  return {call,token,client,replay:()=>request('/oauth/token',tokenRequest,false)};
}
const reader=await authorize('training:read');
assert.equal((await reader.call('tools/call',{name:'get_plan',arguments:{week:2}})).result.structuredContent.week,2);
assert.equal((await reader.call('tools/call',{name:'save_feedback',arguments:feedback})).result.isError,true);
assert.equal((await reader.replay()).status,400);
const writer=await authorize('training:read training:write offline_access');
assert.equal((await writer.call('tools/list',{})).result.tools.length,5);
assert.match((await writer.call('resources/read',{uri:'ui://training-coach/dashboard.html'})).result.contents[0].text,/<h1>Build your/);
const refreshed=await (await request('/oauth/token',post({grant_type:'refresh_token',client_id:writer.client.client_id,refresh_token:writer.token.refresh_token,resource:base+'/mcp'}),false)).json();
assert.ok(refreshed.access_token);
console.log('PASS: OAuth consent, PKCE exchange, code replay rejection, scopes, MCP UI, and refresh');
assert.equal((await request('/logout',post({}))).status,303);
assert.equal((await request('/api/action',json({name:'get_plan',args:{week:1}}))).status,401);
console.log('PASS: logout invalidates browser session');
