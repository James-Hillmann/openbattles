# Hosting a match over the internet

One Node process serves everything: the built client over HTTP and the relay over
WebSocket on the same port (`/relay`). Players open the page, load **their own** ROM
(it stays in their browser), and Host/Join with a room code. The server never sees
or stores game data: it only holds the Vite build of our own code.

```sh
npm ci
npm run build   # client/dist
npm start       # http://localhost:8787 (PORT overrides)
```

## Option A: Render free web service (permanent link)

`render.yaml` describes a free web service. Checked 2026-10-08 against
[render.com/docs/free](https://render.com/docs/free):

- Free, no card needed to create it; 750 instance hours a month per workspace.
- Sleeps after 15 minutes with no HTTP request **and** no WebSocket message, so a
  running match keeps it awake. The first visit after a sleep waits about a minute.
- One instance only, restarts at any time are possible (a restart drops a match in progress).

Steps (James, once):

1. Sign in at [dashboard.render.com](https://dashboard.render.com) with GitHub and allow
   access to `James-Hillmann/openbattles`.
2. **New > Blueprint**, pick the repo, branch `main`. Render reads `render.yaml`; confirm
   the plan says **Free**.
3. Wait for the first build, then open `https://<name>.onrender.com`. Send that link to the friend.

Every push to `main` redeploys once CI passes (`autoDeployTrigger: checksPass`).

## Option B: your own computer + Cloudflare quick tunnel (no account)

Good for a one-off session. Checked against
[Cloudflare's quick tunnel docs](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/):
no account or domain, up to 200 in-flight requests, no uptime guarantee, new URL every run.

```sh
npm run build && npm start                    # terminal 1
cloudflared tunnel --url http://localhost:8787 # terminal 2, prints https://<random>.trycloudflare.com
```

Install `cloudflared` from Cloudflare's downloads page (e.g. `brew install cloudflared`).
Both players open the printed https link; the page dials `wss://<same host>/relay`.

## Client and relay on different hosts

Build the client with `VITE_RELAY_URL=wss://relay.example/relay npm run build`, or add
`?relay=wss://...` to any page URL. Order: `?relay=` > `VITE_RELAY_URL` > same origin
(production build) > `ws://<host>:8787` (`npm run dev`).

## Before inviting someone

- Both players need the same ROM dump (the relay checks a header fingerprint) and the same
  page build (protocol version). A deploy mid-match ends that match.
- Run on Node 22+.
