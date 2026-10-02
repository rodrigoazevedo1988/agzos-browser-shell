// Gera os sons da interface (3.1.1) em src/assets/sounds/: um tick de navegação (hover) e
// três ticks de teclado. Síntese própria e determinística (sem amostras de terceiros), sob
// CC0 1.0: ver src/assets/sounds/LICENSE.md. Rodar: node scripts/make-ui-sounds.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RATE = 44100;
const out = fileURLToPath(new URL("../src/assets/sounds/", import.meta.url));

// Ruído reprodutível (mulberry32): o mesmo arquivo a cada geração.
function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

// Passa-banda simples (biquad RBJ) para dar cor ao ruído.
function bandpass(freq, q) {
  const w = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}

function render(seconds, sample) {
  const length = Math.round(seconds * RATE);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = sample(i / RATE, i);
  // Normaliza o pico em -3 dB e suaviza o fim (sem estalo).
  const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const fade = Math.round(0.004 * RATE);
  for (let i = 0; i < length; i++) {
    const tail = i > length - fade ? (length - i) / fade : 1;
    data[i] = (data[i] / peak) * 0.707 * tail;
  }
  return data;
}

function wav(data) {
  const buffer = Buffer.alloc(44 + data.length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + data.length * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(data.length * 2, 40);
  data.forEach((value, index) => buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2));
  return buffer;
}

const env = (t, attack, decay) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay));

const sounds = {
  // Hover (estilo Opera GX): "tic" curto e agudo, com um corpo de vidro bem leve.
  "nav-tick": (() => {
    const rand = noise(7);
    const band = bandpass(5200, 3);
    return render(0.045, (t) => {
      const click = band(rand()) * env(t, 0.0008, 0.004);
      const tone =
        Math.sin(2 * Math.PI * 2400 * t) * 0.35 * env(t, 0.001, 0.012) +
        Math.sin(2 * Math.PI * 3600 * t) * 0.15 * env(t, 0.001, 0.008);
      return click * 1.4 + tone;
    });
  })(),
  // Teclado mecânico: estalo da haste e a batida curta no fundo.
  "key-mecanico": (() => {
    const rand = noise(11);
    const band = bandpass(3800, 1.6);
    const body = bandpass(900, 2);
    return render(0.06, (t) => {
      const snap = band(rand()) * env(t, 0.0005, 0.006);
      const thump = body(rand()) * env(t, 0.002, 0.012) * 0.6;
      return snap + thump + Math.sin(2 * Math.PI * 190 * t) * 0.12 * env(t, 0.002, 0.01);
    });
  })(),
  // Teclado suave (membrana): toque abafado e curto.
  "key-suave": (() => {
    const rand = noise(23);
    const band = bandpass(1700, 1.1);
    return render(0.05, (t) => band(rand()) * env(t, 0.0015, 0.009));
  })(),
  // Máquina de escrever: batida seca com um "ting" metálico.
  "key-maquina": (() => {
    const rand = noise(31);
    const band = bandpass(2600, 2.5);
    return render(0.09, (t) => {
      const hit = band(rand()) * env(t, 0.0004, 0.005);
      const ring =
        (Math.sin(2 * Math.PI * 1870 * t) + 0.6 * Math.sin(2 * Math.PI * 2930 * t)) *
        0.18 *
        env(t, 0.001, 0.025);
      return hit + ring;
    });
  })(),
};

for (const [name, data] of Object.entries(sounds)) {
  writeFileSync(`${out}${name}.wav`, wav(data));
  console.log(`${name}.wav (${data.length} amostras)`);
}
