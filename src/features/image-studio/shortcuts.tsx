import { X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

const ROWS: [string, string][] = [
  [
    "V, H, T, R, U, O, L, A, S, P, K",
    "Ferramentas (selecionar, mover a tela, texto, formas, remover fundo)",
  ],
  ["Espaço + arrastar, roda do mouse", "Mover a tela"],
  ["Ctrl + roda do mouse, Ctrl + / −", "Zoom no cursor"],
  ["Ctrl + 0 / Ctrl + 1", "Ajustar à tela / 100%"],
  ["Ctrl + Z, Ctrl + Shift + Z", "Desfazer e refazer"],
  ["Ctrl + D, Ctrl + C, Ctrl + V", "Duplicar, copiar e colar elementos"],
  ["Ctrl + A", "Selecionar tudo"],
  ["Shift + clique, arrastar em área vazia", "Somar à seleção, laço"],
  ["Setas (Shift: 10 px)", "Mover a seleção"],
  ["Ctrl + ] / Ctrl + [", "Trazer para a frente / enviar para trás"],
  ["Delete", "Excluir"],
  ["Shift ao arrastar", "Proporção (alças de canto), ângulo de 45° (linhas), giro de 15°"],
  ["Alt ao mover", "Desliga o encaixe (guias)"],
  ["Duplo clique em texto, Esc ou Ctrl + Enter", "Editar texto, sair da edição"],
  ["Ctrl + S, Ctrl + O", "Salvar e abrir projeto (.agzimg)"],
  ["Ctrl + E", "Exportar PNG, JPEG ou WebP"],
  ["?", "Esta lista"],
];

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="ims-modal-backdrop" role="presentation" onPointerDown={onClose}>
      <div
        className="ims-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Atalhos de teclado"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Atalhos de teclado</strong>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
            <X />
          </Button>
        </header>
        <table className="ims-shortcuts">
          <tbody>
            {ROWS.map(([keys, action]) => (
              <tr key={keys}>
                <th scope="row">{keys}</th>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
