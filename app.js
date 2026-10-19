// EZ Tab Share — Ephemeral WebRTC file sharing with Trystero
// Stays live as long as any peer who has the full file keeps their tab open.

import { joinRoom, selfId } from 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/dist/trystero.min.js';

const APP_ID = 'ez-tab-share-v1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let room = null;
let announce = null;
let requestAction = null;
let fileAction = null;
let currentFile = null;
let isHost = false;
let maxDownloads = 0;
let remainingDownloads = Infinity;
let expiresAt = 0;
let hosts = new Map();
let receivedBlob = null;
let currentCode = '';

const $ = id => document.getElementById(id);
const views = ['home', 'hosting', 'downloading', 'received'];

function showView(name) {
  views.forEach(v => $(v).classList.toggle('active', v === name));
}

function generateCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(ms) {
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// File selection
const dropzone = $('dropzone');
const fileInput = $('file-input');
const fileInfo = $('file-info');
const createBtn = $('create-btn');

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  currentFile = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', blob: file };
  fileInfo.innerHTML = `<strong>${file.name}</strong><br>${formatBytes(file.size)} • ${file.type || 'unknown'}`;
  fileInfo.classList.remove('hidden');
  createBtn.disabled = false;
}

// Create
createBtn.addEventListener('click', async () => {
  if (!currentFile) return;
  const custom = $('custom-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const code = custom.length >= 4 ? custom : generateCode();
  maxDownloads = parseInt($('max-downloads').value, 10);
  remainingDownloads = maxDownloads === 0 ? Infinity : maxDownloads;
  const expiryMin = parseInt($('expiry').value, 10);
  expiresAt = expiryMin === 0 ? 0 : Date.now() + expiryMin * 60 * 1000;
  currentCode = code;
  await startHosting(code);
});

async function startHosting(code) {
  isHost = true;
  showView('hosting');
  $('host-filename').textContent = currentFile.name;
  $('share-code').textContent = code;
  updateHostStatus();

  const url = `${location.origin}${location.pathname}?code=${code}`;
  $('copy-link').onclick = () => navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
  $('copy-code').onclick = () => navigator.clipboard.writeText(code).then(() => alert('Code copied!'));

  try {
    const { default: QRCode } = await import('https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm');
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, url, { width: 180, margin: 1, color: { dark: '#00d4aa', light: '#fff' } });
    $('qr-container').innerHTML = '';
    $('qr-container').appendChild(canvas);
  } catch {
    $('qr-container').innerHTML = `<p class="hint"><a href="${url}" target="_blank">${url}</a></p>`;
  }

  await joinSession(code);
}

// Join
$('join-btn').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) return alert('Enter a valid code (4+ characters)');
  currentCode = code;
  joinSession(code);
});

// URL param
const params = new URLSearchParams(location.search);
if (params.has('code')) {
  $('join-code').value = params.get('code');
  setTimeout(() => $('join-btn').click(), 400);
}

async function joinSession(code) {
  if (room) room.leave();
  room = joinRoom({ appId: APP_ID }, code);

  announce = room.makeAction('announce');
  requestAction = room.makeAction('request');
  fileAction = room.makeAction('file');

  function broadcastAnnounce() {
    if (!isHost || !currentFile) return;
    announce.send({
      hasFile: true,
      name: currentFile.name,
      size: currentFile.size,
      type: currentFile.type,
      maxDownloads,
      remaining: remainingDownloads === Infinity ? -1 : remainingDownloads,
      expiresAt,
      peerId: selfId
    });
  }

  room.onPeerJoin = peerId => {
    if (isHost) broadcastAnnounce();
    updatePeers();
  };
  room.onPeerLeave = peerId => {
    hosts.delete(peerId);
    updatePeers();
    updateHostStatus();
  };

  announce.onMessage = (data, peerId) => {
    if (data.hasFile) {
      hosts.set(peerId, data);
      updatePeers();
      updateHostStatus();
      if (!isHost && !receivedBlob && hosts.size > 0) {
        // Request from the first available host
        const hostId = hosts.keys().next().value;
        requestAction.send({ want: true }, { target: hostId });
        $('dl-progress-text').textContent = 'Requesting file from host…';
      }
    }
  };

  requestAction.onMessage = async (data, peerId) => {
    if (!isHost || !currentFile) return;
    if (expiresAt && Date.now() > expiresAt) return;
    if (remainingDownloads <= 0 && remainingDownloads !== Infinity) return;

    try {
      await fileAction.send(currentFile.blob, {
        target: peerId,
        metadata: { name: currentFile.name, type: currentFile.type, size: currentFile.size },
        onProgress: p => {
          console.log(`Sending to ${peerId.slice(0,6)}: ${Math.round(p * 100)}%`);
        }
      });
      if (remainingDownloads !== Infinity) {
        remainingDownloads = Math.max(0, remainingDownloads - 1);
        if (remainingDownloads <= 0) {
          setTimeout(stopHosting, 1500);
        }
      }
      broadcastAnnounce();
      updateHostStatus();
    } catch (err) {
      console.error('Transfer failed:', err);
    }
  };

  fileAction.onMessage = (data, peerId, meta) => {
    receivedBlob = new Blob([data], { type: meta?.type || 'application/octet-stream' });
    currentFile = {
      name: meta?.name || 'shared-file',
      size: receivedBlob.size,
      type: meta?.type || 'application/octet-stream',
      blob: receivedBlob
    };
    isHost = true;
    remainingDownloads = Infinity;
    showReceived();
  };

  if (isHost) {
    broadcastAnnounce();
  } else {
    showView('downloading');
    $('dl-filename').textContent = 'Looking for file…';
    $('dl-progress-text').textContent = 'Connecting to session…';
  }

  // Re-announce periodically
  const interval = setInterval(() => {
    if (isHost && room) broadcastAnnounce();
    else clearInterval(interval);
  }, 7000);
}

function updatePeers() {
  const list = $('peers-list');
  if (!list) return;
  if (hosts.size === 0) {
    list.textContent = isHost ? 'Waiting for someone to join…' : 'No hosts found yet. Make sure the sharer still has the tab open.';
    return;
  }
  list.innerHTML = '<strong>Available hosts:</strong><br>' + 
    Array.from(hosts.values()).map(h => 
      `• ${h.name} (${formatBytes(h.size)})`
    ).join('<br>');
}

function updateHostStatus() {
  if (!$('hosts-count')) return;
  const count = (isHost ? 1 : 0) + hosts.size;
  $('hosts-count').textContent = `${count} host${count === 1 ? '' : 's'} online`;
  const rem = remainingDownloads === Infinity ? 'Unlimited' : `${remainingDownloads} left`;
  $('remaining-info').textContent = rem;
  const exp = expiresAt ? `Expires in ${formatTime(expiresAt - Date.now())}` : 'No expiry';
  $('expiry-info').textContent = exp;
}

function showReceived() {
  showView('received');
  $('received-name').textContent = `${currentFile.name} • ${formatBytes(currentFile.size)}`;
  $('save-file').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(currentFile.blob);
    a.download = currentFile.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('received-hosting').innerHTML = `
    <div class="status" style="margin-top:1.5rem">
      <strong>You are now hosting this file.</strong><br>
      Keep this tab open so others can download it.<br>
      Share code: <span style="color:var(--accent);font-family:monospace;font-size:1.2rem">${currentCode}</span>
    </div>
  `;
}

function stopHosting() {
  if (room) room.leave();
  room = null;
  isHost = false;
  currentFile = null;
  receivedBlob = null;
  hosts.clear();
  showView('home');
  fileInfo.classList.add('hidden');
  createBtn.disabled = true;
  fileInput.value = '';
  $('custom-code').value = '';
}

$('stop-hosting').addEventListener('click', stopHosting);

// Live expiry countdown
setInterval(() => {
  if (expiresAt && isHost) updateHostStatus();
}, 10000);

console.log('EZ Tab Share ready • Peer:', selfId);
