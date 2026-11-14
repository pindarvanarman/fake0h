// Cactus Run - webcam body-tracking runner
// Sections: setup, audio, pose tracking, themes (worlds + obstacles), game logic, figure, drawing, controls
(function () {
"use strict";

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const video = document.getElementById("cam");
const overlay = document.getElementById("overlay");
const card = document.getElementById("card");
const statusEl = document.getElementById("status");

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * DPR; canvas.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// Deterministic "random" so scenery doesn't flicker between frames
const srand = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const lerp = (a, b, t) => a + (b - a) * t;

// =====================================================================
// AUDIO (synthesized, no files needed)
// =====================================================================
let actx = null, noiseBuf = null;
function audio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 3, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}
function tone(freq, dur, type = "square", vol = 0.06, delay = 0) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  const t0 = a.currentTime + delay;
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
function noise(dur, vol, freq, q = 1, attack = 0.01) {
  const a = audio(); if (!a) return;
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  const t0 = a.currentTime;
  src.buffer = noiseBuf; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0); src.stop(t0 + dur + 0.05);
}
const sfx = {
  coin() { tone(988, 0.08, "square", 0.05); tone(1319, 0.2, "square", 0.05, 0.07); },
  hit() { noise(0.3, 0.4, 180, 0.8); tone(110, 0.3, "sawtooth", 0.08); },
  full() { [784, 988, 1175].forEach((f, i) => tone(f, 0.12, "triangle", 0.07, i * 0.08)); },
  levelUp() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, "square", 0.05, i * 0.09)); },
  cheer(big) { noise(big ? 3 : 1.2, big ? 0.35 : 0.15, 1100, 0.5, big ? 0.5 : 0.15); noise(big ? 2.6 : 1, big ? 0.2 : 0.08, 2400, 0.7, 0.3); },
  jump() { const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime;
    o.type = "square"; o.frequency.setValueAtTime(300, t0); o.frequency.exponentialRampToValueAtTime(900, t0 + 0.18);
    g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22); o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + 0.25); },
  heal() { [660, 880, 1320].forEach((f, i) => tone(f, 0.15, "sine", 0.08, 0.1 + i * 0.07)); },
  over() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, "triangle", 0.07, i * 0.2)); }
};

// =====================================================================
// POSE TRACKING (MediaPipe)
// =====================================================================
let landmarker = null;
let pose = null;
let lastVideoTime = -1;
let cameraOn = false;

async function startCamera() {
  audio();
  if (window.top !== window.self) {
    statusEl.textContent = "This is running inside a preview window, which can't use the camera. Open index.html directly in Chrome or Edge.";
    return;
  }
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = "This browser won't allow the camera here. Open index.html directly in Chrome or Edge.";
    return;
  }
  statusEl.textContent = "Asking for camera access…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    const msgs = {
      NotAllowedError: "Camera permission was denied. Click the camera icon in the address bar, choose Allow, then reload.",
      NotFoundError: "No camera was found. Plug one in, or play with arrow keys.",
      NotReadableError: "The camera is busy. Close other apps using it (Zoom, Teams, FaceTime), then try again.",
      OverconstrainedError: "The camera doesn't support the requested size. Try another camera."
    };
    statusEl.textContent = msgs[e.name] || `Camera error: ${e.name || ""} ${e.message || e}`;
    return;
  }
  statusEl.textContent = "Camera on. Loading body tracking (first time takes a few seconds)…";
  let PoseLandmarker, FilesetResolver;
  try {
    ({ PoseLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`));
  } catch (e) {
    statusEl.textContent = "Couldn't download the body-tracking library. Check your internet connection or ad blocker, then reload.";
    return;
  }
  try {
    const files = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
    try {
      landmarker = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1
      });
    } catch {
      landmarker = await PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1
      });
    }
  } catch (e) {
    statusEl.textContent = `Body tracking failed to load (${e.message || e}). Check your internet connection and reload.`;
    return;
  }
  cameraOn = true;
  keyboardMode = false;
  resetGame();
  state = "waiting";
  overlay.classList.add("hidden");
}

function detectPose() {
  if (!landmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, performance.now());
  pose = res.landmarks && res.landmarks.length ? res.landmarks[0] : null;
}
const vis = (lm) => lm && (lm.visibility ?? 1) > 0.5;

// =====================================================================
// THEMES: 10 worlds + the stadium finale
// Each theme: sky colors, ground colors, trail, scenery(), obstacle(), particles
// =====================================================================
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function groundShadow(x, y, w, h) {
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI * 2); ctx.fill();
}
function sunDisc(x, y, r, color, glow) {
  ctx.save();
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = r * 0.8; }
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function stars(count, maxY, seed) {
  for (let i = 0; i < count; i++) {
    const x = srand(seed + i) * W, y = srand(seed + i + 500) * maxY;
    const tw = 0.5 + 0.5 * Math.sin(T * 2 + i);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + tw * 0.6})`;
    ctx.fillRect(x, y, 2, 2);
  }
}

const THEMES = [
  { // 1
    name: "Sunset Desert", obstacleName: "cacti",
    sky: ["#5b2c6f", "#e0704a", "#ffc46b"], ground: ["#d99a5b", "#f2c487"], trail: "#e8b277", stripe: "rgba(140,70,40,0.18)",
    particles: null,
    scenery(hy) {
      sunDisc(W * 0.72, hy - H * 0.02, H * 0.11, "#ffe08a");
      ctx.fillStyle = "#8a3b2a";
      ctx.beginPath(); ctx.moveTo(0, hy);
      ctx.lineTo(0, hy - H * 0.07); ctx.lineTo(W * 0.08, hy - H * 0.07); ctx.lineTo(W * 0.12, hy - H * 0.11);
      ctx.lineTo(W * 0.24, hy - H * 0.11); ctx.lineTo(W * 0.28, hy - H * 0.04); ctx.lineTo(W * 0.5, hy - H * 0.03);
      ctx.lineTo(W * 0.82, hy - H * 0.05); ctx.lineTo(W * 0.86, hy - H * 0.09); ctx.lineTo(W * 0.96, hy - H * 0.09);
      ctx.lineTo(W, hy - H * 0.06); ctx.lineTo(W, hy); ctx.closePath(); ctx.fill();
    },
    obstacle(x, y, h, v) {
      const w = h * 0.26;
      groundShadow(x, y, w * 1.3, h * 0.05);
      ctx.fillStyle = "#3f7d3a"; ctx.strokeStyle = "#1f3f1c"; ctx.lineWidth = Math.max(1, h * 0.02);
      const part = (rx, ry, rw, rh) => { rr(x + rx, y + ry, rw, rh, rw / 2); ctx.fill(); ctx.stroke(); };
      const up = v > 0.5;
      part(-w * 1.25, -h * (up ? 0.78 : 0.62), w * 0.6, h * 0.32);
      part(-w * 1.1, -h * (up ? 0.52 : 0.4), w * 0.9, w * 0.55);
      part(w * 0.65, -h * (up ? 0.6 : 0.82), w * 0.6, h * 0.32);
      part(w * 0.2, -h * (up ? 0.34 : 0.56), w * 0.9, w * 0.55);
      part(-w / 2, -h, w, h);
    }
  },
  { // 2
    name: "Snowy Peaks", obstacleName: "snowmen",
    sky: ["#1d3b6e", "#6fa3d8", "#d9ecff"], ground: ["#cfdcec", "#ffffff"], trail: "#b9cbe0", stripe: "rgba(80,110,150,0.15)",
    particles: "snow",
    scenery(hy) {
      const peaks = [[0, 0.1], [0.12, 0.2], [0.27, 0.12], [0.42, 0.24], [0.6, 0.14], [0.75, 0.22], [0.92, 0.12], [1.05, 0.18]];
      for (let i = 0; i < peaks.length - 1; i++) {
        const [px, ph] = peaks[i], cx = W * px, top = hy - H * ph, half = W * 0.13;
        ctx.fillStyle = i % 2 ? "#6b84a8" : "#7d93b2";
        ctx.beginPath(); ctx.moveTo(cx - half, hy); ctx.lineTo(cx, top); ctx.lineTo(cx + half, hy); ctx.fill();
        ctx.fillStyle = "#f4f8ff";
        ctx.beginPath(); ctx.moveTo(cx, top);
        ctx.lineTo(cx - half * 0.3, top + H * ph * 0.3); ctx.lineTo(cx - half * 0.1, top + H * ph * 0.25);
        ctx.lineTo(cx + half * 0.05, top + H * ph * 0.33); ctx.lineTo(cx + half * 0.3, top + H * ph * 0.3); ctx.fill();
      }
    },
    obstacle(x, y, h) {
      groundShadow(x, y, h * 0.35, h * 0.05);
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#8aa0bd"; ctx.lineWidth = Math.max(1, h * 0.015);
      const ball = (cy, r) => { ctx.beginPath(); ctx.arc(x, y - cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
      ball(h * 0.22, h * 0.22); ball(h * 0.55, h * 0.16); ball(h * 0.8, h * 0.11);
      ctx.fillStyle = "#222"; // hat
      ctx.fillRect(x - h * 0.12, y - h * 0.9, h * 0.24, h * 0.03);
      ctx.fillRect(x - h * 0.08, y - h * 1.02, h * 0.16, h * 0.12);
      ctx.beginPath(); ctx.arc(x - h * 0.04, y - h * 0.82, h * 0.015, 0, 7); ctx.arc(x + h * 0.04, y - h * 0.82, h * 0.015, 0, 7); ctx.fill();
      ctx.fillStyle = "#ff8a1f"; // carrot
      ctx.beginPath(); ctx.moveTo(x, y - h * 0.79); ctx.lineTo(x + h * 0.12, y - h * 0.77); ctx.lineTo(x, y - h * 0.75); ctx.fill();
      ctx.strokeStyle = "#5a3a1f"; ctx.lineWidth = Math.max(1, h * 0.02); // stick arms
      ctx.beginPath(); ctx.moveTo(x - h * 0.15, y - h * 0.58); ctx.lineTo(x - h * 0.34, y - h * 0.7);
      ctx.moveTo(x + h * 0.15, y - h * 0.58); ctx.lineTo(x + h * 0.34, y - h * 0.7); ctx.stroke();
    }
  },
  { // 3
    name: "Deep Forest", obstacleName: "tree stumps",
    sky: ["#2f6b5e", "#8cc9a0", "#e8f5c8"], ground: ["#4f8a3c", "#6fae4f"], trail: "#a7804f", stripe: "rgba(60,40,20,0.18)",
    particles: "leaves",
    scenery(hy) {
      for (let layer = 0; layer < 2; layer++) {
        ctx.fillStyle = layer ? "#1d4230" : "#2f6449";
        const n = 22 + layer * 6;
        for (let i = 0; i < n; i++) {
          const cx = (i / n) * W * 1.05 + (layer ? W * 0.02 : 0);
          const th = H * (0.1 + srand(i + layer * 50) * 0.12) * (layer ? 0.85 : 1);
          const tw = W * 0.025;
          ctx.beginPath(); ctx.moveTo(cx - tw, hy); ctx.lineTo(cx, hy - th); ctx.lineTo(cx + tw, hy); ctx.fill();
        }
      }
    },
    obstacle(x, y, h) {
      const w = h * 0.5, sh = h * 0.5;
      groundShadow(x, y, w * 0.7, h * 0.05);
      ctx.fillStyle = "#7a4a26"; ctx.strokeStyle = "#3f2410"; ctx.lineWidth = Math.max(1, h * 0.02);
      ctx.beginPath();
      ctx.moveTo(x - w / 2 - h * 0.08, y); ctx.lineTo(x - w / 2, y - sh * 0.2); ctx.lineTo(x - w / 2, y - sh);
      ctx.lineTo(x + w / 2, y - sh); ctx.lineTo(x + w / 2, y - sh * 0.2); ctx.lineTo(x + w / 2 + h * 0.08, y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#d9a86a";
      ctx.beginPath(); ctx.ellipse(x, y - sh, w / 2, h * 0.1, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#a8743c"; ctx.lineWidth = Math.max(1, h * 0.01);
      ctx.beginPath(); ctx.ellipse(x, y - sh, w * 0.3, h * 0.06, 0, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y - sh, w * 0.12, h * 0.025, 0, 0, 7); ctx.stroke();
      ctx.fillStyle = "#e04a3a"; // mushroom
      ctx.beginPath(); ctx.arc(x + w * 0.45, y - h * 0.06, h * 0.07, Math.PI, 0); ctx.fill();
    }
  },
  { // 4
    name: "Sunny Beach", obstacleName: "crabs",
    sky: ["#3aa0d8", "#8fd3f0", "#fff1c9"], ground: ["#f1d79a", "#f7e6b5"], trail: "#e9cb86", stripe: "rgba(150,110,40,0.15)",
    particles: null,
    scenery(hy) {
      sunDisc(W * 0.2, hy - H * 0.2, H * 0.06, "#fff6b0", "#fff2a0");
      ctx.fillStyle = "#2a86c4"; ctx.fillRect(0, hy - H * 0.05, W, H * 0.05);
      ctx.fillStyle = "#4fb0e0"; ctx.fillRect(0, hy - H * 0.05, W, H * 0.012);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const x = ((srand(i) * W + T * 30) % (W + 80)) - 40, y = hy - H * 0.035 + srand(i + 9) * H * 0.03;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 15, y - 4, x + 30, y); ctx.stroke();
      }
      // palm tree
      ctx.strokeStyle = "#7a5230"; ctx.lineWidth = W * 0.012;
      ctx.beginPath(); ctx.moveTo(W * 0.9, hy + H * 0.02); ctx.quadraticCurveTo(W * 0.88, hy - H * 0.12, W * 0.92, hy - H * 0.22); ctx.stroke();
      ctx.fillStyle = "#2f8a3a";
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.7 + Math.sin(T + i) * 0.05;
        ctx.save(); ctx.translate(W * 0.92, hy - H * 0.22); ctx.rotate(a);
        ctx.beginPath(); ctx.ellipse(W * 0.035, 0, W * 0.04, H * 0.012, 0, 0, 7); ctx.fill(); ctx.restore();
      }
    },
    obstacle(x, y, h, v) {
      const bob = Math.sin(T * 8 + v * 10) * h * 0.02;
      const w = h * 0.36, by = y - h * 0.25 + bob;
      groundShadow(x, y, w * 1.4, h * 0.05);
      ctx.strokeStyle = "#a62a1a"; ctx.lineWidth = Math.max(1, h * 0.03);
      for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(x + s * w * 0.6, by + i * h * 0.04);
        ctx.lineTo(x + s * w * 1.1, by + h * 0.05 + i * h * 0.05); ctx.lineTo(x + s * w * 1.15, y); ctx.stroke();
      }
      ctx.fillStyle = "#e0402a";
      ctx.beginPath(); ctx.ellipse(x, by, w, h * 0.17, 0, 0, 7); ctx.fill();
      for (let s = -1; s <= 1; s += 2) { // claws
        ctx.beginPath(); ctx.arc(x + s * w * 1.15, by - h * 0.22, h * 0.1, 0, 7); ctx.fill();
        ctx.fillStyle = "#f7e6b5"; ctx.beginPath(); ctx.moveTo(x + s * w * 1.15, by - h * 0.22);
        ctx.lineTo(x + s * w * 1.3, by - h * 0.32); ctx.lineTo(x + s * w * 1.05, by - h * 0.32); ctx.fill();
        ctx.fillStyle = "#e0402a";
      }
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x - w * 0.3, by - h * 0.22, h * 0.05, 0, 7); ctx.arc(x + w * 0.3, by - h * 0.22, h * 0.05, 0, 7); ctx.fill();
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(x - w * 0.3, by - h * 0.22, h * 0.025, 0, 7); ctx.arc(x + w * 0.3, by - h * 0.22, h * 0.025, 0, 7); ctx.fill();
    }
  },
  { // 5
    name: "Under the Sea", obstacleName: "jellyfish",
    sky: ["#03263f", "#0b5d8a", "#2aa3b8"], ground: ["#b89a62", "#e0c48a"], trail: "#d1b47a", stripe: "rgba(20,60,80,0.15)",
    particles: "bubbles",
    scenery(hy) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      for (let i = 0; i < 5; i++) {
        const x = W * (0.1 + i * 0.2) + Math.sin(T * 0.5 + i) * 20;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + W * 0.06, 0); ctx.lineTo(x + W * 0.16, hy); ctx.lineTo(x + W * 0.08, hy); ctx.fill();
      }
      ctx.strokeStyle = "#1f6e4a"; ctx.lineWidth = W * 0.006; ctx.lineCap = "round";
      for (let i = 0; i < 18; i++) {
        const x = srand(i + 3) * W, len = H * (0.08 + srand(i) * 0.14);
        ctx.beginPath(); ctx.moveTo(x, hy);
        for (let s = 1; s <= 6; s++) ctx.lineTo(x + Math.sin(T * 1.5 + s * 0.8 + i) * 8, hy - (len * s) / 6);
        ctx.stroke();
      }
      const corals = ["#ff7a8a", "#ffb04a", "#c77dff"];
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = corals[i % 3];
        const x = srand(i + 70) * W;
        ctx.beginPath(); ctx.arc(x, hy, H * 0.025, Math.PI, 0); ctx.fill();
      }
    },
    obstacle(x, y, h, v) {
      const float = h * 0.35 + Math.sin(T * 3 + v * 9) * h * 0.06;
      groundShadow(x, y, h * 0.3, h * 0.04);
      const cy = y - float - h * 0.4;
      ctx.strokeStyle = "rgba(255,160,220,0.85)"; ctx.lineWidth = Math.max(1, h * 0.025); ctx.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const tx = x + (i - 2) * h * 0.08;
        ctx.beginPath(); ctx.moveTo(tx, cy);
        for (let s = 1; s <= 5; s++) ctx.lineTo(tx + Math.sin(T * 5 + s + i) * h * 0.04, cy + s * h * 0.09);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,120,200,0.9)"; ctx.strokeStyle = "#c2387a"; ctx.lineWidth = Math.max(1, h * 0.015);
      ctx.beginPath(); ctx.ellipse(x, cy, h * 0.24, h * 0.2, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.ellipse(x - h * 0.08, cy - h * 0.1, h * 0.05, h * 0.03, -0.5, 0, 7); ctx.fill();
    }
  },
  { // 6
    name: "Neon City", obstacleName: "traffic cones",
    sky: ["#0b0f2a", "#2a2463", "#d24f8a"], ground: ["#23232e", "#353542"], trail: "#41414f", stripe: "rgba(255,255,255,0.05)",
    particles: null, centerLine: "#ffd43b",
    scenery(hy) {
      stars(40, hy * 0.5, 11);
      sunDisc(W * 0.15, H * 0.1, H * 0.04, "#f4f0ff", "#c8c0ff");
      for (let i = 0; i < 26; i++) {
        const bw = W * (0.035 + srand(i) * 0.03), bh = H * (0.08 + srand(i + 40) * 0.2);
        const bx = (i / 26) * W * 1.04 - W * 0.02;
        ctx.fillStyle = i % 2 ? "#151a3a" : "#1c2148";
        ctx.fillRect(bx, hy - bh, bw, bh);
        for (let wy = hy - bh + 6; wy < hy - 6; wy += 9) for (let wx = bx + 4; wx < bx + bw - 4; wx += 8) {
          if (srand(wx * 3 + wy) > 0.55) { ctx.fillStyle = srand(wx + wy * 7) > 0.5 ? "#ffd86b" : "#6bd5ff"; ctx.fillRect(wx, wy, 3, 4); }
        }
      }
    },
    obstacle(x, y, h) {
      const w = h * 0.4;
      groundShadow(x, y, w * 0.8, h * 0.05);
      ctx.fillStyle = "#ff6a00"; ctx.strokeStyle = "#8a3000"; ctx.lineWidth = Math.max(1, h * 0.015);
      ctx.fillRect(x - w * 0.7, y - h * 0.06, w * 1.4, h * 0.06);
      ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.06); ctx.lineTo(x - w * 0.1, y - h * 0.85);
      ctx.lineTo(x + w * 0.1, y - h * 0.85); ctx.lineTo(x + w / 2, y - h * 0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.moveTo(x - w * 0.37, y - h * 0.3); ctx.lineTo(x - w * 0.27, y - h * 0.48);
      ctx.lineTo(x + w * 0.27, y - h * 0.48); ctx.lineTo(x + w * 0.37, y - h * 0.3); ctx.fill();
    }
  },
  { // 7
    name: "Volcano Valley", obstacleName: "lava rocks",
    sky: ["#1a0505", "#6b1410", "#ff6a2b"], ground: ["#3a1f1a", "#5a2f24"], trail: "#4a2a22", stripe: "rgba(255,90,30,0.12)",
    particles: "embers",
    scenery(hy) {
      ctx.fillStyle = "#2a0f0b";
      ctx.beginPath(); ctx.moveTo(W * 0.25, hy); ctx.lineTo(W * 0.45, hy - H * 0.25); ctx.lineTo(W * 0.55, hy - H * 0.25); ctx.lineTo(W * 0.75, hy); ctx.fill();
      ctx.save(); ctx.shadowColor = "#ff5a1a"; ctx.shadowBlur = 40;
      ctx.fillStyle = "#ff7a1a"; ctx.beginPath(); ctx.ellipse(W * 0.5, hy - H * 0.25, W * 0.05, H * 0.012, 0, 0, 7); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = "#ff5a1a"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(W * 0.48, hy - H * 0.24); ctx.lineTo(W * 0.45, hy - H * 0.15); ctx.lineTo(W * 0.43, hy - H * 0.05);
      ctx.moveTo(W * 0.53, hy - H * 0.24); ctx.lineTo(W * 0.56, hy - H * 0.12); ctx.stroke();
      ctx.fillStyle = "rgba(60,40,40,0.5)";
      for (let i = 0; i < 6; i++) {
        const t = (T * 0.15 + i / 6) % 1;
        ctx.beginPath(); ctx.arc(W * 0.5 + Math.sin(i * 3 + T) * 20 * t, hy - H * 0.27 - t * H * 0.15, H * (0.02 + t * 0.04), 0, 7); ctx.fill();
      }
      ctx.fillStyle = "#200a08";
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(0, hy - H * 0.06); ctx.lineTo(W * 0.15, hy - H * 0.03); ctx.lineTo(W * 0.3, hy);
      ctx.moveTo(W * 0.7, hy); ctx.lineTo(W * 0.85, hy - H * 0.05); ctx.lineTo(W, hy - H * 0.08); ctx.lineTo(W, hy); ctx.fill();
    },
    obstacle(x, y, h, v) {
      groundShadow(x, y, h * 0.4, h * 0.05);
      const flick = Math.sin(T * 20 + v * 7) * h * 0.03;
      ctx.save(); ctx.shadowColor = "#ff6a1a"; ctx.shadowBlur = h * 0.3;
      ctx.fillStyle = "#ffb02e";
      ctx.beginPath(); ctx.moveTo(x - h * 0.15, y - h * 0.45); ctx.quadraticCurveTo(x, y - h * 1.0 - flick, x + h * 0.15, y - h * 0.45); ctx.fill();
      ctx.fillStyle = "#ff4a1a";
      ctx.beginPath(); ctx.moveTo(x - h * 0.08, y - h * 0.45); ctx.quadraticCurveTo(x, y - h * 0.8 + flick, x + h * 0.08, y - h * 0.45); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#2a1a18"; ctx.strokeStyle = "#ff5a1a"; ctx.lineWidth = Math.max(1, h * 0.02);
      ctx.beginPath(); ctx.moveTo(x - h * 0.38, y); ctx.lineTo(x - h * 0.3, y - h * 0.35); ctx.lineTo(x - h * 0.05, y - h * 0.5);
      ctx.lineTo(x + h * 0.25, y - h * 0.42); ctx.lineTo(x + h * 0.38, y - h * 0.1); ctx.lineTo(x + h * 0.32, y); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - h * 0.2, y - h * 0.3); ctx.lineTo(x, y - h * 0.2); ctx.lineTo(x + h * 0.1, y - h * 0.35);
      ctx.moveTo(x, y - h * 0.2); ctx.lineTo(x + h * 0.05, y - h * 0.02); ctx.stroke();
    }
  },
  { // 8
    name: "Moon Base", obstacleName: "space rocks",
    sky: ["#000008", "#0a0a2a", "#1a1a3a"], ground: ["#77777f", "#b0b0b8"], trail: "#95959d", stripe: "rgba(0,0,0,0.12)",
    particles: null,
    scenery(hy) {
      stars(120, hy, 200);
      const ex = W * 0.78, ey = H * 0.13, er = H * 0.07;
      sunDisc(ex, ey, er, "#2a6ad8", "#4a8aff");
      ctx.fillStyle = "#3fae5a";
      ctx.beginPath(); ctx.ellipse(ex - er * 0.3, ey - er * 0.2, er * 0.35, er * 0.25, 0.4, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex + er * 0.35, ey + er * 0.3, er * 0.25, er * 0.3, -0.3, 0, 7); ctx.fill();
      ctx.fillStyle = "#5a5a62";
      ctx.beginPath(); ctx.moveTo(0, hy);
      for (let i = 0; i <= 12; i++) ctx.lineTo((i / 12) * W, hy - H * (0.02 + srand(i + 31) * 0.05));
      ctx.lineTo(W, hy); ctx.fill();
      // little flag
      ctx.strokeStyle = "#ddd"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(W * 0.2, hy - H * 0.03); ctx.lineTo(W * 0.2, hy - H * 0.1); ctx.stroke();
      ctx.fillStyle = "#e04a3a"; ctx.fillRect(W * 0.2, hy - H * 0.1, W * 0.025, H * 0.02);
    },
    obstacle(x, y, h, v) {
      groundShadow(x, y, h * 0.4, h * 0.05);
      const r = h * 0.35, cy = y - r * 0.95;
      ctx.fillStyle = "#8d8d96"; ctx.strokeStyle = "#45454d"; ctx.lineWidth = Math.max(1, h * 0.02);
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, rr2 = r * (0.85 + srand(i + v * 100) * 0.25);
        const px = x + Math.cos(a) * rr2, py = cy + Math.sin(a) * rr2;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#6b6b74";
      ctx.beginPath(); ctx.arc(x - r * 0.3, cy - r * 0.2, r * 0.18, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x + r * 0.35, cy + r * 0.25, r * 0.13, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(x + r * 0.1, cy - r * 0.45, r * 0.08, 0, 7); ctx.fill();
    }
  },
  { // 9
    name: "Candy Land", obstacleName: "lollipops",
    sky: ["#ff9ad5", "#ffc6e6", "#fff0fa"], ground: ["#8fdcbc", "#c5f5df"], trail: "#ffd1ea", stripe: "rgba(255,90,160,0.35)",
    particles: "sprinkles",
    scenery(hy) {
      const hills = ["#ff7ab8", "#c77dff", "#ffb347", "#7ad3ff"];
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = hills[i % 4];
        ctx.beginPath(); ctx.ellipse(W * (i / 6), hy, W * 0.12, H * (0.08 + srand(i) * 0.06), 0, Math.PI, 0); ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let i = 0; i < 4; i++) {
        const cx = ((srand(i + 5) * W + T * 15) % (W + 200)) - 100, cy = H * (0.08 + srand(i + 2) * 0.15);
        ctx.beginPath(); ctx.arc(cx, cy, H * 0.03, 0, 7); ctx.arc(cx + H * 0.035, cy - H * 0.015, H * 0.035, 0, 7); ctx.arc(cx + H * 0.07, cy, H * 0.03, 0, 7); ctx.fill();
      }
    },
    obstacle(x, y, h, v) {
      groundShadow(x, y, h * 0.2, h * 0.04);
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1;
      ctx.fillRect(x - h * 0.025, y - h * 0.62, h * 0.05, h * 0.62);
      const r = h * 0.28, cy = y - h * 0.72;
      ctx.fillStyle = v > 0.5 ? "#ff4fa3" : "#7a5cff";
      ctx.beginPath(); ctx.arc(x, cy, r, 0, 7); ctx.fill();
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(1, h * 0.05);
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 6; a += 0.2) {
        const rad = (a / (Math.PI * 6)) * r * 0.9, px = x + Math.cos(a + T * 2) * rad, py = cy + Math.sin(a + T * 2) * rad;
        a ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }
  },
  { // 10
    name: "Haunted Graveyard", obstacleName: "tombstones",
    sky: ["#0d0a1f", "#3a2a5a", "#7a5a8a"], ground: ["#232a20", "#363f2e"], trail: "#3f382f", stripe: "rgba(200,200,255,0.06)",
    particles: "fog",
    scenery(hy) {
      sunDisc(W * 0.7, H * 0.16, H * 0.09, "#f2f0d8", "#fffbe0");
      ctx.fillStyle = "#120e1e";
      ctx.beginPath(); ctx.ellipse(W * 0.25, hy, W * 0.4, H * 0.09, 0, Math.PI, 0); ctx.fill();
      ctx.beginPath(); ctx.ellipse(W * 0.85, hy, W * 0.3, H * 0.06, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = "#120e1e"; ctx.lineCap = "round";
      const tree = (x, base, s) => {
        ctx.lineWidth = s * 0.08; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - s); ctx.stroke();
        ctx.lineWidth = s * 0.035;
        ctx.beginPath(); ctx.moveTo(x, base - s * 0.6); ctx.lineTo(x - s * 0.4, base - s * 1.0);
        ctx.moveTo(x, base - s * 0.75); ctx.lineTo(x + s * 0.35, base - s * 1.1);
        ctx.moveTo(x - s * 0.2, base - s * 0.8); ctx.lineTo(x - s * 0.15, base - s * 1.15); ctx.stroke();
      };
      tree(W * 0.18, hy - H * 0.07, H * 0.16); tree(W * 0.9, hy - H * 0.04, H * 0.12);
      ctx.fillStyle = "#120e1e"; // bats
      for (let i = 0; i < 4; i++) {
        const bx = ((T * 60 + i * 300) % (W + 100)) - 50, by = H * (0.1 + i * 0.05) + Math.sin(T * 3 + i) * 10, f = Math.sin(T * 15 + i) * 6;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 12, by - 4 - f); ctx.lineTo(bx - 6, by + 1);
        ctx.lineTo(bx, by + 4); ctx.lineTo(bx + 6, by + 1); ctx.lineTo(bx + 12, by - 4 - f); ctx.closePath(); ctx.fill();
      }
    },
    obstacle(x, y, h, v) {
      const w = h * 0.42;
      groundShadow(x, y, w * 0.8, h * 0.05);
      ctx.fillStyle = "#8a8a98"; ctx.strokeStyle = "#45454f"; ctx.lineWidth = Math.max(1, h * 0.02);
      ctx.beginPath();
      ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w / 2, y - h * 0.6);
      ctx.arc(x, y - h * 0.6, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#45454f"; ctx.font = `700 ${Math.max(6, h * 0.14)}px Nunito, sans-serif`; ctx.textAlign = "center";
      ctx.fillText("RIP", x, y - h * 0.55);
      ctx.fillStyle = "#3a5a2a";
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * w * 0.2, y); ctx.lineTo(x + i * w * 0.2 + w * 0.05, y - h * 0.08); ctx.lineTo(x + i * w * 0.2 + w * 0.1, y); ctx.fill(); }
    }
  },
  { // 11 - FINALE
    name: "Champion Stadium", obstacleName: "hurdles", finale: true,
    sky: ["#08122e", "#1a2f66", "#2f4f96"], ground: ["#2f8a3a", "#4fae4f"], trail: "#c4482b", stripe: "rgba(255,255,255,0.08)",
    particles: "confetti", laneLines: true,
    scenery(hy) {
      // floodlights
      for (const lx of [W * 0.06, W * 0.94]) {
        ctx.fillStyle = "#555"; ctx.fillRect(lx - 3, H * 0.04, 6, hy * 0.4);
        ctx.save(); ctx.shadowColor = "#fffbe0"; ctx.shadowBlur = 30; ctx.fillStyle = "#fffbe0";
        rr(lx - 30, H * 0.02, 60, H * 0.04, 6); ctx.fill(); ctx.restore();
        ctx.fillStyle = "rgba(255,250,220,0.06)";
        ctx.beginPath(); ctx.moveTo(lx - 30, H * 0.06); ctx.lineTo(lx + 30, H * 0.06); ctx.lineTo(W / 2 + (lx - W / 2) * 0.1, hy); ctx.fill();
      }
      drawCrowd(hy);
    },
    obstacle(x, y, h) {
      const w = h * 0.55, top = y - h * 0.48;
      groundShadow(x, y, w * 0.7, h * 0.04);
      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(x - w / 2, top, h * 0.035, h * 0.48); ctx.fillRect(x + w / 2 - h * 0.035, top, h * 0.035, h * 0.48);
      ctx.fillRect(x - w / 2 - h * 0.06, y - h * 0.03, h * 0.15, h * 0.03); ctx.fillRect(x + w / 2 - h * 0.09, y - h * 0.03, h * 0.15, h * 0.03);
      const seg = 6;
      for (let i = 0; i < seg; i++) {
        ctx.fillStyle = i % 2 ? "#ffffff" : "#e0402a";
        ctx.fillRect(x - w / 2 + (w / seg) * i, top, w / seg + 0.5, h * 0.1);
      }
      ctx.strokeStyle = "#333"; ctx.lineWidth = Math.max(1, h * 0.01); ctx.strokeRect(x - w / 2, top, w, h * 0.1);
    }
  }
];
const FINALE_INDEX = THEMES.length - 1;

let cheerBoost = 0; // makes the crowd go wild
function drawCrowd(hy) {
  const top = H * 0.09;
  ctx.fillStyle = "#1b1f2e"; ctx.fillRect(0, top, W, hy - top);
  const rows = 7;
  const skins = ["#f1c7a3", "#d9a37a", "#a8714a", "#7a4a2a", "#ffdfc4", "#c68b5c"];
  const shirts = ["#e0402a", "#ffcc33", "#2a86c4", "#ffffff", "#3fae5a", "#c77dff", "#ff7ab8", "#ff8a1f"];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1);
    const s = lerp(H * 0.011, H * 0.024, t);
    const rowY = lerp(top + s * 2, hy - s * 0.6, t);
    ctx.fillStyle = r % 2 ? "#262b3d" : "#2e3448"; // bleacher step
    ctx.fillRect(0, rowY - s * 0.2, W, s * 1.3);
    const spacing = s * 2.1, n = Math.ceil(W / spacing) + 1;
    for (let i = 0; i < n; i++) {
      const id = r * 1000 + i, ph = srand(id) * 6.28;
      const x = i * spacing + (r % 2 ? spacing / 2 : 0);
      const energy = 0.5 + Math.min(1.5, cheerBoost);
      const jump = Math.max(0, Math.sin(T * (6 + srand(id + 3) * 3) + ph)) * s * 0.45 * energy;
      const y = rowY - jump;
      const shirt = shirts[Math.floor(srand(id + 1) * shirts.length)];
      const armsUp = Math.sin(T * 3 + ph) > 0.2 - cheerBoost * 0.5;
      ctx.strokeStyle = shirt; ctx.lineWidth = Math.max(1.5, s * 0.28); ctx.lineCap = "round";
      ctx.beginPath();
      if (armsUp) {
        const wave = Math.sin(T * 10 + ph) * s * 0.3;
        ctx.moveTo(x - s * 0.4, y - s * 0.2); ctx.lineTo(x - s * 0.7 + wave, y - s * 1.6);
        ctx.moveTo(x + s * 0.4, y - s * 0.2); ctx.lineTo(x + s * 0.7 - wave, y - s * 1.6);
      } else {
        ctx.moveTo(x - s * 0.4, y - s * 0.1); ctx.lineTo(x - s * 0.55, y + s * 0.5);
        ctx.moveTo(x + s * 0.4, y - s * 0.1); ctx.lineTo(x + s * 0.55, y + s * 0.5);
      }
      ctx.stroke();
      ctx.fillStyle = shirt; rr(x - s * 0.5, y - s * 0.3, s, s * 1.1, s * 0.3); ctx.fill();
      ctx.fillStyle = skins[Math.floor(srand(id + 2) * skins.length)];
      ctx.beginPath(); ctx.arc(x, y - s * 0.75, s * 0.42, 0, 7); ctx.fill();
    }
  }
  // banner
  ctx.fillStyle = "#c4482b"; ctx.fillRect(0, hy - H * 0.025, W, H * 0.025);
  ctx.fillStyle = "#fff4e0"; ctx.font = `400 ${Math.max(10, H * 0.018)}px Bungee, Impact, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = 0; i < 4; i++) ctx.fillText("GO GO GO", W * (0.125 + i * 0.25), hy - H * 0.0125);
  ctx.textBaseline = "alphabetic";
}

// =====================================================================
// GAME STATE
// =====================================================================
let state = "menu"; // menu | waiting | playing | over
let keyboardMode = false;
const keys = {};
let playerX = W / 2, targetX = W / 2;
let objects = [], popups = [], particles = [];
// Coins you pick up are saved for whoever is playing, so they can be spent in the arcade.
// (The Shift+number world-jump test keys don't affect this.)
function bankCoin() {
  try {
    const p = window.ArcadeProgress && ArcadeProgress.player();
    if (!p) return;                                  // free play: nothing is saved
    const all = JSON.parse(localStorage.getItem("fake0hArcade.coins") || "{}");
    all[p] = (all[p] || 0) + 1;
    localStorage.setItem("fake0hArcade.coins", JSON.stringify(all));
  } catch (e) {}
}
let score = 0, totalCoins = 0, charge = 0, lives = 3, best = 0, level = 1;
let speed = 0.38, elapsed = 0, invuln = 0;
let cactusTimer = 0, coinTimer = 1.5;
let roadScroll = 0, T = 0, walkT = 0;
let handsUpTime = 0, flash = 0, advanceTimer = -1;
// Jumping
let jumpT = -1, jumpBase = null, jumpReady = true;
const JUMP_DUR = 0.75;            // seconds in the air
const JUMP_THRESHOLD = 0.3;       // how high you must jump (in shoulder-widths) to trigger
const jumpHeight = () => jumpT < 0 ? 0 : Math.sin(Math.PI * Math.min(1, jumpT / JUMP_DUR)) * H * 0.22;
function triggerJump() {
  if (jumpT >= 0) return;
  jumpT = 0; sfx.jump();
  if (state === "playing" && lives < 3) {
    lives += 1; sfx.heal();
    popups.push({ text: "+1 heart", x: playerX + H * 0.12, y: feetY() - H * 0.42, t: 0, color: "#ff6b8a" });
  }
}
let banner = null;
let figure = null; // latest stick-figure points (screen space)

const COIN_SIZE = 0.08; // coin radius as a fraction of screen height
const CHARGE_MAX = 3;
const theme = () => THEMES[Math.min(level - 1, FINALE_INDEX)];
const BODY_HALF = () => Math.max(28, W * 0.05);
const horizonY = () => H * 0.4;
const feetY = () => H * 0.93;
const roadTopHalf = () => W * 0.03;
const roadBottomHalf = () => W * 0.62;

let usedWorldJump = false; // the Shift+number test keys don't count toward winning
function resetGame() {
  usedWorldJump = false;
  objects = []; popups = [];
  score = 0; totalCoins = 0; charge = 0; lives = 3; level = 1;
  speed = 0.38; elapsed = 0; invuln = 0;
  cactusTimer = 0.8; coinTimer = 0.9;
  banner = null; cheerBoost = 0;
  initParticles();
}
function startGame() {
  audio();
  resetGame();
  state = "playing";
  overlay.classList.add("hidden");
  showBanner();
}
function showBanner() {
  const th = theme();
  banner = { title: th.finale ? `${th.name}!` : `World ${level}: ${th.name}`, sub: th.finale ? "The crowd goes wild" : `Dodge the ${th.obstacleName}`, t: 0 };
}

// Power bar geometry (right side)
function barRect() {
  const w = Math.max(40, W * 0.035);
  const camBottom = cameraOn ? 68 + Math.min(200, W * 0.25) * 0.75 + 30 : 70;
  const top = Math.max(H * 0.22, camBottom);
  const bottom = H * 0.8;
  return { x: W - w - 24, y: top, w, h: bottom - top };
}

function activateBar() {
  if (charge < CHARGE_MAX || state !== "playing") return;
  charge = 0; advanceTimer = -1;
  level += 1;
  objects = [];
  flash = 1;
  initParticles();
  showBanner();
  sfx.levelUp();
  if (theme().finale) {
    cheerBoost = 2; sfx.cheer(true); burstConfetti();
    // made it through all 10 worlds to the stadium: that beats the game
    if (!usedWorldJump) if (window.ArcadeProgress) ArcadeProgress.complete();
  }
  score += 250;
  invuln = 1.5; // a moment to get your bearings
}

function project(o) {
  const p = o.d * o.d;
  const y = horizonY() + p * (feetY() - horizonY());
  const half = roadTopHalf() + p * (roadBottomHalf() - roadTopHalf());
  return { p, x: W / 2 + o.u * half, y };
}
function spawnObstacle() {
  const u = (Math.random() * 2 - 1) * 0.9;
  objects.push({ type: "obstacle", u, d: 0, done: false, variant: Math.random() });
  if (elapsed > 20 && Math.random() < 0.3) {
    let u2 = (Math.random() * 2 - 1) * 0.9;
    if (Math.abs(u2 - u) < 0.4) u2 = -u;
    objects.push({ type: "obstacle", u: u2, d: 0, done: false, variant: Math.random() });
  }
}
function spawnCoin() {
  objects.push({ type: "coin", u: (Math.random() * 2 - 1) * 0.85, d: 0, done: false, spin: Math.random() * 6 });
}

// ---------- Particles ----------
function initParticles() {
  particles = [];
  const kind = theme().particles;
  if (!kind) return;
  const n = { snow: 120, bubbles: 40, embers: 50, leaves: 25, sprinkles: 50, fog: 12, confetti: 140 }[kind] || 0;
  for (let i = 0; i < n; i++) particles.push(newParticle(kind, true));
}
const CONFETTI = ["#ff4f4f", "#ffcc33", "#4fb0ff", "#5ad17a", "#c77dff", "#ff8ad1"];
function newParticle(kind, anywhere) {
  const p = { kind, x: Math.random() * W, y: anywhere ? Math.random() * H : -10, r: 2 + Math.random() * 3, s: Math.random(), a: Math.random() * 6 };
  if (kind === "bubbles" || kind === "embers") p.y = anywhere ? Math.random() * H : H + 10;
  if (kind === "fog") { p.y = horizonY() + Math.random() * H * 0.4; p.r = W * (0.1 + Math.random() * 0.15); }
  if (kind === "confetti" || kind === "sprinkles") p.c = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
  if (kind === "leaves") p.c = ["#d98a2b", "#b8502a", "#e0b03a"][Math.floor(Math.random() * 3)];
  return p;
}
function burstConfetti() {
  for (let i = 0; i < 120; i++) {
    const p = newParticle("confetti", false);
    p.x = W / 2 + (Math.random() - 0.5) * W * 0.6; p.y = H * 0.3 + Math.random() * H * 0.2;
    p.vy = -200 - Math.random() * 300; p.vx = (Math.random() - 0.5) * 400;
    particles.push(p);
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    switch (p.kind) {
      case "snow": p.y += (30 + p.s * 50) * dt; p.x += Math.sin(T + p.a) * 20 * dt; break;
      case "bubbles": p.y -= (40 + p.s * 60) * dt; p.x += Math.sin(T * 2 + p.a) * 15 * dt; break;
      case "embers": p.y -= (50 + p.s * 80) * dt; p.x += Math.sin(T * 3 + p.a) * 25 * dt; break;
      case "leaves": p.y += (25 + p.s * 30) * dt; p.x += Math.sin(T * 1.5 + p.a) * 40 * dt; p.a += dt * 2; break;
      case "fog": p.x += (10 + p.s * 15) * dt; if (p.x - p.r > W) p.x = -p.r; break;
      case "sprinkles":
      case "confetti":
        if (p.vy !== undefined) { p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98; if (p.vy > 80) p.vy = 80; }
        else { p.y += (40 + p.s * 60) * dt; p.x += Math.sin(T * 2 + p.a) * 30 * dt; }
        p.a += dt * 5; break;
    }
    const off = p.y > H + 20 || p.y < -30 || p.x < -30 || p.x > W + 30;
    if (off && p.kind !== "fog") Object.assign(p, newParticle(p.kind, false), { vy: undefined, vx: undefined });
  }
  const limit = { confetti: 140 }[theme().particles];
  if (limit && particles.length > limit) particles = particles.filter((p, i) => i < limit || p.y < H);
}
function drawParticles() {
  for (const p of particles) {
    switch (p.kind) {
      case "snow": ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); break;
      case "bubbles": ctx.strokeStyle = "rgba(200,240,255,0.6)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 2, 0, 7); ctx.stroke(); break;
      case "embers": ctx.fillStyle = `rgba(255,${120 + p.s * 100 | 0},40,${0.5 + 0.5 * Math.sin(T * 10 + p.a)})`; ctx.fillRect(p.x, p.y, p.r, p.r); break;
      case "leaves": ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, 6, 3, 0, 0, 7); ctx.fill(); ctx.restore(); break;
      case "fog": ctx.fillStyle = "rgba(200,200,230,0.07)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.2, 0, 0, 7); ctx.fill(); break;
      case "sprinkles":
      case "confetti":
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
        ctx.fillRect(-p.r, -p.r * 0.4, p.r * 2, p.r * 0.8); ctx.restore(); break;
    }
  }
}

// =====================================================================
// UPDATE
// =====================================================================
function update(dt) {
  T += dt;
  if (pose) {
    const lh = pose[23], rh = pose[24], ls = pose[11], rs = pose[12];
    let bx = vis(lh) && vis(rh) ? (lh.x + rh.x) / 2 : (ls.x + rs.x) / 2;
    bx = 1 - bx;
    const GAIN = 1.7;
    targetX = W / 2 + (bx - 0.5) * W * GAIN;
  }
  if (keyboardMode || !pose) {
    if (keys.ArrowLeft || keys.a) targetX -= W * 0.9 * dt;
    if (keys.ArrowRight || keys.d) targetX += W * 0.9 * dt;
  }
  const minX = W / 2 - roadBottomHalf() * 0.95, maxX = W / 2 + roadBottomHalf() * 0.95;
  targetX = Math.max(Math.max(minX, 30), Math.min(Math.min(maxX, W - 30), targetX));
  playerX += (targetX - playerX) * Math.min(1, dt * 12);

  // Jump detection: watch for the shoulders rising quickly above their resting height
  if (jumpT >= 0) { jumpT += dt; if (jumpT > JUMP_DUR) jumpT = -1; }
  if (pose) {
    const ls = pose[11], rs = pose[12];
    const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
    const y = (ls.y + rs.y) / 2;
    const unit = Math.max(0.05, Math.abs(ls.x - rs.x) * aspect); // shoulder width, in the same units as height
    if (jumpBase === null) jumpBase = y;
    const lift = (jumpBase - y) / unit;
    if (lift > JUMP_THRESHOLD && jumpReady) { triggerJump(); jumpReady = false; }
    if (lift < 0.12) jumpReady = true;
    if (jumpT < 0 && lift < 0.15) jumpBase += (y - jumpBase) * Math.min(1, dt * (y > jumpBase ? 0.4 : 3));
  } else jumpBase = null;

  const moving = state === "playing";
  walkT += dt * (moving ? 6 + speed * 8 : 0);
  figure = figurePoints();

  if ((state === "waiting" || state === "over") && pose) {
    const nose = pose[0], lw = pose[15], rw = pose[16];
    if (vis(lw) && vis(rw) && lw.y < nose.y && rw.y < nose.y) handsUpTime += dt;
    else handsUpTime = 0;
    if (handsUpTime > 0.7) { handsUpTime = 0; startGame(); }
  }

  const worldSpeed = moving ? speed : 0.12;
  roadScroll = (roadScroll + worldSpeed * dt * 2) % 1;
  updateParticles(dt);
  flash = Math.max(0, flash - dt * 2);
  cheerBoost = Math.max(0, cheerBoost - dt * 0.6);
  if (banner) { banner.t += dt; if (banner.t > 3) banner = null; }
  popups.forEach(p => p.t += dt);
  popups = popups.filter(p => p.t < 0.9);

  if (!moving) return;

  // Full bar: glow for a moment, then travel to the next world automatically
  if (advanceTimer >= 0) { advanceTimer -= dt; if (advanceTimer < 0) activateBar(); }

  elapsed += dt;
  const worldIdx = Math.min(level - 1, FINALE_INDEX);
  speed = 0.38 + Math.min(0.4, elapsed * 0.006) + worldIdx * 0.015;
  score += dt * 10 * (speed / 0.38);
  invuln = Math.max(0, invuln - dt);

  cactusTimer -= dt;
  if (cactusTimer <= 0) { spawnObstacle(); cactusTimer = Math.max(0.55, 1.5 - elapsed * 0.012) * (0.7 + Math.random() * 0.6); }
  coinTimer -= dt;
  if (coinTimer <= 0) { spawnCoin(); coinTimer = 0.7 + Math.random() * 0.7; }

  const playerU = (playerX - W / 2) / roadBottomHalf();
  for (const o of objects) {
    const before = o.d;
    o.d += worldSpeed * dt;
    if (o.type === "coin") o.spin += dt * 6;
    if (!o.done && before < 1 && o.d >= 1) {
      o.done = true;
      const dx = Math.abs(o.u - playerU) * roadBottomHalf();
      if (o.type === "obstacle") {
        const half = H * 0.24 * 0.32;
        const inLine = dx < half + BODY_HALF() * 0.7;
        if (inLine && jumpHeight() > H * 0.08) {
          score += 25;
          popups.push({ text: "Jumped it!", x: playerX, y: feetY() - H * 0.65, t: 0, color: "#7ad3ff" });
        } else if (inLine && invuln <= 0) {
          lives -= 1; invuln = 1.5; sfx.hit();
          popups.push({ text: "Ouch!", x: playerX, y: feetY() - H * 0.45, t: 0, color: "#ff5a3a" });
          if (lives <= 0) gameOver();
        }
      } else if (dx < H * COIN_SIZE + BODY_HALF() * 1.1) {
        o.collected = true; totalCoins += 1; score += 50;
        bankCoin();   // every coin is saved to the player's coin purse (spent on the arcade's secret machine)
        const wasFull = charge >= CHARGE_MAX;
        charge = Math.min(CHARGE_MAX, charge + 1);
        sfx.coin();
        if (!wasFull && charge >= CHARGE_MAX) {
          sfx.full(); advanceTimer = 0.6;
          popups.push({ text: "Power full!", x: W / 2, y: H * 0.3, t: 0, color: "#ffcc33" });
        } else popups.push({ text: "+50", x: playerX, y: feetY() - H * 0.45, t: 0, color: "#ffcc33" });
        if (theme().finale) { cheerBoost = Math.min(2, cheerBoost + 0.8); sfx.cheer(false); }
      }
    }
  }
  objects = objects.filter(o => o.d < 1.25 && !o.collected);
}

function gameOver() {
  state = "over";
  sfx.over();
  best = Math.max(best, Math.floor(score));
  const th = theme();
  card.innerHTML = `
    <h1>Game over</h1>
    <p>You reached ${th.finale ? th.name : `world ${level}, ${th.name}`}, with a score of <strong>${Math.floor(score)}</strong> and ${totalCoins} coin${totalCoins === 1 ? "" : "s"}. Best so far: ${best}.</p>
    <p>${keyboardMode ? "Press space to play again." : "Raise both hands above your head to play again."}</p>
    <div class="row"><button id="btnAgain">Play again</button></div>`;
  overlay.classList.remove("hidden");
  document.getElementById("btnAgain").onclick = startGame;
}

// =====================================================================
// STICK FIGURE: real tracked upper body + legs that always exist.
// Missing legs are simulated (walking), and the whole body is pushed up
// so the feet always stand on the ground line.
// =====================================================================
function figurePoints() {
  const torsoPx = H * 0.17;
  const legSeg = torsoPx * 0.62;
  const pts = {};
  let midX = playerX;

  if (pose) {
    const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
    const ls = pose[11], rs = pose[12], lh = pose[23], rh = pose[24];
    const shMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hipsSeen = vis(lh) && vis(rh);
    const hipMid = hipsSeen ? { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 } : { x: shMid.x, y: shMid.y + 0.28 };
    const torso = Math.hypot((shMid.x - hipMid.x) * aspect, shMid.y - hipMid.y) || 0.25;
    const scale = torsoPx / torso;
    const map = (lm) => ({ x: playerX - (lm.x - hipMid.x) * aspect * scale, y: (lm.y - hipMid.y) * scale });
    for (const i of [0, 11, 12, 13, 14, 15, 16, 19, 20]) if (i === 0 || i === 11 || i === 12 || vis(pose[i])) pts[i] = map(pose[i]);
    if (hipsSeen) { pts[23] = map(lh); pts[24] = map(rh); }
    // Real legs only if the whole chain is visible
    if (hipsSeen && vis(pose[25]) && vis(pose[26])) { pts[25] = map(pose[25]); pts[26] = map(pose[26]); }
    if (pts[25] && vis(pose[27]) && vis(pose[28])) { pts[27] = map(pose[27]); pts[28] = map(pose[28]); }
    pts.head = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y) * scale * 0.33;
  } else {
    // Keyboard mode: a simple standing figure
    const s = torsoPx, shY = -s;
    pts[0] = { x: playerX, y: shY - s * 0.38 }; pts.head = s * 0.22;
    pts[11] = { x: playerX - s * 0.28, y: shY }; pts[12] = { x: playerX + s * 0.28, y: shY };
    const arm = state === "playing" ? Math.sin(walkT) * s * 0.15 : 0;
    pts[13] = { x: playerX - s * 0.42, y: shY + s * 0.48 + arm }; pts[14] = { x: playerX + s * 0.42, y: shY + s * 0.48 - arm };
    pts[15] = { x: playerX - s * 0.48, y: shY + s * 0.92 + arm }; pts[16] = { x: playerX + s * 0.48, y: shY + s * 0.92 - arm };
  }

  // Hips: simulate from shoulders if missing
  if (!pts[23] || !pts[24]) {
    const sl = pts[11], sr = pts[12];
    midX = (sl.x + sr.x) / 2;
    const sy = (sl.y + sr.y) / 2;
    pts[23] = { x: midX + (sl.x - midX) * 0.65, y: sy + torsoPx };
    pts[24] = { x: midX + (sr.x - midX) * 0.65, y: sy + torsoPx };
  }

  // Legs: simulate a walking stride for anything not tracked
  const stride = state === "playing" ? Math.sin(walkT) * 0.45 : 0;
  const legs = [[23, 25, 27, 1], [24, 26, 28, -1]];
  for (const [h, k, a, side] of legs) {
    const hip = pts[h];
    if (!pts[k]) {
      const ang = stride * side;
      pts[k] = { x: hip.x + Math.sin(ang) * legSeg, y: hip.y + Math.cos(ang) * legSeg };
      pts[a] = null;
    }
    if (!pts[a]) {
      const ang = stride * side - Math.max(0, stride * side) * 0.9 - 0.05 * side; // bend knee on the back-swing
      pts[a] = { x: pts[k].x + Math.sin(ang) * legSeg, y: pts[k].y + Math.cos(ang) * legSeg };
    }
  }

  // Push everything up/down so the lowest foot is on the ground line
  const dy = feetY() - Math.max(pts[27].y, pts[28].y);
  const air = jumpHeight();
  for (const key of Object.keys(pts)) if (pts[key] && typeof pts[key] === "object") pts[key].y += dy - air;
  if (air > 0) { // tuck the feet up while airborne
    const tuck = air / (H * 0.22);
    for (const [k, a] of [[25, 27], [26, 28]]) { pts[a].y -= legSeg * 0.45 * tuck; pts[k].y -= legSeg * 0.15 * tuck; }
  }
  return pts;
}

const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
function strokeBones(points, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [a, b] of BONES) {
    const A = points[a], B = points[b];
    if (!A || !B) continue;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
}
function drawFigure() {
  if (!figure) return;
  if (invuln > 0 && Math.floor(invuln * 10) % 2 === 0) return;
  const pts = figure, w = Math.max(5, H * 0.014);
  const shrink = 1 - 0.5 * jumpHeight() / (H * 0.22);
  groundShadow(playerX, feetY(), BODY_HALF() * 1.1 * shrink, H * 0.015 * shrink);
  strokeBones(pts, "#2b1a12", w + 5);
  strokeBones(pts, "#ffffff", w);
  if (pts[0]) {
    const r = Math.max(10, pts.head || H * 0.04);
    ctx.lineWidth = 5; ctx.strokeStyle = "#2b1a12"; ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const i of [15, 16]) {
    if (!pts[i]) continue;
    ctx.fillStyle = "#ffb43b"; ctx.strokeStyle = "#2b1a12"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, w * 0.9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  for (const i of [27, 28]) { // shoes
    ctx.fillStyle = "#2b1a12";
    ctx.beginPath(); ctx.ellipse(pts[i].x, pts[i].y, w * 1.3, w * 0.7, 0, 0, 7); ctx.fill();
  }
}

// =====================================================================
// DRAWING
// =====================================================================
function drawBackground() {
  const th = theme(), hy = horizonY();
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, th.sky[0]); sky.addColorStop(0.55, th.sky[1]); sky.addColorStop(1, th.sky[2]);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, hy + 1);

  const ground = ctx.createLinearGradient(0, hy, 0, H);
  ground.addColorStop(0, th.ground[0]); ground.addColorStop(1, th.ground[1]);
  ctx.fillStyle = ground; ctx.fillRect(0, hy, W, H - hy);

  ctx.save(); th.scenery(hy); ctx.restore();

  const cx = W / 2, fy = H * 1.05;
  const bottomHalf = roadBottomHalf() * ((fy - hy) / (feetY() - hy));
  ctx.fillStyle = th.trail;
  ctx.beginPath();
  ctx.moveTo(cx - roadTopHalf(), hy); ctx.lineTo(cx + roadTopHalf(), hy);
  ctx.lineTo(cx + bottomHalf, fy); ctx.lineTo(cx - bottomHalf, fy); ctx.closePath(); ctx.fill();

  if (th.laneLines) {
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(cx + (i / 3.5) * roadTopHalf(), hy); ctx.lineTo(cx + (i / 3.5) * bottomHalf, fy); ctx.stroke();
    }
  }
  ctx.strokeStyle = th.stripe; ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const d = ((i / 12) + roadScroll) % 1, p = d * d, y = hy + p * (fy - hy);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    if (th.centerLine && i % 2 === 0) {
      const p2 = Math.min(1, (d + 0.04) * (d + 0.04)), y2 = hy + p2 * (fy - hy);
      ctx.strokeStyle = th.centerLine; ctx.lineWidth = 2 + p * 8;
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y2); ctx.stroke();
      ctx.strokeStyle = th.stripe; ctx.lineWidth = 2;
    }
  }
}

function drawCoin(x, y, r, spin) {
  ctx.save();
  ctx.translate(x, y - r * 1.6);
  ctx.scale(Math.max(0.15, Math.abs(Math.cos(spin))), 1);
  ctx.fillStyle = "#ffcc33"; ctx.strokeStyle = "#a86b00"; ctx.lineWidth = Math.max(1.5, r * 0.15);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "#e0a400"; ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.35, r * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  groundShadow(x, y, r * 0.8, r * 0.18);
}
function drawObject(o) {
  const { p, x, y } = project(o);
  ctx.save();
  if (o.type === "obstacle") theme().obstacle(x, y, H * 0.24 * Math.max(p, 0.02), o.variant);
  else drawCoin(x, y, H * COIN_SIZE * Math.max(p, 0.02), o.spin);
  ctx.restore();
}

function drawPowerBar() {
  const b = barRect(), full = charge >= CHARGE_MAX;
  const pulse = 0.5 + 0.5 * Math.sin(T * 8);
  ctx.save();
  if (full) { ctx.shadowColor = "#ffdd55"; ctx.shadowBlur = 20 + pulse * 30; }
  ctx.fillStyle = "rgba(43,26,18,0.75)";
  rr(b.x, b.y, b.w, b.h, b.w / 2); ctx.fill();
  ctx.restore();

  const pad = 5, segGap = 4;
  const segH = (b.h - pad * 2 - segGap * (CHARGE_MAX - 1)) / CHARGE_MAX;
  for (let i = 0; i < CHARGE_MAX; i++) {
    const y = b.y + b.h - pad - (i + 1) * segH - i * segGap;
    const on = i < charge;
    ctx.fillStyle = on ? (full ? `hsl(${45 + pulse * 10}, 100%, ${60 + pulse * 15}%)` : `hsl(${40 + i * 2}, 100%, ${50 + i * 2}%)`) : "rgba(255,255,255,0.12)";
    rr(b.x + pad, y, b.w - pad * 2, segH, Math.min(8, segH / 2)); ctx.fill();
  }
  ctx.strokeStyle = full ? "#fff4b0" : "#2b1a12"; ctx.lineWidth = 3;
  rr(b.x, b.y, b.w, b.h, b.w / 2); ctx.stroke();

  // coin icon + count under the bar
  const cy = b.y + b.h + 24;
  ctx.fillStyle = "#ffcc33"; ctx.strokeStyle = "#a86b00"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(b.x + b.w / 2, cy, 11, 0, 7); ctx.fill(); ctx.stroke();
  ctx.font = `800 15px Nunito, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.lineWidth = 4; ctx.strokeStyle = "#2b1a12"; ctx.fillStyle = "#fff4e0";
  const label = `${charge}/${CHARGE_MAX}`;
  ctx.strokeText(label, b.x + b.w / 2, cy + 16); ctx.fillText(label, b.x + b.w / 2, cy + 16);

  if (full && state === "playing") {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + pulse * 0.3})`;
    rr(b.x, b.y, b.w, b.h, b.w / 2); ctx.fill();
  }
  ctx.textBaseline = "alphabetic";
}

function outlinedText(text, x, y, size, fill, font = "Bungee, Impact, sans-serif", weight = 400) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.lineWidth = Math.max(4, size * 0.18); ctx.strokeStyle = "#2b1a12"; ctx.lineJoin = "round";
  ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function drawHUD() {
  ctx.save();
  const size = Math.max(18, H * 0.035), pad = 16;
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  outlinedText(`Score ${Math.floor(score)}`, pad, pad, size, "#fff4e0");
  const th = theme();
  outlinedText(th.finale ? `${th.name} · level ${level}` : `World ${level}/10: ${th.name}`, pad, pad + size * 1.25, Math.max(13, size * 0.55), "#ffdd55", "Nunito, sans-serif", 800);
  for (let i = 0; i < 3; i++) {
    const x = pad + 14 + i * 34, y = pad + size * 2.1;
    ctx.fillStyle = i < lives ? "#e0402a" : "rgba(43,26,18,0.35)";
    ctx.strokeStyle = "#2b1a12"; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.bezierCurveTo(x, y, x - 12, y, x - 12, y + 7);
    ctx.bezierCurveTo(x - 12, y + 14, x, y + 19, x, y + 23);
    ctx.bezierCurveTo(x, y + 19, x + 12, y + 14, x + 12, y + 7);
    ctx.bezierCurveTo(x + 12, y, x, y, x, y + 6);
    ctx.fill(); ctx.stroke();
  }

  if (cameraOn && video.readyState >= 2) {
    const pw = Math.min(200, W * 0.25), ph = pw * (video.videoHeight / video.videoWidth || 0.75);
    const px = W - pw - 16, py = 68;
    ctx.save();
    rr(px, py, pw, ph, 10); ctx.clip();
    ctx.translate(px + pw, py); ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, pw, ph);
    ctx.restore();
    ctx.strokeStyle = pose ? "#3fae5a" : "#e0402a"; ctx.lineWidth = 4;
    rr(px, py, pw, ph, 10); ctx.stroke();
    if (!pose) { ctx.textAlign = "right"; outlinedText("Step into view", px + pw - 8, py + ph + 8, 14, "#fff4e0", "Nunito, sans-serif", 800); }
  }

  ctx.textAlign = "center";
  if (state === "waiting") {
    const s2 = Math.max(20, H * 0.045);
    outlinedText(pose ? "Raise both hands to start" : "Step back into view", W / 2, H * 0.12, s2, "#fff4e0");
    if (handsUpTime > 0) { ctx.fillStyle = "#ffb43b"; ctx.fillRect(W / 2 - 100, H * 0.12 + s2 * 1.4, 200 * Math.min(1, handsUpTime / 0.7), 10); }
  }

  if (banner && state === "playing") {
    const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 2.4 ? Math.max(0, (3 - banner.t) / 0.6) : 1;
    ctx.globalAlpha = a;
    const s3 = Math.max(24, Math.min(W * 0.05, H * 0.07));
    outlinedText(banner.title, W / 2, H * 0.12, s3, "#ffdd55");
    outlinedText(banner.sub, W / 2, H * 0.12 + s3 * 1.3, Math.max(15, s3 * 0.45), "#fff4e0", "Nunito, sans-serif", 800);
    ctx.globalAlpha = 1;
  }

  for (const p of popups) {
    ctx.globalAlpha = 1 - p.t / 0.9;
    outlinedText(p.text, p.x, p.y - p.t * 60, Math.max(22, H * 0.05), p.color);
  }
  ctx.restore();
}

function render() {
  drawBackground();
  const sorted = [...objects].sort((a, b) => a.d - b.d);
  for (const o of sorted) if (o.d < 1) drawObject(o);
  drawFigure();
  for (const o of sorted) if (o.d >= 1) drawObject(o);
  drawParticles();
  if (state === "playing" || state === "over") drawPowerBar();
  drawHUD();
  if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W, H); }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (cameraOn) detectPose();
  update(dt);
  render();
  requestAnimationFrame(loop);
}
initParticles();
requestAnimationFrame(loop);

// =====================================================================
// CONTROLS
// =====================================================================
document.getElementById("btnCam").onclick = startCamera;
document.getElementById("btnKeys").onclick = () => { keyboardMode = true; startGame(); };
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  if (e.key === " " && (state === "over" || state === "waiting")) { e.preventDefault(); startGame(); return; }
  if ((e.key === " " || e.key === "ArrowUp" || e.key === "w") && state === "playing") { e.preventDefault(); triggerJump(); }
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });

// Debug helper: press 1-9, 0, or S (stadium) while playing to jump to a world
window.addEventListener("keydown", (e) => {
  if (state !== "playing" || !e.shiftKey) return;
  const map = { "!": 1, "@": 2, "#": 3, "$": 4, "%": 5, "^": 6, "&": 7, "*": 8, "(": 9, ")": 10, "S": 11 };
  if (map[e.key]) { usedWorldJump = true; level = map[e.key] - 1; charge = CHARGE_MAX; activateBar(); }
});
})();
