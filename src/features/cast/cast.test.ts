import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Ponte de Chromecast (6.0): protobuf, mensagens, status, validação, mDNS e uma sessão
// completa contra um aparelho falso (socket local falando o protocolo Cast).
const require = createRequire(import.meta.url);
const dir = path.join(import.meta.dirname, "../../../electron");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const proto = require(path.join(dir, "cast-proto.cjs")) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cast = require(path.join(dir, "cast.cjs")) as any;

const media = {
  url: "https://cdn.example.com/filme.mp4",
  contentType: "video/mp4",
  title: "Filme",
};

describe("protobuf do CastMessage", () => {
  it("codifica nos bytes esperados (campos 1 a 6)", () => {
    const buf = proto.encodeCastMessage({
      source: "a",
      destination: "b",
      namespace: "n",
      payload: "{}",
    });
    expect([...buf]).toEqual([
      0x08, 0x00, 0x12, 1, 0x61, 0x1a, 1, 0x62, 0x22, 1, 0x6e, 0x28, 0x00, 0x32, 2, 0x7b, 0x7d,
    ]);
  });

  it("ida e volta com acentos e payload grande (varint de 2 bytes)", () => {
    const payload = JSON.stringify({ t: "ação ".repeat(100) });
    const decoded = proto.decodeCastMessage(
      proto.encodeCastMessage({
        source: "s",
        destination: "d",
        namespace: proto.NS.media,
        payload,
      }),
    );
    expect(decoded).toMatchObject({
      source: "s",
      destination: "d",
      namespace: proto.NS.media,
      payload,
    });
  });

  it("ignora campos desconhecidos e rejeita campo truncado", () => {
    const known = proto.encodeCastMessage({
      source: "s",
      destination: "d",
      namespace: "n",
      payload: "p",
    });
    const extra = Buffer.concat([known, Buffer.from([0x38, 0x05])]); // campo 7 varint: ignorado
    expect(proto.decodeCastMessage(extra).payload).toBe("p");
    expect(() => proto.decodeCastMessage(Buffer.from([0x12, 0x09, 0x61]))).toThrow();
  });
});

describe("enquadramento do socket", () => {
  const one = proto.frame(proto.encodeCastMessage(proto.buildPing()));

  it("remonta quadros partidos e colados", () => {
    const reader = new proto.FrameReader();
    const joined = Buffer.concat([one, one]);
    expect(reader.push(joined.subarray(0, 3))).toHaveLength(0);
    expect(reader.push(joined.subarray(3, one.length + 5))).toHaveLength(1);
    const rest = reader.push(joined.subarray(one.length + 5));
    expect(rest).toHaveLength(1);
    expect(rest[0].namespace).toBe(proto.NS.heartbeat);
  });

  it("recusa quadro maior que o limite", () => {
    const reader = new proto.FrameReader(100);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(101);
    expect(() => reader.push(head)).toThrow();
  });
});

describe("montagem de mensagens", () => {
  it("LOAD com legenda WebVTT, trilha ativa e posição inicial", () => {
    const { value } = proto.validateMedia({
      ...media,
      subtitle: "Ep. 1",
      imageUrl: "https://cdn.example.com/capa.jpg",
      duration: 5400,
      startTime: 30,
      tracks: [{ id: 1, url: "https://cdn.example.com/pt.vtt", lang: "pt-BR", label: "Português" }],
      activeTrackId: 1,
    });
    const { payload } = proto.buildLoad("web-5", 7, "sess", value);
    expect(payload).toMatchObject({
      type: "LOAD",
      requestId: 7,
      sessionId: "sess",
      autoplay: true,
      currentTime: 30,
      activeTrackIds: [1],
      media: {
        contentId: media.url,
        contentType: "video/mp4",
        streamType: "BUFFERED",
        duration: 5400,
        metadata: {
          metadataType: 0,
          title: "Filme",
          subtitle: "Ep. 1",
          images: [{ url: "https://cdn.example.com/capa.jpg" }],
        },
        tracks: [
          {
            trackId: 1,
            type: "TEXT",
            trackContentId: "https://cdn.example.com/pt.vtt",
            trackContentType: "text/vtt",
            subtype: "SUBTITLES",
            language: "pt-BR",
            name: "Português",
          },
        ],
      },
    });
  });

  it("QUEUE_LOAD leva todos os itens", () => {
    const a = proto.validateMedia(media).value;
    const b = proto.validateMedia({
      ...media,
      url: "https://cdn.example.com/2.mp3",
      contentType: "audio/mpeg",
      title: "Faixa 2",
    }).value;
    const { payload } = proto.buildQueueLoad("web-5", 3, "s", [a, b]);
    expect(payload.type).toBe("QUEUE_LOAD");
    expect(payload.items).toHaveLength(2);
    expect(payload.items[1].media.contentType).toBe("audio/mpeg");
    expect(payload.startIndex).toBe(0);
  });

  it("controles usam o mediaSessionId e limitam o volume", () => {
    expect(proto.buildSeek("t", 1, 9, 42).payload).toMatchObject({
      type: "SEEK",
      mediaSessionId: 9,
      currentTime: 42,
    });
    expect(proto.buildQueueJump("t", 1, 9, -1).payload).toMatchObject({
      type: "QUEUE_UPDATE",
      jump: -1,
    });
    expect(proto.buildEditTracks("t", 1, 9, []).payload.activeTrackIds).toEqual([]);
    expect(proto.buildSetVolume(2, 7).payload.volume.level).toBe(1);
    expect(proto.buildLaunch(1).payload.appId).toBe("CC1AD845");
  });
});

describe("leitura de status", () => {
  it("MEDIA_STATUS tocando, terminou e erro", () => {
    const status = (extra: object) =>
      proto.parseMediaStatus({
        type: "MEDIA_STATUS",
        requestId: 0,
        status: [
          {
            mediaSessionId: 4,
            currentTime: 12.5,
            media: { duration: 100 },
            volume: { level: 0.4 },
            ...extra,
          },
        ],
      });
    expect(status({ playerState: "PLAYING" })).toMatchObject({
      state: "playing",
      currentTime: 12.5,
      duration: 100,
      volume: 0.4,
      mediaSessionId: 4,
    });
    expect(status({ playerState: "BUFFERING" }).state).toBe("buffering");
    expect(status({ playerState: "PAUSED" }).state).toBe("paused");
    expect(status({ playerState: "IDLE", idleReason: "FINISHED" }).state).toBe("ended");
    const failed = status({ playerState: "IDLE", idleReason: "ERROR" });
    expect(failed.state).toBe("error");
    expect(failed.error).toBeTruthy();
    expect(status({ playerState: "IDLE", idleReason: "CANCELLED" }).state).toBe("idle");
  });

  it("aceita texto JSON e rejeita lixo", () => {
    expect(proto.parseMediaStatus("não é json")).toBeNull();
    expect(proto.parseMediaStatus('{"type":"PONG"}')).toBeNull();
    expect(proto.parseMediaStatus('{"type":"MEDIA_STATUS","status":[]}')).toMatchObject({
      empty: true,
    });
  });

  it("RECEIVER_STATUS acha o Default Media Receiver e o volume", () => {
    const parsed = proto.parseReceiverStatus({
      type: "RECEIVER_STATUS",
      requestId: 1,
      status: {
        applications: [{ appId: "CC1AD845", transportId: "web-9", sessionId: "uuid" }],
        volume: { level: 0.7, muted: false },
      },
    });
    expect(parsed.app).toEqual({ appId: "CC1AD845", transportId: "web-9", sessionId: "uuid" });
    expect(parsed.volume).toBe(0.7);
    const other = proto.parseReceiverStatus({
      type: "RECEIVER_STATUS",
      status: { applications: [{ appId: "OUTRO", transportId: "x" }] },
    });
    expect(other.app).toBeNull();
    expect(other.otherApp).toBe(true);
  });

  it("reconhece erros de comando", () => {
    expect(proto.parseCommandError({ type: "LOAD_FAILED", requestId: 2 })).toMatchObject({
      type: "LOAD_FAILED",
    });
    expect(proto.parseCommandError({ type: "MEDIA_STATUS" })).toBeNull();
  });
});

describe("validação das entradas da página", () => {
  const ok = (value: unknown) => proto.validateMedia(value).ok;

  it("aceita só http e https nas URLs", () => {
    expect(ok(media)).toBe(true);
    expect(ok({ ...media, url: "http://192.168.0.5/a.mp4" })).toBe(true);
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:video/mp4;base64,AA",
      "ftp://x/y.mp4",
      "nada",
      "",
      5,
    ]) {
      expect(ok({ ...media, url })).toBe(false);
    }
    expect(ok({ ...media, imageUrl: "javascript:x" })).toBe(false);
    expect(ok({ ...media, url: `https://x.com/${"a".repeat(2100)}` })).toBe(false);
  });

  it("confere tipo, título, tempos e legendas", () => {
    expect(ok({ ...media, contentType: "text/html; x" })).toBe(false);
    expect(ok({ ...media, contentType: "application/x-mpegURL" })).toBe(true);
    expect(ok({ ...media, title: "" })).toBe(false);
    expect(ok({ ...media, duration: -1 })).toBe(false);
    expect(ok({ ...media, startTime: Number.NaN })).toBe(false);
    const track = { id: 1, url: "https://x.com/a.vtt", lang: "pt", label: "PT" };
    expect(ok({ ...media, tracks: [track, track] })).toBe(false);
    expect(ok({ ...media, tracks: [{ ...track, url: "file:///x" }] })).toBe(false);
    expect(ok({ ...media, tracks: [{ ...track, id: 0 }] })).toBe(false);
    expect(ok({ ...media, tracks: [track], activeTrackId: 2 })).toBe(false);
    expect(ok({ ...media, tracks: [track], activeTrackId: 1 })).toBe(true);
    expect(ok({ ...media, activeTrackId: 1 })).toBe(false);
  });

  it("corta textos longos em vez de repassar", () => {
    const { value } = proto.validateMedia({ ...media, title: "t".repeat(500) });
    expect(value.title).toHaveLength(200);
  });

  it("load: deviceId, fila e tamanhos", () => {
    expect(proto.validateLoad({ deviceId: "abc-123", media }).ok).toBe(true);
    expect(proto.validateLoad({ deviceId: "a b", media }).ok).toBe(false);
    expect(proto.validateLoad({ deviceId: "x".repeat(65), media }).ok).toBe(false);
    expect(proto.validateLoad({ deviceId: "a", media, queue: [] }).ok).toBe(false);
    expect(proto.validateLoad({ deviceId: "a", media, queue: Array(201).fill(media) }).ok).toBe(
      false,
    );
    expect(
      proto.validateLoad({ deviceId: "a", media, queue: [media, { ...media, url: "x" }] }).ok,
    ).toBe(false);
    expect(
      proto.validateLoad({ deviceId: "a", media, queue: [media, media] }).value.queue,
    ).toHaveLength(2);
    expect(proto.validateLoad(null).ok).toBe(false);
  });

  it("control: ação conhecida e valor no intervalo", () => {
    const c = (action: unknown, value?: unknown) =>
      proto.validateControl("sess1", { action, value }).ok;
    expect(c("play")).toBe(true);
    expect(c("seek", 10)).toBe(true);
    expect(c("seek", -1)).toBe(false);
    expect(c("seek")).toBe(false);
    expect(c("volume", 0.5)).toBe(true);
    expect(c("volume", 1.5)).toBe(false);
    expect(c("track", null)).toBe(true);
    expect(c("track", 2)).toBe(true);
    expect(c("track", "2")).toBe(false);
    expect(c("explodir")).toBe(false);
    expect(proto.validateControl("../x", { action: "play" }).ok).toBe(false);
  });

  it("só IPv4 de rede local", () => {
    for (const a of ["10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.20", "169.254.3.4"])
      expect(proto.isPrivateIPv4(a)).toBe(true);
    for (const a of [
      "8.8.8.8",
      "172.32.0.1",
      "127.0.0.1",
      "0.0.0.0",
      "192.169.0.1",
      "300.1.1.1",
      "::1",
      "abc",
      "",
    ])
      expect(proto.isPrivateIPv4(a)).toBe(false);
  });
});

describe("origens permitidas e limite", () => {
  it("padrão, só https e sem curinga", () => {
    expect(proto.cleanOrigins(undefined)).toEqual(["https://flix.rsolutionsbr.com"]);
    expect(
      proto.cleanOrigins([
        "http://a.com",
        "https://a.com/x",
        "https://*.a.com",
        "https://ok.com",
        "https://ok.com",
        3,
      ]),
    ).toEqual(["https://ok.com"]);
    expect(proto.cleanOrigins([])).toEqual([]);
  });

  it("confere a origem da página", () => {
    const list = ["https://flix.rsolutionsbr.com"];
    expect(proto.originAllowed("https://flix.rsolutionsbr.com/filme/1?x=2", list)).toBe(true);
    expect(proto.originAllowed("http://flix.rsolutionsbr.com/", list)).toBe(false);
    expect(proto.originAllowed("https://flix.rsolutionsbr.com.evil.com/", list)).toBe(false);
    expect(proto.originAllowed("https://evil.com/?https://flix.rsolutionsbr.com", list)).toBe(
      false,
    );
    expect(proto.originAllowed("https://flix.rsolutionsbr.com:8443/", list)).toBe(false);
    expect(proto.originAllowed("file:///x", list)).toBe(false);
    expect(proto.originAllowed("lixo", list)).toBe(false);
  });

  it("limitador por janela", () => {
    let t = 0;
    const limiter = proto.createRateLimiter({ max: 3, windowMs: 1000, now: () => t });
    expect([1, 2, 3, 4].map(() => limiter.take("a"))).toEqual([true, true, true, false]);
    expect(limiter.take("b")).toBe(true);
    t = 1500;
    expect(limiter.take("a")).toBe(true);
  });
});

// Monta uma resposta mDNS de Chromecast.
function mdnsResponse({
  instance = "Chromecast-abc",
  id = "0123456789abcdef",
  fn = "Sala",
  md = "Chromecast",
  port = 8009,
  host = "abc.local",
  ip = [192, 168, 0, 40] as number[],
  withA = true,
} = {}) {
  const name = (n: string) => proto.encodeName(n);
  const rr = (n: string, type: number, rdata: Buffer, ttl = 120) => {
    const h = Buffer.alloc(10);
    h.writeUInt16BE(type, 0);
    h.writeUInt16BE(1, 2);
    h.writeUInt32BE(ttl, 4);
    h.writeUInt16BE(rdata.length, 8);
    return Buffer.concat([name(n), h, rdata]);
  };
  const full = `${instance}._googlecast._tcp.local`;
  const txt = Buffer.concat(
    [`id=${id}`, `fn=${fn}`, `md=${md}`].map((e) =>
      Buffer.concat([Buffer.from([e.length]), Buffer.from(e)]),
    ),
  );
  const srvData = Buffer.concat([Buffer.from([0, 0, 0, 0, port >> 8, port & 255]), name(host)]);
  const records = [
    rr("_googlecast._tcp.local", 12, name(full)),
    rr(full, 16, txt),
    rr(full, 33, srvData),
    ...(withA ? [rr(host, 1, Buffer.from(ip))] : []),
  ];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(records.length, 6);
  return Buffer.concat([head, ...records]);
}

describe("mDNS", () => {
  it("monta a consulta PTR do serviço", () => {
    const q = proto.buildMdnsQuery();
    expect(q.readUInt16BE(4)).toBe(1);
    expect(q.subarray(12, 12 + 24).toString("latin1")).toContain("_googlecast");
  });

  it("lê a resposta e monta o aparelho (sem expor endereço na lista pública)", () => {
    const parsed = proto.parseDnsMessage(mdnsResponse());
    expect(parsed.response).toBe(true);
    const table = new proto.DeviceTable();
    table.ingest(parsed.records);
    expect(table.devices()).toEqual([
      {
        id: "0123456789abcdef",
        name: "Sala",
        model: "Chromecast",
        address: "192.168.0.40",
        port: 8009,
      },
    ]);
  });

  it("descarta aparelho com IP fora da rede local, e pacote malformado", () => {
    const table = new proto.DeviceTable();
    table.ingest(proto.parseDnsMessage(mdnsResponse({ ip: [8, 8, 8, 8] })).records);
    expect(table.devices()).toEqual([]);
    expect(() => proto.parseDnsMessage(mdnsResponse().subarray(0, 40))).toThrow();
    // Ponteiro de compressão em laço não trava.
    const loop = Buffer.concat([Buffer.alloc(12), Buffer.from([0xc0, 12, 0, 1, 0, 1])]);
    loop.writeUInt16BE(1, 4);
    expect(() => proto.parseDnsMessage(loop)).toThrow();
  });

  it("aparelhos que param de responder expiram", () => {
    const table = new proto.DeviceTable({ ttlMs: 1000 });
    table.ingest(proto.parseDnsMessage(mdnsResponse()).records, 0);
    expect(table.devices()).toHaveLength(1);
    table.prune(2000);
    expect(table.devices()).toHaveLength(0);
  });
});

// Aparelho falso: fala Cast v2 por TCP local (sem TLS) e guarda o que recebeu.
function fakeDevice() {
  const received: {
    namespace: string;
    destination: string; // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any;
  }[] = [];
  const sockets = new Set<net.Socket>();
  let appRunning = false;
  let playerState = "IDLE";
  let currentTime = 0;
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const reader = new proto.FrameReader();
    const reply = (message: object) => socket.write(proto.frame(proto.encodeCastMessage(message)));
    const status = (requestId: number) =>
      reply({
        source: "receiver-0",
        destination: proto.SENDER_ID,
        namespace: proto.NS.receiver,
        payload: {
          type: "RECEIVER_STATUS",
          requestId,
          status: {
            applications: appRunning
              ? [{ appId: "CC1AD845", transportId: "web-1", sessionId: "rs-1" }]
              : [],
            volume: { level: 0.5, muted: false },
          },
        },
      });
    const mediaStatus = (requestId: number, extra: object = {}) =>
      reply({
        source: "web-1",
        destination: proto.SENDER_ID,
        namespace: proto.NS.media,
        payload: {
          type: "MEDIA_STATUS",
          requestId,
          status: [
            {
              mediaSessionId: 11,
              playerState,
              currentTime,
              media: { duration: 100 },
              volume: { level: 0.5 },
              ...extra,
            },
          ],
        },
      });
    socket.on("data", (chunk) => {
      for (const message of reader.push(chunk)) {
        const payload = JSON.parse(message.payload);
        received.push({ namespace: message.namespace, destination: message.destination, payload });
        if (message.namespace === proto.NS.heartbeat) continue;
        if (message.namespace === proto.NS.receiver) {
          if (payload.type === "LAUNCH") appRunning = true;
          if (payload.type === "STOP") appRunning = false;
          if (payload.type === "GET_STATUS" || payload.type === "LAUNCH" || payload.type === "STOP")
            status(payload.requestId);
        } else if (message.namespace === proto.NS.media) {
          if (payload.type === "LOAD" || payload.type === "QUEUE_LOAD") {
            playerState = "PLAYING";
            currentTime = payload.currentTime ?? 0;
            mediaStatus(payload.requestId);
          } else if (payload.type === "PAUSE") {
            playerState = "PAUSED";
            mediaStatus(payload.requestId);
          } else if (payload.type === "PLAY") {
            playerState = "PLAYING";
            mediaStatus(payload.requestId);
          } else if (payload.type === "SEEK") {
            currentTime = payload.currentTime;
            mediaStatus(payload.requestId);
          } else if (payload.type === "GET_STATUS") mediaStatus(payload.requestId);
        }
      }
    });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
  });
  return {
    received,
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
      ),
    finish: (reason: string) => {
      playerState = "IDLE";
      return [...sockets].forEach((s) =>
        s.write(
          proto.frame(
            proto.encodeCastMessage({
              source: "web-1",
              destination: proto.SENDER_ID,
              namespace: proto.NS.media,
              payload: {
                type: "MEDIA_STATUS",
                requestId: 0,
                status: [
                  { mediaSessionId: 11, playerState: "IDLE", idleReason: reason, currentTime: 100 },
                ],
              },
            }),
          ),
        ),
      );
    },
    close: () => {
      sockets.forEach((s) => s.destroy());
      server.close();
    },
  };
}

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("sessão contra um aparelho falso", () => {
  async function setup() {
    const device = fakeDevice();
    const port = await device.listen();
    const service = cast.createCastService({
      addressOk: () => true,
      pollMs: 30,
      connect: (_address: string, p: number) =>
        new Promise((resolve, reject) => {
          const socket = net.connect(p, "127.0.0.1", () => resolve(socket));
          socket.once("error", reject);
        }),
    });
    service.table.ingest(proto.parseDnsMessage(mdnsResponse({ port })).records);
    const statuses: { state: string; currentTime: number; sessionId: string; error?: string }[] =
      [];
    const owner = { key: 1, notify: (s: (typeof statuses)[number]) => statuses.push(s) };
    return { device, service, statuses, owner };
  }

  it("conecta, abre o receiver, carrega e controla", async () => {
    const { device, service, statuses, owner } = await setup();
    const sessionId = service.load(owner, {
      deviceId: "0123456789abcdef",
      media: { ...media, startTime: 5 },
    });
    expect(sessionId).toMatch(/^[0-9a-f]{16}$/);
    await until(() => statuses.some((s) => s.state === "playing"));
    const types = device.received.map((m) => `${m.namespace.split(".").pop()}:${m.payload.type}`);
    expect(types).toContain("connection:CONNECT");
    expect(types).toContain("receiver:LAUNCH");
    expect(types).toContain("media:LOAD");
    const load = device.received.find((m) => m.payload.type === "LOAD")!;
    expect(load.destination).toBe("web-1");
    expect(load.payload.currentTime).toBe(5);

    await service.control(1, sessionId, { action: "pause" });
    await until(() => statuses.at(-1)?.state === "paused");
    await service.control(1, sessionId, { action: "seek", value: 60 });
    await until(() => Math.round(statuses.at(-1)!.currentTime) === 60);
    await service.control(1, sessionId, { action: "volume", value: 0.2 });
    await until(() => device.received.some((m) => m.payload.type === "SET_VOLUME"));
    await expect(service.control(2, sessionId, { action: "play" })).rejects.toMatchObject({
      code: "cast_no_session",
    });
    await expect(service.control(1, sessionId, { action: "next" })).rejects.toMatchObject({
      code: "cast_invalid",
    });

    device.finish("FINISHED");
    await until(() => statuses.some((s) => s.state === "ended"));

    await service.stop(1, sessionId);
    await until(() =>
      device.received.some((m) => m.payload.type === "STOP" && m.namespace.endsWith("receiver")),
    );
    expect(service.sessionsOf(1)).toEqual([]);
    service.shutdown();
    device.close();
  });

  it("soltar o dono não para o aparelho (só fecha o canal)", async () => {
    const { device, service, statuses, owner } = await setup();
    service.load(owner, { deviceId: "0123456789abcdef", media });
    await until(() => statuses.some((s) => s.state === "playing"));
    service.dropOwner(1);
    expect(service.sessionsOf(1)).toEqual([]);
    await new Promise((r) => setTimeout(r, 80));
    expect(device.received.some((m) => m.payload.type === "STOP")).toBe(false);
    service.shutdown();
    device.close();
  });

  it("rejeita aparelho desconhecido e entrada inválida", async () => {
    const { device, service, owner } = await setup();
    expect(() => service.load(owner, { deviceId: "naoexiste", media })).toThrow(
      /cast_device_not_found/,
    );
    expect(() =>
      service.load(owner, { deviceId: "0123456789abcdef", media: { ...media, url: "file:///x" } }),
    ).toThrow(/cast_invalid/);
    service.shutdown();
    device.close();
  });

  it("recusa endereço fora da rede local mesmo com id válido", async () => {
    const service = cast.createCastService({
      connect: () => Promise.reject(new Error("não devia conectar")),
    });
    service.table.ingest(proto.parseDnsMessage(mdnsResponse({ ip: [8, 8, 8, 8] })).records);
    expect(() =>
      service.load({ key: 1, notify() {} }, { deviceId: "0123456789abcdef", media }),
    ).toThrow(/cast_device_not_found/);
  });
});

describe("ponte da página (main)", () => {
  function make({ origins = ["https://flix.rsolutionsbr.com"], flag = true, permit = true } = {}) {
    const loads: unknown[] = [];
    const service = {
      devices: async () => [{ id: "d1", name: "Sala", model: "Chromecast" }],
      subscribeDevices: () => () => {},
      load: (_owner: unknown, args: unknown) => (loads.push(args), "sess"),
      control: async () => true,
      stop: async () => true,
      sessionsOf: () => [],
      dropOwner: () => {},
    };
    let asked = 0;
    const bridge = cast.createCastBridge({
      service,
      flagOn: () => flag,
      origins: () => origins,
      limiter: proto.createRateLimiter({ max: 3, windowMs: 10_000 }),
      ensurePermission: async () => (asked++, permit),
      onSessions: () => {},
    });
    const frame = { url: "https://flix.rsolutionsbr.com/filme" };
    const sender = { id: 7, mainFrame: frame, on() {}, isDestroyed: () => false, send() {} };
    return {
      bridge,
      loads,
      event: (f: object = frame) => ({ sender, senderFrame: f }),
      asked: () => asked,
    };
  }

  it("atende origem permitida", async () => {
    const { bridge, event } = make();
    expect(bridge.allowedSync(event())).toBe(true);
    expect(await bridge.handle(event(), "devices")).toEqual({
      ok: true,
      value: [{ id: "d1", name: "Sala", model: "Chromecast" }],
    });
  });

  it("recusa origem fora da lista, http, sub-frame e flag desligada", async () => {
    const outra = make();
    const evil = { url: "https://evil.com/" };
    const e1 = { sender: { ...outra.event().sender, mainFrame: evil }, senderFrame: evil };
    expect(outra.bridge.allowedSync(e1)).toBe(false);
    expect(await outra.bridge.handle(e1, "devices")).toEqual({
      ok: false,
      error: "cast_forbidden_origin",
    });
    const plain = { url: "http://flix.rsolutionsbr.com/" };
    expect(
      await outra.bridge.handle(
        { sender: { ...outra.event().sender, mainFrame: plain }, senderFrame: plain },
        "devices",
      ),
    ).toMatchObject({ error: "cast_forbidden_origin" });
    const sub = { url: "https://flix.rsolutionsbr.com/embed" };
    expect(await outra.bridge.handle(outra.event(sub), "devices")).toMatchObject({
      error: "cast_forbidden_origin",
    });
    const off = make({ flag: false });
    expect(off.bridge.allowedSync(off.event())).toBe(false);
    expect(await off.bridge.handle(off.event(), "devices")).toMatchObject({
      error: "cast_disabled",
    });
    const empty = make({ origins: [] });
    expect(await empty.bridge.handle(empty.event(), "devices")).toMatchObject({
      error: "cast_forbidden_origin",
    });
  });

  it("sem permissão do site nada é feito", async () => {
    const { bridge, event, loads } = make({ permit: false });
    expect(await bridge.handle(event(), "load", { deviceId: "d1", media })).toEqual({
      ok: false,
      error: "cast_denied",
    });
    expect(loads).toEqual([]);
  });

  it("limita chamadas e valida o op", async () => {
    const { bridge, event } = make();
    expect(await bridge.handle(event(), "nada")).toMatchObject({ error: "cast_invalid" });
    await bridge.handle(event(), "devices");
    await bridge.handle(event(), "devices");
    expect(await bridge.handle(event(), "devices")).toMatchObject({ error: "cast_rate_limited" });
  });

  it("load devolve o sessionId", async () => {
    const { bridge, event, loads } = make();
    expect(await bridge.handle(event(), "load", { deviceId: "d1", media })).toEqual({
      ok: true,
      value: "sess",
    });
    expect(loads).toHaveLength(1);
  });
});
