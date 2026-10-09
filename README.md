# Atlantic Waves • Deriv Trading App

A small full-stack starter based on the supplied Atlantic Waves UI. It uses Deriv OAuth 2.0 with PKCE, keeps the access token on the server, lists accounts, requests an account-specific WebSocket OTP, and connects the browser to the returned authenticated WebSocket URL.

## Important
- This is a starter implementation, not a guarantee of error-free execution or profit.
- **Real-money trading is disabled by default.** Keep `ALLOW_REAL_TRADING=false` until the app is deployed securely and tested on a demo account.
- The supplied digit-frequency strategy is heuristic only. Recent digit frequency does not establish a predictive edge.
- Never paste Deriv passwords, OAuth secrets, access tokens, or OTP URLs into chat or public code repositories.
- Use HTTPS in production. The included in-memory session store is for local development only. Use a persistent, secure session store before public deployment.

## Requirements
- Node.js 20+
- A Deriv OAuth 2.0 app with `trade` scope and an exact redirect URL.
- The OAuth client ID from Deriv's developer dashboard.

## Setup
1. Extract this ZIP and open a terminal in the project folder.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DERIV_CLIENT_ID`, `SESSION_SECRET`, and `BASE_URL`.
5. Register `${BASE_URL}/oauth/callback` as the exact OAuth redirect URL in Deriv.
6. Run `npm start`.
7. Open `http://localhost:3000`, connect, and select a **demo** account first.

OAuth redirect URL must match the registered URL exactly. For a hosted deployment, use HTTPS and update `BASE_URL`.

## Real account
Real account selection and live trading require explicit opt-in:
1. Verify the app on a demo account first.
2. Deploy behind HTTPS with a persistent session store, monitoring, and secure secrets management.
3. Set `ALLOW_REAL_TRADING=true` only when you intentionally accept the risk.
4. The app will still ask for confirmation before arming the bot.

## Files
- `server.js`: Express server, PKCE OAuth, account listing, OTP endpoint.
- `public/index.html`: dashboard UI.
- `.env.example`: configuration template.

## Risk controls in this build
Starting stake $1, progression multiplier 1.7x, max stake $8, four consecutive losses, session target +$25, session stop -$15. These are client-side strategy controls, not guaranteed account-level protections. If the connection drops while a contract is open, check your Deriv account directly.
