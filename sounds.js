let ctx = null;
let _enabled = localStorage.getItem("pins-sound") === "1";

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, dur, vol = 0.08, type = "sine") {
  if (!_enabled) return;
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g);
  g.connect(a.destination);
  o.start(a.currentTime);
  o.stop(a.currentTime + dur);
}

export function isSoundEnabled() { return _enabled; }

export function toggleSound() {
  _enabled = !_enabled;
  localStorage.setItem("pins-sound", _enabled ? "1" : "0");
  return _enabled;
}

export function playPinDrop() { tone(800, 0.06, 0.07); }
export function playStroke() { tone(440, 0.04, 0.05); }
export function playUndo() { tone(300, 0.03, 0.04, "triangle"); }
export function playRedo() { tone(500, 0.03, 0.04, "triangle"); }
export function playSave() { tone(600, 0.08, 0.06); setTimeout(() => tone(900, 0.08, 0.06), 60); }
export function playPeerJoin() { tone(400, 0.08, 0.05); setTimeout(() => tone(600, 0.1, 0.06), 80); }
