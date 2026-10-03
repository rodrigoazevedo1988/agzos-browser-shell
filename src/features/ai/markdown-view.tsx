import { Check, Copy, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";

import { type Block, type Inline, isArtifact, parseMarkdown } from "./markdown";

function Inlines({ items, onLink }: { items: Inline[]; onLink: (href: string) => void }) {
  return (
    <>
      {items.map((item, index) => {
        switch (item.kind) {
          case "text":
            return <span key={index}>{item.text}</span>;
          case "code":
            return <code key={index}>{item.text}</code>;
          case "strong":
            return (
              <strong key={index}>
                <Inlines items={item.children} onLink={onLink} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <Inlines items={item.children} onLink={onLink} />
              </em>
            );
          case "del":
            return (
              <del key={index}>
                <Inlines items={item.children} onLink={onLink} />
              </del>
            );
          case "link":
            return (
              <a
                key={index}
                href={item.href}
                title={item.href}
                onClick={(event) => {
                  event.preventDefault();
                  onLink(item.href);
                }}
              >
                <Inlines items={item.children} onLink={onLink} />
              </a>
            );
        }
      })}
    </>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copiar código"
      title="Copiar"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Check /> : <Copy />}
    </button>
  );
}

type Props = {
  text: string;
  /** Prefixo do id dos artifacts desta mensagem (`${at}-${índice}`); null = sem artifacts. */
  artifactPrefix: string | null;
  onLink: (href: string) => void;
  onArtifact: (id: string) => void;
};

/** Resposta em markdown; blocos de código têm copiar e, quando viram artifact, abrir ao lado. */
export function Markdown({ text, artifactPrefix, onLink, onArtifact }: Props) {
  // Mesma ordem de visita do artifactsOf (markdown.ts): o n-ésimo bloco tem o mesmo id.
  let codeIndex = 0;
  const render = (blocks: Block[]): ReactNode[] =>
    blocks.map((block, index) => {
      switch (block.kind) {
        case "heading": {
          const Tag = `h${Math.min(block.level + 2, 6)}` as "h3";
          return (
            <Tag key={index} className="md-heading" data-level={block.level}>
              <Inlines items={block.children} onLink={onLink} />
            </Tag>
          );
        }
        case "paragraph":
          return (
            <p key={index}>
              <Inlines items={block.children} onLink={onLink} />
            </p>
          );
        case "rule":
          return <hr key={index} />;
        case "quote":
          return <blockquote key={index}>{render(block.children)}</blockquote>;
        case "list": {
          const items = block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{render(item)}</li>
          ));
          return block.ordered ? (
            <ol key={index} start={block.start}>
              {items}
            </ol>
          ) : (
            <ul key={index}>{items}</ul>
          );
        }
        case "table":
          return (
            <div key={index} className="md-table">
              <table>
                <thead>
                  <tr>
                    {block.head.map((cell, cellIndex) => (
                      <th key={cellIndex}>
                        <Inlines items={cell} onLink={onLink} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex}>
                          <Inlines items={cell} onLink={onLink} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        case "code": {
          const id = artifactPrefix === null ? null : `${artifactPrefix}-${codeIndex}`;
          codeIndex += 1;
          const artifact = id !== null && !block.open && isArtifact(block.lang, block.text);
          return (
            <div key={index} className="md-code" data-lang={block.lang || undefined}>
              <div className="md-code-bar">
                <span>{block.lang || "código"}</span>
                {artifact && (
                  <button
                    type="button"
                    aria-label="Abrir ao lado"
                    title="Abrir ao lado"
                    onClick={() => onArtifact(id)}
                  >
                    <PanelRightOpen />
                  </button>
                )}
                <CopyButton text={block.text} />
              </div>
              <pre className="ai-code">
                <code>{block.text}</code>
              </pre>
            </div>
          );
        }
      }
    });
  return <div className="md">{render(parseMarkdown(text))}</div>;
}
