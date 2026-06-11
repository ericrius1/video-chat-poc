# Video Chat PoC

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ericrius1/video-chat-poc)

Two-person video call with a recording that actually stays in sync.

The trick: each person records a **single combined stream** (both videos
composited on a canvas, both audios mixed via Web Audio) through **one
MediaRecorder**. One recorder = one clock, so audio/video sync is
structural. No server-side media, no post-processing, no ffmpeg, no
drift to correct.

## Run

```bash
npm install
npm start
# → http://localhost:3000 (redirects into a fresh room)
```

Open the room URL in two tabs/browsers, click **Join call** in both.
Once connected, either side can hit **Start recording** — each person
gets their own local WebM download when they stop.

## Testing with a real second person

`getUserMedia` requires HTTPS off localhost. Easiest options:

```bash
# ngrok
ngrok http 3000

# or Tailscale funnel
tailscale funnel 3000
```

Send the other person the full room URL (`https://…/room/<id>`).

## Known limitations (deliberate PoC trade-offs)

- **Keep the tab focused while recording** — background tabs throttle
  `requestAnimationFrame`, which freezes the canvas composite.
- **No TURN server** — ~10–20% of NAT combinations won't connect P2P.
  Add a TURN entry to `iceServers` in `public/main.js` if needed.
- **Chrome/Edge recommended** — Safari's MediaRecorder support is shaky.
- Recording captures the network-degraded remote feed, not the remote
  person's pristine local tracks. That's the quality ceiling of this
  architecture — fixing it is the hard problem this PoC avoids.
