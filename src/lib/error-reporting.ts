/**
 * Erro pego pelo error boundary da rota raiz. Vai para o console com a rota e o
 * contexto (loaders e server fns costumam lançar um Response cru: mostra status e URL).
 */
export function reportError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);
  console.error("[Agzos] erro na interface:", message, {
    route: window.location.pathname,
    ...context,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  });
}
