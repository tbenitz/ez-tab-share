# EZ Tab Share

**Ephemeral, session-based file sharing over WebRTC.**

Share a file and get a short code. Anyone with the code can download it **as long as at least one person who has the full file keeps their browser tab open**. Once someone downloads the complete file, they can also keep their tab open and become a host for others.

- No server stores your files
- WebRTC provides end-to-end encryption (DTLS)
- Optional limits: 1 download, N downloads, or unlimited
- Optional expiry times
- Custom share codes
- Works entirely in the browser

## Features

- Drag & drop or click to select a file
- Random secure codes or custom codes (4–12 alphanumeric)
- Max downloads: 1 (most secure), 5, 10, or unlimited
- Expiry: 15 min / 1 hr / 6 hr / 24 hr / never
- QR code + copy link / code
- Progress indication
- After download, keep the tab open to seed for others
- Multiple simultaneous hosts supported
- Clean, modern, responsive UI

## How it works

1. You select a file and choose options → a room is created using the share code as the room ID (via [Trystero](https://trystero.dev/)).
2. Trystero uses public relays (Nostr by default) only for signaling (SDP/ICE exchange). File data never touches a server.
3. Anyone who joins the same code sees available hosts and requests the file.
4. The file is sent peer-to-peer over a WebRTC DataChannel in chunks with backpressure handling.
5. Once fully received, that browser can stay open and announce itself as a host.
6. When the last host closes their tab (or limits/expiry are hit), the share disappears.

## Deploy / Run

This is a static site. You can:

1. **GitHub Pages** (recommended):
   - Go to Settings → Pages → Source: Deploy from branch `main` / root
   - Your site will be at `https://tbenitz.github.io/ez-tab-share/`

2. **Any static host** (Netlify, Vercel, Cloudflare Pages, etc.)

3. **Locally**:
   ```bash
   # Python
   python -m http.server 8080
   # or npx serve
   npx serve .
   ```
   Then open http://localhost:8080

> Note: Signaling requires an internet connection because it uses public relays. Direct file transfer is peer-to-peer.

## Limitations & Notes

- Both (or more) tabs must stay open during the transfer.
- Very large files are limited by browser memory (the full file is held in RAM on hosts).
- Difficult NATs may need TURN servers (public STUN is used by default). For better connectivity you can self-host a Trystero relay.
- Limits and expiry are enforced by the hosting peers. They are not cryptographically enforced against a malicious client.
- One file per session.

## Tech

- [Trystero](https://github.com/dmotz/trystero) for serverless WebRTC matchmaking
- Pure HTML/CSS/JS — no build step required
- WebRTC DataChannels

## License

MIT

---

Made for easy, temporary, private file sharing.
