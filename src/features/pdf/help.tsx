import { CircleHelp, Bug } from "lucide-react";

const ISSUES_URL = "https://github.com/rodrigoazevedo1988/agzos-browser-shell/issues/new";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Meus PDFs vão para algum servidor?",
    a: "Não. Editar, juntar, dividir, comprimir, girar, senha e OCR rodam neste computador. Só o resumo com IA manda texto (nunca o arquivo) para o Agzos AI, e só com o recurso ligado e a sua confirmação a cada arquivo.",
  },
  {
    q: "Como abro um PDF?",
    a: "Botão Abrir, ícone PDF na barra de endereço quando a guia mostra um PDF, clique direito num link .pdf › Abrir com PDF Tools, o botão de PDF no gerenciador de downloads ou o atalho (Ctrl+Alt+P, configurável).",
  },
  {
    q: "Salvar ou Exportar?",
    a: "Salvar grava por cima do arquivo que você abriu. Exportar pergunta onde gravar uma cópia. PDF aberto de um link só exporta.",
  },
  {
    q: "A senha do PDF fica gravada?",
    a: "Não, a menos que você marque 'Lembrar neste computador' ao abrir. Aí ela fica cifrada (AES-256) com uma chave guardada pelo chaveiro do sistema. Para esquecer: Configurações › Recursos › PDF Tools.",
  },
  {
    q: "O que a compressão faz?",
    a: "Refaz as imagens com outra qualidade e tamanho máximo (fraca, equilibrada ou forte). Texto e desenhos não mudam. Se o arquivo não ficar menor, nada é trocado.",
  },
  {
    q: "Converter para Word não aparece.",
    a: "A conversão Office usa o LibreOffice instalado no computador (gratuito). Sem ele, exporte como texto ou imagens.",
  },
  {
    q: "OCR em outros idiomas?",
    a: "Português, inglês e espanhol vêm com o app. Outros idiomas são baixados só quando você pede (arquivos de idioma, nunca o PDF).",
  },
  {
    q: "Qual o tamanho máximo?",
    a: "50 MB por padrão; mude em Configurações › Recursos › PDF Tools (até 500 MB, PDFs grandes demoram mais).",
  },
];

/** agzos://ajuda/pdf-tools: perguntas frequentes e "Reportar problema". */
export function PdfHelpPage({
  onOpenUrl,
  version,
}: {
  onOpenUrl: (url: string) => void;
  version: string | null;
}) {
  const report = () => {
    const body = encodeURIComponent(
      `Versão: ${version ?? "?"}\nSistema: ${navigator.platform}\n\nO que aconteceu:\n\nComo reproduzir:\n1. \n\n(Não anexe PDFs com dados pessoais.)`,
    );
    onOpenUrl(`${ISSUES_URL}?title=${encodeURIComponent("PDF Tools: ")}&body=${body}`);
  };
  return (
    <div className="library-page pdf-help" aria-label="Ajuda do PDF Tools">
      <header className="library-head">
        <div className="library-title">
          <CircleHelp aria-hidden="true" />
          <div>
            <h1>Ajuda do PDF Tools</h1>
            <p>Tudo local por padrão; rede só com o seu consentimento.</p>
          </div>
        </div>
      </header>
      <dl className="pdf-faq">
        {FAQ.map((item) => (
          <div key={item.q}>
            <dt>{item.q}</dt>
            <dd>{item.a}</dd>
          </div>
        ))}
      </dl>
      <button type="button" className="pdf-primary" onClick={report}>
        <Bug aria-hidden="true" /> Reportar problema
      </button>
    </div>
  );
}
