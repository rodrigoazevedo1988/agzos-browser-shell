import type { PreviewRect, PreviewSide, TabCard } from "../tab-preview";

const WIDTH = 264;
const GAP = 6;

/** Cartão de prévia na versão web (no app quem desenha é o main, acima da página). */
export function TabPreviewCard({
  card,
  rect,
  side,
}: {
  card: TabCard;
  rect: PreviewRect;
  side: PreviewSide;
}) {
  const left =
    side === "right"
      ? rect.x + rect.width + GAP
      : Math.min(rect.x, (typeof window === "undefined" ? 1440 : window.innerWidth) - WIDTH - 8);
  const top = side === "right" ? rect.y : rect.y + rect.height + GAP;
  return (
    <div
      className="tab-preview"
      role="tooltip"
      aria-label={`Prévia: ${card.title}`}
      style={{ left, top, width: WIDTH }}
    >
      {card.image ? (
        <img className="tab-preview-shot" src={card.image} alt="" />
      ) : card.placeholder ? (
        <div className="tab-preview-shot empty">{card.placeholder}</div>
      ) : null}
      <div className="tab-preview-body">
        <strong>{card.title}</strong>
        <small>{card.host}</small>
        {card.stats.length > 0 && (
          <dl>
            {card.stats.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {card.chips.length > 0 && (
          <div className="tab-preview-chips">
            {card.chips.map((chip) => (
              <span key={chip.label} className={chip.muted ? "muted" : undefined}>
                {chip.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
