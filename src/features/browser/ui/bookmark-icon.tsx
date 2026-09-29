import { useState } from "react";

import { hostOf } from "../store/selectors";

/** Favicon salvo do favorito/página ou, sem ele, a inicial do site. */
export function BookmarkIcon({
  node,
}: {
  node: { url?: string | undefined; icon?: string | null | undefined; title: string };
}) {
  const [broken, setBroken] = useState(false);
  if (node.icon && !broken) {
    return (
      <img className="bookmark-favicon" src={node.icon} alt="" onError={() => setBroken(true)} />
    );
  }
  const letter = (hostOf(node.url ?? "") ?? node.title).charAt(0).toUpperCase() || "•";
  return (
    <span className="bookmark-letter" aria-hidden="true">
      {letter}
    </span>
  );
}
