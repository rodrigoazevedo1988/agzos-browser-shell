# Ponte de Chromecast do Agzos Browser (`window.agzosCast`)

Contrato para sites (como o Flix) que querem transmitir vídeo e áudio para Chromecast e
Android TV da rede local dentro do Agzos Browser. O Google Cast Web Sender SDK não funciona no
Electron (não existe Media Router); esta ponte faz o papel dele. Em outros navegadores o objeto
não existe: o site deve continuar usando o SDK do Google.

## Disponibilidade

`window.agzosCast` existe só quando todas estas condições valem:

- a página é `https:` e é o quadro de cima (iframes não recebem a ponte);
- a origem exata (esquema + host + porta) está em `prefs.castOrigins` (padrão:
  `["https://flix.rsolutionsbr.com"]`; sem curinga);
- o recurso `cast` está ligado (padrão: ligado).

Detecte assim:

```js
if (window.agzosCast && window.agzosCast.version === 1) {
  /* mostre o botão de transmitir do Agzos */
}
```

O objeto é criado no início do documento. O main confere tudo de novo a cada chamada, então a
lista pode mudar sem recarregar a página (as chamadas passam a falhar com `cast_forbidden_origin`).

## Permissão

Na primeira chamada de uma origem, o navegador mostra a barra "o site quer transmitir vídeo
para Chromecast e TVs da sua rede" com Permitir/Bloquear e "Lembrar". Em Configurações do site
a permissão aparece como "Transmitir para a TV (Chromecast)". Enquanto o usuário não responde,
as promessas ficam pendentes (até 60 s; depois falham com `cast_denied`). Em guia anônima a
permissão vale só até fechar o app e a permissão salva na janela normal não é herdada.

## API (TypeScript)

```ts
type CastDevice = { id: string; name: string; model: string };

type CastTrack = {
  id: number; // inteiro > 0, único na mídia
  url: string; // WebVTT, http(s)
  lang: string; // BCP 47, ex.: "pt-BR"
  label: string; // texto mostrado na TV
};

type CastMedia = {
  url: string; // http(s), até 2048 caracteres; o APARELHO é quem baixa
  contentType: string; // "video/mp4", "audio/mpeg", "application/x-mpegURL"...
  title: string; // obrigatório, até 200 caracteres
  subtitle?: string;
  imageUrl?: string; // capa, http(s)
  duration?: number; // segundos
  startTime?: number; // segundos
  tracks?: CastTrack[]; // até 16
  activeTrackId?: number; // precisa existir em tracks
};

type CastLoadRequest = {
  deviceId: string;
  media: CastMedia;
  queue?: CastMedia[]; // 1 a 200 itens; quando existe, a fila toca a partir do primeiro
};

type CastControl =
  | { action: "play" }
  | { action: "pause" }
  | { action: "seek"; value: number } // segundos
  | { action: "stop" }
  | { action: "volume"; value: number } // 0 a 1, volume do aparelho
  | { action: "next" } // só com fila
  | { action: "prev" } // só com fila
  | { action: "track"; value: number | null }; // id da legenda, null desliga

type CastStatus = {
  sessionId: string;
  deviceName: string;
  state: "idle" | "buffering" | "playing" | "paused" | "ended" | "error";
  currentTime: number; // segundos
  duration?: number; // segundos, quando o aparelho informa
  volume?: number; // 0 a 1
  error?: string; // texto em português, só com state "error"
};

interface AgzosCast {
  readonly version: 1;
  getDevices(): Promise<CastDevice[]>;
  /** Chama o callback já com a lista atual e a cada mudança. Devolve a função que cancela. */
  onDevices(callback: (devices: CastDevice[]) => void): () => void;
  /** Devolve o sessionId assim que a sessão é criada; o estado vem por onStatus. */
  load(request: CastLoadRequest): Promise<string>;
  control(sessionId: string, command: CastControl): Promise<true>;
  /** Estado de todas as sessões desta guia. Devolve a função que cancela. */
  onStatus(callback: (status: CastStatus) => void): () => void;
  /** Para a mídia, encerra o app no aparelho e a sessão. */
  stop(sessionId: string): Promise<true>;
  /** Extra: sessões vivas desta guia (para retomar o controle depois de recarregar). */
  getSessions(): Promise<CastStatus[]>;
}
```

### Dispositivos

`id` é estável (vem do próprio aparelho), `name` é o nome que o usuário deu e `model` o modelo
(ex.: "Chromecast", "Google TV Streamer"). Endereço IP e porta nunca chegam à página. A busca
usa mDNS (`_googlecast._tcp`) e começa na primeira chamada; a primeira `getDevices()` espera
até 2 s por respostas. Aparelhos que somem da rede saem da lista em até 2 minutos.

### Mídia

- **O aparelho baixa a URL**, não o navegador. A URL precisa ser alcançável pela TV (não
  `localhost`, não exigir cookie do navegador). Use URLs assinadas ou um token na própria URL.
- O Default Media Receiver (app `CC1AD845`) toca MP4 H.264/AAC, WebM, MP3, AAC, HLS
  (`application/x-mpegURL`) e DASH (`application/dash+xml`), conforme o modelo.
- Legendas precisam ser **WebVTT** e o servidor delas precisa mandar
  `Access-Control-Allow-Origin: *` (o receiver baixa com CORS). O mesmo vale para HLS/DASH e,
  em geral, para o vídeo.
- Fila (`queue`): é enviada inteira como `QUEUE_LOAD` e `media` é ignorada nesse caso (inclua o
  item atual como primeiro da fila). `next`/`prev` pulam entre itens. O estado reflete o item
  atual (`duration` muda a cada item).

### Sessões

- Uma sessão por chamada de `load`; carregar de novo no mesmo aparelho troca a sessão anterior
  (o app no aparelho continua aberto). No máximo 4 por guia.
- A sessão pertence à guia. Fechar a guia, ou a guia sair da origem, **solta o controle e deixa
  tocando no aparelho**. Só `stop` encerra a reprodução.
- Recarregar a mesma origem não encerra a sessão; use `getSessions()` para retomar.
- `onStatus` recebe uma atualização a cada mudança e, tocando, cerca de uma por segundo.
  Estados: `buffering` ao criar/carregar, `playing`, `paused`, `ended` (terminou), `idle`
  (parado/encerrado) e `error`. Perda de conexão ou aparelho recusando a mídia vira `error`.
- Pelo botão de transmissão que o navegador mostra na barra de endereço, o usuário também
  pode pausar, avançar, mudar o volume e parar; essas mudanças chegam por `onStatus`.

## Erros

As promessas rejeitam com `Error` cuja `message` (e `code`) é um destes valores:

| código                   | significado                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `cast_forbidden_origin`  | a origem não está em `castOrigins`, não é https ou não é o topo   |
| `cast_disabled`          | recurso desligado                                                 |
| `cast_denied`            | usuário bloqueou (ou não respondeu a tempo)                       |
| `cast_rate_limited`      | mais de 40 chamadas em 5 s                                        |
| `cast_invalid`           | argumento inválido (URL não http(s), tamanho, id, valor, ação...) |
| `cast_device_not_found`  | `deviceId` não está mais na rede                                  |
| `cast_no_session`        | `sessionId` desconhecido ou de outra guia                         |
| `cast_not_ready`         | sessão ainda conectando (tente depois do primeiro `onStatus`)     |
| `cast_too_many_sessions` | limite de sessões                                                 |

Falhas depois do `load` (conexão, receiver, mídia recusada) chegam por `onStatus` com
`state: "error"`.

## Exemplo

```js
const cast = window.agzosCast;
if (cast) {
  const off = cast.onStatus((s) => console.log(s.state, s.currentTime));
  const [tv] = await cast.getDevices();
  const sessionId = await cast.load({
    deviceId: tv.id,
    media: {
      url: "https://flix.rsolutionsbr.com/media/ep1.mp4",
      contentType: "video/mp4",
      title: "Episódio 1",
      imageUrl: "https://flix.rsolutionsbr.com/img/ep1.jpg",
      startTime: 120,
      tracks: [
        {
          id: 1,
          url: "https://flix.rsolutionsbr.com/sub/ep1.pt.vtt",
          lang: "pt-BR",
          label: "Português",
        },
      ],
      activeTrackId: 1,
    },
  });
  await cast.control(sessionId, { action: "pause" });
  await cast.control(sessionId, { action: "seek", value: 300 });
  await cast.stop(sessionId);
  off();
}
```

## Segurança (resumo)

Só https, só a lista, permissão por site, limite de chamadas, entradas validadas no main, sem
endereço de rede para a página, certificado do aparelho aceito só no socket dele e só em IP de
rede local. Detalhes e arquivos: `AGENTS.md` (item 6.0) e `electron/cast.cjs`.
