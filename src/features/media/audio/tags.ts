// Leitura de tags e capa embutida (ID3v2, MP4/M4A e FLAC) a partir do começo do arquivo.
// Função pura: recebe os bytes (um Range de ~512 KB) e nunca lança; o que não der para
// ler fica de fora do resultado. A capa é validada pelos bytes (JPEG/PNG/GIF/WebP).

export type CoverImage = {
  mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: Uint8Array;
};

export type TrackTags = {
  title?: string;
  artist?: string;
  album?: string;
  /** Duração em segundos (quando o próprio arquivo informa). */
  durationSec?: number;
  trackNo?: number;
  cover?: CoverImage;
};

/** Tamanho do Range pedido ao backend: tags e capas costumam caber aqui. */
export const TAG_READ_BYTES = 512 * 1024;

const decoder = (label: string) => {
  try {
    return new TextDecoder(label);
  } catch {
    return null;
  }
};

const utf8 = decoder("utf-8");
const latin1 = decoder("windows-1252");

function clean(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  // Remove o que o tag deixa para trás: nulos, BOM e espaços das pontas.
  const value = text
    .replace(/\0/g, "")
    .replace(/^\uFEFF/, "")
    .trim();
  return value ? value : undefined;
}

/** Decodifica texto de frame ID3 (encoding 0..3). */
function decodeText(bytes: Uint8Array, encoding: number): string {
  if (encoding === 1 || encoding === 2) {
    let little = encoding === 1;
    let start = 0;
    if (encoding === 1 && bytes.length >= 2) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        little = true;
        start = 2;
      } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
        little = false;
        start = 2;
      }
    }
    let text = "";
    for (let i = start; i + 1 < bytes.length; i += 2) {
      const code = little ? bytes[i]! | (bytes[i + 1]! << 8) : (bytes[i]! << 8) | bytes[i + 1]!;
      text += String.fromCharCode(code);
    }
    return text;
  }
  if (encoding === 3) return utf8?.decode(bytes) ?? "";
  return latin1?.decode(bytes) ?? "";
}

/** Acha o terminador nulo do encoding (2 bytes em UTF-16) a partir de `from`. */
function terminatorAt(bytes: Uint8Array, from: number, encoding: number): number {
  const wide = encoding === 1 || encoding === 2;
  for (let i = from; wide ? i + 1 < bytes.length : i < bytes.length; i += wide ? 2 : 1) {
    if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return i;
  }
  return -1;
}

/** Sniff de imagem pelos bytes; o MIME declarado no tag não é confiável. */
export function sniffImage(data: Uint8Array): CoverImage | undefined {
  if (data.length < 4) return undefined;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mime: "image/jpeg", data };
  }
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { mime: "image/png", data };
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { mime: "image/gif", data };
  }
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return { mime: "image/webp", data };
  }
  return undefined;
}

const be32 = (b: Uint8Array, o: number) =>
  ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const le32 = (b: Uint8Array, o: number) =>
  ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0;
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

function syncsafe(b: Uint8Array, o: number): number {
  return (
    ((b[o]! & 0x7f) << 21) |
    ((b[o + 1]! & 0x7f) << 14) |
    ((b[o + 2]! & 0x7f) << 7) |
    (b[o + 3]! & 0x7f)
  );
}

/** Desfaz a unsynchronization (0xFF 0x00 → 0xFF). */
function unsynchronise(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    out.push(b[i]!);
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
}

/** Frames ID3v2 com nomes de 3 letras (v2.2): TT2, TP1, TAL, PIC, TLE. */
const ID3_V22: Record<string, string> = {
  TT2: "TIT2",
  TP1: "TPE1",
  TAL: "TALB",
  TLE: "TLEN",
  TRK: "TRCK",
  PIC: "APIC",
};

export function parseId3(bytes: Uint8Array): TrackTags {
  const out: TrackTags = {};
  if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") return out;
  const major = bytes[3]!;
  const flags = bytes[5]!;
  if (major < 2 || major > 4) return out;
  const size = syncsafe(bytes, 6);
  let body = bytes.subarray(10, Math.min(bytes.length, 10 + size));
  if (major === 3 && flags & 0x80) body = unsynchronise(body);
  if (major === 2 && flags & 0x80) body = unsynchronise(body);
  // Cabeçalho estendido: pulado (não guarda nada que a gente use).
  let pos = 0;
  if (major !== 2 && flags & 0x40 && body.length >= 4) {
    const extSize = major === 4 ? syncsafe(body, 0) : be32(body, 0) + 4;
    pos = Math.min(body.length, extSize);
  }

  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;
  while (pos + headerLength <= body.length) {
    if (body[pos] === 0) break; // padding
    const id = ascii(body, pos, idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const frameSize =
      major === 2
        ? (body[pos + 3]! << 16) | (body[pos + 4]! << 8) | body[pos + 5]!
        : major === 4
          ? syncsafe(body, pos + 4)
          : be32(body, pos + 4);
    const dataStart = pos + headerLength;
    const dataEnd = Math.min(body.length, dataStart + frameSize);
    const data = body.subarray(dataStart, dataEnd);
    if (major === 2 && id === "PIC") readId3Picture22(data, out);
    else readId3Frame(major === 2 ? (ID3_V22[id] ?? id) : id, data, out);
    pos = dataEnd;
  }
  return out;
}

/** APIC (v2.3/v2.4): encoding, MIME, tipo da imagem, descrição e os bytes. */
function readPictureBody(
  data: Uint8Array,
  encoding: number,
  descStart: number,
  pictureType: number | undefined,
  out: TrackTags,
) {
  const descEnd = terminatorAt(data, descStart, encoding);
  if (descEnd < 0) return;
  const wide = encoding === 1 || encoding === 2;
  const cover = sniffImage(data.subarray(descEnd + (wide ? 2 : 1)));
  if (cover && (!out.cover || pictureType === 3)) out.cover = cover;
}

/** PIC (v2.2): encoding, formato de 3 letras (JPG/PNG), tipo, descrição e os bytes. */
function readId3Picture22(data: Uint8Array, out: TrackTags) {
  if (data.length < 5) return;
  readPictureBody(data, data[0]!, 5, data[4], out);
}

function readId3Frame(id: string, data: Uint8Array, out: TrackTags) {
  if (!data.length) return;
  if (id === "APIC") {
    const encoding = data[0]!;
    const mimeEnd = data.indexOf(0, 1);
    if (mimeEnd < 0) return;
    // Depois do terminador do MIME vem o tipo da imagem (1 byte) e então a descrição.
    const pictureType = data[mimeEnd + 1];
    readPictureBody(data, encoding, mimeEnd + 2, pictureType, out);
    return;
  }
  if (!id.startsWith("T")) return;
  const text = clean(decodeText(data.subarray(1), data[0]!));
  if (text === undefined) return;
  if (id === "TIT2") out.title = text;
  else if (id === "TPE1") out.artist = out.artist ?? text;
  else if (id === "TALB") out.album = text;
  else if (id === "TLEN") {
    const ms = Number(text);
    if (Number.isFinite(ms) && ms > 0) out.durationSec = ms / 1000;
  } else if (id === "TRCK") {
    const no = parseInt(text, 10);
    if (Number.isFinite(no) && no > 0) out.trackNo = no;
  }
}

type Box = { type: string; start: number; end: number; body: number };

/** Lista as caixas de um intervalo. Caixa cortada pelo fim do buffer é ignorada. */
function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const list: Box[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = be32(bytes, pos);
    const type = ascii(bytes, pos + 4, 4);
    let body = pos + 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      const high = be32(bytes, pos + 8);
      size = high * 0x100000000 + be32(bytes, pos + 12);
      body = pos + 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < body - pos || pos + size > end) break;
    list.push({ type, start: pos, end: pos + size, body });
    pos += size;
  }
  return list;
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | undefined {
  return boxes(bytes, start, end).find((box) => box.type === type);
}

/** Valor de um átomo do ilst (©nam, ©ART, ©alb, trkn, covr). */
function ilstValue(bytes: Uint8Array, item: Box): { flags: number; data: Uint8Array } | undefined {
  const dataBox = findBox(bytes, item.body, item.end, "data");
  if (!dataBox || dataBox.body + 8 > dataBox.end) return undefined;
  const flags = be32(bytes, dataBox.body) & 0xffffff;
  return { flags, data: bytes.subarray(dataBox.body + 8, dataBox.end) };
}

export function parseMp4(bytes: Uint8Array): TrackTags {
  const out: TrackTags = {};
  const moov = findBox(bytes, 0, bytes.length, "moov");
  if (!moov) return out;

  const mvhd = findBox(bytes, moov.body, moov.end, "mvhd");
  if (mvhd) {
    const version = bytes[mvhd.body];
    const p = mvhd.body + 4;
    if (version === 1 && p + 28 <= mvhd.end) {
      const timescale = be32(bytes, p + 16);
      const duration = be32(bytes, p + 20) * 0x100000000 + be32(bytes, p + 24);
      if (timescale > 0 && duration > 0) out.durationSec = duration / timescale;
    } else if (version === 0 && p + 16 <= mvhd.end) {
      const timescale = be32(bytes, p + 8);
      const duration = be32(bytes, p + 12);
      if (timescale > 0 && duration > 0) out.durationSec = duration / timescale;
    }
  }

  const udta = findBox(bytes, moov.body, moov.end, "udta");
  const meta = udta && findBox(bytes, udta.body, udta.end, "meta");
  // meta é "full box": 4 bytes de versão/flags antes dos filhos.
  const ilst = meta && findBox(bytes, meta.body + 4, meta.end, "ilst");
  if (!ilst) return out;

  for (const item of boxes(bytes, ilst.body, ilst.end)) {
    if (item.type === "covr") {
      const value = ilstValue(bytes, item);
      const cover = value && sniffImage(value.data);
      if (cover) out.cover = cover;
      continue;
    }
    if (item.type === "trkn") {
      const value = ilstValue(bytes, item);
      if (value && value.data.length >= 4) {
        const no = (value.data[2]! << 8) | value.data[3]!;
        if (no > 0) out.trackNo = no;
      }
      continue;
    }
    const value = ilstValue(bytes, item);
    if (!value || value.flags !== 1) continue; // 1 = UTF-8
    const text = clean(utf8?.decode(value.data));
    if (text === undefined) continue;
    if (item.type === "©nam") out.title = text;
    else if (item.type === "©ART") out.artist = text;
    else if (item.type === "©alb") out.album = text;
  }
  return out;
}

export function parseFlac(bytes: Uint8Array): TrackTags {
  const out: TrackTags = {};
  if (bytes.length < 4 || ascii(bytes, 0, 4) !== "fLaC") return out;
  let pos = 4;
  while (pos + 4 <= bytes.length) {
    const last = (bytes[pos]! & 0x80) !== 0;
    const type = bytes[pos]! & 0x7f;
    const length = (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!;
    const start = pos + 4;
    const end = start + length;
    if (end > bytes.length) break; // bloco cortado: o que já leu fica
    if (type === 0 && length >= 18) {
      // STREAMINFO: 20 bits de taxa e 36 bits de total de amostras (depois de 10 bytes).
      const rate =
        (bytes[start + 10]! << 12) | (bytes[start + 11]! << 4) | (bytes[start + 12]! >> 4);
      const high = bytes[start + 13]! & 0x0f;
      const total = high * 0x100000000 + be32(bytes, start + 14);
      if (rate > 0 && total > 0) out.durationSec = total / rate;
    } else if (type === 4) {
      readVorbisComments(bytes, start, end, out);
    } else if (type === 6) {
      // Capa frontal (tipo 3) vence qualquer outra imagem do arquivo.
      const picture = readFlacPicture(bytes, start, end);
      if (picture && (!out.cover || picture.pictureType === 3)) out.cover = picture.cover;
    }
    pos = end;
    if (last) break;
  }
  return out;
}

function readVorbisComments(bytes: Uint8Array, start: number, end: number, out: TrackTags) {
  let p = start;
  if (p + 4 > end) return;
  const vendor = le32(bytes, p);
  p += 4 + vendor;
  if (p + 4 > end) return;
  const count = le32(bytes, p);
  p += 4;
  for (let i = 0; i < count && p + 4 <= end; i++) {
    const length = le32(bytes, p);
    p += 4;
    if (p + length > end) break;
    const entry = utf8?.decode(bytes.subarray(p, p + length)) ?? "";
    p += length;
    const eq = entry.indexOf("=");
    if (eq < 0) continue;
    const key = entry.slice(0, eq).toUpperCase();
    const value = clean(entry.slice(eq + 1));
    if (value === undefined) continue;
    if (key === "TITLE") out.title = value;
    else if (key === "ARTIST") out.artist = out.artist ?? value;
    else if (key === "ALBUM") out.album = value;
    else if (key === "TRACKNUMBER") {
      const no = parseInt(value, 10);
      if (no > 0) out.trackNo = no;
    }
  }
}

/** Bloco PICTURE: tipo, MIME, descrição, dimensões e os bytes da imagem. */
function readFlacPicture(
  bytes: Uint8Array,
  start: number,
  end: number,
): { pictureType: number; cover: CoverImage } | undefined {
  let p = start;
  if (p + 8 > end) return undefined;
  const pictureType = be32(bytes, p);
  const mimeLength = be32(bytes, p + 4);
  p += 8 + mimeLength;
  if (p + 4 > end) return undefined;
  const descLength = be32(bytes, p);
  // Descrição, depois largura, altura, profundidade e cores (4 × 4 bytes).
  p += 4 + descLength + 16;
  if (p + 4 > end) return undefined;
  const dataLength = be32(bytes, p);
  p += 4;
  if (p + dataLength > end) return undefined;
  const cover = sniffImage(bytes.subarray(p, p + dataLength));
  return cover ? { pictureType, cover } : undefined;
}

/** Escolhe o parser pelos bytes (ID3, ftyp/moov, fLaC); nunca pela extensão. */
export function parseTags(bytes: Uint8Array): TrackTags {
  try {
    if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") return parseId3(bytes);
    if (bytes.length >= 4 && ascii(bytes, 0, 4) === "fLaC") return parseFlac(bytes);
    if (bytes.length >= 8) {
      const type = ascii(bytes, 4, 4);
      if (type === "ftyp" || type === "moov" || type === "free" || type === "mdat") {
        return parseMp4(bytes);
      }
    }
  } catch {
    // Arquivo truncado ou malformado: sem tags, sem erro para a tela.
  }
  return {};
}

/** Título de exibição: o do tag, senão o nome do arquivo sem extensão. */
export function displayTitle(name: string, tags?: TrackTags): string {
  return tags?.title ?? name.replace(/\.[^.]+$/, "");
}
