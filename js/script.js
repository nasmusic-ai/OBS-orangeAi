/*
  Mini Browser Streamer + Recorder + LIVE TO TWITCH/YOUTUBE
  Now with free Dolby Millicast WebRTC → RTMP relay!
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
let recordingStart = null;

// Live streaming
let millicastDirector = null;
let liveStreamActive = false;

// util
const uid = (p=6) => Math.random().toString(36).slice(2,2+p);

// Main draw loop
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

    if(L.kind === 'image'){
      if(L.el.complete) ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    } else {
      if(L.el.readyState >= 2) ctx.drawImage(L.el, L.x, L.y, L.w, L.h);
    }
  }
  ctx.globalAlpha = 1;
}

// Layer UI
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

    const opacity = document.createElement('input'); opacity.type='range'; opacity.min=0; opacity.max=100; opacity.value=(L.opacity??1)*100;
    opacity.oninput = () => { L.opacity = opacity.value/100; };
    row.appendChild(opacity);

    const up = document.createElement('button'); up.textContent='↑';
    up.onclick = () => moveLayer(L.id, 1);
    row.appendChild(up);

    const down = document.createElement('button'); down.textContent='↓';
    down.onclick = () => moveLayer(L.id, -1);
    row.appendChild(down);

    const del = document.createElement('button'); del.textContent='×';
    del.onclick = () => removeLayer(L.id);
    row.appendChild(del);

    layersList.appendChild(row);
  });
}

function moveLayer(id, dir){
  const i = layers.findIndex(x=>x.id===id);
  if(i<0) return;
  const newI = Math.max(0, Math.min(layers.length-1, i - dir));
  const [item] = layers.splice(i,1);
  layers.splice(newI,0,item);
  renderLayers();
}

function removeLayer(id){
  const L = layers.find(x=>x.id===id);
  if(!L) return;
  if(L.stream) L.stream.getTracks().forEach(t=>t.stop());
  if(L.audioNode) L.audioNode.disconnect();
  layers.splice(layers.indexOf(L),1);
  renderLayers();
}

// Add sources
async function addWebcam(){
  try {
    const s = await navigator.mediaDevices.getUserMedia({video:{width:1280,height:720}, audio:true});
    const v = document.createElement('video'); v.autoplay=v.muted=v.playsInline=true;
    v.srcObject = s; await v.play();
    const L = {id:uid(), kind:'webcam', el:v, stream:s, visible:true, opacity:1, x:0, y:0, w:canvasW/2, h:canvasH/2};
    layers.push(L);
    setupAudioForLayer(L, s);
    renderLayers();
  } catch(e) { alert('Webcam access denied'); }
}

async function addScreen(){
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({video:true, audio:true});
    const v = document.createElement('video'); v.autoplay=v.muted=v.playsInline=true;
    v.srcObject = s; await v.play();
    const L = {id:uid(), kind:'screen', el:v, stream:s, visible:true, opacity:1, x:canvasW/2, y:0, w:canvasW/2, h:canvasH};
    layers.push(L);
    setupAudioForLayer(L, s);
    renderLayers();
  } catch(e) { alert('Screen share cancelled'); }
}

function addVideoFile(file){
  const url = URL.createObjectURL(file);
  const v = document.createElement('video'); v.src=url; v.loop=v.autoplay=true; v.playsInline=true;
  v.onloadedmetadata = () => v.play();
  const L = {id:uid(), kind:'video', el:v, visible:true, opacity:1, x:0, y:canvasH/2, w:canvasW/2, h:canvasH/2};
  layers.push(L);
  if(v.captureStream) setupAudioForLayer(L, v.captureStream());
  renderLayers();
}

function addImageFile(file){
  const img = new Image();
  img.src = URL.createObjectURL(file);
  const w = canvasW/3, h = canvasH/3;
  const L = {id:uid(), kind:'image', el:img, visible:true, opacity:0.9, x:(canvasW-w)/2, y:(canvasH-h)/2, w, h};
  layers.push(L);
  renderLayers();
}

// Audio mixing
function ensureAudio(){
  if(!audioCtx){
    audioCtx = new AudioContext();
    destination = audioCtx.createMediaStreamDestination();
  }
}

function setupAudioForLayer(L, stream){
  if(!stream || !stream.getAudioTracks().length) return;
  ensureAudio();
  const source = audioCtx.createMediaStreamSource(stream);
  const gain = audioCtx.createGain();
  source.connect(gain).connect(destination);
  L.audioNode = gain;
}

// Resolution
function applyResolutionFromSelect(){
  const [w,h] = document.getElementById('resolution').value.split('x');
  canvasW = +w; canvasH = +h;
  preview.width = canvasW; preview.height = canvasH;
}
document.getElementById('applyRes').onclick = applyResolutionFromSelect;

// Recording (unchanged)
function startRecording(){
  if(mediaRecorder?.state === 'recording') return alert('Already recording');
  const stream = preview.captureStream(30);
  if(destination) destination.stream.getAudioTracks().forEach(t => stream.addTrack(t));
  layers.forEach(L => {
    if(L.stream?.getAudioTracks) L.stream.getAudioTracks().forEach(t => {
      if(!stream.getAudioTracks().some(x=>x.id===t.id)) stream.addTrack(t);
    });
  });

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, {mimeType: 'video/webm;codecs=vp9,opus'});
  mediaRecorder.ondataavailable = e => e.data.size && recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, {type:'video/webm'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `recording-${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;
    a.click();
    recordingInfo.textContent = `Downloaded ${a.download} (${(blob.size/1024/1024).toFixed(1)} MB)`;
  };
  mediaRecorder.start(1000);
  recStatus.textContent = 'recording';
  document.getElementById('startRec').disabled = true;
  document.getElementById('stopAll').disabled = false;
}

function stopRecording(){
  if(mediaRecorder?.state === 'recording') mediaRecorder.stop();
}

// LIVE STREAMING (Dolby Millicast — FREE)
async function startLiveStream(){
  if(liveStreamActive) return alert('Already live!');
  if(!layers.length) return alert('Add at least one source first!');

  const rtmpUrl = prompt('Enter RTMP URL (e.g. rtmp://live.twitch.tv/app/ or rtmp://a.rtmp.youtube.com/live2/)');
  if(!rtmpUrl) return;
  const streamKey = prompt('Enter Stream Key / Stream Name');
  if(!streamKey) return;

  const stream = preview.captureStream(30);
  if(destination) destination.stream.getAudioTracks().forEach(t => stream.addTrack(t));

  try {
    const tokenGenerator = () => Millicast.Director.getPublisher({
      streamName: streamKey,
      token: "" // free tier uses empty token
    });

    const publishOptions = {
      tokenGenerator,
      streamName: streamKey,
      mediaStream: stream,
      bandwidth: 0,
      codec: "h264"
    };

    millicastDirector = new Millicast.Publish(publishOptions);
    await millicastDirector.connect();

    // Send to your platform via Millicast relay
    await fetch(`https://director.millicast.com/api/rtmp_forward`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + millicastDirector.getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ rtmpUrl: rtmpUrl + streamKey })
    });

    liveStreamActive = true;
    recStatus.textContent = 'LIVE';
    recordingInfo.textContent = 'Streaming to ' + new URL(rtmpUrl).hostname;
    document.getElementById('goLive').textContent = 'Live!';
    document.getElementById('stopAll').disabled = false;
    alert('You are now LIVE! Check your platform.');
  } catch(e) {
    alert('Live failed: ' + e.message + '\nMake sure RTMP URL and key are correct.');
  }
}

async function stopLiveStream(){
  if(millicastDirector){
    await millicastDirector.stop();
    millicastDirector = null;
  }
  liveStreamActive = false;
  document.getElementById('goLive').textContent = 'Go Live to Twitch / YouTube / Facebook';
}

// Stop everything
function stopAll(){
  stopRecording();
  stopLiveStream();
  recStatus.textContent = 'idle';
  document.getElementById('startRec').disabled = false;
  document.getElementById('stopAll').disabled = true;
}

// Scenes
const scenes = {};
function saveScene(){ /* same as before */ const n=document.getElementById('sceneName').value.trim(); if(!n)return; scenes[n]=layers.map(L=>({id:L.id,kind:L.kind,visible:L.visible,opacity:L.opacity,x:L.x,y:L.y,w:L.w,h:L.h})); renderScenes(); }
function renderScenes(){ scenesList.innerHTML=''; Object.keys(scenes).forEach(n=>{const b=document.createElement('button');b.className='pill';b.textContent=n;b.onclick=()=>recallScene(n);scenesList.appendChild(b);}); }
function recallScene(n){ const s=scenes[n]; if(!s)return; s.forEach(o=>{const L=layers.find(x=>x.id===o.id);if(L){Object.assign(L,o);}}); renderLayers(); }

// Wire UI
document.getElementById('btnWebcam').onclick = addWebcam;
document.getElementById('btnScreen').onclick = addScreen;
document.getElementById('btnVideoFile').onclick = () => document.getElementById('videoInput').click();
document.getElementById('videoInput').onchange = e => e.target.files[0] && addVideoFile(e.target.files[0]) && (e.target.value='');
document.getElementById('btnImageOverlay').onclick = () => document.getElementById('imageInput').click();
document.getElementById('imageInput').onchange = e => e.target.files[0] && addImageFile(e.target.files[0]) && (e.target.value='');

document.getElementById('startRec').onclick = startRecording;
document.getElementById('goLive').onclick = startLiveStream;
document.getElementById('stopAll').onclick = stopAll;
document.getElementById('saveScene').onclick = saveScene;

// Start
applyResolutionFromSelect();
drawLoop();
renderScenes();