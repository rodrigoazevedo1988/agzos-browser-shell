import { useState } from "react";

import { faviconSources, initialOf } from "../favicon";

/**
 * Favicon real do site (Google → /favicon.ico) com a inicial como último recurso. O
 * serviço do Google devolve um globo genérico de 16 px quando não conhece o site: imagem
 * pequena demais também conta como falha.
 */
export function SiteIcon({
  url,
  name,
  size = 64,
  className,
}: {
  url: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const sources = faviconSources(url, size);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const source = sources[attempt];

  const settle = (image: HTMLImageElement) => {
    if (image.naturalWidth === 0) {
      setAttempt(attempt + 1);
      return;
    }
    if (attempt === 0 && image.naturalWidth < 32 && size >= 32) {
      setAttempt(1);
      return;
    }
    setLoaded(true);
  };

  return (
    <span
      className={className ?? "site-icon"}
      data-icon={loaded ? "favicon" : "letter"}
      aria-hidden="true"
    >
      {!loaded && <span className="site-icon-letter">{initialOf(name, url)}</span>}
      {source && (
        <img
          key={source}
          src={source}
          alt=""
          aria-hidden="true"
          draggable={false}
          referrerPolicy="no-referrer"
          style={loaded ? undefined : { position: "absolute", opacity: 0 }}
          // Página renderizada no servidor: a imagem pode terminar antes da hidratação, sem
          // onLoad. O ref confere o que já carregou.
          ref={(image) => {
            if (image?.complete && !loaded) settle(image);
          }}
          onLoad={(event) => settle(event.currentTarget)}
          onError={() => setAttempt(attempt + 1)}
        />
      )}
    </span>
  );
}
