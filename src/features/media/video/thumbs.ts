// Miniaturas de vídeo no renderer: um <video> oculto vai a 10% do arquivo e o quadro é
// desenhado num canvas. Cache LRU em memória (não vai para o disco) e no máximo duas
// decodificações ao mesmo tempo.

const CACHE_LIMIT = 240;
const PARALLEL = 2;
const TIMEOUT_MS = 15000;
const WIDTH = 320;

const cache = new Map<string, string | null>();
const waiting: Array<() => void> = [];
let running = 0;

function remember(key: string, value: string | null) {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function slot<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          running -= 1;
          waiting.shift()?.();
        });
    };
    if (running < PARALLEL) run();
    else waiting.push(run);
  });
}

/** Quadro a 10% do vídeo como data: JPEG, ou null se o arquivo não toca. */
export function thumbnailOf(url: string, key: string): Promise<string | null> {
  if (cache.has(key)) {
    const value = cache.get(key) ?? null;
    remember(key, value);
    return Promise.resolve(value);
  }
  return slot(() => capture(url)).then((value) => {
    remember(key, value);
    return value;
  });
}

function capture(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);
    video.addEventListener("error", () => finish(null));
    const draw = () => {
      try {
        const ratio = video.videoHeight / (video.videoWidth || 1);
        const canvas = document.createElement("canvas");
        canvas.width = WIDTH;
        canvas.height = Math.max(1, Math.round(WIDTH * (ratio || 9 / 16)));
        const context = canvas.getContext("2d");
        if (!context || !video.videoWidth) return finish(null);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        // Canvas contaminado ou sem decodificador: sem miniatura.
        finish(null);
      }
    };
    video.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      // Sem seek (vídeo curto): o primeiro quadro já serve.
      if (duration > 1) video.currentTime = duration * 0.1;
    });
    video.addEventListener("seeked", draw);
    video.addEventListener("loadeddata", () => {
      if (video.currentTime === 0 && video.readyState >= 2) draw();
    });
    video.src = url;
  });
}

/** Só para testes e para o botão de limpar: esvazia o cache. */
export function clearThumbnails() {
  cache.clear();
}
