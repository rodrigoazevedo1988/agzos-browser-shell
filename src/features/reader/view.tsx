import { BookOpen, Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { ReaderArticle, ReaderBlock, ReaderInline } from "@/features/browser/desktop";

export const READER_FONT = { min: 15, max: 26, initial: 19 } as const;

function Inlines({ items, onLink }: { items: ReaderInline[]; onLink: (href: string) => void }) {
  return (
    <>
      {items.map((item, index) => {
        switch (item.kind) {
          case "strong":
            return <strong key={index}>{item.text}</strong>;
          case "em":
            return <em key={index}>{item.text}</em>;
          case "code":
            return <code key={index}>{item.text}</code>;
          case "link":
            return (
              <a
                key={index}
                href={item.href}
                title={item.href}
                onClick={(event) => {
                  event.preventDefault();
                  if (item.href) onLink(item.href);
                }}
              >
                {item.text}
              </a>
            );
          default:
            return <span key={index}>{item.text}</span>;
        }
      })}
    </>
  );
}

function Block({
  block,
  onLink,
}: {
  block: ReaderBlock;
  onLink: (href: string) => void;
}): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${Math.min(6, Math.max(2, block.level))}` as "h2";
      return (
        <Tag>
          <Inlines items={block.children} onLink={onLink} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p>
          <Inlines items={block.children} onLink={onLink} />
        </p>
      );
    case "quote":
      return (
        <blockquote>
          <Inlines items={block.children} onLink={onLink} />
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>
          <Inlines items={item} onLink={onLink} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case "code":
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );
    case "image":
      return (
        <figure>
          <img src={block.src} alt={block.alt} loading="lazy" referrerPolicy="no-referrer" />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
  }
}

/**
 * Modo leitura (4.5): o artigo da guia com tipografia larga, sem o menu do site. A página
 * continua carregada por baixo; "Sair" tira a capa e ela volta como estava.
 */
export function ReaderView({
  article,
  fontSize,
  onFontSize,
  onExit,
  onOpenUrl,
}: {
  article: ReaderArticle;
  fontSize: number;
  onFontSize: (size: number) => void;
  onExit: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.focus();
  }, [article.url]);

  return (
    <section className="reader" aria-label="Modo leitura" data-reader>
      <header className="reader-bar">
        <BookOpen aria-hidden="true" />
        <span className="reader-site">
          {article.site}
          <small> · {article.minutes} min de leitura</small>
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Diminuir letra"
          disabled={fontSize <= READER_FONT.min}
          onClick={() => onFontSize(Math.max(READER_FONT.min, fontSize - 1))}
        >
          <Minus />
        </Button>
        <span className="reader-font" aria-live="polite">
          {fontSize}px
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Aumentar letra"
          disabled={fontSize >= READER_FONT.max}
          onClick={() => onFontSize(Math.min(READER_FONT.max, fontSize + 1))}
        >
          <Plus />
        </Button>
        <Button variant="outline" size="sm" onClick={onExit}>
          <X /> Sair do modo leitura
        </Button>
      </header>
      <div
        ref={scrollRef}
        className="reader-scroll"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onExit();
          }
        }}
      >
        <article
          className="reader-article"
          lang={article.lang || undefined}
          style={{ fontSize: `${fontSize}px` }}
        >
          <h1>{article.title}</h1>
          {article.byline && <p className="reader-byline">{article.byline}</p>}
          {article.blocks.map((block, index) => (
            <Block key={index} block={block} onLink={onOpenUrl} />
          ))}
        </article>
      </div>
    </section>
  );
}
