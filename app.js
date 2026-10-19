// EZ Tab Share — PeerJS version (reliable public signaling, pure WebRTC data)
// Host tab stays open = share stays alive. Downloaders can also keep hosting.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let peer = null;
let connections = [];
let currentFile = null;
let isHost = false;
let maxDownloads = 0;
let remaining = Infinity;
let expiresAt = 0;
let currentCode = '';
let receivedChunks = [];
let expectedSize = 0;
let receivedSize = 0;

const $ = id => document.getElementById(id);
const views = ['home', 'hosting', 'downloading', 'received'];

function showView(name) {
  views.forEach(v => $(v).classList.toggle('active', v === name));
}

function generateCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

function formatBytes(n) {
  if (!n) return '0 B';
  const k = 1024, sizes = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return (n / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

// --- File selection ---
const dropzone = $('dropzone');
const fileInput = $('file-input');
const fileInfo = $('file-info');
const createBtn = $('create-btn');

dropzone.onclick = () => fileInput.click();
dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('dragover'); };
dropzone.ondragleave = () => dropzone.classList.remove('dragover');
dropzone.ondrop = e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
};
fileInput.onchange = () => fileInput.files[0] && handleFile(fileInput.files[0]);

function handleFile(file) {
  currentFile = file;
  fileInfo.innerHTML = `<strong>${file.name}</strong><br>${formatBytes(file.size)}`;
  fileInfo.classList.remove('hidden');
  createBtn.disabled = false;
}

// --- Create share ---
createBtn.onclick = () => {
  if (!currentFile) return;
  const custom = $('custom-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const code = custom.length >= 4 ? custom : generateCode();
  maxDownloads = parseInt($('max-downloads').value, 10);
  remaining = maxDownloads === 0 ? Infinity : maxDownloads;
  const mins = parseInt($('expiry').value, 10);
  expiresAt = mins === 0 ? 0 : Date.now() + mins * 60 * 1000;
  startHosting(code);
};

function startHosting(code) {
  isHost = true;
  currentCode = code;
  showView('hosting');
  $('host-filename').textContent = currentFile.name;
  $('share-code').textContent = code;

  const url = location.origin + location.pathname + '?code=' + code;
  $('copy-code').onclick = () => navigator.clipboard.writeText(code);
  $('copy-link').onclick = () => navigator.clipboard.writeText(url);

  peer = new Peer(code, { debug: 1 });
  peer.on('open', id => {
    updateStatus();
    console.log('Hosting as', id);
  });
  peer.on('connection', conn => handleIncoming(conn));
  peer.on('error', err => {
    console.error(err);
    if (err.type === 'unavailable-id') alert('That code is already in use. Try another.');
  });
}

function handleIncoming(conn) {
  connections.push(conn);
  conn.on('open', () => {
    if (expiresAt && Date.now() > expiresAt) { conn.close(); return; }
    if (remaining <= 0 && remaining !== Infinity) { conn.close(); return; }

    // Send metadata first
    conn.send({ type: 'meta', name: currentFile.name, size: currentFile.size, mime: currentFile.type });

    // Then stream the file in chunks
    const chunkSize = 64 * 1024;
    const reader = currentFile.stream().getReader();
    let sent = 0;

    function sendNext() {
      reader.read().then(({ done, value }) => {
        if (done) {
          conn.send({ type: 'done' });
          if (remaining !== Infinity) {
            remaining--;
            if (remaining <= 0) setTimeout(stopHosting, 1000);
          }
          updateStatus();
          return;
        }
        conn.send({ type: 'chunk', data: value });
        sent += value.byteLength;
        setTimeout(sendNext, 0); // yield
      });
    }
    sendNext();
  });
  conn.on('close', () => {
    connections = connections.filter(c => c !== conn);
    updateStatus();
  });
}

function updateStatus() {
  if (!$('host-status')) return;
  const rem = remaining === Infinity ? 'Unlimited' : remaining + ' left';
  const exp = expiresAt ? 'Expires in ' + Math.max(0, Math.round((expiresAt - Date.now()) / 60000)) + ' min' : 'No expiry';
  $('host-status').textContent = `${connections.length} connected • ${rem} • ${exp}`;
}

// --- Join ---
$('join-btn').onclick = () => {
  const code = $('join-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) return alert('Enter a valid code');
  join(code);
};

const params = new URLSearchParams(location.search);
if (params.has('code')) {
  $('join-code').value = params.get('code');
  setTimeout(() => $('join-btn').click(), 300);
}

function join(code) {
  showView('downloading');
  $('dl-progress-text').textContent = 'Connecting to host…';
  peer = new Peer({ debug: 1 });
  peer.on('open', () => {
    const conn = peer.connect(code, { reliable: true });
    conn.on('open', () => {
      $('dl-progress-text').textContent = 'Connected, waiting for file…';
    });
    conn.on('data', data => handleIncomingData(data));
    conn.on('error', err => {
      $('dl-progress-text').textContent = 'Connection failed. Host may have closed the tab.';
      console.error(err);
    });
  });
  peer.on('error', err => {
    $('dl-progress-text').textContent = 'Could not connect. Check the code and that the host still has the tab open.';
    console.error(err);
  });
}

function handleIncomingData(msg) {
  if (msg.type === 'meta') {
    expectedSize = msg.size;
    $('dl-filename').textContent = msg.name;
    receivedChunks = [];
    receivedSize = 0;
  } else if (msg.type === 'chunk') {
    receivedChunks.push(msg.data);
    receivedSize += msg.data.byteLength;
    const pct = expectedSize ? Math.round(receivedSize / expectedSize * 100) : 0;
    $('dl-progress').style.width = pct + '%';
    $('dl-progress-text').textContent = pct + '% • ' + formatBytes(receivedSize);
  } else if (msg.type === 'done') {
    const blob = new Blob(receivedChunks);
    currentFile = blob;
    currentFile.name = $('dl-filename').textContent;
    showReceived(blob);
  }
}

function showReceived(blob) {
  showView('received');
  $('received-name').textContent = (blob.name || 'file') + ' • ' + formatBytes(blob.size);
  $('save-file').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = blob.name || 'download';
    a.click();
  };
}

function stopHosting() {
  if (peer) peer.destroy();
  peer = null;
  isHost = false;
  connections = [];
  showView('home');
  fileInfo.classList.add('hidden');
  createBtn.disabled = true;
  fileInput.value = '';
}

$('stop-hosting').onclick = stopHosting;

setInterval(() => { if (isHost) updateStatus(); }, 10000);

console.log('EZ Tab Share (PeerJS) ready');
