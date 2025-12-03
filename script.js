// script.js
const layers = [];
const preview = document.getElementById('preview');
const ctx = preview.getContext('2d');
const canvasW = 1920, canvasH = 1080;

let selectedLayer = null;
let isDragging = false;
let startX = 0, startY = 0;
let dragMode = 'move';

let talkingHead = null;
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;

const uid = () => Math.random().toString(36).substr(2, 9);

// ========================= DRAW LOOP =========================
function drawLoop() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  layers.forEach(L => {
    if (!L.visible) return;
    ctx.globalAlpha = L.opacity ?? 1;

    if ((L.kind === 'image' || L.kind === 'video' || L.kind === 'webcam' || L.kind === 'screen') && L.el?.complete !== undefined || L.el?.readyState >= 2) {
      ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    } else if (L.kind === 'text') {
      ctx.font = `${L.size || 72}px Inter`;
      ctx.fillStyle = L.color || '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(L.text || 'Text', L.x, L.y);
    } else if (L.kind === 'timer') {
      let seconds = L.init || 0;
      if (L.running) {
        const elapsed = Math.floor((Date.now() - L.startTime) / 1000);
        seconds = L.dir === 'down' ? (L.init || 0) - elapsed : (L.init || 0) + elapsed;
        if (seconds < 0) seconds = 0;
      }
      const m = String(Math.floor(seconds / 60)).padStart(2, '0');
      const s = String(seconds % 60).padStart(2, '0');
      ctx.font = '72px Inter';
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'top';
      ctx.fillText(`${m}:${s}`, L.x, L.y);
    }
  });
  ctx.globalAlpha = 1;

  // Selection box
  if (selectedLayer) {
    ctx.strokeStyle = '#ff0';
    ctx.lineWidth = 4;
    ctx.strokeRect(selectedLayer.x, selectedLayer.y, selectedLayer.w, selectedLayer.h);
    ctx.fillStyle = '#ff0';
    ctx.fillRect(selectedLayer.x + selectedLayer.w - 20, selectedLayer.y + selectedLayer.h - 20, 20, 20);
  }

  requestAnimationFrame(drawLoop);
}

// ========================= DRAG & RESIZE =========================
function getMousePos(e) {
  const rect = preview.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvasW / rect.width),
    y: (clientY - rect.top) * (canvasH / rect.height)
  };
}

preview.addEventListener('mousedown', handleStart);
preview.addEventListener('touchstart', handleStart, {passive: false});
preview.addEventListener('mousemove', handleMove);
preview.addEventListener('touchmove', handleMove, {passive: false});
preview.addEventListener('mouseup', handleEnd);
preview.addEventListener('touchend', handleEnd);

function handleStart(e) {
  e.preventDefault();
  const pos = getMousePos(e);
  startX = pos.x; startY = pos.y;

  selectedLayer = layers.slice().reverse().find(L =>
    pos.x >= L.x && pos.x <= L.x + L.w &&
    pos.y >= L.y && pos.y <= L.y + L.h
  );

  if (selectedLayer) {
    // Check resize handle
    if (pos.x > selectedLayer.x + selectedLayer.w - 40 && pos.y > selectedLayer.y + selectedLayer.h - 40) {
      dragMode = 'resize';
    } else {
      dragMode = 'move';
    }
  }
}

function handleMove(e) {
  if (!selectedLayer) return;
  e.preventDefault();
  const pos = getMousePos(e);
  if (dragMode === 'move') {
    selectedLayer.x += pos.x - startX;
    selectedLayer.y += pos.y - startY;
  } else if (dragMode === 'resize') {
    selectedLayer.w += pos.x - startX;
    selectedLayer.h += pos.y - startY;
    selectedLayer.w = Math.max(50, selectedLayer.w);
    selectedLayer.h = Math.max(50, selectedLayer.h);
  }
  startX = pos.x;
  startY = pos.y;
}

function handleEnd() {
  dragMode = 'move';
}

// ========================= LAYER MANAGEMENT =========================
function renderLayers() {
  const list = document.getElementById('layersList');
  list.innerHTML = '';
  layers.forEach(L => {
    const div = document.createElement('div');
    div.className = 'layer';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = L.visible;
    chk.onchange = () => { L.visible = chk.checked; };

    const name = document.createElement('span');
    name.textContent = L.name || L.kind;

    const op = document.createElement('input');
    op.type = 'range'; op.min = 0; op.max = 100; op.value = (L.opacity ?? 1) * 100;
    op.oninput = () => L.opacity = op.value / 100;

    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => removeLayer(L.id);

    div.append(chk, name, op, del);
    list.appendChild(div);
  });
}

function removeLayer(id) {
  const idx = layers.findIndex(x => x.id === id);
  if (idx === -1) return;
  const L = layers[idx];
  if (L.stream) L.stream.getTracks().forEach(t => t.stop());
  layers.splice(idx, 1);
  if (selectedLayer?.id === id) selectedLayer = null;
  renderLayers();
}

// ========================= ADD SOURCES =========================
async function addWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = video.muted = video.playsInline = true;
    await video.play();
    layers.push({
      id: uid(), kind: 'webcam', name: 'Webcam', el: video, stream,
      x: 100, y: 100, w: 600, h: 450, visible: true
    });
    renderLayers();
  } catch (e) { alert('Webcam access denied'); }
}

async function addScreen() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({video: true});
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    stream.getTracks()[0].onended = () => removeLayer(layers.find(l => l.stream === stream)?.id);
    layers.push({
      id: uid(), kind: 'screen', name: 'Screen', el: video, stream,
      x: 0, y: 0, w: canvasW, h: canvasH, visible: true
    });
    renderLayers();
  } catch (e) { console.log('Screen share cancelled'); }
}

function addImage(file) {
  const img = new Image();
  img.onload = () => {
    layers.push({
      id: uid(), kind: 'image', name: file.name.split('.')[0], el: img,
      x: 200, y: 200, w: img.width / 2, h: img.height / 2, visible: true
    });
    renderLayers();
  };
  img.src = URL.createObjectURL(file);
}

function addVideo(file) {
  const video = document.createElement('video');
  video.loop = true; video.autoplay = true; video.muted = true;
  video.src = URL.createObjectURL(file);
  video.onloadedmetadata = () => {
    layers.push({
      id: uid(), kind: 'video', name: file.name.split('.')[0], el: video,
      x: 100, y: 100, w: 800, h: 450, visible: true
    });
    video.play();
    renderLayers();
  };
}

function addText() {
  const text = prompt('Enter text:', 'Hello World');
  if (!text) return;
  const color = prompt('Color (e.g. #ff0000 or red)', '#ffffff') || '#ffffff';
  layers.push({
    id: uid(), kind: 'text', name: 'Text', text, color,
    size: 72, x: 200, y: 200, visible: true
  });
  renderLayers();
}

function addTimer() {
  const minutes = parseInt(prompt('Start minutes:', '5') || '5');
  layers.push({
    id: uid(), kind: 'timer', name: 'Timer',
    init: minutes * 60, dir: 'down', running: false,
    x: 200, y: 100, visible: true
  });
  renderLayers();
}

// ========================= ANIMATED OVERLAY =========================
document.getElementById('btnTriggerAnimation').onclick = () => {
  const el = document.getElementById('animatedOverlay');
  el.style.display = 'block';
  el.classList.remove('animate__fadeInUp');
  void el.offsetWidth; // trigger reflow
  el.classList.add('animate__animated', 'animate__fadeInUp');
  setTimeout(() => {
    el.classList.remove('animate__animated', 'animate__fadeInUp');
    el.style.display = 'none';
  }, 3000);
};

// ========================= LIP-SYNC AVATAR =========================
document.getElementById('btnLoadAvatar').onclick = async () => {
  if (talkingHead) return alert('Avatar already loaded');
  const container = document.getElementById('avatarContainer');
  talkingHead = new TalkingHead(container);
  await talkingHead.showAvatar({
    avatar: "https://models.readyplayer.me/6565f8b4a9c0f100d43d0b0b.glb" // free example
  });

  micStream = await navigator.mediaDevices.getUserMedia({audio: true});
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(micStream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  talkingHead.startListening(analyser);
};

// ========================= RECORD & PLAY =========================
document.getElementById('startRec').onclick = () => {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    document.getElementById('startRec').textContent = 'RECORD';
    return;
  }

  const stream = preview.captureStream(30);
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, {mimeType: 'video/webm;codecs=vp9'});

  mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, {type: 'video/webm'});
    alert('Recording finished!');
  };

  mediaRecorder.start();
  document.getElementById('startRec').textContent = 'STOP';
};

document.getElementById('streamRecorded').onclick = () => {
  if (!recordedBlob) return alert('Nothing recorded yet');
  const video = document.createElement('video');
  video.src = URL.createObjectURL(recordedBlob);
  video.loop = true; video.autoplay = true; video.muted = true;
  video.play();

  layers.push({
    id: uid(), kind: 'video', name: 'Recorded Clip', el: video,
    x: 0, y: 0, w: canvasW, h: canvasH, visible: true
  });
  renderLayers();
};

// ========================= LIVE STREAM (Millicast) =========================
let millicastPublisher = null;
document.getElementById('goLive').onclick = async () => {
  const token = prompt('Enter your Millicast Publish Token', '');
  if (!token) return;

  if (millicastPublisher) {
    await millicastPublisher.disconnect();
    millicastPublisher = null;
    document.getElementById('goLive').textContent = 'GO LIVE';
    return;
  }

  try {
    const stream = preview.captureStream(30);
    const publisher = await Millicast.Director.getPublisher({token});
    await publisher.connect({mediaStream: stream});
    millicastPublisher = publisher;
    document.getElementById('goLive').textContent = 'STOP LIVE';
    alert('You are LIVE on Millicast!');
  } catch (e) {
    console.error(e);
    alert('Failed to go live: ' + e.message);
  }
};

// ========================= BUTTONS =========================
document.getElementById('btnWebcam').onclick = addWebcam;
document.getElementById('btnScreen').onclick = addScreen;
document.getElementById('btnVideoFile').onclick = () => document.getElementById('videoInput').click();
document.getElementById('btnImage').onclick = () => document.getElementById('imageInput').click();
document.getElementById('btnText').onclick = addText;
document.getElementById('btnTimer').onclick = addTimer;

document.getElementById('imageInput').onchange = e => e.target.files[0] && addImage(e.target.files[0]);
document.getElementById('videoInput').onchange = e => e.target.files[0] && addVideo(e.target.files[0]);

// Toggle sidebar
function togglePanel() {
  document.getElementById('sidePanel').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}

// Start everything
drawLoop();
renderLayers();
