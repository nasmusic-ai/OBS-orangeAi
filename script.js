const layers = [];
const preview = document.getElementById('preview');
const ctx = preview.getContext('2d');
let canvasW = 1920, canvasH = 1080;

let selectedLayer = null;
let isDragging = false;
let startX = 0, startY = 0;
let dragMode = 'move'; // 'move' or 'resize'

const uid = () => Math.random().toString(36).substr(2, 9);

// Iframe Canvas Elements (for drawing iframes)
const iframeCanvases = new Map();

function draw() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  layers.forEach(L => {
    if (!L.visible) return;
    ctx.globalAlpha = L.opacity || 1;

    try {
      if (L.kind === 'iframe') {
        let offscreen = iframeCanvases.get(L.id);
                if (!offscreen) {
                  offscreen = document.createElement('canvas');
                  offscreen.width = L.w;
                  offscreen.height = L.h;
                  iframeCanvases.set(L.id, offscreen);
                }
                const ictx = offscreen.getContext('2d');
                ictx.drawImage(L.el, 0, 0, L.w, L.h);
                ctx.drawImage(offscreen, L.x, L.y, L.w, L.h);
              } else if ((L.kind === 'video' || L.kind === 'webcam' || L.kind === 'screen') && L.el && L.el.readyState >= 2) {
                ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
              } else if (L.kind === 'image' && L.el.complete) {
                ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
              } else if (L.kind === 'text') {
                ctx.font = `${L.size || 80}px Arial`;
                ctx.fillStyle = L.color || '#ff9500';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(L.text || 'Text', L.x, L.y);
              } else if (L.kind === 'timer') {
                const elapsed = Date.now() - L.startTime;
                const remaining = Math.max(0, L.duration - elapsed);
                const mins = String(Math.floor(remaining / 60000)).padStart(2, '0');
                const secs = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
                ctx.font = '120px Arial';
                ctx.fillStyle = '#ff9500';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${mins}:${secs}`, canvasW/2, canvasH/2);
              }
            } catch(e) { }
          });

  // Selection box
  if (selectedLayer) {
    ctx.strokeStyle = '#ff9500';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.strokeRect(selectedLayer.x, selectedLayer.y, selectedLayer.w, selectedLayer.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff9500';
    ctx.fillRect(selectedLayer.x + selectedLayer.w - 24, selectedLayer.y + selectedLayer.h - 24, 24, 24);
  }

  requestAnimationFrame(draw);
}

// Touch/Mouse Handling
function getPointerPos(e) {
  const rect = preview.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * (canvasW / rect.width),
    y: (clientY - rect.top) * (canvasH / rect.height)
  };
}

preview.addEventListener('pointerdown', e => {
  const pos = getPointerPos(e);
  selectedLayer = layers.slice().reverse().find(L =>
    pos.x >= L.x && pos.x <= L.x + L.w && pos.y >= L.y && pos.y <= L.y + L.h
  );

  if (selectedLayer) {
    isDragging = true;
    startX = pos.x;
    startY = pos.y;
    const cornerX = selectedLayer.x + selectedLayer.w - 40;
    const cornerY = selectedLayer.y + selectedLayer.h - 40;
    dragMode = (pos.x > cornerX && pos.y > cornerY) ? 'resize' : 'move';
    preview.style.cursor = dragMode === 'resize' ? 'se-resize' : 'move';
  }
});

preview.addEventListener('pointermove', e => {
  if (!isDragging || !selectedLayer) return;
  e.preventDefault();
  const pos = getPointerPos(e);

  if (dragMode === 'resize') {
    selectedLayer.w += pos.x - startX;
    selectedLayer.h += pos.y - startY;
    selectedLayer.w = Math.max(100, selectedLayer.w);
    selectedLayer.h = Math.max(100, selectedLayer.h);
  } else {
    selectedLayer.x += pos.x - startX;
    selectedLayer.y += pos.y - startY;
  }
  startX = pos.x;
  startY = pos.y;
});

preview.addEventListener('pointerup', () => {
  isDragging = false;
  dragMode = 'move';
  preview.style.cursor = 'default';
});

// Add Sources
async function addWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = video.muted = video.playsInline = true;
  await video.play();
  layers.push({ id: uid(), kind: 'webcam', el: video, stream, visible: true, x: 100, y: 100, w: 640, h: 480, opacity: 1 });
  renderLayers();
}

async function addScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  await video.play();
  layers.push({ id: uid(), kind: 'screen', el: video, stream, visible: true, x: 0, y: 0, w: canvasW, h: canvasH, opacity: 1 });
  renderLayers();
}

function addBrowser() {
  const url = prompt("Website URL:", "https://example.com");
  if (!url) return;
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style = "position:absolute; top:0; left:0; width:100%; height:100%; border:0;";
  document.body.appendChild(iframe);
  layers.push({ id: uid(), kind: 'iframe', el: iframe, visible: true, x: 200, y: 200, w: 800, h: 600, opacity: 1 });
  setTimeout(() => iframe.remove(), 1000);
  renderLayers();
}

function addYouTube() {
  const id = prompt("YouTube Video ID:");
  if (!id) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&loop=1&playlist=${id}`;
  iframe.allow = "autoplay";
  document.body.appendChild(iframe);
  layers.push({ id: uid(), kind: 'iframe', el: iframe, visible: true, x: 300, y: 300, w: 800, h: 450, opacity: 1 });
  setTimeout(() => iframe.remove(), 1000);
  renderLayers();
}

function addTwitch() {
  const channel = prompt("Twitch Channel Name:");
  if (!channel) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://player.twitch.tv/?channel=${channel}&parent=${location.hostname}&muted=true`;
  document.body.appendChild(iframe);
  layers.push({ id: uid(), kind: 'iframe', el: iframe, visible: true, x: 200, y: 200, w: 800, h: 600, opacity: 1 });
  setTimeout(() => iframe.remove(), 1000);
  renderLayers();
}

document.getElementById('btnVideoFile').onclick = () => document.getElementById('videoInput').click();
document.getElementById('videoInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.loop = video.muted = video.autoplay = true;
  video.play();
  layers.push({ id: uid(), kind: 'video', el: video, visible: true, x: 400, y: 300, w: 800, h: 450, opacity: 1 });
  renderLayers();
};

document.getElementById('btnImage').onclick = () => document.getElementById('imageInput').click();
document.getElementById('imageInput').onchange = e => {
  const file = e.target.files[0];
  const img = new Image();
  img.onload = () => {
    layers.push({ id: uid(), kind: 'image', el: img, visible: true, x: 500, y: 300, w: 400, h: 400, opacity: 1 });
    renderLayers();
  };
  img.src = URL.createObjectURL(file);
};

document.getElementById('btnLogo').onclick = () => document.getElementById('imageInput').click();
document.getElementById('btnBackground').onclick = () => document.getElementById('bgInput').click();
document.getElementById('bgInput').onchange = e => {
  const file = e.target.files[0];
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  const el = isVideo ? document.createElement('video') : new Image();
  el.src = url;
  if (isVideo) { el.loop = el.muted = el.autoplay = true; el.play(); }
  layers.unshift({ id: uid(), kind: 'background', el, visible: true, x: 0, y: 0, w: canvasW, h: canvasH, opacity: 1 });
  renderLayers();
};

document.getElementById('btnText').onclick = () => {
  const text = prompt("Text:", "LIVE");
  layers.push({ id: uid(), kind: 'text', text, color: '#ff9500', size: 100, visible: true, x: canvasW/2, y: 200, opacity: 1 });
  renderLayers();
};

document.getElementById('btnTimer').onclick = () => {
  const mins = parseInt(prompt("Minutes:", "10") || "10");
  layers.push({ id: uid(), kind: 'timer', duration: mins * 60000, startTime: Date.now(), visible: true, opacity: 1 });
  renderLayers();
};

// Layers List
function renderLayers() {
  document.getElementById('layersList').innerHTML = layers.map(L => `
    <div class="layer" style="background:${selectedLayer?.id===L.id?'#333':''}">
      <input type="checkbox" ${L.visible?'checked':''} onchange="L.visible=this.checked">
      <span>${L.kind.toUpperCase()} ${L.text||''}</span>
      <input type="range" min="0" max="100" value="${(L.opacity||1)*100}" onchange="L.opacity=this.value/100">
      <button onclick="removeLayer('${L.id}')">Delete</button>
    </div>
  `).join('');
}

function removeLayer(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx !== -1) {
    const L = layers[idx];
    if (L.stream) L.stream.getTracks().forEach(t => t.stop());
    if (L.el && L.el.srcObject) L.el.srcObject = null;
    layers.splice(idx, 1);
    if (selectedLayer?.id === id) selectedLayer = null;
    renderLayers();
  }
}

// Permission System
let permsGranted = false;
function requestPermissions() {
  if (permsGranted) return Promise.resolve();
  return new Promise(resolve => {
    document.getElementById('permWarning').classList.add('show');
    document.getElementById('allowBtn').onclick = async () => {
      document.getElementById('permWarning').classList.remove('show');
      try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        permsGranted = true;
        alert("Permissions granted!");
        resolve();
      } catch (e) {
        alert("Permission denied");
      }
    };
  });
}
function closePermWarning() {
  document.getElementById('permWarning').classList.remove('show');
}

// Button Wiring
document.getElementById('btnWebcam').onclick = () => requestPermissions().then(addWebcam);
document.getElementById('btnScreen').onclick = () => requestPermissions().then(addScreen);
document.getElementById('btnBrowser').onclick = addBrowser;
document.getElementById('btnYouTube').onclick = addYouTube;
document.getElementById('btnTwitch').onclick = addTwitch;

// Recording
let recorder = null;
document.getElementById('startRec').onclick = () => {
  if (recorder?.state === 'recording') {
    recorder.stop();
    return;
  }
  const stream = preview.captureStream(30);
  recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'recording.webm'; a.click();
  };
  recorder.start();
  document.getElementById('startRec').textContent = 'STOP';
};

// Resolution
document.getElementById('applyRes').onclick = () => {
  const [w, h] = document.getElementById('resolution').value.split('x');
  canvasW = +w; canvasH = +h;
  preview.width = canvasW; preview.height = canvasH;
};

// Init
document.getElementById('applyRes').click();
draw();
renderLayers();
