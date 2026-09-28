import { useState } from "react";

import { Button } from "@/components/ui/button";

const embedBlockers = [
  "duckduckgo.com",
  "yandex.com",
  "yandex.ru",
  "google.com",
  "github.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "facebook.com",
  "notion.so",
  "figma.com",
  "linear.app",
  "youtube.com",
  "linkedin.com",
];

function refusesEmbedding(url: string) {
  if (typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent)) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return embedBlockers.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

export function WebFrame({ title, url }: { title: string; url: string }) {
  const [forced, setForced] = useState(false);
  const blocked = refusesEmbedding(url) && !forced;

  return (
    <div className="web-frame">
      <div className="frame-bar">
        <span>{title}</span>
        <button type="button" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
          Abrir em nova janela
        </button>
      </div>
      {blocked ? (
        <div className="frame-fallback">
          <div className="mock-eyebrow">Este site não permite exibição aqui</div>
          <h1>{title}</h1>
          <p>
            Na versão web, alguns sites bloqueiam a exibição dentro de outro navegador. No
            aplicativo Agzos para computador a página abre normalmente dentro da aba.
          </p>
          <div className="fallback-actions">
            <Button onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
              Abrir em nova janela
            </Button>
            <Button variant="outline" onClick={() => setForced(true)}>
              Tentar exibir aqui
            </Button>
          </div>
          <small>{url}</small>
        </div>
      ) : (
        <iframe
          src={url}
          title={title}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      )}
    </div>
  );
}
