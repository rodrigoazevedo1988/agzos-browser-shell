// Hibernação de abas (1.7): guia sem uso há um tempo tem o WebContentsView fechado (o
// processo da página sai da memória). A casca continua mostrando a guia; ao voltar para
// ela, a página é recriada com o histórico de navegação (voltar/avançar e rolagem).

/** Minutos oferecidos nas configurações (o primeiro é o padrão quando o valor é inválido). */
const HIBERNATE_MINUTES = [30, 15, 60, 120];
const CHECK_INTERVAL_MS = 60 * 1000;

function hibernateConfigOf(prefs, override = {}) {
  const minutes = HIBERNATE_MINUTES.includes(prefs?.hibernateMinutes)
    ? prefs.hibernateMinutes
    : HIBERNATE_MINUTES[0];
  return {
    enabled: prefs?.hibernate !== false,
    afterMs: Number.isFinite(override.afterMs) ? override.afterMs : minutes * 60 * 1000,
  };
}

/**
 * Regras (as mesmas do "Economia de memória" do Chrome): nunca a guia visível, nem a que
 * toca som, carrega, usa câmera/microfone, espera resposta de permissão, está em tela
 * cheia ou tem formulário preenchido (`edited` vem da página, ver EDITED_FORM_SOURCE).
 */
function canHibernate(tab, { now, afterMs }) {
  if (!tab || tab.visible || tab.hiddenSince == null) return false;
  if (now - tab.hiddenSince < afterMs) return false;
  return !(
    tab.audible ||
    tab.loading ||
    tab.capturing ||
    tab.pendingPermission ||
    tab.fullscreen ||
    tab.devtools
  );
}

// Roda num mundo isolado da página: algum campo com texto diferente do inicial?
const EDITED_FORM_SOURCE = `(() => {
  const fields = document.querySelectorAll("input, textarea, select");
  for (const field of fields) {
    if (field.disabled || field.readOnly) continue;
    if (field.tagName === "SELECT") {
      if ([...field.options].some((option) => option.selected !== option.defaultSelected)) return true;
      continue;
    }
    const type = (field.type || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image", "search"].includes(type)) continue;
    if (type === "checkbox" || type === "radio") {
      if (field.checked !== field.defaultChecked) return true;
      continue;
    }
    if (field.value !== field.defaultValue && field.value.trim() !== "") return true;
  }
  const editable = document.querySelector("[contenteditable=''], [contenteditable='true']");
  return Boolean(editable && editable.textContent.trim() && document.activeElement === editable);
})()`;

/**
 * Histórico para o navigationHistory.restore: sem as páginas de erro do Chromium e com o
 * índice ajustado. null quando não há o que restaurar.
 */
function restorableHistory(entries, index) {
  if (!Array.isArray(entries)) return null;
  const kept = [];
  let active = -1;
  entries.forEach((entry, position) => {
    const url = typeof entry?.url === "string" ? entry.url : "";
    if (!/^(https?|file):/i.test(url)) return;
    if (position <= index) active = kept.length;
    kept.push({
      url,
      title: typeof entry.title === "string" ? entry.title : "",
      ...(typeof entry.pageState === "string" ? { pageState: entry.pageState } : {}),
    });
  });
  if (!kept.length) return null;
  return { entries: kept, index: Math.max(0, active) };
}

module.exports = {
  HIBERNATE_MINUTES,
  CHECK_INTERVAL_MS,
  hibernateConfigOf,
  canHibernate,
  restorableHistory,
  EDITED_FORM_SOURCE,
};
