# EZ Tab Share

Ephemeral file sharing over WebRTC (PeerJS).  
The share stays alive as long as at least one person who has the full file keeps their browser tab open.

- No server stores the file
- Direct peer-to-peer transfer
- Optional download limits (1 / 5 / 10 / unlimited)
- Optional expiry
- Custom or random codes
- Simple, no build step

## Run

GitHub Pages or any static host.  
Or locally:

```bash
python -m http.server 8080
```

Open http://localhost:8080

Uses the public PeerJS signaling server (only for connection setup). File data never leaves the browsers.
