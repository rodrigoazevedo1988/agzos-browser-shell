import { describe, expect, it } from "vitest";

import { displayTitle, parseTags, sniffImage } from "./tags";

// Fixtures geradas aqui mesmo: nada de arquivo de música no repositório.
const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const syncsafe = (n: number) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const bytes = (list: number[]) => Uint8Array.from(list);

const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];

function id3Frame(id: string, body: number[], version: 3 | 4 = 3): number[] {
  const size = version === 4 ? syncsafe(body.length) : be32(body.length);
  return [...ascii(id), ...size, 0, 0, ...body];
}

function id3Tag(frames: number[][], version: 3 | 4 = 3): number[] {
  const body = frames.flat();
  return [...ascii("ID3"), version, 0, 0, ...syncsafe(body.length), ...body];
}

const textBody = (text: string, encoding = 3) => [encoding, ...utf8(text)];

/** Caixa MP4: tamanho, tipo e o conteúdo. */
const box = (type: string, ...parts: number[][]) => {
  const payload = parts.flat();
  return [...be32(payload.length + 8), ...ascii(type), ...payload];
};

/** Átomo do ilst: "data" com tipo 1 (UTF-8) ou o tipo da imagem. */
const ilstText = (name: string, text: string) =>
  box(name, box("data", [0, 0, 0, 1, 0, 0, 0, 0], utf8(text)));

describe("parseTags (ID3v2)", () => {
  it("lê título, artista, álbum, faixa e capa de um ID3v2.3", () => {
    const tag = id3Tag([
      id3Frame("TIT2", textBody("Aquarela")),
      id3Frame("TPE1", textBody("Banda X")),
      id3Frame("TALB", textBody("Disco Y")),
      id3Frame("TRCK", textBody("4/12")),
      id3Frame("APIC", [0, ...ascii("image/jpeg"), 0, 3, 0, ...JPEG]),
    ]);
    const tags = parseTags(bytes(tag));
    expect(tags.title).toBe("Aquarela");
    expect(tags.artist).toBe("Banda X");
    expect(tags.album).toBe("Disco Y");
    expect(tags.trackNo).toBe(4);
    expect(tags.cover?.mime).toBe("image/jpeg");
    expect(tags.cover?.data.length).toBe(JPEG.length);
  });

  it("lê ID3v2.4 com tamanhos syncsafe e texto UTF-8", () => {
    const tag = id3Tag(
      [id3Frame("TIT2", textBody("Coração ♪"), 4), id3Frame("TLEN", textBody("123000"), 4)],
      4,
    );
    const tags = parseTags(bytes(tag));
    expect(tags.title).toBe("Coração ♪");
    expect(tags.durationSec).toBe(123);
  });

  it("decodifica UTF-16 com BOM", () => {
    const le = [
      0xff,
      0xfe,
      ...Array.from("Olá", (ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8]).flat(),
    ];
    const tags = parseTags(bytes(id3Tag([id3Frame("TIT2", [1, ...le])])));
    expect(tags.title).toBe("Olá");
  });

  it("descarta capa que não é imagem conhecida", () => {
    const tags = parseTags(
      bytes(id3Tag([id3Frame("APIC", [0, ...ascii("text/plain"), 0, 3, 0, 1, 2, 3])])),
    );
    expect(tags.cover).toBeUndefined();
  });

  it("prefere a capa frontal (tipo 3) quando há mais de uma", () => {
    const back = [0, ...ascii("image/png"), 0, 4, 0, ...PNG];
    const front = [0, ...ascii("image/jpeg"), 0, 3, 0, ...JPEG];
    const tags = parseTags(bytes(id3Tag([id3Frame("APIC", back), id3Frame("APIC", front)])));
    expect(tags.cover?.mime).toBe("image/jpeg");
  });

  it("aceita APIC com descrição em UTF-16", () => {
    const desc = [0xff, 0xfe, 0x41, 0x00, 0x00, 0x00];
    const tags = parseTags(
      bytes(id3Tag([id3Frame("APIC", [1, ...ascii("image/png"), 0, 3, ...desc, ...PNG])])),
    );
    expect(tags.cover?.mime).toBe("image/png");
  });
});

describe("parseTags (MP4/M4A)", () => {
  const mvhd = (timescale: number, duration: number) =>
    box("mvhd", [0, 0, 0, 0], be32(0), be32(0), be32(timescale), be32(duration));

  it("lê duração do mvhd, título, artista, álbum e a capa do covr", () => {
    const ilst = box(
      "ilst",
      ilstText("©nam", "Sol"),
      ilstText("©ART", "Artista"),
      ilstText("©alb", "Álbum"),
      box("covr", box("data", [0, 0, 0, 14, 0, 0, 0, 0], PNG)),
    );
    const meta = box("meta", [0, 0, 0, 0], ilst);
    const moov = box("moov", mvhd(1000, 215000), box("udta", meta));
    const file = [...box("ftyp", ascii("M4A "), be32(0), ascii("M4A ")), ...moov];
    const tags = parseTags(bytes(file));
    expect(tags.durationSec).toBe(215);
    expect(tags.title).toBe("Sol");
    expect(tags.artist).toBe("Artista");
    expect(tags.album).toBe("Álbum");
    expect(tags.cover?.mime).toBe("image/png");
  });

  it("aceita mvhd versão 1 (duração de 64 bits)", () => {
    const v1 = box(
      "mvhd",
      [1, 0, 0, 0],
      be32(0),
      be32(0),
      be32(0),
      be32(0),
      be32(44100),
      be32(0),
      be32(44100 * 60),
    );
    const moov = box("moov", v1);
    const tags = parseTags(bytes([...box("ftyp", ascii("M4A ")), ...moov]));
    expect(tags.durationSec).toBeCloseTo(60, 5);
  });

  it("moov cortado (caixa maior que o Range) não lança e não inventa tags", () => {
    const full = [...box("ftyp", ascii("M4A ")), ...box("moov", mvhd(1000, 9000))];
    const cut = full.slice(0, full.length - 6);
    expect(() => parseTags(bytes(cut))).not.toThrow();
    expect(parseTags(bytes(cut))).toEqual({});
  });
});

describe("parseTags (FLAC)", () => {
  /** STREAMINFO de 44,1 kHz, 2 canais, 16 bits e 132300 amostras (3 s). */
  const streamInfo = [
    0x10,
    0x00,
    0x10,
    0x00,
    0,
    0,
    0,
    0,
    0,
    0, // tamanhos de bloco e de quadro
    0x0a,
    0xc4,
    0x42,
    0xf0,
    ...be32(132300), // taxa, canais, bits e total de amostras
    ...new Array(16).fill(0), // MD5
  ];
  const block = (type: number, last: boolean, body: number[]) => [
    (last ? 0x80 : 0) | type,
    (body.length >> 16) & 255,
    (body.length >> 8) & 255,
    body.length & 255,
    ...body,
  ];
  const vorbis = (comments: string[]) => {
    const vendor = "agzos";
    const body = [
      ...le32(vendor.length),
      ...ascii(vendor),
      ...le32(comments.length),
      ...comments.flatMap((comment) => [...le32(utf8(comment).length), ...utf8(comment)]),
    ];
    return body;
  };

  it("lê duração, tags Vorbis e a capa frontal do bloco PICTURE", () => {
    const picture = [
      ...be32(3),
      ...be32("image/jpeg".length),
      ...ascii("image/jpeg"),
      ...be32(0), // descrição vazia
      ...be32(300),
      ...be32(300),
      ...be32(24),
      ...be32(0),
      ...be32(JPEG.length),
      ...JPEG,
    ];
    const file = [
      ...ascii("fLaC"),
      ...block(0, false, streamInfo),
      ...block(4, false, vorbis(["TITLE=Trilha", "ARTIST=Dupla", "ALBUM=Vol. 1", "TRACKNUMBER=2"])),
      ...block(6, true, picture),
    ];
    const tags = parseTags(bytes(file));
    expect(tags.durationSec).toBeCloseTo(3, 5);
    expect(tags.title).toBe("Trilha");
    expect(tags.artist).toBe("Dupla");
    expect(tags.album).toBe("Vol. 1");
    expect(tags.trackNo).toBe(2);
    expect(tags.cover?.mime).toBe("image/jpeg");
  });

  it("bloco PICTURE cortado não vira capa", () => {
    const picture = [
      ...be32(3),
      ...be32(9),
      ...ascii("image/png"),
      ...be32(0),
      ...be32(1),
      ...be32(1),
      ...be32(8),
      ...be32(0),
      ...be32(999),
    ];
    const file = [...ascii("fLaC"), ...block(6, true, picture)];
    expect(parseTags(bytes(file)).cover).toBeUndefined();
  });
});

describe("sniffImage e displayTitle", () => {
  it("reconhece JPEG, PNG, GIF e WebP pelos bytes", () => {
    expect(sniffImage(bytes(JPEG))?.mime).toBe("image/jpeg");
    expect(sniffImage(bytes(PNG))?.mime).toBe("image/png");
    expect(sniffImage(bytes(ascii("GIF89a")))?.mime).toBe("image/gif");
    expect(sniffImage(bytes([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]))?.mime).toBe(
      "image/webp",
    );
    expect(sniffImage(bytes(ascii("nope")))).toBeUndefined();
  });

  it("entrada desconhecida devolve tags vazias, sem erro", () => {
    expect(parseTags(bytes([1, 2, 3]))).toEqual({});
    expect(parseTags(new Uint8Array(0))).toEqual({});
  });

  it("título de exibição usa o tag e cai no nome do arquivo", () => {
    expect(displayTitle("faixa-01.mp3", { title: "Tema" })).toBe("Tema");
    expect(displayTitle("faixa-01.mp3")).toBe("faixa-01");
  });
});
