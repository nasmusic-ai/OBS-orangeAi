/*
  Mini browser "streamer" / recorder:
  - Composes webcam / screen / video / image overlay to a canvas.
  - Mixes audio into the recorded stream.
  - Records via MediaRecorder and downloads a .webm file.
*/

const layers = []; // {id, kind:'webcam'|'screen'|'video'|'image', el:HTMLMediaElement|Image, visible,true, opacity, x,y,w,h, audioNode?}
const layersList = document.getElementById('layersList');
const scenesList = document.getElementById('scenesList');
const preview = document.getElementById('preview');
const ctx = preview.getContext('2d', { alpha: false });
const fpsEl = document.getElementById('fps');
const recStatus = document.getElementById('recStatus');
const recordingInfo = document.getElementById('recordingInfo');

let canvasW = 1280, canvasH = 720;
let raf, lastTime=performance.now(), frames=0, fps=0;

let audioCtx = null;
let destination = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStart = null;

// util id
const uid = (p=6) => Math.random().toString(36).slice(2,2+p);

// draw loop
function drawLoop(now){
  raf = requestAnimationFrame(drawLoop);
  // FPS calc
  frames++;
  if(now - lastTime >= 1000){
    fps = frames;
    frames=0;
    lastTime = now;
    fpsEl.textContent = fps;
  }

  // clear
  ctx.fillStyle = '#031023';
  ctx.fillRect(0,0,canvasW,canvasH);

  // draw layers in order
  for(const L of layers){
    if(!L.visible) continue;
    ctx.globalAlpha = (typeof L.opacity === 'number') ? L.opacity : 1.0;

    if(L.kind === 'image'){
      const img = L.el;
      if(img.complete) ctx.drawImage(img, L.x, L.y, L.w, L.h);
    } else if(L.kind === 'video' || L.kind === 'webcam' || L.kind === 'screen'){
      const v = L.el;
      if(!v.paused && v.readyState >= 2){
        // preserve aspect by default
        ctx.drawImage(v, L.x, L.y, L.w, L.h);
      } else if(v.readyState >= 2){
        ctx.drawImage(v, L.x, L.y, L.w, L.h);
      }
    }
    ctx.globalAlpha = 1.0;
  }
}

// add layer UI
function renderLayers(){
  layersList.innerHTML = '';
  for(const L of [...layers].reverse()){ // show top-first
    const row = document.createElement('div');
    row.className='layer';

    const vis = document.createElement('input'); vis.type='checkbox'; vis.checked = !!L.visible;
    vis.onchange = () => { L.visible = vis.checked; };
    row.appendChild(vis);

    const label = document.createElement('div');
    label.style.minWidth='120px';
    label.textContent = `${L.kind} (${L.id})`;
    row.appendChild(label);

    const range = document.createElement('input'); range.type='range'; range.min=0; range.max=1; range.step=0.01;
    range.value = L.opacity ?? 1;
    range.oninput = () => { L.opacity = parseFloat(range.value); };
    row.appendChild(range);

    const up = document.createElement('button'); up.textContent='↑'; up.title='Move up';
    up.onclick = () => { moveLayer(L.id, 1); };
    row.appendChild(up);

    const down = document.createElement('button'); down.textContent='↓'; down.title='Move down';
    down.onclick = () => { moveLayer(L.id, -1); };
    row.appendChild(down);

    const del = document.createElement('button'); del.textContent='✖'; del.title='Remove';
    del.onclick = () => { removeLayer(L.id); };
    row.appendChild(del);

    layersList.appendChild(row);
  }
}

function moveLayer(id, dir){
  const idx = layers.findIndex(x=>x.id===id);
  if(idx === -1) return;
  const to = Math.max(0, Math.min(layers.length-1, idx - dir));
  const [item] = layers.splice(idx,1);
  layers.splice(to,0,item);
  renderLayers();
}

function removeLayer(id){
  const idx = layers.findIndex(x=>x.id===id);
  if(idx===-1) return;
  const L = layers[idx];
  // stop media if webcam/screen/video
  if(L.kind === 'webcam' || L.kind === 'screen' || L.kind === 'video'){
    try{ L.el.pause(); }catch(e){}
    if(L.el.srcObject){
      const tracks = L.el.srcObject.getTracks();
      tracks.forEach(t=>t.stop());
    }
  }
  // disconnect audio node
  if(L.audioNode){
    try{ L.audioNode.disconnect(); }catch(e){}
  }
  layers.splice(idx,1);
  renderLayers();
}

// create media nodes + add layer
async function addWebcam(){
  try{
    const s = await navigator.mediaDevices.getUserMedia({video:{width:1280}, audio:true});
    const v = document.createElement('video'); v.autoplay=true; v.muted=true; v.playsInline=true;
    v.srcObject = s;
    await v.play();
    const L = createLayer('webcam', v, s);
    // set default geometry
    L.x=0; L.y=0; L.w=canvasW/2; L.h=canvasH/2; L.opacity=1; L.visible=true;
    layers.push(L);
    setupAudioForLayer(L, s);
    renderLayers();
  }catch(err){ alert('Webcam denied or error: ' + err.message); }
}

async function addScreen(){
  try{
    const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:true});
    const v = document.createElement('video'); v.autoplay=true; v.muted=true; v.playsInline=true;
    v.srcObject = s;
    await v.play();
    const L = createLayer('screen', v, s);
    L.x=canvasW/2; L.y=0; L.w=canvasW/2; L.h=canvasH; L.opacity=1; L.visible=true;
    layers.push(L);
    setupAudioForLayer(L, s);
    renderLayers();
  }catch(err){ alert('Screen share denied or error: ' + err.message); }
}

function addVideoFile(file){
  const url = URL.createObjectURL(file);
  const v = document.createElement('video'); v.src = url; v.loop=true; v.autoplay=true; v.muted=false; v.playsInline=true;
  v.controls = true;
  v.onloadedmetadata = () => {
    v.play().catch(()=>{});
  };
  const L = createLayer('video', v, null);
  L.x = 0; L.y = canvasH/2; L.w = canvasW/2; L.h = canvasH/2; L.opacity=1; L.visible=true;
  layers.push(L);
  // try to add audio from file if any
  const s = v.captureStream ? v.captureStream() : null;
  if(s) setupAudioForLayer(L, s);
  renderLayers();
}

function addImageFile(file){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  img.onload = ()=>{ /* ok */};
  const L = createLayer('image', img, null);
  // fit overlay center
  const w = canvasW/3, h = canvasH/3;
  L.x = (canvasW - w)/2; L.y = (canvasH - h)/2; L.w=w; L.h=h; L.opacity=0.9; L.visible=true;
  layers.push(L);
  renderLayers();
}

function createLayer(kind, el, stream){
  return {
    id: uid(5),
    kind,
    el,
    stream, // optional
    visible: true,
    opacity: 1,
    x:0,y:0,w:canvasW,h:canvasH,
    audioNode: null
  };
}

// audio mixing
function ensureAudio(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    destination = audioCtx.createMediaStreamDestination(); // mixed audio -> destination.stream
  }
}

function setupAudioForLayer(L, stream){
  if(!stream) return;
  ensureAudio();
  try{
    const srcNode = audioCtx.createMediaStreamSource(stream);
    const gain = audioCtx.createGain();
    gain.gain.value = 1.0;
    srcNode.connect(gain).connect(destination);
    L.audioNode = gain;
  }catch(e){
    console.warn('Audio setup failed:', e);
  }
}

// recording
function applyResolutionFromSelect(){
  const sel = document.getElementById('resolution').value.split('x');
  canvasW = parseInt(sel[0],10);
  canvasH = parseInt(sel[1],10);
  preview.width = canvasW;
  preview.height = canvasH;
  // update default layer sizes (not changing existing positions/scale)
}

document.getElementById('applyRes').onclick = () => {
  applyResolutionFromSelect();
};

function startRecording(){
  if(mediaRecorder && mediaRecorder.state === 'recording'){
    alert('Already recording');
    return;
  }
  // canvas stream
  const canvasStream = preview.captureStream(30); // 30 FPS
  // ensure audio destination exists and add its tracks
  if(destination && destination.stream){
    for(const tr of destination.stream.getAudioTracks()){
      canvasStream.addTrack(tr);
    }
  }
  // fallback: if any layers have raw MediaStream with audio, add them (best-effort)
  for(const L of layers){
    if(L.stream){
      const audioTracks = L.stream.getAudioTracks();
      audioTracks.forEach(t => {
        // only add if not present (avoid duplicates)
        if(!canvasStream.getAudioTracks().some(at=>at.id === t.id)){
          canvasStream.addTrack(t);
        }
      });
    }
  }

  // start media recorder
  recordedChunks = [];
  const options = {mimeType: 'video/webm;codecs=vp9,opus'};
  try{
    mediaRecorder = new MediaRecorder(canvasStream, options);
  }catch(e){
    try{ mediaRecorder = new MediaRecorder(canvasStream); }catch(err){ alert('MediaRecorder not supported: ' + err.message); return; }
  }

  mediaRecorder.ondataavailable = e => { if(e.data && e.data.size) recordedChunks.push(e.data); };
  mediaRecorder.onstart = () => {
    recStatus.textContent = 'recording';
    recordingStart = Date.now();
    document.getElementById('startRec').disabled = true;
    document.getElementById('stopRec').disabled = false;
  };
  mediaRecorder.onstop = () => {
    recStatus.textContent = 'idle';
    document.getElementById('startRec').disabled = false;
    document.getElementById('stopRec').disabled = true;

    const blob = new Blob(recordedChunks, {type:'video/webm'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    a.href = url;
    a.download = `recording-${ts}.webm`;
    a.click();
    recordingInfo.textContent = `Downloaded recording-${ts}.webm (${(blob.size/1024/1024).toFixed(2)} MB)`;
  };
  mediaRecorder.start(1000);
}

function stopRecording(){
  if(mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
}

// scenes (save & recall simple visibility/opacity/order snapshot)
const scenes = {}; // name -> snapshot of layers metadata (id order/visible/opacity/x/y/w/h/kind, but not element)
function saveScene(){
  const name = document.getElementById('sceneName').value.trim();
  if(!name) return alert('Give scene a name');
  scenes[name] = layers.map(L => ({id:L.id, kind:L.kind, visible:L.visible, opacity:L.opacity, x:L.x,y:L.y,w:L.w,h:L.h}));
  renderScenes();
}
function renderScenes(){
  scenesList.innerHTML = '';
  Object.keys(scenes).forEach(name => {
    const btn = document.createElement('button'); btn.className='pill'; btn.textContent = name;
    btn.onclick = () => recallScene(name);
    scenesList.appendChild(btn);
  });
}
function recallScene(name){
  const snap = scenes[name];
  if(!snap) return;
  // Map snapshot to existing layers (by id). If a layer is missing, ignore.
  for(const s of snap){
    const L = layers.find(x=>x.id===s.id);
    if(L){
      L.visible = s.visible;
      L.opacity = s.opacity;
      L.x = s.x; L.y = s.y; L.w = s.w; L.h = s.h;
    }
  }
  renderLayers();
}

// UI wiring
document.getElementById('btnWebcam').onclick = addWebcam;
document.getElementById('btnScreen').onclick = addScreen;
document.getElementById('btnVideoFile').onclick = () => document.getElementById('videoInput').click();
document.getElementById('videoInput').onchange = (ev) => {
  const f = ev.target.files && ev.target.files[0]; if(f) addVideoFile(f); ev.target.value='';
};
document.getElementById('btnImageOverlay').onclick = () => document.getElementById('imageInput').click();
document.getElementById('imageInput').onchange = (ev) => {
  const f = ev.target.files && ev.target.files[0]; if(f) addImageFile(f); ev.target.value='';
};

document.getElementById('startRec').onclick = startRecording;
document.getElementById('stopRec').onclick = stopRecording;
document.getElementById('saveScene').onclick = saveScene;

// start rendering
applyResolutionFromSelect();
drawLoop(performance.now());

// clean up on unload
window.addEventListener('beforeunload', ()=>{
  cancelAnimationFrame(raf);
  layers.forEach(L=>{ try{ if(L.stream){ L.stream.getTracks().forEach(t=>t.stop()); } }catch(e){} });
  if(audioCtx) try{ audioCtx.close(); }catch(e){}
});