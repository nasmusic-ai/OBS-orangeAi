/*
  Mini Streamer v2 - Fully Fixed & Enhanced
*/

const layers = [];
const layersList = document.getElementById('layersList');
const preview = document.getElementById('preview');
const ctx = preview.getContext('2d', { alpha: false });
const fpsEl = document.getElementById('fps');
const recStatus = document.getElementById('recStatus');

let canvasW = 1920, canvasH = 1080;
let raf, lastTime = performance.now(), frames = 0, fps = 0;

let audioCtx = null;
let destination = null;
let mediaRecorder = null;
let recordedChunks = [];
let globalMuted = false;

// Drag state
let selectedLayer = null;
let dragMode = '';
let startX = 0, startY = 0;

const uid = () => Math.random().toString(36).substr(2, 9);

// Draw Loop
function drawLoop(now) {
  raf = requestAnimationFrame(drawLoop);
  frames++;
  if (now - lastTime >= 1000) {
    fps = frames; frames = 0; lastTime = now;
    fpsEl.textContent = fps;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  layers.forEach(L => {
    if (!L.visible) return;
    ctx.globalAlpha = L.opacity ?? 1;

    if (L.kind === 'image' && L.el.complete) {
      ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    } else if (L.kind === 'text') {
      ctx.font = `${L.size || 48}px Arial`;
      ctx.fillStyle = L.color || '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(L.text || 'Text', L.x, L.y);
    } else if (L.kind === 'timer') {
      const elapsed = L.running ? Math.floor((Date.now() - L.startTime) / 1000) : 0;
      const time = L.countdown ? Math.max(0, L.initial - elapsed) : elapsed;
      const mins = String(Math.floor(time / 60)).padStart(2, '0');
      const secs = String(time % 60).padStart(2, '0');
      ctx.font = '68px Arial';
      ctx.fillStyle = '#ff9500';
      ctx.textAlign = 'center';
      ctx.fillText(`${mins}:${secs}`, L.x, L.y);
    } else if (L.el && (L.el.readyState >= 2 || L.el.complete)) {
      ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    }
  });

  // Selection box
  if (selectedLayer) {
    ctx.strokeStyle = '#ff9500';
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(selectedLayer.x, selectedLayer.y, selectedLayer.w, selectedLayer.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff9500';
    ctx.fillRect(selectedLayer.x + selectedLayer.w - 16, selectedLayer.y + selectedLayer.h - 16, 16, 16);
  }
  ctx.globalAlpha = 1;
}

// Layers UI
function renderLayers() {
  layersList.innerHTML = '';
  [...layers].reverse().forEach(L => {
    const row = document.createElement('div');
    row.className = 'layer';

    const vis = document.createElement('input'); vis.type = 'checkbox'; vis.checked = L.visible;
    vis.onchange = () => { L.visible = vis.checked; };
    row.appendChild(vis);

    const name = document.createElement('div');
    name.textContent = L.kind[0].toUpperCase() + L.kind.slice(1);
    row.appendChild(name);

    const op = document.createElement('input'); op.type = 'range'; op.min = 0; op.max = 100; op.value = (L.opacity || 1) * 100;
    op.oninput = () => L.opacity = op.value / 100;
    row.appendChild(op);

    const up = document.createElement('button'); up.textContent = '↑';
    up.onclick = () => { const i = layers.indexOf(L); if (i < layers.length - 1) [layers[i], layers[i+1]] = [layers[i+1], layers[i]]; renderLayers(); };
    row.appendChild(up);

    const down = document.createElement('button'); down.textContent = '↓';
    down.onclick = () => { const i = layers.indexOf(L); if (i > 0) [layers[i], layers[i-1]] = [layers[i-1], layers[i]]; renderLayers(); };
    row.appendChild(down);

    const del = document.createElement('button'); del.textContent = '×'; del.style.color = '#f55';
    del.onclick = () => removeLayer(L.id);
    row.appendChild(del);

    layersList.appendChild(row);
  });
}

function removeLayer(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return;
  const L = layers[idx];
  if (L.stream) L.stream.getTracks().forEach(t => t.stop());
  if (L.audioNode) L.audioNode.disconnect();
  layers.splice(idx, 1);
  if (selectedLayer?.id === id) selectedLayer = null;
  renderLayers();
}

// Audio Setup
function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    destination = audioCtx.createMediaStreamDestination();
  }
}

function addAudioSource(stream) {
  if (!stream.getAudioTracks().length) return null;
  ensureAudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const gain = audioCtx.createGain();
  source.connect(gain).connect(destination);
  return gain;
}

// Sources
async function addWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const video = document.createElement('video');
    video.srcObject = stream; video.autoplay = video.muted = video.playsInline = true;
    await video.play();
    const layer = { id: uid(), kind: 'webcam', el: video, stream, visible: true, x: 100, y: 100, w: 640, h: 480 };
    layer.audioNode = addAudioSource(stream);
    layers.push(layer);
    renderLayers();
  } catch (e) { alert("Webcam access denied"); }
}

async function addScreen() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const video = document.createElement('video');
    video.srcObject = stream; video.autoplay = video.playsInline = true;
    await video.play();
    const layer = { id: uid(), kind: 'screen', el: video, stream, visible: true, x: 0, y: 0, w: canvasW, h: canvasH };
    layer.audioNode = addAudioSource(stream);
    layers.push(layer);
    renderLayers();
  } catch (e) { alert("Screen share cancelled"); }
}

function addVideoFile(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url; video.loop = video.autoplay = video.playsInline = true;
  video.muted = true;
  video.onloadedmetadata = () => video.play();
  const layer = { id: uid(), kind: 'video', el: video, visible: true, x: 200, y: 200, w: 800, h: 450 };
  if (video.captureStream) layer.audioNode = addAudioSource(video.captureStream());
  layers.push(layer);
  renderLayers();
}

function addImage(file) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = () => {
    const max = 400;
    const scale = Math.min(max / img.width, max / img.height);
    layers.push({
      id: uid(), kind: 'image', el: img, visible: true, opacity: 0.9,
      x: (canvasW - img.width * scale) / 2, y: (canvasH - img.height * scale) / 2,
      w: img.width * scale, h: img.height * scale
    });
    renderLayers();
  };
}

function addText() {
  const text = prompt("Enter text:", "LIVE NOW") || "Text";
  const color = prompt("Color (e.g. #ff0000):", "#ffffff") || "#fff";
  const size = parseInt(prompt("Font size:", "72") || "72");
  layers.push({ id: uid(), kind: 'text', text, color, size, visible: true, x: canvasW/2, y: canvasH/2 });
  renderLayers();
}

function addTimer() {
  const secs = parseInt(prompt("Countdown seconds (0 for stopwatch):", "300") || "0");
  layers.push({
    id: uid(), kind: 'timer', initial: secs, countdown: secs > 0, running: false, startTime: 0, visible: true,
    x: canvasW / 2, y: 100
  });
  renderLayers();
}

// Background / Logo
document.getElementById('btnBackground').onclick = () => document.getElementById('bgInput').click();
document.getElementById('bgInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  const el = isVideo ? document.createElement('video') : new Image();
  el.src = url;
  if (isVideo) { el.loop = el.autoplay = el.muted = true; el.play(); }
  layers.unshift({ id: uid(), kind: 'background', el, visible: true, x: 0, y: 0, w: canvasW, h: canvasH });
  renderLayers();
};

document.getElementById('btnLogo').onclick = () => document.getElementById('logoInput').click();
document.getElementById('logoInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = () => {
    const size = Math.min(200, canvasW * 0.15);
    layers.push({
      id: uid(), kind: 'logo', el: img, visible: true, opacity: 0.8,
      x: canvasW - size - 30, y: 30, w: size, h: size * (img.height / img.width)
    });
    renderLayers();
  };
};

// Drag & Resize
function getCoord(e) {
  const rect = preview.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvasW / rect.width),
    y: (clientY - rect.top) * (canvasH / rect.height)
  };
}

preview.addEventListener('pointerdown', e => {
  const pos = getCoord(e);
  selectedLayer = layers.slice().reverse().find(L => 
    pos.x >= L.x && pos.x <= L.x + L.w && pos.y >= L.y && pos.y <= L.y + L.h
  );
  if (selectedLayer) {
    startX = pos.x; startY = pos.y;
    dragMode = (pos.x > selectedLayer.x + selectedLayer.w - 30 && pos.y > selectedLayer.y + selectedLayer.h - 30) ? 'resize' : 'move';
    e.preventDefault();
  }
});

preview.addEventListener('pointermove', e => {
  if (!selectedLayer || !dragMode) return;
  const pos = getCoord(e);
  if (dragMode === 'move') {
    selectedLayer.x += pos.x - startX;
    selectedLayer.y += pos.y - startY;
  } else if (dragMode === 'resize') {
    selectedLayer.w += pos.x - startX;
    selectedLayer.h += pos.y - startY;
    selectedLayer.w = Math.max(50, selectedLayer.w);
    selectedLayer.h = Math.max(50, selectedLayer.h);
  }
  startX = pos.x; startY = pos.y;
});

preview.addEventListener('pointerup', () => { dragMode = ''; });

// Recording
document.getElementById('startRec').onclick = () => {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  ensureAudioContext();
  const outputStream = preview.captureStream(30);
  if (destination) outputStream.addTrack(destination.stream.getAudioTracks()[0]);
  mediaRecorder = new MediaRecorder(outputStream, { mimeType: 'video/webm' });
  recordedChunks = [];

  mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `recording_${Date.now()}.webm`;
    a.click();
    recStatus.textContent = 'idle';
  };

  mediaRecorder.start();
  recStatus.textContent = 'recording...';
};

// Mute & Stop
document.getElementById('muteAll').onclick = () => {
  globalMuted = !globalMuted;
  layers.forEach(L => { if (L.audioNode) L.audioNode.gain.value = globalMuted ? 0 : 1; });
  document.getElementById('muteAll').textContent = globalMuted ? 'Unmute All' : 'Mute All';
};

document.getElementById('stopAll').onclick = () => {
  layers.forEach(removeLayer);
  if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
  recStatus.textContent = 'stopped';
};

// Resolution
document.getElementById('applyRes').onclick = () => {
  const [w, h] = document.getElementById('resolution').value.split('x');
  canvasW = +w; canvasH = +h;
  preview.width = canvasW; preview.height = canvasH;
};

// Wire buttons
document.getElementById('btnWebcam').onclick = addWebcam;
document.getElementById('btnScreen').onclick = addScreen;
document.getElementById('btnVideoFile').onclick = () => document.getElementById('videoInput').click();
document.getElementById('videoInput').onchange = e => e.target.files[0] && addVideoFile(e.target.files[0]);
document.getElementById('btnImageOverlay').onclick = () => document.getElementById('imageInput').click();
document.getElementById('imageInput').onchange = e => e.target.files[0] && addImage(e.target.files[0]);
document.getElementById('btnText').onclick = addText;
document.getElementById('btnTimer').onclick = addTimer;

// Start
document.getElementById('applyRes').click();
drawLoop();
renderLayers();

// Permission Warning System
let permissionsGranted = false;

function showPermissionWarning(onAllowCallback) {
  if (permissionsGranted) {
    onAllowCallback();
    return;
  }

  document.getElementById('permWarning').style.display = 'flex';
  
  // Override the Allow button to run the actual permission request
  const btn = document.getElementById('allowPermissionsBtn');
  btn.onclick = async () => {
    closePermWarning();
    try {
      // Pre-warm audio context (critical on mobile!)
      if (!audioCtx || audioCtx.state === 'closed') {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();
      }

      // Trigger both permissions at once (best success rate)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      });
      
      // Now trigger screen share (this will show system dialog)
      // We do this after mic/cam to reduce denial rate
      setTimeout(async () => {
        try {
          await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          permissionsGranted = true;
          alert("All permissions granted! You can now use all features.");
          if (onAllowCallback) onAllowCallback();
        } catch (err) {
          alert("Screen sharing denied. Some features will be limited.");
        }
      }, 300);

      // Stop the test stream
      stream.getTracks().forEach(t => t.stop());
    } catch (err) {
      alert("Camera/Microphone denied. Please allow to use avatars & audio.");
    }
  };
}

function closePermWarning() {
  document.getElementById('permWarning').style.display = 'none';
}

// Modify your existing addWebcam and addScreen functions to use the warning
const originalAddWebcam = addWebcam;
addWebcam = () => {
  showPermissionWarning(originalAddWebcam);
};

const originalAddScreen = addScreen;
addScreen = () => {
  showPermissionWarning(() => {
    // Small delay to ensure mic/cam already granted
    setTimeout(originalAddScreen, 400);
  });
};
