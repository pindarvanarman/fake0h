// Pindars Piano Party - webcam body-tracking music game
// Sections: setup, audio (piano, drums, beat), pose tracking, game state, figure, drawing, controls
(function () {
"use strict";

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const video = document.getElementById("cam");
const overlay = document.getElementById("overlay");
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

const srand = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// =====================================================================
// SETTINGS (easy to tweak)
// =====================================================================
const GAIN = 1.7;             // how far the figure moves per real step
const JUMP_THRESHOLD = 0.3;   // how high you must jump (in shoulder-widths)
const JUMP_DUR = 0.6;         // seconds in the air
const BPM_SLOW = 80;          // beat speed when standing still
const BPM_FAST = 165;         // beat speed when dancing hard
const FIRST_NOTE = 48;        // MIDI note of the leftmost key (48 = C3)
const WHITE_KEYS = 15;        // number of white keys (15 = two octaves + C)
const BOMB_CHANCE = 0.12;     // chance that something flying by is a bomb instead of a balloon
const RECOVER_PER_HIT = 0.1;  // how much each drum hit fills the get-up meter (0.1 = about 10 fast hits)
const RECOVER_DECAY = 0.15;   // how fast the get-up meter drains if you stop drumming
const WIN_BALLOONS = 100;     // pop this many balloons to win
const MAX_BOMBS = 3;          // this many bomb blasts and it's game over

// =====================================================================
// AUDIO
// =====================================================================
let actx = null, master = null, noiseBuf = null;
function audio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = actx.createGain(); master.gain.value = 0.9;
    master.connect(comp).connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}
const now = () => (actx ? actx.currentTime : 0);
const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}
function osc(type, freq, t, dur, peak, attack = 0.005, dest = master, freqEnd) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur * 0.6);
  env(g, t, peak, attack, dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + attack + dur + 0.05);
}
function noise(t, dur, peak, type, freq, q = 1) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, t, peak, 0.002, dur);
  s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + 0.05);
}

// Piano-ish note: a few harmonics with a soft filter that closes as it fades
function piano(midi, vel = 1) {
  if (!audio()) return;
  const t = now(), f = midiFreq(midi);
  const lp = actx.createBiquadFilter(); lp.type = "lowpass";
  lp.frequency.setValueAtTime(Math.min(8000, f * 8), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + 1.2);
  lp.connect(master);
  osc("triangle", f, t, 1.6, 0.22 * vel, 0.004, lp);
  osc("sine", f * 2, t, 0.9, 0.08 * vel, 0.004, lp);
  osc("sine", f * 3, t, 0.4, 0.03 * vel, 0.004, lp);
  noise(t, 0.03, 0.04 * vel, "highpass", 3000); // hammer tap
}

const drums = {
  kick(t, v = 1) { osc("sine", 150, t, 0.32, 0.9 * v, 0.002, master, 42); },
  snare(t, v = 1) { noise(t, 0.18, 0.45 * v, "highpass", 1500); osc("triangle", 190, t, 0.1, 0.3 * v, 0.002); },
  hat(t, v = 1, open = false) { noise(t, open ? 0.25 : 0.04, 0.22 * v, "highpass", 7500); },
  tom(t, v = 1, f = 200) { osc("sine", f, t, 0.35, 0.7 * v, 0.002, master, f * 0.55); },
  clap(t, v = 1) { for (let i = 0; i < 3; i++) noise(t + i * 0.012, 0.09, 0.4 * v, "bandpass", 1300, 0.8); },
  crash(t, v = 1) { noise(t, 1.3, 0.3 * v, "highpass", 4500); },
  boom(t) {
    noise(t, 2.4, 1.0, "lowpass", 450, 0.7);
    osc("sine", 95, t, 1.4, 1.0, 0.004, master, 26);
    noise(t, 1.6, 0.45, "highpass", 2500);
    noise(t + 0.15, 1.8, 0.35, "bandpass", 900, 0.6);
  },
  boing(t) { osc("square", 220, t, 0.18, 0.06, 0.004, master, 520); },
  getUp(t) { [523, 659, 784, 1047].forEach((f, i) => osc("square", f, t + i * 0.08, 0.18, 0.06)); },
  bass(t, midi, v = 1) {
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.connect(master);
    osc("sawtooth", midiFreq(midi), t, 0.28, 0.28 * v, 0.005, lp);
  }
};

// ---------- Movement-driven background beat ----------
let energy = 0;            // 0 = standing still, 1 = dancing hard
let bpm = BPM_SLOW;
let beatOn = false, nextStepTime = 0, step = 0, bar = 0;
let kickQueue = [];        // times of scheduled kicks, for the visual pulse
const BASS_ROOTS = [36, 33, 29, 31]; // C, A, F, G
function scheduleStep(s, t) {
  const e = energy, v = 0.25 + e * 0.75;
  const lvl = e < 0.12 ? 0 : e < 0.45 ? 1 : e < 0.75 ? 2 : 3;
  if (s === 0 || (lvl >= 1 && s === 8) || (lvl >= 2 && s === 10) || (lvl >= 3 && s === 6)) { drums.kick(t, v); kickQueue.push(t); }
  if (lvl >= 1 && (s === 4 || s === 12)) drums.snare(t, v * 0.8);
  if (lvl >= 3 && (s === 4 || s === 12)) drums.clap(t, v * 0.5);
  if (lvl >= 1 && s % 2 === 0) drums.hat(t, v * (s % 4 === 0 ? 0.6 : 0.4));
  if (lvl >= 2 && s % 2 === 1) drums.hat(t, v * 0.25);
  if (lvl >= 2 && s === 14) drums.hat(t, v * 0.4, true);
  const root = BASS_ROOTS[bar % 4];
  if (lvl >= 1 && (s === 0 || s === 6 || s === 8)) drums.bass(t, root, v);
  if (lvl >= 2 && s === 14) drums.bass(t, root + 12, v * 0.8);
}
setInterval(() => {
  if (!actx || !beatOn) return;
  if (nextStepTime < actx.currentTime) nextStepTime = actx.currentTime + 0.05;
  while (nextStepTime < actx.currentTime + 0.12) {
    scheduleStep(step, nextStepTime);
    nextStepTime += 60 / bpm / 4;
    step = (step + 1) % 16;
    if (step === 0) bar++;
  }
}, 25);

// =====================================================================
// POSE TRACKING
// =====================================================================
let landmarker = null, pose = null, lastVideoTime = -1, cameraOn = false;

async function startCamera() {
  audio();
  if (window.top !== window.self) { statusEl.textContent = "This is running inside a preview window, which can't use the camera. Open the game from the downloaded folder in Chrome or Edge."; return; }
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { statusEl.textContent = "This browser won't allow the camera here. Open the game directly in Chrome or Edge."; return; }
  statusEl.textContent = "Asking for camera access…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }, audio: false });
    video.srcObject = stream; await video.play();
  } catch (e) {
    const msgs = {
      NotAllowedError: "Camera permission was denied. Click the camera icon in the address bar, choose Allow, then reload.",
      NotFoundError: "No camera was found. Plug one in, or play with keyboard and mouse.",
      NotReadableError: "The camera is busy. Close other apps using it (Zoom, Teams, FaceTime), then try again."
    };
    statusEl.textContent = msgs[e.name] || `Camera error: ${e.name || ""} ${e.message || e}`;
    return;
  }
  statusEl.textContent = "Camera on. Loading body tracking (first time takes a few seconds)…";
  let PoseLandmarker, FilesetResolver;
  try { ({ PoseLandmarker, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`)); }
  catch { statusEl.textContent = "Couldn't download the body-tracking library. Check your internet connection or ad blocker, then reload."; return; }
  try {
    const files = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
    try { landmarker = await PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate: "GPU" }, runningMode: "VIDEO", numPoses: 1 }); }
    catch { landmarker = await PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath, delegate: "CPU" }, runningMode: "VIDEO", numPoses: 1 }); }
  } catch (e) { statusEl.textContent = `Body tracking failed to load (${e.message || e}). Check your internet connection and reload.`; return; }
  cameraOn = true; keyboardMode = false;
  startPlaying();
}
function detectPose() {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, performance.now());
  pose = res.landmarks && res.landmarks.length ? res.landmarks[0] : null;
}
const vis = (lm) => lm && (lm.visibility ?? 1) > 0.5;

// =====================================================================
// GAME STATE
// =====================================================================
let state = "menu";
let keyboardMode = false;
const keys = {};
let playerX = W / 2, targetX = W / 2, prevPlayerX = W / 2, playerVel = 0;
let T = 0, walkT = 0, strideAmt = 0;
let jumpT = -1, jumpBase = null, jumpReady = true;
let figure = null;
let balloons = [], sparks = [], notesFx = [];
let popped = 0, notesPlayed = 0;
let balloonTimer = 1;
let pulse = 0;
// Bomb explosion state
let shake = 0, flash = 0, boomT = -1, cracks = [], crackAlpha = 0;
let recover = 0, fallT = 0, fallSnap = null, fallDir = 1, lastRecoverT = -10, recoverBump = 0;
let bombsHit = 0, finalBlast = false, finalT = 0, celebrateT = 0;
// Two drums appear while knocked down; bang them to get up
const drumKit = [{ bounce: 0, inside: [false, false] }, { bounce: 0, inside: [false, false] }];
let nextKeyDrum = 0;
let prevLm = null;
let keyGlow = new Array(WHITE_KEYS).fill(0);
const feet = { 27: { key: undefined, grounded: true, last: 0 }, 28: { key: undefined, grounded: true, last: 0 } };

const horizonY = () => H * 0.58;
const feetY = () => H * 0.93;
const jumpHeight = () => jumpT < 0 ? 0 : Math.sin(Math.PI * Math.min(1, jumpT / JUMP_DUR)) * H * 0.18;

// White-key notes: C D E F G A B
const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11];
const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const keyMidi = (i) => FIRST_NOTE + Math.floor(i / 7) * 12 + WHITE_STEPS[i % 7];
const keyHue = (i) => (i * 360 / 7) % 360;

function startPlaying() {
  audio();
  state = "playing"; beatOn = true;
  overlay.classList.add("hidden");
}

function triggerJump() {
  if (jumpT >= 0 || state !== "playing") return;
  jumpT = 0;
  energy = Math.min(1, energy + 0.15);
}

// Floor geometry: a trapezoid from the horizon to below the screen
function floorGeom() {
  const hy = horizonY(), fy = feetY();
  const tFeet = (fy - hy) / (H - hy);
  const topHalf = W * 0.2, feetHalf = W * 0.5;
  const bottomHalf = topHalf + (feetHalf - topHalf) / tFeet;
  return { hy, topHalf, bottomHalf, feetHalf };
}
function footKey(x) {
  const g = floorGeom();
  const u = (x - W / 2) / g.feetHalf;
  return clamp(Math.floor((u + 1) / 2 * WHITE_KEYS), 0, WHITE_KEYS - 1);
}
function playKey(i, vel) {
  piano(keyMidi(i), vel);
  keyGlow[i] = 1; notesPlayed++;
  const g = floorGeom();
  const x = W / 2 + ((i + 0.5) / WHITE_KEYS * 2 - 1) * g.feetHalf;
  notesFx.push({ x, y: feetY() - H * 0.02, t: 0, hue: keyHue(i), name: NOTE_NAMES[i % 7] });
}

// Balloons
const BALLOON_TYPES = [
  { color: "#ff4f6b", drum: "kick" }, { color: "#4fa3ff", drum: "snare" }, { color: "#5ad17a", drum: "tom" },
  { color: "#ffcc33", drum: "clap" }, { color: "#c77dff", drum: "crash" }, { color: "#ff8a3d", drum: "tom2" }
];
function spawnBalloon() {
  const type = BALLOON_TYPES[Math.floor(Math.random() * BALLOON_TYPES.length)];
  const r = H * 0.055 * (0.85 + Math.random() * 0.3);
  const bomb = Math.random() < BOMB_CHANCE && T - lastRecoverT > 5;
  balloons.push({
    bomb, x: -r * 2, baseY: H * (0.17 + Math.random() * 0.33), y: 0, r, type,
    speed: W / lerp(4.2, 2.3, energy) * (0.85 + Math.random() * 0.3), phase: Math.random() * 6
  });
}
// ---------- BOMB! ----------
function explode(b) {
  b.popped = true;
  state = "down"; beatOn = false;
  bombsHit++;
  finalBlast = bombsHit >= MAX_BOMBS; finalT = 0;
  drumKit.forEach(d => { d.bounce = 0; d.inside = [false, false]; });
  shake = 1; flash = 1; boomT = 0; crackAlpha = 1;
  recover = 0; fallT = 0; recoverBump = 0;
  fallSnap = JSON.parse(JSON.stringify(figure));
  fallDir = playerX > W / 2 ? -1 : 1;  // fall toward the middle so the figure stays on screen
  if (audio()) drums.boom(now());
  // fireball
  const fire = ["#ffdd55", "#ff8a1f", "#ff4a1a", "#ffffff", "#ffb02e"];
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2, sp = 200 + Math.random() * 900;
    sparks.push({ x: b.x, y: b.y, px: b.x, py: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 1.2, t: 0, color: fire[i % fire.length] });
  }
  for (let i = 0; i < 4; i++) sparks.push({ ring: true, x: b.x, y: b.y, t: -i * 0.08, life: 0.7, color: i % 2 ? "#ff8a1f" : "#ffdd55", r: b.r * (1 + i) });
  // every other balloon in the sky goes off too
  for (const o of balloons) if (!o.popped && o !== b) {
    o.popped = true;
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 300;
      sparks.push({ x: o.x, y: o.y, px: o.x, py: o.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.6, t: 0, color: o.type.color });
    }
  }
  // the screen cracks like glass
  cracks = [];
  for (let i = 0; i < 11; i++) {
    let ang = (i / 11) * Math.PI * 2 + Math.random() * 0.4, x = b.x, y = b.y;
    const line = [[x, y]];
    while (x > -50 && x < W + 50 && y > -50 && y < H + 50) {
      ang += (Math.random() - 0.5) * 0.7;
      const len = 30 + Math.random() * 60;
      x += Math.cos(ang) * len; y += Math.sin(ang) * len;
      line.push([x, y]);
      if (Math.random() < 0.12) {
        const br = [[x, y]]; let bx = x, by = y, ba = ang + (Math.random() < 0.5 ? 0.8 : -0.8);
        for (let k = 0; k < 4; k++) { bx += Math.cos(ba) * 35; by += Math.sin(ba) * 35; ba += (Math.random() - 0.5) * 0.6; br.push([bx, by]); }
        cracks.push(br);
      }
    }
    cracks.push(line);
  }
  balloons = [];
}
// Drum positions: either side of where the player stands, about hand height
function drumGeom(i) {
  const side = i === 0 ? -1 : 1;
  return { x: playerX + side * H * 0.26, y: feetY() - H * 0.4, rx: H * 0.085, ry: H * 0.03, body: H * 0.11 };
}
function hitDrum(i) {
  if (state !== "down" || fallT < 1 || finalBlast) return;
  const d = drumKit[i];
  d.bounce = 1;
  recover = Math.min(1, recover + RECOVER_PER_HIT);
  recoverBump = 1;
  if (audio()) { const t = now(); drums.tom(t, 0.9, i === 0 ? 190 : 130); drums.snare(t, 0.25); }
  const g = drumGeom(i);
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI * Math.random(), sp = 120 + Math.random() * 200;
    sparks.push({ x: g.x, y: g.y, px: g.x, py: g.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.3, t: 0, color: i === 0 ? "#ff4f8b" : "#4fa3ff" });
  }
  if (recover >= 1) {
    state = "rising";
    if (audio()) drums.getUp(now());
    notesFx.push({ x: W / 2, y: H * 0.42, t: 0, hue: 50, name: "Back on your feet!", big: true });
  }
}
function onJumpGesture() {
  if (state === "playing") triggerJump();
}
function updateDrums(dt) {
  drumKit.forEach(d => d.bounce = Math.max(0, d.bounce - dt * 5));
  if (!figure) return;
  const hands = [figure[15], figure[16]];
  drumKit.forEach((d, i) => {
    const g = drumGeom(i);
    hands.forEach((h, j) => {
      if (!h) { d.inside[j] = false; return; }
      const dx = (h.x - g.x) / (g.rx * 1.35), dy = h.y - g.y;
      const inside = Math.abs(dx) < 1 && dy > -g.ry * 2.5 && dy < g.body * 0.6;
      if (inside && !d.inside[j]) hitDrum(i);
      d.inside[j] = inside;
    });
  });
}

// ---------- Win / lose ----------
function showEnd(win) {
  state = win ? "won" : "lost";
  if (win) if (window.ArcadeProgress) ArcadeProgress.complete(); // popped all 100 balloons
  beatOn = false;
  balloons = [];
  if (audio()) {
    const t = now();
    if (win) { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => osc("square", f, t + i * 0.12, 0.25, 0.07)); drums.crash(t + 0.84, 1); }
    else { [392, 330, 262, 196].forEach((f, i) => osc("triangle", f, t + i * 0.25, 0.4, 0.09)); }
  }
  const card = document.getElementById("card");
  card.innerHTML = win
    ? `<h1>You win!</h1>
       <p>You popped all ${WIN_BALLOONS} balloons and played ${notesPlayed} notes on the giant piano.</p>
       <p>${bombsHit === 0 ? "And you never got blown up once. Amazing!" : `You survived ${bombsHit} bomb${bombsHit === 1 ? "" : "s"} along the way.`}</p>`
    : `<h1>Game over</h1>
       <p>Three bombs blew up and knocked you out for good.</p>
       <p>You popped ${popped} of ${WIN_BALLOONS} balloons and played ${notesPlayed} notes.</p>`;
  card.innerHTML += `<div class="row"><button id="btnAgain">Play again</button><button id="btnExit2" class="secondary">Exit to arcade</button></div>`;
  overlay.classList.remove("hidden");
  document.getElementById("btnAgain").onclick = restart;
  document.getElementById("btnExit2").onclick = () => { location.href = "../../index.html"; };
}
function restart() {
  popped = 0; notesPlayed = 0; bombsHit = 0;
  balloons = []; sparks = []; cracks = []; notesFx = [];
  crackAlpha = 0; recover = 0; fallT = 0; fallSnap = null; finalBlast = false;
  energy = 0; lastRecoverT = T; balloonTimer = 1;
  startPlaying();
}
function celebrate(dt) {
  celebrateT -= dt;
  if (celebrateT > 0) return;
  celebrateT = 0.25 + Math.random() * 0.3;
  const x = W * (0.1 + Math.random() * 0.8), y = H * (0.1 + Math.random() * 0.35);
  const color = BALLOON_TYPES[Math.floor(Math.random() * BALLOON_TYPES.length)].color;
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 300;
    sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9 + Math.random() * 0.6, t: 0, color: Math.random() < 0.75 ? color : "#ffffff" });
  }
  if (audio()) noise(now(), 0.3, 0.12, "highpass", 3000);
}

function popBalloon(b) {
  b.popped = true; popped++;
  if (popped >= WIN_BALLOONS) setTimeout(() => { if (state === "playing") showEnd(true); }, 400);
  if (audio()) {
    const t = now();
    noise(t, 0.06, 0.25, "highpass", 2000);
    const d = b.type.drum;
    if (d === "tom2") drums.tom(t, 1, 140); else drums[d](t, 1);
  }
  energy = Math.min(1, energy + 0.04);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, sp = 140 + Math.random() * 320;
    sparks.push({ x: b.x, y: b.y, px: b.x, py: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.8 + Math.random() * 0.6, t: 0, color: Math.random() < 0.7 ? b.type.color : "#ffffff" });
  }
  sparks.push({ ring: true, x: b.x, y: b.y, t: 0, life: 0.35, color: b.type.color, r: b.r });
}

// =====================================================================
// UPDATE
// =====================================================================
function update(dt) {
  T += dt;

  // --- player position ---
  const knockedOut = state === "down" || state === "rising";
  if (pose && !knockedOut) {
    const lh = pose[23], rh = pose[24], ls = pose[11], rs = pose[12];
    let bx = vis(lh) && vis(rh) ? (lh.x + rh.x) / 2 : (ls.x + rs.x) / 2;
    targetX = W / 2 + ((1 - bx) - 0.5) * W * GAIN;
  }
  if ((keyboardMode || !pose) && !knockedOut) {
    if (keys.ArrowLeft || keys.a) targetX -= W * 0.7 * dt;
    if (keys.ArrowRight || keys.d) targetX += W * 0.7 * dt;
  }
  targetX = clamp(targetX, 30, W - 30);
  prevPlayerX = playerX;
  playerX += (targetX - playerX) * Math.min(1, dt * 12);
  playerVel = (playerX - prevPlayerX) / Math.max(dt, 0.001);

  // --- walking stride comes from real movement ---
  const legSeg = H * 0.17 * 0.62;
  strideAmt += (clamp(Math.abs(playerVel) / (W * 0.25), 0, 1) - strideAmt) * Math.min(1, dt * 8);
  walkT += Math.abs(playerX - prevPlayerX) / (legSeg * 0.55);

  // --- jump detection (same as Cactus Run) ---
  if (jumpT >= 0) { jumpT += dt; if (jumpT > JUMP_DUR) jumpT = -1; }
  if (pose) {
    const ls = pose[11], rs = pose[12];
    const aspect = (video.videoWidth || 640) / (video.videoHeight || 480);
    const y = (ls.y + rs.y) / 2, unit = Math.max(0.05, Math.abs(ls.x - rs.x) * aspect);
    if (jumpBase === null) jumpBase = y;
    const lift = (jumpBase - y) / unit;
    if (lift > JUMP_THRESHOLD && jumpReady) { onJumpGesture(); jumpReady = false; }
    if (lift < 0.12) jumpReady = true;
    if (jumpT < 0 && lift < 0.15) jumpBase += (y - jumpBase) * Math.min(1, dt * (y > jumpBase ? 0.4 : 3));
  } else jumpBase = null;

  figure = figurePoints();

  // --- movement energy -> beat speed and balloon count ---
  let raw = 0;
  if (pose) {
    const ids = [0, 15, 16, 23, 24, 27, 28];
    if (prevLm) {
      let sum = 0;
      for (const i of ids) sum += Math.hypot(pose[i].x - prevLm[i].x, pose[i].y - prevLm[i].y);
      raw = clamp((sum / Math.max(dt, 0.001) - 0.35) / 3.2, 0, 1);
    }
    prevLm = ids.reduce((o, i) => (o[i] = { x: pose[i].x, y: pose[i].y }, o), {});
  } else {
    prevLm = null;
    raw = clamp(Math.abs(playerVel) / (W * 0.5), 0, 1);
  }
  energy += (raw - energy) * Math.min(1, dt * (raw > energy ? 1.6 : 0.35));
  energy = clamp(energy, 0, 1);
  bpm = lerp(BPM_SLOW, BPM_FAST, energy);

  // --- beat pulse for visuals ---
  if (actx) while (kickQueue.length && kickQueue[0] <= actx.currentTime) { kickQueue.shift(); pulse = 1; }
  pulse = Math.max(0, pulse - dt * 4);
  keyGlow = keyGlow.map(g => Math.max(0, g - dt * 1.8));

  // --- fireworks, explosion and note pop-ups ---
  for (const s of sparks) {
    s.t += dt;
    if (!s.ring) { s.px = s.x; s.py = s.y; s.vy += 260 * dt; s.vx *= 0.985; s.vy *= 0.985; s.x += s.vx * dt; s.y += s.vy * dt; }
  }
  sparks = sparks.filter(s => s.t < s.life);
  notesFx.forEach(n => n.t += dt * (n.big ? 0.5 : 1));
  notesFx = notesFx.filter(n => n.t < 1);
  shake = Math.max(0, shake - dt * 0.8);
  flash = Math.max(0, flash - dt * 1.4);
  if (boomT >= 0) { boomT += dt; if (boomT > 1.6) boomT = -1; }
  recoverBump = Math.max(0, recoverBump - dt * 4);

  if (state === "won") { celebrate(dt); return; }
  if (state === "down") {
    fallT = Math.min(1, fallT + dt * 2.2);
    if (finalBlast) { finalT += dt; if (finalT > 2.4) showEnd(false); return; }
    recover = Math.max(0, recover - RECOVER_DECAY * dt);
    if (fallT >= 1) updateDrums(dt);
    return;
  }
  if (state === "rising") {
    fallT -= dt * 2;
    if (fallT <= 0) { fallT = 0; state = "playing"; beatOn = true; lastRecoverT = T; balloonTimer = 1.5; }
    return;
  }
  crackAlpha = Math.max(0, crackAlpha - dt * 0.8);

  if (state !== "playing") return;

  // --- feet on keys ---
  const fy = feetY(), t = performance.now();
  for (const id of [27, 28]) {
    const p = figure[id], f = feet[id];
    const air = fy - p.y;
    if (f.grounded && air > H * 0.03) { f.grounded = false; f.key = -1; }
    else if (!f.grounded && air < H * 0.012) f.grounded = true;
    if (f.grounded) {
      const k = footKey(p.x);
      if (f.key === undefined) f.key = k;
      else if (k !== f.key && t - f.last > 70) { playKey(k, f.key === -1 ? 1 : 0.7); f.key = k; f.last = t; }
    }
  }

  // --- balloons ---
  balloonTimer -= dt;
  if (balloonTimer <= 0) { spawnBalloon(); balloonTimer = lerp(2.0, 0.28, energy) * (0.7 + Math.random() * 0.6); }
  const hands = [15, 16, 19, 20].map(i => figure[i]).filter(Boolean);
  for (const b of balloons) {
    b.x += b.speed * dt;
    b.y = b.baseY + Math.sin(T * 2 + b.phase) * H * 0.02;
    for (const h of hands) if (Math.hypot(h.x - b.x, h.y - b.y) < b.r + H * 0.03) { if (b.bomb) { explode(b); return; } popBalloon(b); break; }
  }
  balloons = balloons.filter(b => !b.popped && b.x < W + b.r * 3);

}

// =====================================================================
// STICK FIGURE (tracked upper body, legs always present, feet on the floor)
// =====================================================================
function figurePoints() {
  const torsoPx = H * 0.17, legSeg = torsoPx * 0.62;
  const pts = {};
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
    if (hipsSeen && vis(pose[25]) && vis(pose[26])) { pts[25] = map(pose[25]); pts[26] = map(pose[26]); }
    if (pts[25] && vis(pose[27]) && vis(pose[28])) { pts[27] = map(pose[27]); pts[28] = map(pose[28]); }
    pts.head = Math.hypot((ls.x - rs.x) * aspect, ls.y - rs.y) * scale * 0.33;
  } else {
    const s = torsoPx, shY = -s;
    pts[0] = { x: playerX, y: shY - s * 0.38 }; pts.head = s * 0.22;
    pts[11] = { x: playerX - s * 0.28, y: shY }; pts[12] = { x: playerX + s * 0.28, y: shY };
    const arm = Math.sin(walkT) * s * 0.2 * strideAmt;
    const up = keys.mouseDown ? 1 : 0;
    pts[13] = { x: playerX - s * 0.42, y: shY + s * (0.48 - up * 0.9) + arm };
    pts[14] = { x: playerX + s * 0.42, y: shY + s * (0.48 - up * 0.9) - arm };
    pts[15] = { x: playerX - s * 0.5, y: shY + s * (0.92 - up * 1.8) + arm };
    pts[16] = { x: playerX + s * 0.5, y: shY + s * (0.92 - up * 1.8) - arm };
  }
  if (!pts[23] || !pts[24]) {
    const sl = pts[11], sr = pts[12], midX = (sl.x + sr.x) / 2, sy = (sl.y + sr.y) / 2;
    pts[23] = { x: midX + (sl.x - midX) * 0.65, y: sy + torsoPx };
    pts[24] = { x: midX + (sr.x - midX) * 0.65, y: sy + torsoPx };
  }
  const stride = Math.sin(walkT) * 0.45 * strideAmt;
  for (const [h, k, a, side] of [[23, 25, 27, 1], [24, 26, 28, -1]]) {
    const hip = pts[h];
    if (!pts[k]) {
      const ang = stride * side;
      pts[k] = { x: hip.x + Math.sin(ang) * legSeg, y: hip.y + Math.cos(ang) * legSeg };
      pts[a] = null;
      // lift the swinging foot so walking makes steps
      const lift = Math.max(0, Math.cos(walkT) * side) * legSeg * 0.35 * strideAmt;
      pts[k].y -= lift * 0.4;
      pts[a] = { x: pts[k].x + Math.sin(ang * 0.3) * legSeg, y: pts[k].y + legSeg - lift * 0.6 };
    } else if (!pts[a]) {
      pts[a] = { x: pts[k].x, y: pts[k].y + legSeg };
    }
  }
  const air = jumpHeight();
  const dy = feetY() - Math.max(pts[27].y, pts[28].y);
  for (const key of Object.keys(pts)) if (pts[key] && typeof pts[key] === "object") pts[key].y += dy - air;
  if (air > 0) {
    const tuck = air / (H * 0.18);
    for (const [k, a] of [[25, 27], [26, 28]]) { pts[a].y -= legSeg * 0.45 * tuck; pts[k].y -= legSeg * 0.15 * tuck; }
  }
  return pts;
}

const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
const easeOutBounce = (x) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};
function drawFigure() {
  if (!figure) return;
  const w = Math.max(5, H * 0.014);
  if ((state === "down" || state === "rising" || state === "lost") && fallSnap) {
    // Rotate the frozen figure around its feet so it lies on the floor
    const s = fallSnap;
    const px = (s[27].x + s[28].x) / 2, py = feetY();
    const k = state === "down" ? easeOutBounce(fallT) : fallT * fallT * (3 - 2 * fallT);
    const a = fallDir * (Math.PI / 2) * k;
    const ca = Math.cos(a), sa = Math.sin(a);
    const lift = H * 0.035 * k;
    const pts = { head: s.head };
    for (const key of Object.keys(s)) {
      const p = s[key];
      if (!p || typeof p !== "object") continue;
      pts[key] = { x: px + (p.x - px) * ca - (p.y - py) * sa, y: py + (p.x - px) * sa + (p.y - py) * ca - lift };
    }
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(px + fallDir * H * 0.3 * k, feetY(), W * 0.05 + H * 0.25 * k, H * 0.014, 0, 0, 7); ctx.fill();
    drawStick(pts, w);
    // dizzy stars
    if (state === "down" && fallT >= 1 && pts[0]) {
      const r = Math.max(10, pts.head || H * 0.04);
      for (let i = 0; i < 3; i++) {
        const ang = T * 4 + i * 2.1;
        const sx = pts[0].x + Math.cos(ang) * r * 1.8, sy = pts[0].y - r * 1.4 + Math.sin(ang) * r * 0.5;
        drawStar(sx, sy, r * 0.45, "#ffdd55");
      }
    }
    return;
  }
  const pts = figure;
  const shrink = 1 - 0.5 * jumpHeight() / (H * 0.18);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(playerX, feetY(), W * 0.05 * shrink, H * 0.014 * shrink, 0, 0, 7); ctx.fill();
  drawStick(pts, w);
}
function drawStar(x, y, r, color) {
  ctx.fillStyle = color; ctx.strokeStyle = "#140a28"; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5;
    const X = x + Math.cos(a) * rr, Y = y + Math.sin(a) * rr;
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
function drawStick(pts, w) {  for (const [color, width] of [["#140a28", w + 5], ["#ffffff", w]]) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const [a, b] of BONES) {
      const A = pts[a], B = pts[b]; if (!A || !B) continue;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    }
  }
  if (pts[0]) {
    ctx.lineWidth = 5; ctx.strokeStyle = "#140a28"; ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, Math.max(10, pts.head || H * 0.04), 0, 7); ctx.fill(); ctx.stroke();
  }
  for (const i of [15, 16]) {
    if (!pts[i]) continue;
    ctx.save(); ctx.shadowColor = "#ffdd55"; ctx.shadowBlur = 14;
    ctx.fillStyle = "#ffdd55"; ctx.strokeStyle = "#140a28"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, w * 1.1, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  for (const i of [27, 28]) {
    ctx.fillStyle = "#140a28";
    ctx.beginPath(); ctx.ellipse(pts[i].x, pts[i].y, w * 1.4, w * 0.75, 0, 0, 7); ctx.fill();
  }
}

// =====================================================================
// DRAWING
// =====================================================================
function drawSky() {
  const hy = horizonY();
  const g = ctx.createLinearGradient(0, 0, 0, hy);
  g.addColorStop(0, "#0b0626"); g.addColorStop(0.6, "#2a1260"); g.addColorStop(1, "#5a2290");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 1);
  for (let i = 0; i < 90; i++) {
    const tw = 0.5 + 0.5 * Math.sin(T * 2 + i);
    ctx.fillStyle = `rgba(255,255,255,${0.25 + tw * 0.5})`;
    ctx.fillRect(srand(i) * W, srand(i + 300) * hy * 0.9, 2, 2);
  }
  // sweeping spotlights
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const beams = [[0.15, "255,79,139"], [0.5, "79,163,255"], [0.85, "255,221,85"]];
  beams.forEach(([fx, rgb], i) => {
    const bx = W * fx, by = hy, ang = Math.sin(T * (0.6 + i * 0.2) + i * 2) * 0.5;
    const len = hy * 1.2, spread = 0.12;
    ctx.fillStyle = `rgba(${rgb},${0.06 + pulse * 0.08 + energy * 0.05})`;
    ctx.beginPath(); ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.sin(ang - spread) * len, by - Math.cos(ang - spread) * len);
    ctx.lineTo(bx + Math.sin(ang + spread) * len, by - Math.cos(ang + spread) * len);
    ctx.fill();
  });
  ctx.restore();
  // equalizer along the horizon
  const bars = 40, bw = W / bars;
  for (let i = 0; i < bars; i++) {
    const h = H * 0.012 + H * 0.06 * (0.3 + energy) * (0.5 + 0.5 * Math.sin(T * 7 + i * 1.7)) * (0.6 + pulse * 0.6) * srand(i + Math.floor(T * 8)) ;
    ctx.fillStyle = `hsla(${(i * 9 + T * 40) % 360}, 90%, 62%, 0.55)`;
    ctx.fillRect(i * bw + 2, hy - h, bw - 4, h);
  }
}

function drawFloor() {
  const { hy, topHalf, bottomHalf } = floorGeom();
  ctx.fillStyle = "#1a0f33"; ctx.fillRect(0, hy, W, H - hy); // stage
  const X = (u, t) => W / 2 + u * lerp(topHalf, bottomHalf, t);
  const Y = (t) => hy + t * (H - hy);
  const N = WHITE_KEYS;
  const u = (i) => i / N * 2 - 1;
  // keyboard case
  ctx.fillStyle = "#0a0614";
  ctx.beginPath(); ctx.moveTo(X(-1.03, 0) , Y(0) - H * 0.012); ctx.lineTo(X(1.03, 0), Y(0) - H * 0.012);
  ctx.lineTo(X(1.03, 1), Y(1)); ctx.lineTo(X(-1.03, 1), Y(1)); ctx.fill();
  // white keys
  for (let i = 0; i < N; i++) {
    const g = keyGlow[i], gap = 0.004;
    const a = u(i) + gap, b = u(i + 1) - gap;
    ctx.beginPath();
    ctx.moveTo(X(a, 0), Y(0)); ctx.lineTo(X(b, 0), Y(0)); ctx.lineTo(X(b, 1), Y(1)); ctx.lineTo(X(a, 1), Y(1)); ctx.closePath();
    const grad = ctx.createLinearGradient(0, Y(0), 0, Y(1));
    grad.addColorStop(0, "#d9d4e8"); grad.addColorStop(1, "#ffffff");
    ctx.fillStyle = grad; ctx.fill();
    if (g > 0) {
      ctx.save();
      ctx.fillStyle = `hsla(${keyHue(i)}, 95%, 60%, ${0.25 + g * 0.65})`;
      ctx.shadowColor = `hsl(${keyHue(i)}, 95%, 60%)`; ctx.shadowBlur = 30 * g;
      ctx.fill(); ctx.restore();
    }
    // note names near the front
    const lt = (feetY() - hy) / (H - hy) + 0.03;
    ctx.fillStyle = g > 0.2 ? "#ffffff" : "rgba(60,40,100,0.55)";
    ctx.font = `800 ${Math.max(11, H * 0.022)}px Nunito, sans-serif`; ctx.textAlign = "center";
    ctx.fillText(NOTE_NAMES[i % 7], X((u(i) + u(i + 1)) / 2, lt), Y(lt) + H * 0.01);
  }
  // black keys (far half of the keys)
  for (let i = 0; i < N - 1; i++) {
    if ([2, 6].includes(i % 7)) continue; // no black key after E and B
    const c = u(i + 1), hw = (1 / N) * 0.6;
    const t2 = 0.42;
    ctx.fillStyle = "#16121f";
    ctx.beginPath();
    ctx.moveTo(X(c - hw, 0), Y(0)); ctx.lineTo(X(c + hw, 0), Y(0)); ctx.lineTo(X(c + hw, t2), Y(t2)); ctx.lineTo(X(c - hw, t2), Y(t2)); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath(); ctx.moveTo(X(c - hw * 0.6, 0.02), Y(0.02)); ctx.lineTo(X(c - hw * 0.3, 0.02), Y(0.02)); ctx.lineTo(X(c - hw * 0.3, t2 - 0.04), Y(t2 - 0.04)); ctx.lineTo(X(c - hw * 0.6, t2 - 0.04), Y(t2 - 0.04)); ctx.fill();
  }
  // beat flash on the floor
  if (pulse > 0) { ctx.fillStyle = `rgba(255,255,255,${pulse * 0.05})`; ctx.fillRect(0, hy, W, H - hy); }
}

function drawBalloon(b) {
  const { x, y, r } = b;
  ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, y + r * 1.15);
  ctx.quadraticCurveTo(x - r * 0.3 + Math.sin(T * 4 + b.phase) * r * 0.3, y + r * 1.8, x, y + r * 2.5); ctx.stroke();
  ctx.fillStyle = b.type.color;
  ctx.beginPath(); ctx.moveTo(x - r * 0.15, y + r * 1.2); ctx.lineTo(x + r * 0.15, y + r * 1.2); ctx.lineTo(x, y + r * 1.02); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y, r * 0.88, r * 1.08, 0, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath(); ctx.ellipse(x - r * 0.32, y - r * 0.4, r * 0.18, r * 0.3, -0.5, 0, 7); ctx.fill();
}

function drawSparks() {
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const s of sparks) {
    if (s.t < 0) continue;
    const a = 1 - s.t / s.life;
    if (s.ring) {
      ctx.strokeStyle = s.color; ctx.globalAlpha = a; ctx.lineWidth = 4 * a + 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1 + s.t * 6), 0, 7); ctx.stroke();
    } else {
      ctx.globalAlpha = a; ctx.strokeStyle = s.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(s.px - (s.x - s.px) * 2, s.py - (s.y - s.py) * 2); ctx.lineTo(s.x, s.y); ctx.stroke();
    }
  }
  ctx.restore();
}

function outlined(text, x, y, size, fill, font = "Bungee, Impact, sans-serif", weight = 400) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.lineWidth = Math.max(4, size * 0.18); ctx.strokeStyle = "#140a28"; ctx.lineJoin = "round";
  ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function drawHUD() {
  ctx.save();
  const size = Math.max(16, H * 0.03), pad = 16;
  ctx.textBaseline = "top"; ctx.textAlign = "left";
  outlined(`Balloons ${popped}/${WIN_BALLOONS}`, pad, pad, size, "#ffdd55");
  outlined(`Notes ${notesPlayed}`, pad, pad + size * 1.3, size, "#7ad3ff");
  // bombs: one icon per life, crossed out when used
  for (let i = 0; i < MAX_BOMBS; i++) {
    const bx = pad + size * 0.55 + i * size * 1.35, by = pad + size * 3.1, r = size * 0.48;
    const used = i < bombsHit;
    ctx.globalAlpha = used ? 0.45 : 1;
    ctx.fillStyle = "#111118"; ctx.strokeStyle = "#fff4e0"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#ffb02e"; ctx.beginPath(); ctx.moveTo(bx + r * 0.5, by - r * 0.8); ctx.lineTo(bx + r * 0.9, by - r * 1.3); ctx.stroke();
    ctx.globalAlpha = 1;
    if (used) { ctx.strokeStyle = "#ff4f6b"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(bx - r, by - r); ctx.lineTo(bx + r, by + r); ctx.moveTo(bx + r, by - r); ctx.lineTo(bx - r, by + r); ctx.stroke(); }
  }

  // Camera preview
  let groovTop = 30;
  if (cameraOn && video.readyState >= 2) {
    const pw = Math.min(180, W * 0.2), ph = pw * (video.videoHeight / video.videoWidth || 0.75);
    const px = W - pw - 16, py = 68;
    ctx.save(); ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.clip();
    ctx.translate(px + pw, py); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, pw, ph); ctx.restore();
    ctx.strokeStyle = pose ? "#5ad17a" : "#ff4f6b"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 10); ctx.stroke();
    if (!pose) { ctx.textAlign = "right"; outlined("Step into view", px + pw - 6, py + ph + 6, 14, "#fff4e0", "Nunito, sans-serif", 800); ctx.textAlign = "left"; }
    groovTop = py + ph + 34;
  }

  // Groove meter (movement energy and tempo)
  const mw = Math.max(36, W * 0.028), mx = W - mw - 24, my = Math.max(groovTop, H * 0.24), mh = H * 0.5 - (my - H * 0.24);
  ctx.fillStyle = "rgba(20,10,40,0.75)";
  ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, mw / 2); ctx.fill();
  const fill = mh * clamp(energy, 0.03, 1);
  const g = ctx.createLinearGradient(0, my + mh, 0, my);
  g.addColorStop(0, "#5ad17a"); g.addColorStop(0.5, "#ffcc33"); g.addColorStop(1, "#ff4f6b");
  ctx.save(); ctx.shadowColor = "#ff4f8b"; ctx.shadowBlur = 10 + pulse * 25;
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(mx + 4, my + mh - fill + 4, mw - 8, Math.max(0, fill - 8), (mw - 8) / 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#fff4e0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, mw / 2); ctx.stroke();
  ctx.textAlign = "center";
  outlined(`${Math.round(bpm)}`, mx + mw / 2, my + mh + 10, Math.max(16, H * 0.028), "#fff4e0");
  outlined("BPM", mx + mw / 2, my + mh + 10 + Math.max(16, H * 0.028) * 1.1, 12, "#b9abde", "Nunito, sans-serif", 800);
  outlined("Groove", mx + mw / 2, my - 22, 13, "#fff4e0", "Nunito, sans-serif", 800);

  // Note names rising from the keys
  for (const n of notesFx) {
    ctx.globalAlpha = 1 - n.t;
    if (n.big) outlined(n.name, n.x, n.y - n.t * H * 0.1, Math.max(24, H * 0.06), "#5ad17a");
    else outlined(`♪ ${n.name}`, n.x, n.y - n.t * H * 0.12, Math.max(16, H * 0.032), `hsl(${n.hue}, 95%, 65%)`);
  }
  ctx.globalAlpha = 1;

  if (state === "playing" && T < 6 && popped === 0 && notesPlayed < 3) {
    ctx.globalAlpha = Math.min(1, (6 - T) / 1.5);
    outlined(keyboardMode || !pose ? "Arrows walk, Space jumps, click balloons" : "Walk, stomp and jump on the keys. Pop balloons!", W / 2, H * 0.06, Math.max(16, H * 0.032), "#fff4e0", "Nunito, sans-serif", 800);
  }
  ctx.restore();
}

function drawBomb(b) {
  const { x, y, r } = b;
  // fuse
  ctx.strokeStyle = "#8a6a3a"; ctx.lineWidth = Math.max(2, r * 0.1); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x + r * 0.35, y - r * 0.85); ctx.quadraticCurveTo(x + r * 0.7, y - r * 1.4, x + r * 0.35, y - r * 1.6); ctx.stroke();
  // fuse spark
  const fx = x + r * 0.35, fy = y - r * 1.6, f = 0.7 + Math.random() * 0.6;
  ctx.save(); ctx.shadowColor = "#ffb02e"; ctx.shadowBlur = 18;
  drawStar(fx, fy, r * 0.32 * f, Math.random() < 0.5 ? "#ffdd55" : "#ff8a1f");
  ctx.restore();
  // cap
  ctx.fillStyle = "#3a3a44"; ctx.fillRect(x + r * 0.1, y - r * 1.0, r * 0.5, r * 0.3);
  // body
  ctx.save(); ctx.shadowColor = "#ff2a2a"; ctx.shadowBlur = 10 + 8 * Math.sin(T * 10);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "#55556a"); g.addColorStop(1, "#111118");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.restore();
  // crossbones
  ctx.fillStyle = "#f4f0ff";
  for (const a of [0.7, -0.7]) {
    ctx.save(); ctx.translate(x, y + r * 0.22); ctx.rotate(a);
    ctx.beginPath(); ctx.roundRect(-r * 0.62, -r * 0.08, r * 1.24, r * 0.16, r * 0.08); ctx.fill();
    for (const e of [-1, 1]) { ctx.beginPath(); ctx.arc(e * r * 0.62, -r * 0.08, r * 0.1, 0, 7); ctx.arc(e * r * 0.62, r * 0.08, r * 0.1, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  // skull
  ctx.beginPath(); ctx.arc(x, y - r * 0.12, r * 0.38, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.roundRect(x - r * 0.22, y + r * 0.1, r * 0.44, r * 0.22, r * 0.05); ctx.fill();
  ctx.fillStyle = "#111118";
  ctx.beginPath(); ctx.arc(x - r * 0.15, y - r * 0.14, r * 0.1, 0, 7); ctx.arc(x + r * 0.15, y - r * 0.14, r * 0.1, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, y + r * 0.0); ctx.lineTo(x - r * 0.05, y + r * 0.08); ctx.lineTo(x + r * 0.05, y + r * 0.08); ctx.fill();
  ctx.fillRect(x - r * 0.08, y + r * 0.14, r * 0.03, r * 0.16); ctx.fillRect(x + r * 0.05, y + r * 0.14, r * 0.03, r * 0.16);
  // shine
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.ellipse(x - r * 0.5, y - r * 0.5, r * 0.14, r * 0.24, -0.6, 0, 7); ctx.fill();
}

function drawExplosionOverlay() {
  // darkened, smoky screen while knocked down
  const down = state === "down" || state === "lost" ? Math.min(1, fallT) : state === "rising" ? fallT : 0;
  if (down > 0) { ctx.fillStyle = `rgba(30,12,8,${0.4 * down})`; ctx.fillRect(0, 0, W, H); }
  // glass cracks
  if (crackAlpha > 0 && cracks.length) {
    ctx.save(); ctx.globalAlpha = crackAlpha; ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const [color, width] of [["rgba(0,0,0,0.55)", 5], ["rgba(255,255,255,0.85)", 1.8]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      for (const line of cracks) { ctx.beginPath(); line.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
    }
    ctx.restore();
  }
  // flash
  if (flash > 0) {
    ctx.fillStyle = flash > 0.6 ? `rgba(255,255,255,${flash})` : `rgba(255,140,40,${flash})`;
    ctx.fillRect(0, 0, W, H);
  }
  // BOOM!
  if (boomT >= 0) {
    const s = Math.min(1, boomT / 0.25), a = boomT > 1.1 ? Math.max(0, 1 - (boomT - 1.1) / 0.5) : 1;
    ctx.save(); ctx.globalAlpha = a; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.translate(W / 2, H * 0.3); ctx.rotate(-0.08); ctx.scale(0.4 + s * 0.8, 0.4 + s * 0.8);
    outlined("BOOM!", 0, 0, Math.max(60, H * 0.16), "#ff8a1f");
    ctx.restore();
  }
  // knocked out for good
  if (state === "down" && finalBlast && fallT >= 1) {
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    outlined("Knocked out!", W / 2, H * 0.18, Math.max(28, H * 0.07), "#ff4f6b");
    ctx.restore();
  }
  // get-up drums and meter
  if (state === "down" && fallT >= 1 && !finalBlast) {
    for (let i = 0; i < 2; i++) drawDrum(i);
    // show where your hands are
    if (figure && pose) for (const i of [15, 16]) {
      const h = figure[i]; if (!h) continue;
      ctx.save(); ctx.shadowColor = "#ffdd55"; ctx.shadowBlur = 18;
      ctx.fillStyle = "#ffdd55"; ctx.strokeStyle = "#140a28"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(9, H * 0.018), 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const size = Math.max(20, H * 0.042);
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const bob = Math.sin(T * 8) * 4;
    outlined(keyboardMode || !pose ? "Tap Space fast to bang the drums!" : "Bang the drums fast to get up!", W / 2, H * 0.16 + bob, size, "#fff4e0");
    const mw = Math.min(W * 0.5, 520), mh = Math.max(22, H * 0.035), mx = W / 2 - mw / 2, my = H * 0.16 + size * 1.1;
    ctx.fillStyle = "rgba(20,10,40,0.8)"; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, mh / 2); ctx.fill();
    const g = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    g.addColorStop(0, "#ff4f6b"); g.addColorStop(0.5, "#ffcc33"); g.addColorStop(1, "#5ad17a");
    ctx.save(); ctx.shadowColor = "#ffdd55"; ctx.shadowBlur = 20 * recoverBump;
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(mx + 4, my + 4, Math.max(0, (mw - 8) * recover), mh - 8, (mh - 8) / 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#fff4e0"; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, mh / 2); ctx.stroke();
    ctx.restore();
  }
}

function drawDrum(i) {
  const g = drumGeom(i), d = drumKit[i];
  const squash = d.bounce * g.ry * 0.6;
  const x = g.x, y = g.y + squash, rx = g.rx, ry = g.ry, bh = g.body;
  const shell = i === 0 ? "#ff4f8b" : "#4fa3ff", dark = i === 0 ? "#a82a5a" : "#2a5aa8";
  ctx.save();
  ctx.shadowColor = shell; ctx.shadowBlur = 12 + d.bounce * 30 + Math.sin(T * 6) * 6;
  // legs
  ctx.strokeStyle = "#c9c3d6"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x - rx * 0.7, y + bh); ctx.lineTo(x - rx, feetY() - H * 0.12);
  ctx.moveTo(x + rx * 0.7, y + bh); ctx.lineTo(x + rx, feetY() - H * 0.12); ctx.stroke();
  // shell
  ctx.fillStyle = shell;
  ctx.beginPath(); ctx.moveTo(x - rx, y); ctx.lineTo(x - rx, y + bh); ctx.ellipse(x, y + bh, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(x + rx, y); ctx.closePath(); ctx.fill();
  ctx.restore();
  // zigzag lacing
  ctx.strokeStyle = "#fff4e0"; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let k = 0; k <= 8; k++) { const px = x - rx + (k / 8) * rx * 2; const py = y + (k % 2 ? bh * 0.85 : ry * 0.6); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
  ctx.fillStyle = dark; ctx.fillRect(x - rx, y + bh * 0.85, rx * 2, bh * 0.15);
  // head
  ctx.fillStyle = d.bounce > 0.3 ? "#ffffff" : "#f4efe2"; ctx.strokeStyle = "#140a28"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); ctx.stroke();
  // hit ring
  if (d.bounce > 0) {
    ctx.strokeStyle = `rgba(255,221,85,${d.bounce})`; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(x, y, rx * (1 + (1 - d.bounce) * 0.5), ry * (1 + (1 - d.bounce) * 0.5), 0, 0, 7); ctx.stroke();
  }
}

function render() {
  const s = shake * shake * Math.min(40, W * 0.03);
  ctx.save();
  if (s > 0) { ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s); ctx.rotate((Math.random() - 0.5) * shake * 0.02); }
  drawSky();
  for (const b of balloons) if (!b.popped) b.bomb ? drawBomb(b) : drawBalloon(b);
  drawFloor();
  drawFigure();
  drawSparks();
  drawExplosionOverlay();
  ctx.restore();
  drawHUD();
}

let last = performance.now();
function loop(n) {
  const dt = Math.min(0.05, (n - last) / 1000); last = n;
  if (cameraOn) detectPose();
  update(dt); render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// =====================================================================
// CONTROLS
// =====================================================================
document.getElementById("btnCam").onclick = startCamera;
document.getElementById("btnKeys").onclick = () => { keyboardMode = true; startPlaying(); };
window.addEventListener("keydown", (e) => {
  keys[e.key] = true;
  if ((e.key === " " || e.key === "ArrowUp" || e.key === "w") && (state === "playing" || state === "down")) {
    e.preventDefault(); if (e.repeat) return;
    if (state === "down") { hitDrum(nextKeyDrum); nextKeyDrum = 1 - nextKeyDrum; } else onJumpGesture();
  }
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });
// Testing shortcut: Shift+B sends a bomb right away
window.addEventListener("keydown", (e) => {
  if (e.key === "B" && state === "playing") { const n = balloons.length; spawnBalloon(); if (balloons[n]) balloons[n].bomb = true; }
});
canvas.addEventListener("pointerdown", (e) => {
  if (state === "down") {
    for (let i = 0; i < 2; i++) { const g = drumGeom(i); if (Math.abs(e.clientX - g.x) < g.rx * 1.3 && e.clientY > g.y - g.ry * 3 && e.clientY < g.y + g.body) hitDrum(i); }
    return;
  }
  if (state !== "playing") return;
  keys.mouseDown = true; setTimeout(() => keys.mouseDown = false, 200);
  for (const b of balloons) if (!b.popped && Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r * 1.3) { if (b.bomb) explode(b); else popBalloon(b); break; }
});
})();
