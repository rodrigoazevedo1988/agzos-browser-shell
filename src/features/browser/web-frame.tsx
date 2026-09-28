import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge } from "./desktop";

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

function NativeView({
  tabId,
  url,
  requestedUrl,
  dark,
  privateTab,
  muted,
}: {
  tabId: number;
  url: string;
  requestedUrl?: string;
  dark: boolean;
  privateTab: boolean;
  muted: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const lastRequestedRef = useRef<string | null>(requestedUrl ?? url);
  const bridge = desktopBridge();

  useEffect(() => {
    void bridge?.attachTab(tabId, url, { dark, private: privateTab });
    void bridge?.activateTab(tabId);
    void bridge?.muteTab(tabId, muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  useEffect(() => {
    if (!bridge || requestedUrl == null) return;
    if (lastRequestedRef.current === requestedUrl) return;
    lastRequestedRef.current = requestedUrl;
    void bridge.navigate(tabId, requestedUrl);
  }, [bridge, tabId, requestedUrl]);

  useEffect(() => {
    void bridge?.muteTab(tabId, muted);
  }, [bridge, tabId, muted]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !bridge) return;
    const report = () => {
      const rect = host.getBoundingClientRect();
      void bridge.setBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(host);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [bridge]);

  return <div ref={hostRef} className="web-frame native-view" />;
}

export function WebFrame({
  tabId,
  title,
  url,
  requestedUrl,
  dark,
  privateTab,
  muted,
}: {
  tabId: number;
  title: string;
  url: string;
  requestedUrl?: string;
  dark: boolean;
  privateTab: boolean;
  muted: boolean;
}) {
  const [forced, setForced] = useState(false);
  const native = desktopBridge();
  const blocked = refusesEmbedding(url) && !forced;

  if (native) {
    return (
      <NativeView
        tabId={tabId}
        url={url}
        requestedUrl={requestedUrl}
        dark={dark}
        privateTab={privateTab}
        muted={muted}
      />
    );
  }

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
