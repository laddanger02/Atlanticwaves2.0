import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const CLIENT_ID = process.env.DERIV_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ALLOW_REAL_TRADING = process.env.ALLOW_REAL_TRADING === 'true';
const AUTH_BASE = 'https://auth.deriv.com/oauth2';
const API_BASE = 'https://api.derivws.com';

if (!CLIENT_ID || !SESSION_SECRET) {
  console.error('Missing DERIV_CLIENT_ID or SESSION_SECRET. Copy .env.example to .env and configure it.');
  process.exit(1);
}
if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));
app.use(session({
  name: 'aw.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

const b64url = b => Buffer.from(b).toString('base64url');
const random = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(s).digest();

function requireAuth(req, res, next) {
  if (!req.session.accessToken) return res.status(401).json({ error: 'Connect your Deriv account first.' });
  next();
}
async function derivFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || `Deriv API request failed (${response.status})`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return body;
}

app.get('/api/session', (req, res) => {
  res.json({ authenticated: Boolean(req.session.accessToken) });
});

app.get('/auth/login', (req, res) => {
  const verifier = random(48);
  const state = random(24);
  req.session.oauth = { verifier, state, createdAt: Date.now() };
  const url = new URL(`${AUTH_BASE}/auth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', `${BASE_URL}/oauth/callback`);
  url.searchParams.set('scope', 'trade');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', b64url(sha256(verifier)));
  url.searchParams.set('code_challenge_method', 'S256');
  res.redirect(url.toString());
});

app.get('/oauth/callback', async (req, res) => {
  const oauth = req.session.oauth;
  delete req.session.oauth;
  if (req.query.error) return res.status(400).send('Deriv login was cancelled or denied. Return to the app and try again.');
  if (!oauth || Date.now() - oauth.createdAt > 10 * 60 * 1000 || req.query.state !== oauth.state || typeof req.query.code !== 'string') {
    return res.status(400).send('OAuth state validation failed or the login session expired. Return to the app and reconnect.');
  }
  try {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: req.query.code,
      code_verifier: oauth.verifier,
      redirect_uri: `${BASE_URL}/oauth/callback`
    });
    const response = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || data.message || 'Token exchange failed.');
    req.session.accessToken = data.access_token;
    req.session.tokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
    res.redirect('/');
  } catch (error) {
    console.error('OAuth callback failed:', error.message);
    res.status(502).send('Could not finish Deriv authentication. Check the OAuth app configuration and try again.');
  }
});

app.get('/api/accounts', requireAuth, async (req, res) => {
  try {
    const data = await derivFetch(`${API_BASE}/trading/v1/options/accounts`, req.session.accessToken);
    res.json(data);
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post('/api/otp', requireAuth, async (req, res) => {
  const accountId = String(req.body?.accountId || '');
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(accountId)) return res.status(400).json({ error: 'Invalid account ID.' });
  try {
    const accountsResponse = await derivFetch(`${API_BASE}/trading/v1/options/accounts`, req.session.accessToken);
    const accounts = accountsResponse?.data?.accounts || accountsResponse?.accounts || [];
    const account = accounts.find(a => String(a.account_id || a.id) === accountId);
    if (!account) return res.status(403).json({ error: 'That account is not available to this authenticated user.' });
    const isReal = String(account.account_type || account.type || '').toLowerCase().includes('real')
      || String(accountId).toLowerCase().startsWith('cr');
    if (isReal && !ALLOW_REAL_TRADING) {
      return res.status(403).json({ error: 'Real trading is disabled on this server. Set ALLOW_REAL_TRADING=true only after testing and understanding the risks.' });
    }
    const data = await derivFetch(`${API_BASE}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, req.session.accessToken, { method: 'POST' });
    if (!data?.data?.url) return res.status(502).json({ error: 'Deriv did not return a WebSocket URL.' });
    res.json({ data: { url: data.data.url } });
  } catch (error) {
    res.status(error.status || 502).json({ error: error.message });
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('aw.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true });
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Atlantic Waves listening at ${BASE_URL}`));
