import OAuthProvider, { AuthorizationError, CimdFetchError, insufficientScope, type OAuthHelpers, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { handleMcp } from '../lib/mcp';
import { action, safeError } from '../lib/service';
import { dashboard } from '../lib/ui';

interface Env {
  APP_ORIGIN: string;
  OWNER_ACCESS_CODE: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  LOGIN_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
const owner = 'personal-owner';
const sessionCookie = '__Host-training-session';
const csrfCookie = '__Host-training-csrf';
const sessionTTL = 7 * 86400;
const escape = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const cookie = (name: string, value: string, age: number) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const cookies = (request: Request) => new Map((request.headers.get('Cookie') || '').split(';').map(part => { const i = part.indexOf('='); return [part.slice(0, i).trim(), part.slice(i + 1)]; }));
async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
async function equalSecret(a: string, b: string) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
async function signedIn(request: Request, env: Env) {
  const token = cookies(request).get(sessionCookie);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  return await env.OAUTH_KV.get(`session:${await digest(token)}`) === await digest(env.OWNER_ACCESS_CODE);
}
function page(content: string, headers = new Headers(), status = 200, callbackOrigin = '') {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  // Browsers apply form-action to the redirect after consent, too.
  headers.set('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callbackOrigin ? ` ${callbackOrigin}` : ''}; frame-ancestors 'none'; base-uri 'none'`);
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>70.3 Training Coach</title><style>body{font:17px system-ui;color:#191c20;background:#f4f4f2;margin:0;padding:24px}main{max-width:480px;margin:6vh auto;background:white;border:1px solid #dce2da;border-radius:16px;padding:28px}p{line-height:1.6}input{box-sizing:border-box;width:100%;font:inherit;margin:12px 0;padding:12px;border:1px solid #bbc9be;border-radius:8px}button{font:inherit;padding:12px 20px;border:0;border-radius:8px;background:#c8102e;color:white;cursor:pointer;margin:10px 8px 0 0}a{color:#c8102e}label{display:block}small{line-height:1.5}</style><main><h1>70.3 Training Coach</h1>${content}</main></html>`, { headers, status });
}
function returnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  const parsed = new URL(value, 'https://local.invalid');
  return parsed.pathname === '/authorize' ? parsed.pathname + parsed.search : '/';
}
async function defaultFetch(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
  if (url.pathname === '/health') return Response.json({ status: 'ok' });
  if (!env.OWNER_ACCESS_CODE || env.OWNER_ACCESS_CODE.length < 32) return page('<p>Private sign-in is being configured. Please try again shortly.</p>', undefined, 503);
  if (request.method === 'POST' && request.headers.get('Origin') !== env.APP_ORIGIN) return new Response('Untrusted request origin.', { status: 403 });
  if (Number(request.headers.get('Content-Length') || 0) > 16000) return new Response('Request too large.', { status: 413 });

  if (url.pathname === '/login') {
    if (request.method === 'GET') {
      const csrf = random();
      return page(`<p>Your training log is private. Enter your personal app access code.</p><form method="post" action="/login"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="return_to" value="${escape(returnPath(url.searchParams.get('return_to')))}"><label for="code">App access code</label><input id="code" name="code" type="password" required minlength="32" maxlength="128" autocomplete="current-password"><button>Sign in</button></form><p><small>This is the separate code created for this app, not your Cloudflare or ChatGPT password.</small></p>`, new Headers({ 'Set-Cookie': cookie(csrfCookie, csrf, 600) }));
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const body = await request.text();
    if (body.length > 16000) return new Response('Request too large.', { status: 413 });
    const form = new URLSearchParams(body);
    const csrf = cookies(request).get(csrfCookie);
    if (!csrf || !await equalSecret(csrf, form.get('csrf') || '')) return new Response('Sign-in expired. Reload the login page.', { status: 403 });
    if (!await equalSecret(env.OWNER_ACCESS_CODE, form.get('code') || '')) return page('<p>The access code was incorrect.</p><a href="/login">Try again</a>', undefined, 401);
    const token = random();
    await env.OAUTH_KV.put(`session:${await digest(token)}`, await digest(env.OWNER_ACCESS_CODE), { expirationTtl: sessionTTL });
    const headers = new Headers({ Location: returnPath(form.get('return_to')) });
    headers.append('Set-Cookie', cookie(sessionCookie, token, sessionTTL));
    headers.append('Set-Cookie', cookie(csrfCookie, '', 0));
    return new Response(null, { status: 303, headers });
  }
  if (!await signedIn(request, env)) {
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'Your session expired. Open the app in your browser and sign in again.' }, { status: 401 });
    return new Response(null, { status: 303, headers: { Location: `/login?return_to=${encodeURIComponent(returnPath(url.pathname + url.search))}` } });
  }
  if (url.pathname === '/logout' && request.method === 'POST') {
    await env.OAUTH_KV.delete(`session:${await digest(cookies(request).get(sessionCookie)!)}`);
    return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': cookie(sessionCookie, '', 0) } });
  }
  if (url.pathname === '/authorize') {
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (request.method === 'GET') {
        const auth = await oauth.parseAuthRequest(request);
        const details = await oauth.describeConsent(auth);
        const consent = await oauth.beginConsent(auth);
        return page(`<h2>Connect ${escape(details.clientName)}?</h2><p>${details.clientDomain ? `Published by <strong>${escape(details.clientDomain)}</strong>.` : 'The client name is self-declared.'} Access will return to <strong>${escape(details.redirectHost)}</strong>.</p>${details.redirectIsLoopback ? '<p>This connects an app on your computer. Continue only if you started that connection.</p>' : ''}<p>Permissions: ${details.scope.map(escape).join(', ') || 'No training permissions requested'}</p><p>Training read access includes your plan, comments, and imported Garmin activities. Write access allows feedback saves and Garmin imports.</p><form method="post"><input type="hidden" name="handle" value="${escape(consent.handle)}">${details.scope.map(scope => `<input type="hidden" name="scope" value="${escape(scope)}">`).join('')}<button name="decision" value="approve">Allow</button><button name="decision" value="deny">Deny</button></form>`, consent.headers, 200, new URL(auth.redirectUri).origin);
      }
      if (request.method === 'POST') {
        const form = await request.clone().formData();
        const handle = String(form.get('handle') || '');
        if (form.get('decision') !== 'approve') {
          const denied = await oauth.denyConsent(request, handle);
          return new Response(null, { status: 302, headers: denied.headers });
        }
        const approved = await oauth.approveConsent(request, handle, { scope: form.getAll('scope').map(String) });
        const result = await oauth.completeAuthorization({ request: approved.request, userId: owner, metadata: {}, scope: approved.request.scope, props: { userId: owner } });
        approved.headers.set('Location', result.redirectTo);
        return new Response(null, { status: 302, headers: approved.headers });
      }
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) return page('<p>This connection request expired or could not be verified. Start the connection again from ChatGPT.</p>', undefined, 400);
      throw error;
    }
  }
  if (url.pathname === '/api/action' && request.method === 'POST') {
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return new Response('JSON required.', { status: 415 });
    const body = await request.text();
    if (body.length > 16000) return new Response('Request too large.', { status: 413 });
    try { const { name, args } = JSON.parse(body); return Response.json(await action(owner, name, args)); }
    catch (error) { return Response.json({ error: safeError(error) }, { status: 400 }); }
  }
  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(dashboard.replace('<!--account-->', '<form class="logout" action="/logout" method="post"><button>Sign out</button></form>'), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
  }
  return new Response('Not found.', { status: 404 });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.origin !== env.APP_ORIGIN) return new Response('Unknown app origin.', { status: 421 });
    if ((request.method === 'POST' && ['/login', '/oauth/register'].includes(url.pathname)) || url.pathname === '/authorize') {
      if (!(await env.LOGIN_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') || 'local' })).success) return new Response('Too many sign-in requests. Try again in a minute.', { status: 429, headers: { 'Retry-After': '60' } });
    }
    const provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: { async fetch(req, _env, context) {
        const authContext = context as OAuthResourceContext<{ userId: string }>;
        if (authContext.props?.userId !== owner) return new Response('Forbidden.', { status: 403 });
        if (!authContext.auth.scope.includes('training:read')) return insufficientScope(authContext.auth, ['training:read']);
        if (new URL(req.url).pathname !== '/mcp') return new Response('Not found.', { status: 404 });
        if (req.method !== 'POST') return new Response('Use POST for MCP requests.', { status: 405, headers: { Allow: 'POST' } });
        return handleMcp(req, owner, authContext.auth.scope.includes('training:write'));
      } },
      defaultHandler: { fetch: defaultFetch },
      authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['training:read', 'training:write', 'offline_access'],
      requiredScopes: ['training:read', 'training:write'],
      resourceMetadata: { resource: `${env.APP_ORIGIN}/mcp`, authorization_servers: [env.APP_ORIGIN] },
      clientIdMetadataDocumentEnabled: true,
    });
    try {
      const response = await provider.fetch(request, env, ctx);
      const secured = new Response(response.body, response);
      secured.headers.set('Cache-Control', 'no-store');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Referrer-Policy', 'same-origin');
      secured.headers.set('X-Frame-Options', 'DENY');
      return secured;
    } catch {
      return new Response('The app is temporarily unavailable. Please retry.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
