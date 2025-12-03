/*
  Mini Streamer v2 - Mobile, Themes, More Features
*/

const layers = [];
const layersList = document.getElementById('layersList');
const scenesList = document.getElementById('scenesList');
const preview = document.getElementById('preview');
const ctx = preview.getContext('2d', { alpha: false });
const fpsEl = document.getElementById('fps');
const recStatus = document.getElementById('recStatus');
const recordingInfo = document.getElementById('recordingInfo');

let canvasW = 1280, canvasH = 720;
let raf, lastTime = performance.now(), frames = 0, fps = 0;

let audioCtx = null;
let destination = null;
let mediaRecorder = null;
let recordedChunks = [];
let millicastDirector = null;
let liveStreamActive = false;
let globalMuted = false;

// Drag/resize state
let selectedLayer = null;
let dragMode = ''; // 'move' or 'resize'
let startX = 0, startY = 0;

// util
const uid = (p=6) => Math.random().toString(36).slice(2,2+p);

// Draw loop
function drawLoop(now){
  raf = requestAnimationFrame(drawLoop);
  frames++;
  if(now - lastTime >= 1000){
    fps = frames; frames = 0; lastTime = now;
    fpsEl.textContent = fps;
  }

  ctx.fillStyle = '#031023';
  ctx.fillRect(0,0,canvasW,canvasH);

  for(const L of layers){
    if(!L.visible) continue;
    ctx.globalAlpha = L.opacity ?? 1;

    if(L.kind === 'image' && L.el.complete){
      ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    } else if(L.kind === 'text'){
      ctx.font = `${L.size ?? 48}px ${L.font ?? 'sans-serif'}`;
      ctx.fillStyle = L.color ?? '#fff';
      ctx.fillText(L.text ?? 'Text', L.x, L.y + (L.size ?? 48));
    } else if(L.kind === 'timer'){
      const time = L.running ? Math.floor((Date.now() - L.start) / 1000) * (L.dir === 'down' ? -1 : 1) + (L.init ?? 0) : L.init ?? 0;
      ctx.font = '48px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(time, L.x, L.y + 48);
    } else if(L.el.readyState >= 2){
      ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    }
  }
  ctx.globalAlpha = 1;

  // Draw resize handles if selected
  if(selectedLayer){
    ctx.strokeStyle = '#ff0'; ctx.lineWidth = 2;
    ctx.strokeRect(selectedLayer.x, selectedLayer.y, selectedLayer.w, selectedLayer.h);
    // Handles (bottom-right for resize)
    ctx.fillStyle = '#ff0';
    ctx.fillRect(selectedLayer.x + selectedLayer.w - 10, selectedLayer.y + selectedLayer.h - 10, 10, 10);
  }
}

// Render layers UI
function renderLayers(){
  layersList.innerHTML = '';
  [...layers].reverse().forEach(L => {
    const row = document.createElement('div');
    row.className = 'layer';

    const vis = document.createElement('input'); vis.type='checkbox'; vis.checked = L.visible;
    vis.onchange = () => { L.visible = vis.checked; };
    row.appendChild(vis);

    const label = document.createElement('div');
    label.textContent = `${L.kind} (${L.id.slice(0,4)})`;
    row.appendChild(label);

    const op = document.createElement('input'); op.type='range'; op.min=0; op.max=100; op.value=(L.opacity??1)*100;
    op.oninput = () => L.opacity = op.value/100;
    row.appendChild(op);

    if(L.audioNode){
      const vol = document.createElement('input'); vol.type='range'; vol.min=0; vol.max=200; vol.value=100;
      vol.oninput = () => L.audioNode.gain.value = vol.value/100;
      row.appendChild(vol);
    }

    if(L.kind === 'text'){
      const edit = document.createElement('button'); edit.textContent='Edit';
      edit.onclick = () => {
        L.text = prompt('Text:', L.text) || L.text;
        L.color = prompt('Color (hex/rgb):', L.color) || L.color;
        L.size = parseInt(prompt('Size:', L.size)) || L.size;
      };
      row.appendChild(edit);
    }

    if(L.kind === 'timer'){
      const startBtn = document.createElement('button'); startBtn.textContent = L.running ? 'Pause' : 'Start';
      startBtn.onclick = () => {
        if(L.running){
          L.init = Math.floor((Date.now() - L.start) / 1000) * (L.dir === 'down' ? -1 : 1) + (L.init ?? 0);
          L.running = false;
        } else {
          L.start = Date.now();
          L.running = true;
        }
        startBtn.textContent = L.running ? 'Pause' : 'Start';
      };
      row.appendChild(startBtn);
    }

    const up = document.createElement('button'); up.textContent='↑'; up.onclick = () => moveLayer(L.id, 1); row.appendChild(up);
    const down = document.createElement('button'); down.textContent='↓'; down.onclick = () => moveLayer(L.id, -1); row.appendChild(down);
    const del = document.createElement('button'); del.textContent='×'; del.onclick = () => removeLayer(L.id); row.appendChild(del);

    layersList.appendChild(row);
  });
}

function moveLayer(id, dir){
  const i = layers.findIndex(x=>x.id===id);
  if(i<0) return;
  const newI = Math.max(0, Math.min(layers.length-1, i - dir));
  [layers[i], layers[newI]] = [layers[newI], layers[i]];
  renderLayers();
}

function removeLayer(id){
  const L = layers.find(x=>x.id===id);
  if(!L) return;
  if(L.stream) L.stream.getTracks().forEach(t=>t.stop());
  if(L.audioNode) L.audioNode.disconnect();
  layers.splice(layers.indexOf(L),1);
  if(selectedLayer?.id === id) selectedLayer = null;
  renderLayers();
}

// Add sources
async function addWebcam(){
  try {
    const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
    const v = document.createElement('video'); v.autoplay = v.muted = v.playsInline = true;
    v.srcObject = s; await v.play();
    const L = {id:uid(), kind:'webcam', el:v, stream:s, visible:true, opacity:1, x:0, y:0, w:canvasW/2, h:canvasH/2};
    layers.push(L);
    setupAudioForLayer(L, s);
    renderLayers();
  } catch(e) { alert('Webcam denied'); }
}

async function addScreen(){
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:true});
    const v = document.createElement('video'); v.autoplay = v.muted = v.playsInline = true;
    v.srcObject = s; await v.play();
    const L = {id:uid(), kind:'screen', el:v, stream:s, visible:true, opacity:1, x:canvasW/2, y:0, w:canvasW/2, h:canvasH};
    layers.push(L);
    setupAudioForLayer(L, s);
    renderLayers();
  } catch(e) { alert('Screen denied'); }
}

function addVideoFile(file){
  const url = URL.createObjectURL(file);
  const v = document.createElement('video'); v.src = url; v.loop = v.autoplay = true; v.playsInline = true;
  v.onloadedmetadata = () => v.play();
  const L = {id:uid(), kind:'video', el:v, visible:true, opacity:1, x:0, y:canvasH/2, w:canvasW/2, h:canvasH/2};
  layers.push(L);
  if(v.captureStream) setupAudioForLayer(L, v.captureStream());
  renderLayers();
}

function addImageFile(file){
  const img = new Image(); img.src = URL.createObjectURL(file);
  const w = canvasW/3, h = canvasH/3;
  const L = {id:uid(), kind:'image', el:img, visible:true, opacity:0.9, x:(canvasW-w)/2, y:(canvasH-h)/2, w, h};
  layers.push(L);
  renderLayers();
}

function addText(){
  const text = prompt('Enter text:') || 'Hello';
  const color = prompt('Color (hex/rgb):') || '#fff';
  const size = parseInt(prompt('Font size:') || 48);
  const L = {id:uid(), kind:'text', text, color, size, visible:true, opacity:1, x:canvasW/2, y:canvasH/2, w:0, h:0}; // w/h not used for text
  layers.push(L);
  renderLayers();
}

function addTimer(){
  const init = parseInt(prompt('Initial time (secs):') || 0);
  const dir = prompt('Direction (up/down):') || 'up';
  const L = {id:uid(), kind:'timer', init, dir, running:false, start:0, visible:true, opacity:1, x:canvasW-100, y:50, w:0, h:0};
  layers.push(L);
  renderLayers();
}

// Audio
function ensureAudio(){
  if(!audioCtx) {
    audioCtx = new AudioContext();
    destination = audioCtx.createMediaStreamDestination();
  }
}

function setupAudioForLayer(L, stream){
  if(!stream || !stream.getAudioTracks().length) return;
  ensureAudio();
  const source = audioCtx.createMediaStreamSource(stream);
  const gain = audioCtx.createGain(); gain.gain.value = 1;
  source.connect(gain).connect(destination);
  L.audioNode = gain;
}

// Global mute
document.getElementById('muteAll').onclick = () => {
  globalMuted = !globalMuted;
  layers.forEach(L => { if(L.audioNode) L.audioNode.gain.value = globalMuted ? 0 : 1; });
  alert(globalMuted ? 'Muted' : 'Unmuted');
};

// Resolution
function applyResolutionFromSelect(){
  const [w,h] = document.getElementById('resolution').value.split('x');
  canvasW = +w; canvasH = +h;
  preview.width = canvasW; preview.height = canvasH;
  // Scale layers proportionally (simple)
  layers.forEach(L => { L.x *= canvasW/1280; L.y *= canvasH/720; L.w *= canvasW/1280; L.h *= canvasH/720; });
}
document.getElementById('applyRes').onclick = applyResolutionFromSelect;

// Drag & Resize (touch/mouse)
function handleStart(e){
  e.preventDefault();
  const touch = e.touches ? e.touches[0] : e;
  const rect = preview.getBoundingClientRect();
  startX = (touch.clientX - rect.left) * (canvasW / rect.width);
  startY = (touch.clientY - rect.top) * (canvasH / rect.height);
  selectedLayer = layers.find(L => startX > L.x && startX < L.x + L.w && startY > L.y && startY < L.y + L.h);
  if(selectedLayer){
    if(startX > selectedLayer.x + selectedLayer.w - 20 && startY > selectedLayer.y + selectedLayer.h - 20){
      dragMode = 'resize';
    } else {
      dragMode = 'move';
    }
  }
}

function handleMove(e){
  if(!selectedLayer || !dragMode) return;
  e.preventDefault();
  const touch = e.touches ? e.touches[0] : e;
  const rect = preview.getBoundingClientRect();
  const x = (touch.clientX - rect.left) * (canvasW / rect.width);
  const y = (touch.clientY - rect.top) * (canvasH / rect.height);
  if(dragMode === 'move'){
    selectedLayer.x += x - startX;
    selectedLayer.y += y - startY;
  } else {
    selectedLayer.w += x - startX;
    selectedLayer.h += y - startY;
  }
  startX = x; startY = y;
}

function handleEnd(){
  dragMode = '';
}

preview.addEventListener('mousedown', handleStart);
preview.addEventListener('mousemove', handleMove);
preview.addEventListener('mouseup', handleEnd);
preview.addEventListener('touchstart', handleStart, {passive:false});
preview.addEventListener('touchmove', handleMove, {passive:false});
preview.addEventListener('touchend', handleEnd);

// Recording
function startRecording(){
  // similar to before, omitted for brevity
  // ...
}

// Live Stream
async function startLiveStream(){
  // similar to before, omitted for brevity
  // ...
}

// Stop All
function stopAll(){
  // similar
}

// Scenes + Export/Import
const scenes = {};
function saveScene(){
  const n = document.getElementById('sceneName').value.trim();
  if(!n) return;
  scenes[n] = layers.map(L => ({...L, el:undefined, stream:undefined, audioNode:undefined})); // strip non-serializable
  renderScenes();
}
function renderScenes(){
  scenesList.innerHTML = '';
  Object.keys(scenes).forEach(n => {
    const b = document.createElement('button'); b.className='pill'; b.textContent = n;
    b.onclick = () => recallScene(n);
    scenesList.appendChild(b);
  });
}
function recallScene(n){
  const s = scenes[n];
  if(!s) return;
  // Re-create elements/streams as needed, but for simplicity, assume manual re-add
  alert('Recall: Re-add media sources manually');
  layers.length = 0;
  layers.push(...s);
  renderLayers();
}

document.getElementById('exportScenes').onclick = () => {
  const blob = new Blob([JSON.stringify(scenes)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'scenes.json';
  a.click();
};

document.getElementById('importScenes').onclick = () => {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => { 
      scenes = JSON.parse(reader.result); 
      renderScenes(); 
      alert('Imported!');
    };
    reader.readAsText(file);
  };
  input.click();
};

// Theme switch
document.getElementById('themeSelect').onchange = e => document.body.dataset.theme = e.target.value;

// Wire
document.getElementById('btnWebcam').onclick = addWebcam;
document.getElementById('btnScreen').onclick = addScreen;
document.getElementById('btnVideoFile').onclick = () => document.getElementById('videoInput').click();
document.getElementById('videoInput').onchange = e => e.target.files[0] && addVideoFile(e.target.files[0]);
document.getElementById('btnImageOverlay').onclick = () => document.getElementById('imageInput').click();
document.getElementById('imageInput').onchange = e => e.target.files[0] && addImageFile(e.target.files[0]);
document.getElementById('btnText').onclick = addText;
document.getElementById('btnTimer').onclick = addTimer;

document.getElementById('startRec').onclick = startRecording;
document.getElementById('goLive').onclick = startLiveStream;
document.getElementById('stopAll').onclick = stopAll;
document.getElementById('saveScene').onclick = saveScene;

// Start
applyResolutionFromSelect();
drawLoop(performance.now());
renderScenes();

// Cleanup
window.addEventListener('beforeunload', () => {
  cancelAnimationFrame(raf);
  layers.forEach(removeLayer);
  if(audioCtx) audioCtx.close();
});

// Add Background (Image or Video)
document.getElementById('btnBackground').onclick = () => document.getElementById('bgInput').click();
document.getElementById('bgInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const isVideo = file.type.startsWith('video');
  const el = isVideo ? document.createElement('video') : new Image();
  if (isVideo) { el.loop = el.muted = el.playsInline = true; el.autoplay = true; }
  el.src = url;
  el.onload = el.onloadedmetadata = () => el[isVideo ? 'play' : 'complete'];
  const L = {
    id: uid(), kind: 'background', el, visible: true, opacity: 1,
    x: 0, y: 0, w: canvasW, h: canvasH
  };
  layers.unshift(L); // Background goes behind everything
  renderLayers();
};

// Add Logo (Watermark)
document.getElementById('btnLogo').onclick = () => document.getElementById('logoInput').click();
document.getElementById('logoInput').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.src = URL.createObjectURL(file);
  img.onload = () => {
    const size = Math.min(canvasW * 0.2, 200);
    const L = {
      id: uid(), kind: 'logo', el: img, visible: true, opacity: 0.8,
      x: canvasW - size - 30, y: 30, w: size, h: size
    };
    layers.push(L);
    renderLayers();
  };
};