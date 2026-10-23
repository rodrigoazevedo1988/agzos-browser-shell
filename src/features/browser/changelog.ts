/**
 * Novidades de cada versão publicada, mostradas no aviso "Atualizado com sucesso".
 * Toda publicação (scripts/build-all.sh) acrescenta uma entrada no topo, com a mesma
 * versão do VERSION do build.
 */
export type ChangelogEntry = { version: string; date: string; items: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "5.0.4",
    date: "2026-10-23",
    items: [
      "Corrigido: em notebooks de 1366×768 o menu Ferramentas da barra lateral passava da borda de baixo da janela e os últimos itens não apareciam nem rolando. Agora ele sobe até caber e rola até o fim.",
      "Corrigido: no Agzos Músicas o botão de tocar aparecia todo branco, sem o ícone. As cores dos botões do player (cinza nos ícones, vermelho em aleatório e repetir ligados) voltaram.",
    ],
  },
  {
    version: "5.0.3",
    date: "2026-10-23",
    items: [
      'Novo: Agzos Vídeos (agzos://videos). Navegue pelas pastas do computador como na Netflix, com destaques, "Continuar assistindo", favoritos e um player completo: legendas, velocidade, Picture-in-Picture e próximo episódio.',
      "Novo: Agzos Músicas (agzos://musica), no estilo do Spotify em vermelho: biblioteca por pastas, capas dos arquivos, playlists, fila, visualizador e teclas de mídia do sistema.",
      "Novo: editor de texto e código (agzos://editor) com o mesmo motor do VS Code. Modo bloco de notas para texto simples e cores vivas para código e Markdown, com visualização ao vivo do .md.",
      "Novo: Agzos Imagem (agzos://imagem), um editor no estilo do Canva com camadas, textos, formas, filtros, modelos prontos e as cores da Agzos.",
      'Novo: recarregar ignorando o cache (Ctrl+Shift+R, Ctrl+F5 ou Shift+clique no botão). Com o DevTools aberto, o clique direito no botão Recarregar oferece "Esvaziar o cache e recarregar".',
      'Melhorado: o yt-dlp se atualiza sozinho, tenta outros caminhos quando um download falha e, em sites que ele não conhece, baixa o vídeo que a página está tocando. Em Downloads, "Copiar detalhes" mostra o motivo de uma falha.',
      "Corrigido: digitar outro endereço na barra de uma guia já aberta às vezes não carregava a página, principalmente depois de um erro ou de uma guia travada.",
    ],
  },
  {
    version: "5.0.2",
    date: "2026-10-21",
    items: [
      "Corrigido: baixar vídeo do YouTube com o yt-dlp dava erro. O navegador agora entrega ao yt-dlp o runtime de JavaScript que o YouTube exige e os cookies da própria guia, então vídeos que pedem login (YouTube, Instagram, Facebook, X) também baixam.",
      'Corrigido: no Windows, vídeos com acento no título podiam terminar como "interrompido" mesmo baixados.',
      "Melhorado: os erros do yt-dlp aparecem em português e dizem o que fazer, por exemplo entrar na conta do site na guia.",
    ],
  },
  {
    version: "5.0.1",
    date: "2026-10-21",
    items: [
      "Novo: baixe vídeos do YouTube, X, Instagram, Facebook, TikTok e de todos os sites que o yt-dlp aceita, com um clique na barra de ferramentas ou no clique direito sobre o vídeo.",
      "Novo: foto no perfil da Conta Agzos. Ela fica salva na conta e aparece em todos os seus dispositivos.",
      "Novo: o seletor de contas do início ficou maior, no estilo do Chrome, com as fotos dos perfis, e o navegador avisa quando uma conta Google é conectada num perfil.",
      "Novo: zoom com Ctrl + roda do mouse (⌘ + roda no Mac) e com o gesto de pinça do trackpad.",
      'Novo: "Abrir com Agzos Browser" no menu de contexto do Windows e o navegador entre os apps de "Abrir com" no Windows, Mac e Linux.',
      'Melhorado: a barra lateral e a barra de ferramentas se ajustam a telas menores, como notebooks de 1360×768; o que não cabe vai para o menu "Mais".',
      "Corrigido: na captura da página inteira, cabeçalhos e elementos fixos se repetiam e ficavam por cima do conteúdo.",
      "Corrigido: fechar o DevTools com o terminal aberto do mesmo lado deixava uma área preta presa na tela. Agora só o DevTools fecha e o terminal continua aberto.",
    ],
  },
  {
    version: "5.0.0",
    date: "2026-10-19",
    items: [
      "Novo: Conta Agzos (agzos://conta). Crie sua conta, entre e recupere a senha com códigos de recuperação. Conectado, você gerencia quantas contas Google quiser, cada uma num perfil isolado, e escolhe qual abrir no início. Também ganha a área Serviços Agzos e o espaço das funções Premium.",
      "Novo: banner de abertura animado com o logo da Agzos.",
      "Novo: tradução como no Chrome. Selecione um texto e use o clique direito, ou traduza a página inteira pelo ícone da barra de endereço (Alt+Shift+T). Escolha entre substituir, bilíngue ou ver o original ao passar o mouse, e ajuste tom, glossário, termos que não se traduzem, regras por idioma e por site, e o idioma de destino.",
      'Novo: captura da página inteira (Ctrl+Alt+Shift+F ou "Página inteira" na captura) e um editor completo: recortar, lápis, marca-texto, linha, seta, retângulos, elipse, texto, contador numerado, pixelar e desfocar, com cores, espessura e desfazer/refazer.',
      "Novo: preenchimento automático inteligente. Ele reconhece os campos pelo significado (nome, e-mail, CPF, CEP, endereço…), preenche com perfis que você cria e acha login e senha também dentro de iframes, como nos apps do Google Apps Script.",
      "Novo: o conta-gotas do ColorTools pega cores de qualquer lugar da tela, não só do navegador.",
      "Novo: o painel do Agzos AI pode ser redimensionado pela borda, como o terminal.",
      "Novo: as Configurações estão organizadas em categorias e grupos.",
      "Novo: cole prints também numa sessão SSH do terminal. A imagem vai para ~/.cache/agzos-prints no servidor e o caminho entra no terminal. Precisa de chave SSH na conexão.",
      "Corrigido: os apps instalados (PWA) mostravam anúncios no YouTube. Agora eles têm o mesmo bloqueador do navegador, no Windows e no Mac.",
      "Corrigido: o modo voz do terminal podia não transcrever. Ele tenta outro modelo do Whisper quando a Groq recusa o primeiro, avisa quando o microfone não capta som e mostra o motivo exato quando algo falha.",
    ],
  },
  {
    version: "4.9.6",
    date: "2026-10-13",
    items: [
      "Corrigido: colar print no terminal não fazia nada (Ctrl+V no Windows, ⌘V no Mac, Ctrl+Shift+V no Linux). Agora a imagem vira um PNG temporário e o caminho entra no terminal, pronto para o Claude Code ou o Codex anexarem.",
    ],
  },
  {
    version: "4.9.5",
    date: "2026-10-13",
    items: [
      "Corrigido: a janela de vídeo flutuante ficava preta quando diminuída no YouTube (abaixo de certa largura o site muda o player de lugar na página).",
      "Novo: cole prints no terminal (Ctrl+V no Windows, ⌘V no Mac, Ctrl+Shift+V no Linux). A imagem vira um PNG temporário e o caminho entra no terminal, pronto para o Claude Code ou o Codex anexarem.",
    ],
  },
  {
    version: "4.9.4",
    date: "2026-10-13",
    items: [
      "Corrigido: na janela de vídeo flutuante (Picture-in-Picture), o título do vídeo, o nome do canal e os botões do YouTube não aparecem mais por cima ou abaixo do vídeo ao redimensionar a janela; as sobras ficam em preto.",
    ],
  },
  {
    version: "4.9.3",
    date: "2026-10-13",
    items: [
      "Corrigido: na janela de vídeo flutuante (Picture-in-Picture), corrigido travamento no redimensionamento que fazia a janela expandir descontroladamente até quase cobrir a tela e impedia diminuir o tamanho.",
      "Redimensionamento suave e livre: a janela agora diminui suavemente até o tamanho mínimo (240×135) ou expande sem travar nas bordas, e descarta dimensões gigantes salvas anteriormente.",
    ],
  },
  {
    version: "4.9.2",
    date: "2026-10-13",
    items: [
      "Corrigido: na janela de vídeo flutuante (Picture-in-Picture com controles), ao redimensionar a janela o vídeo agora sempre ocupa 100% da tela em qualquer proporção e tamanho (Windows, Linux e Mac), sem vazar elementos da página abaixo nem sofrer deslocamento por scripts do player (como no YouTube).",
      "Corrigido: ícone dos apps instalados (PWA) aparecia como o ícone do Agzos no Windows em vez do ícone real do site (YouTube, WhatsApp, etc.). A busca do ícone agora usa a pilha de rede do Chromium diretamente, que funciona de forma confiável no Windows.",
      "Novo: em Configurações → Apps instalados, clique no lápis ao lado de qualquer app para editar o nome exibido e o ícone (por URL). Os atalhos do sistema são recriados automaticamente.",
    ],
  },
  {
    version: "4.9.1",
    date: "2026-10-12",
    items: [
      "Picture-in-Picture com controles também nos apps instalados (YouTube, por exemplo): o botão da barra do app, Ctrl+Shift+P e o minimizar com vídeo tocando abrem a janela de vídeo com volume, velocidade, ±10 s e qualidade.",
      "Ao voltar para o app (ou restaurar a janela dele), o vídeo volta junto, sem recarregar.",
      "A escolha entre o Picture-in-Picture com controles e o simples, em Configurações → Aparência, agora vale também para os apps.",
    ],
  },
  {
    version: "4.9.0",
    date: "2026-10-12",
    items: [
      "Picture-in-Picture com controles: o vídeo vai para uma janela flutuante do Agzos, sempre por cima, com play e pausa, voltar e avançar 10 segundos, barra de tempo, volume, velocidade (0,5× a 2×) e qualidade (no YouTube).",
      "Os controles aparecem ao passar o mouse e somem sozinhos. Também dá pelo teclado: Espaço pausa, ← e → andam 10 segundos, ↑ e ↓ mudam o volume, M tira o som e Esc devolve o vídeo à guia.",
      'O vídeo não recarrega ao ir para a janela nem ao voltar. Enquanto ele está fora, a guia mostra o aviso com "Trazer de volta"; o × fecha pausando.',
      'Prefere o Picture-in-Picture simples do Chromium? Desligue "Picture-in-Picture com controles" em Configurações → Aparência. Os apps instalados continuam com o simples nesta versão.',
    ],
  },
  {
    version: "4.8.8",
    date: "2026-10-12",
    items: [
      "Windows: a busca por atualizações não falha mais com net::ERR_FAILED. Se o caminho normal falhar, o Agzos tenta de novo por outro e o pacote continua conferido.",
      "Windows: os apps instalados usam o ícone do site na janela e na barra de tarefas, também os que foram instalados antes desta versão.",
      "Windows e Linux: a barra dos apps instalados deixa livre o espaço dos botões de minimizar, maximizar e fechar, então o menu ⋮ e o Picture-in-Picture não ficam mais por baixo deles.",
      "O aviso de atualização que não foi instalada some quando o Agzos já está nessa versão ou numa mais nova.",
    ],
  },
  {
    version: "4.8.7",
    date: "2026-10-12",
    items: [
      "Mac: os botões da barra dos apps instalados (Picture-in-Picture, menu ⋮, voltar, recarregar) voltaram a responder ao clique.",
      "Mac: criar o app próprio de um PWA não pede mais senha de chaveiro. Depois de uma atualização, o macOS pode perguntar uma vez se o app pode acessar as Chaves; é só clicar em Permitir.",
      "Quando o app próprio fica pronto depois de uma falha, o Agzos já passa a abri-lo sem precisar reiniciar o navegador.",
    ],
  },
  {
    version: "4.8.6",
    date: "2026-10-12",
    items: [
      "Uma barra só nos apps instalados: a barra do app agora é a própria barra de título, sem a faixa repetindo o nome da página em cima. No Mac os botões de fechar, minimizar e maximizar ficam nela, à esquerda; no Windows e no Linux ficam à direita, com a cor do app.",
      "Mac: um app instalado que tinha voltado a abrir como janela do navegador volta a ser um app próprio, com ícone no Dock. O Agzos monta o app que estiver faltando ao abrir e, se não conseguir, mostra o motivo em vez de abrir no navegador sem avisar.",
    ],
  },
  {
    version: "4.8.5",
    date: "2026-10-12",
    items: [
      "Apps instalados (PWA) com as funções do navegador: uma barra fina no topo traz voltar, avançar, recarregar, Picture-in-Picture e o menu ⋮ com copiar URL, abrir no Agzos, zoom, localizar na página (Ctrl+F), imprimir, tela cheia, ferramentas do desenvolvedor e as permissões do app. A barra usa a cor do app e some em tela cheia.",
      "Picture-in-Picture nos apps: pelo botão da barra, por Ctrl+Shift+P ou pelo clique direito no vídeo. Ao minimizar um app com vídeo tocando (YouTube, por exemplo), o vídeo continua numa janela flutuante; dá para desligar no menu ⋮.",
      "Chamadas de vídeo funcionando: no Mac, câmera e microfone agora pedem a permissão do sistema (antes o Meet ficava sem câmera). Se o macOS tiver bloqueado, o Agzos avisa e abre o Ajuste certo.",
      "Compartilhar tela no Meet, Teams, Zoom, Discord e afins, nas guias e nos apps: escolha a tela inteira ou uma janela. No Windows o áudio do sistema pode ir junto; no Mac 15 ou mais novo aparece o seletor do próprio sistema.",
      "Permissão bloqueada por engano num app? O menu ⋮ → Permissões mostra câmera, microfone, notificações, localização e área de transferência, cada uma com Perguntar, Permitir ou Bloquear.",
    ],
  },
  {
    version: "4.8.4",
    date: "2026-10-09",
    items: [
      "Windows com instalador de verdade: o novo instalador coloca o Agzos em Programas e Recursos (dá para desinstalar por lá), cria os atalhos na Área de trabalho e no menu Iniciar e não pede administrador. As atualizações continuam chegando sozinhas, e a versão mostrada em Programas e Recursos acompanha cada uma.",
      "Instalar não apaga nada: login, abas, cache e configurações continuam onde estão, e a cópia portátil que você já usa fica intacta. Desinstalar também mantém o perfil.",
      "Mac: o app agora vem assinado sempre com o mesmo certificado. Depois de clicar em “Permitir sempre” no pedido de senha das Chaves, ele não volta a cada atualização. As atualizações só são instaladas se o app novo vier com essa mesma assinatura.",
      "Os apps instalados (PWA) no Mac também passam a ser assinados com esse certificado quando ele está nas suas Chaves; sem ele, o Agzos avisa ao instalar.",
    ],
  },
  {
    version: "4.8.3",
    date: "2026-10-09",
    items: [
      "No Mac, cada app instalado (PWA) agora é um aplicativo de verdade: tem o próprio ícone e nome no Dock, aparece separado no ⌘Tab e no Mission Control, e continua aberto quando você fecha o navegador. Antes ele abria como mais uma janela do Agzos, com o ícone do navegador.",
      "Os apps que você já tinha são convertidos sozinhos na primeira vez que o navegador abre nesta versão, e o login de cada um vem junto. Links para fora do app continuam abrindo numa guia do Agzos.",
      "Dá para voltar ao jeito antigo em Configurações → Apps instalados → “Cada app com ícone próprio no Dock”. No Windows e no Linux nada muda.",
    ],
  },
  {
    version: "4.8.2",
    date: "2026-10-08",
    items: [
      "DevTools mais compacto: o espaço vazio que ele reservava ao lado do painel sumiu. Com o dock estreito, o Styles fica embaixo do Elements, e a divisão entre os dois pode ser arrastada.",
      "Modo dispositivo como no Chrome: ao ligar (botão de celular no dock, no próprio DevTools ou Ctrl+Shift+M dentro dele), a área da página vira a tela de teste, com a barra de dimensões em cima e o celular ou tablet centralizado no tamanho real. Antes a página ficava espremida num canto com o resto preto. Desligando, tudo volta ao normal e o login do Google continua funcionando.",
    ],
  },
  {
    version: "4.8.1",
    date: "2026-10-08",
    items: [
      "DevTools do Chromium dentro da janela: F12 ou Ctrl+Shift+I abre o DevTools encaixado à direita ou embaixo da página (ou numa janela separada), e Ctrl+Shift+J vai direto ao Console. A página encolhe para dar espaço, como nos painéis laterais. O lado e o tamanho ficam gravados por workspace, e cada guia tem o seu DevTools.",
      "Integrado ao que já existia: com o DevTools aberto, Ctrl+Shift+C seleciona o elemento nele; fechado, continua sendo a mira de cores e Tailwind, que ganhou o botão “Abrir no DevTools”. O clique direito → Inspecionar abre direto no elemento, e a aba Terminal do dock mostra o terminal da janela com as mesmas sessões. Também está nas Ferramentas e na busca de comandos (Ctrl+K), incluindo o modo dispositivo.",
      "Guia com o DevTools aberto não hiberna, e sair do modo dispositivo devolve a identidade do Chrome à página (o login do Google continua funcionando). Dá para desligar o DevTools em Configurações → Recursos → DevTools.",
    ],
  },
  {
    version: "4.8.0",
    date: "2026-10-08",
    items: [
      "Base do DevTools e do novo motor de impressão: o app agora mede o que esta versão do Chromium suporta (PDF com tags e sumário para leitores de tela, comandos do depurador nas guias) e guarda o resultado no perfil. É o que permite ligar o DevTools integrado e a impressão da página inteira nas próximas versões sem depender de suposições.",
      "Recursos novos podem ser ligados ou desligados um a um (DevTools, proteção de impressão, captura por rolagem, Copilot de depuração, Rewind e modo quiosque). DevTools e proteção de impressão já nascem ligados; os demais ficam desligados até ficarem prontos.",
    ],
  },
  {
    version: "4.7.2",
    date: "2026-10-04",
    items: [
      "Vídeo em Picture-in-Picture não some mais com a barra lateral. No Mac, levar um vídeo da tela cheia para o PiP deixava o navegador achando que a página continuava em tela cheia: a barra lateral e as barras sumiam e a página ficava por cima de tudo. Agora a própria página avisa quando sai da tela cheia, e sair da tela cheia da janela também devolve o layout.",
      "O atalho de um PWA traz o app para a frente. No Mac, com o navegador já aberto, a janela do app nascia atrás das outras e o que aparecia era o navegador; agora o Agzos é ativado e a janela do app vem para a frente.",
    ],
  },
  {
    version: "4.7.1",
    date: "2026-10-04",
    items: [
      "Vídeo em Picture-in-Picture não trava mais a janela. A cada minuto o app conferia, em cada aba, se havia vídeo em PiP, chamando a página um frame por vez; isso segurava o navegador inteiro e a barra lateral, a barra de guias e a navegação travavam. Agora a própria página avisa quando o vídeo entra e sai do PiP, então nada é perguntado a ela — e a Guia em PiP também não hiberna mais sozinha, o que fechava a janela flutuante. Vale para o PiP ligado pelo botão do site, não só pelo atalho do app.",
      "O atalho de um PWA instalado abre o app de verdade. O clique no ícone chegava ao navegador já aberto e, às vezes, virava só mais uma janela do navegador. O aviso de segunda instância agora é registrado antes do app terminar de abrir e espera a hora de abrir a janela do PWA.",
      "No Mac, o app de um PWA ganhou ícone e presença próprias. Ele era gravado como aplicativo acessório e não aparecia no Dock, o que dava a impressão de que o site continuava preso ao navegador.",
      "Terminal solto não fica mais grudado na frente de tudo. A janela flutuante nascia sempre por cima — inclusive sobre as abas, o menu ⋯ e o que aparecesse acima. Agora é uma janela normal: ela vai para trás do navegador quando você mexe numa aba e só vem para a frente quando você clica nela. Continua do mesmo jeito para lembrar posição e tamanho.",
    ],
  },
  {
    version: "4.7.0",
    date: "2026-10-04",
    items: [
      "Gerenciador de downloads (Ctrl+J): lista com nome, situação, progresso, tamanho e pasta; filtros (em andamento, pausados, concluídos, falhos, tipo e etiqueta) e busca no histórico por nome, endereço, site ou etiqueta. Pausar, retomar (com Range quando o servidor aceita), reiniciar, cancelar, abrir a pasta, mudar o destino de um item, etiquetar e exportar a seleção em JSON ou CSV. Pelo teclado: Espaço, Delete, Shift+Delete, R, F e Enter.",
      "Pastas e regras: pasta padrão, “organizar por tipo” (PDF, imagens, vídeos, áudio e compactados em pastas próprias) e regras por tipo, site (etiqueta) ou nome (subpasta), em Configurações → Recursos. Tudo vale em todas as janelas e fica no perfil.",
      "Tema da página por site: a lua na barra de endereço liga o Dark só naquele site (sol volta ao Lightning), sem recarregar, e o app lembra. Fotos, vídeos, canvas, iframes e logos ficam como estão; trechos que perderiam contraste voltam ao original. Atalho Alt+Shift+D.",
      "ColorTools (conta-gotas na barra): pegue a cor de qualquer ponto da página com lupa e HEX/RGB/HSL ao vivo (Alt+Shift+C), analise as cores da página, monte gradientes lineares ou radiais e copie o CSS, salve paletas e veja o histórico, com busca e cores fixadas. No clique direito: copiar cor do pixel, analisar a página e abrir o gerador de gradiente.",
      "PDF Tools (agzos://pdf, Ctrl+Alt+P): editar (texto, imagem, formas, marca-texto, comentário, assinatura desenhada e marca-d'água), organizar, juntar, dividir, girar, recortar, comprimir (fraca, equilibrada ou forte, com antes e depois), senha AES-256, formulários, OCR local em português, inglês e espanhol, PDF para imagens ou texto e, com o LibreOffice instalado, Word para PDF e PDF para Word. Tudo neste computador.",
      "PDFs abrem na guia, como no Chrome, e um ícone PDF na barra de endereço leva o documento ao PDF Tools (também pelo clique direito no link e pelo gerenciador de downloads). Resumo com IA e salvar na nuvem ficam desligados até você ligar, e pedem confirmação a cada arquivo.",
    ],
  },
  {
    version: "4.6.2",
    date: "2026-10-04",
    items: [
      "Conteúdo protegido no Windows e no macOS: o app agora sai com a assinatura VMP da castLabs, que a Netflix, o Disney+, o Prime Video e o Max exigem além do Widevine. No Linux esses serviços já tocavam.",
    ],
  },
  {
    version: "4.6.1",
    date: "2026-10-04",
    items: [
      "Instalar da Chrome Web Store funciona: cole o link da loja (ou o id) em Configurações → Extensões. O app baixava o pacote mas gravava a chave do Google em vez da do autor, e toda extensão da loja ficava com o mesmo id (uma tomava o lugar da outra). As que já estavam instaladas são corrigidas sozinhas na próxima abertura.",
      "Erros de verdade: id que a loja não tem, pacote sem a assinatura do autor (CRX_REQUIRED_PROOF_MISSING) ou sem conexão aparecem como erro; nada finge que instalou.",
      "Atualizações: o app consulta a loja (update_url do manifest) e mostra uma badge no quebra-cabeça. Atualizar é com você, pelo menu da extensão ou em Configurações; nada muda sozinho no meio da sessão.",
      "Pop-up que não encolhe: cada abertura cria uma janela nova, medida depois do load e de novo enquanto a página monta. Trocar de extensão fecha a anterior; nada de faixa pequena herdada, e o pop-up nunca passa da tela.",
      "O clique segue o manifest: pop-up quando tem, side_panel no painel lateral do navegador, só opções abre as opções, e extensão só de fundo mostra que está ativa (no menu dela, sem janela vazia). O menu só traz o que a extensão tem. Manifest V2 também carrega.",
      "Dicas da barra pelo app: “Downloads (Ctrl+J)” e as outras aparecem inteiras e dentro da janela, com o atalho no jeito do sistema (Ctrl+ no Windows e Linux, ⌘ no Mac).",
    ],
  },
  {
    version: "4.6.0",
    date: "2026-10-04",
    items: [
      "Extensões como no Chrome e no Edge: o quebra-cabeça da barra abre um pop-up (não uma guia) com as extensões instaladas, ícone, nome e o acesso resumido. Clique abre o pop-up da extensão ancorado no ícone; o alfinete fixa o ícone na barra; o “…” ou o clique direito trazem acesso a este site, opções, fixar, permissões, gerenciar, inspecionar pop-up e remover (com confirmação).",
      "Acesso por site: “Nenhum acesso a este site” tira os scripts da extensão daquele site (a extensão recarrega na hora).",
      "Modo leitura num caderno dentro da barra de URL: ele só aparece quando a página tem um artigo para ler, e o clique liga e desliga, sem abrir página nova.",
      "As ferramentas (Session Tab, Scratchpad, mira, captura, leitura, notas, extensões) ficam só no item “Ferramentas” da barra lateral, num menu com o visual do app (vidro, tema escuro ou claro e a cor de acento). A página inicial e o Discador ficam só com a busca e os seus atalhos.",
      "Barra lateral redimensionável: arraste a borda para deixar mais estreita (só ícones) ou mais larga (ícone e nome lado a lado); os ícones e os textos se ajustam. Duplo clique na borda volta ao tamanho padrão.",
    ],
  },
  {
    version: "4.5.1",
    date: "2026-10-03",
    items: [
      "As ferramentas da 4.5 agora estão à vista: uma grade “Ferramentas” na página inicial e no Discador (Nova Session Tab, Portas em uso, API Scratchpad, Mira de elemento, Capturar tela, Modo leitura, Notas e Extensões) e dois botões novos na barra: Ferramentas (chave inglesa) e Extensões (quebra-cabeça), que lista as extensões ligadas para abrir.",
      "Botão de Session Tab ao lado do botão de guia anônima, e as Session Tabs ganharam fundo na cor da sessão.",
      "Painel lateral: o botão “Tela toda” (e “Recolher”) agora tem nome e fica no cabeçalho do painel.",
      "Mira de elemento: avisa quando liga, desliga ou quando a guia não é um site; pela grade, liga na guia do site aberto. Modo leitura também explica quando não dá.",
      "Correção: sites sem cor de fundo voltam a aparecer brancos (como no Chrome) com o tema escuro. No painel de portas, os projetos de código vêm primeiro e a URL do túnel aparece inteira.",
    ],
  },
  {
    version: "4.5.0",
    date: "2026-10-03",
    items: [
      "Session Tabs (Ctrl+Alt+N): cada uma tem cookies e localStorage só dela e uma cor própria. Dá para deixar o mesmo site aberto três vezes, lado a lado, com logins diferentes (admin, corretor, cliente), sem a sessão vazar entre elas nem para a guia normal. Links e duplicatas ficam na mesma sessão.",
      "Painel de portas na barra lateral: o que está escutando no PC (3000, 5432…), com processo, PID e, quando dá, o projeto. Matar o processo pede confirmação. “Expor porta” abre um túnel HTTPS do Cloudflare (precisa do cloudflared instalado) e já copia a URL pública; o túnel fecha pelo botão ou ao fechar o painel.",
      "API Scratchpad (agzos://scratchpad ou o menu da página): captura as requisições de uma guia, manda uma para o editor, muda método, URL, headers ou body e reenvia, vendo status, tempo e resposta.",
      "Mira de elemento (Ctrl+Shift+C): clique num elemento e veja as cores em HEX, a fonte e uma sugestão de classes Tailwind para copiar, sem abrir o DevTools. É sugestão a partir do estilo calculado, não o CSS original do site.",
      "Extensões Manifest V3: carregue uma pasta descompactada ou instale pelo link da Chrome Web Store (quando o Chromium do app dá conta da extensão). Ligue, desligue, recarregue e remova em Configurações → Extensões.",
      "O app passa a trazer o módulo Widevine oficial do Google para conteúdo protegido (Spotify, Netflix e afins), só para reproduzir: nada é gravado nem extraído. O estado do módulo aparece em Configurações → Extensões.",
      "Captura de tela (Ctrl+Shift+S): a guia, a janela do app ou uma região, para copiar ou salvar em PNG. Modo leitura (Ctrl+Alt+R): o artigo com letra grande e sem o menu do site. Notas por página (Ctrl+Shift+M), em markdown simples, guardadas neste computador. E “Salvar imagem já carregada” no menu da imagem grava o que a página já baixou.",
      "Expandir um atalho da barra lateral agora leva o painel para a tela toda e fecha o painel menor; recolher volta só o menor. O tema escuro passa a ser o padrão, com tema claro e cor de acento (padrão #D10A11) em Configurações → Aparência.",
    ],
  },
  {
    version: "4.1.3",
    date: "2026-10-03",
    items: [
      "Agzos AI de cara nova, no estilo do Claude: barra lateral com Novo (Ctrl+N com o foco no painel), busca, projetos (criar, renomear, arquivar), conversas recentes com título editável, artifacts e personalização; várias conversas abertas em guias; composer fixo no rodapé com o projeto da conversa.",
      "Respostas em markdown de verdade, chegando aos pedaços: títulos, listas, tabelas, citações, links e blocos de código com copiar. Código, HTML e SVG abrem ao lado do chat, com prévia isolada.",
      "Personalização do Agzos AI: instruções que valem em toda conversa e o modelo padrão (o Automático agora prefere o gpt oss 120b). O contexto da aba continua indo só quando você marca a caixa, e só naquela mensagem.",
      "Instalar sites como app funciona em muito mais lugares: o service worker deixou de ser exigido (como no Chrome) e o manifesto é lido pelo próprio Chromium, inclusive quando o site o coloca depois de carregar (Grok, Gemini, Canva). Se o ícone não aparecer, use Configurações → Apps instalados → Tentar instalar este site como app.",
    ],
  },
  {
    version: "4.1.2",
    date: "2026-10-03",
    items: [
      "Correção da 4.1.1: arquivos abertos direto do sistema — duplo clique, “Abrir com” no Explorer, no Finder ou no gerenciador de arquivos, ou arrastar para o ícone — agora abrem numa guia do navegador, mesmo com ele já aberto (antes só o Ctrl+O funcionava).",
    ],
  },
  {
    version: "4.1.1",
    date: "2026-10-03",
    items: [
      "Instale sites como apps: quando a página tem manifesto e service worker, aparece o ícone de instalar na barra de endereço. O app abre em janela própria, sem a barra de guias, ganha ícone no menu Iniciar, no Dock (Aplicativos › Agzos Apps) ou no menu de aplicativos, e tem login, zoom e permissões separados da guia normal. Desinstale em Configurações → Apps instalados ou pelo menu do próprio app.",
      "Abra qualquer arquivo no navegador: Ctrl+O (⌘O), digitando o caminho na barra de endereço ou pelo terminal. HTML, SVG, PDF, vídeo e áudio abrem direto; código e texto viram uma página de leitura com números de linha; os outros tipos mostram os detalhes e o botão para abrir no app do sistema.",
      "Visualizador de imagens completo: zoom no cursor, arrastar, girar, espelhar, brilho, contraste, saturação, fundo escuro, claro ou xadrez, informações e tela cheia. No modo Canvas você desenha, marca, faz retângulos, setas e textos e exporta a imagem anotada em PNG.",
      "Terminal com abas que você renomeia (duplo clique ou F2) e um painel lateral: o modo ls (Ctrl+Shift+O) navega pelas pastas e, ao escolher uma, abre ela no terminal; os snippets rodam ou só digitam comandos; as skills do Claude Code, Codex, OpenCode e Gemini entram no prompt com um clique, e dá para criar uma skill nova.",
      "Modo agente (Ctrl+Shift+G): um canvas de nós ligados, no estilo do ComfyUI. Descreva um objetivo e a IA monta as etapas com os agentes (Claude Code, Codex, OpenCode, Gemini, Kiro ou a própria Groq); cada etapa roda numa aba do terminal, as independentes em paralelo, e a saída de uma segue para a próxima.",
      "Na primeira abertura, o terminal oferece instalar as CLIs de IA (Claude Code, Codex, Kiro CLI, OpenCode, Gemini CLI, Freebuff) no Windows, macOS e Linux, numa aba à vista, e põe as pastas delas no PATH. Também pelo lançador: Instalar CLIs de IA.",
    ],
  },
  {
    version: "4.1.0",
    date: "2026-10-03",
    items: [
      "Terminal onde você quiser: embaixo da página, à direita dela ou numa janela flutuante sempre por cima (PiP). Arraste a borda para redimensionar; trocar de lugar não fecha as sessões nem apaga o que estava na tela.",
      "Aparência do terminal em Configurações → Terminal: temas prontos (Agzos, Claro, Dracula, Solarized, Monokai, Meia-noite), cor de fundo, do texto e do cursor, fonte, tamanho e formato do cursor.",
      "Modo voz: aperte o microfone (ou Ctrl+Shift+M), fale o comando e o texto transcrito pelo Whisper da Groq aparece no prompt — usa a mesma chave do Agzos AI.",
      "Lançador (Ctrl+Shift+K) com Claude Code, OpenCode, Kiro, Antigravity, Freebuff, Codex e Gemini CLI, suas conexões SSH e comandos rápidos. As chaves de API dessas ferramentas ficam cifradas e entram só no ambiente do terminal.",
      "SSH: veja as chaves de ~/.ssh, gere uma ed25519 nova, copie a chave pública e salve conexões que abrem com um clique.",
      "Aliases que funcionam no bash, zsh, PowerShell e cmd, e atalhos novos: Ctrl+Shift+E nova sessão, Ctrl+Shift+W fecha, Ctrl+Shift+←/→ troca de sessão e Ctrl +/−/0 muda a fonte.",
    ],
  },
  {
    version: "4.0.0",
    date: "2026-10-03",
    items: [
      "Agzos AI de verdade, com a Groq: na primeira abertura o painel pede a sua chave da API (num campo mascarado) e a guarda cifrada pelo cofre do sistema — ela nunca volta para a tela. As respostas chegam em tempo real, dá para escolher o modelo e a conversa fica salva no computador até você apagar.",
      "Contexto só quando você quer: marque “Enviar contexto da aba” para mandar o endereço, o título e o texto selecionado junto com aquela pergunta. Abra e feche a IA com Ctrl+Shift+A (⌘⇧A no Mac) ou pelo menu ⋯.",
      "Gestos: deslize dois dedos no trackpad para voltar e avançar, faça pinça para dar zoom só na página ou no painel sob o cursor, use os botões laterais do mouse e desenhe gestos com o botão direito segurado (← voltar, → avançar, ↑↓ recarregar, ↓ nova guia, ↓→ fechar guia). Em Configurações → Gestos você liga, desliga e troca a ação de cada um.",
      "Terminal de verdade embaixo da página (Ctrl+Alt+T): PowerShell, PowerShell 7 ou Prompt de Comando no Windows, zsh ou bash no macOS, com abas de sessão, cores, Ctrl+C, copiar e colar. Cada aba volta na última pasta usada.",
      "Vídeos mais leves: o navegador agora força a aceleração pela placa de vídeo, inclusive em GPUs integradas como a Intel UHD, e decodifica o vídeo nela — YouTube em 1080p sem engasgar e com menos CPU. Se a sua placa der problema, o Agzos volta sozinho ao modo padrão; dá para desligar em Configurações → Desempenho.",
    ],
  },
  {
    version: "3.1.1",
    date: "2026-10-02",
    items: [
      "Barra lateral mais limpa: a rolagem ficou fina e quase invisível, sem setas no rodapé. Quando os apps não cabem na altura da janela, o último lugar vira o botão Mais, que abre uma caixinha com os outros apps.",
      "Novo modal para adicionar sites, o mesmo no Discador e no Adicionar da página inicial: nome, endereço, categoria e a prévia do card com o logo do site, que vem sozinho. No Discador, os cards mostram a categoria e dá para filtrar por ela.",
      "Sons opcionais: um tick discreto ao passar o mouse na barra lateral e nos cards do Discador, e um som de tecla ao digitar na busca, na barra de endereço e nos modais. Em Configurações → Sons você liga ou desliga cada um, escolhe entre três ticks de teclado e ajusta o volume.",
      "Cada painel da barra lateral tem o seu zoom (Ctrl + roda do mouse ou Ctrl +/−/0 com o foco nele) e a sua largura, guardados mesmo depois de fechar o navegador — sem mudar o zoom das guias do mesmo site nem o dos outros painéis.",
      "A alça do painel lateral agora aumenta a largura também, até onde a janela permitir.",
      "Discord e outros apps da barra lateral continuam logados depois de fechar e abrir o navegador: as páginas dos painéis são encerradas direito antes de sair, e o armazenamento é gravado.",
      "Início e Discador: a página aberta fica marcada no seletor do topo.",
    ],
  },
  {
    version: "3.0.0",
    date: "2026-10-02",
    items: [
      "GX Control: um painel no topo da barra lateral com medidores de CPU e memória, limitador de RAM (hiberna as guias mais pesadas acima do teto), limitador de CPU (desacelera as guias em segundo plano) e limitador de rede para download e upload.",
      "Hot Tabs Killer: veja quanto de CPU e memória cada guia usa, ordene pelas mais pesadas e encerre a guia num clique. O mesmo painel testa a velocidade da internet e limpa o cache sem tirar você das suas contas.",
      "Discador: uma página nova ao lado do Início, com uma grade de sites com logo. Pesquise nos seus sites ou na web, adicione sites com o +, arraste os cards para reordenar e clique para abrir na mesma guia.",
      "Barra lateral maior: além de WhatsApp, Telegram, Messenger, Instagram, Discord, X, Gmail e ChatGPT, agora tem Claude, Gemini, Duck.ai, TikTok, Kwai, YouTube, LinkedIn, Reddit, Spotify, Deezer e Pinterest — cada um com logo e nome. Dá para ocultar a barra nas Configurações.",
      "Os atalhos da página inicial agora mostram o logo de cada site no lugar da inicial.",
    ],
  },
  {
    version: "2.2.8",
    date: "2026-10-02",
    items: [
      "Barra de endereço: a chave do Agzos Key, a estrela e o link agora ficam juntos na ponta direita, sempre no mesmo lugar e com o mesmo espaçamento — os ajustes do site e a proteção aparecem à esquerda deles ao passar o mouse.",
      "Correção: com uma pasta de favoritos aberta, passar o mouse nas outras pastas troca o menu de verdade, em qualquer sistema, sem precisar clicar.",
      "Agzos Key: Preencher agora leva o foco para a página (é só apertar Enter), funciona também em logins feitos com web components e, quando a página não tem formulário de login à vista, avisa no próprio popup em vez de fechar sem fazer nada.",
      "Voltando a uma página de login, o Agzos Key sugere o preenchimento de novo, e o popup da chave fecha ao trocar de página.",
    ],
  },
  {
    version: "2.2.7",
    date: "2026-10-02",
    items: [
      "Favoritos da barra (e das pastas) agora sempre abrem numa guia nova — a página que você está vendo não é mais substituída.",
      "Com uma pasta de favoritos aberta, basta passar o mouse nas outras pastas para ir abrindo cada uma, com uma transição suave.",
      "Agzos Key mais confiável nas páginas de login: ao clicar no campo de usuário ou senha ele já busca no cofre e sugere o preenchimento (ou pede para desbloquear), inclusive em sites que montam o login aos poucos ou em etapas.",
      "Logins com Authenticator: depois de preencher, a barrinha do Key abre com o código de verificação, sem cobrir a página. Use a tachinha para deixá-la fixa enquanto copia e cola; o botão Preencher põe o código direto no campo.",
      "Chave do Agzos Key na barra de endereço: mostra os logins do site, busca no cofre e salva um login novo em um clique, já com o que você digitou na página.",
      "O navegador agora guarda no cofre a URL do site quando um login sem endereço é usado, e o sincroniza com o Agzos Key.",
    ],
  },
  {
    version: "2.2.6",
    date: "2026-10-01",
    items: [
      "Correção: as pastas e o histórico do Agzos Key não aparecem mais como credenciais vazias no painel de senhas, e o navegador não consegue mais apagá-los — antes, apagar esses itens fazia as pastas sumirem do Agzos Key em todos os dispositivos.",
      "As senhas agora aparecem agrupadas pelo nome da pasta em que estão no Agzos Key.",
    ],
  },
  {
    version: "2.2.5",
    date: "2026-10-01",
    items: [
      'As pastas da barra de favoritos voltaram ao menu de vidro (transparência, cantos arredondados, subpastas e "Abrir todos") — agora sempre por cima da página do site.',
    ],
  },
  {
    version: "2.2.4",
    date: "2026-10-01",
    items: [
      'Correção: as pastas da barra de favoritos abriam o menu atrás da página do site. Agora o menu da pasta (com subpastas e "Abrir todos") aparece sempre por cima.',
    ],
  },
  {
    version: "2.2.3",
    date: "2026-10-01",
    items: [
      "Correção: contas do Agzos Key protegidas com Argon2id voltam a desbloquear com a senha mestra correta — o navegador agora deriva a chave com os mesmos parâmetros do Agzos Key e, como ele, tenta a outra proteção quando o cofre está rotulado diferente.",
      "O desbloqueio dessas contas roda em segundo plano, sem travar as janelas enquanto a senha é verificada.",
      'Correção: o popup "Entrar com o Agzos Key" ficava escondido atrás da página; agora sobe por cima do site, como os outros painéis, sem tirar o foco do que você está digitando.',
    ],
  },
  {
    version: "2.2.2",
    date: "2026-10-01",
    items: [
      "Correção: as credenciais sincronizadas não somem mais depois de entrar — o cofre inteiro é recarregado a cada abertura, em vez de só as mudanças recentes.",
      "Correção: o desbloqueio agora respeita a proteção (KDF) de cada conta do Agzos Key — PBKDF2 ou Argon2id, com os parâmetros do próprio cofre —, então a senha mestra correta deixa de ser recusada.",
    ],
  },
  {
    version: "2.2.1",
    date: "2026-10-01",
    items: [
      "Correção: quando mais de uma pessoa usava o Agzos Key no mesmo computador, a senha mestra correta de outra conta era recusada. Agora cada conta desbloqueia o seu cofre normalmente.",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-10-01",
    items: [
      "Senhas como nos navegadores principais: ao digitar um login e senha num site, o navegador pergunta se quer salvar no Agzos Key e sincroniza com o seu cofre cifrado.",
      "Autofill: quando o site aberto tem uma credencial no cofre, sobe um popup para copiar e-mail e senha ou preencher e entrar com um clique.",
      "MFA no navegador: as credenciais com verificação em duas etapas mostram o código TOTP atual (com contagem regressiva) e copiam na hora, igual ao Agzos Key.",
      "Cofre organizado por categorias (Pessoal, Trabalho, Finanças…): crie as suas, filtre por categoria e recolha os grupos; cada credencial agora tem favorito, categoria e chave MFA no cadastro.",
      "Barra de favoritos sempre acima da página: antes ela sumia atrás do site quando você saía da aba inicial — corrigido na web e no app.",
    ],
  },
  {
    version: "2.1.0",
    date: "2026-10-01",
    items: [
      "Agzos Key conectado de verdade: pareie o navegador com o seu cofre por um código, desbloqueie com a senha mestra e veja suas credenciais sincronizadas e cifradas de ponta a ponta (a senha mestra e as chaves nunca saem do seu dispositivo).",
      "Modo escuro com vidro de verdade: os menus e painéis translúcidos agora respeitam o tema escuro, sem mais fundo branco.",
      "Escolha a cor de destaque da interface na roda de cores (Configurações > Personalização), e ela vale também nos menus.",
      "Menu de favoritos corrigido: o clique direito numa pasta abre o menu de editar/renomear sem conflitar com a lista da pasta.",
    ],
  },
  {
    version: "2.0.1",
    date: "2026-10-01",
    items: ["Melhorias visuais e de estabilidade (transparência, cores de destaque e atalhos)."],
  },
  {
    version: "2.0.0",
    date: "2026-10-05",
    items: [
      "Workspaces: separe as guias por assunto (Pessoal, Trabalho, Estudos…) e troque com um clique no começo da barra de guias.",
      "Grupos de guias com nome e cor: clique direito na guia → Adicionar guia a novo grupo (Ctrl+Shift+G); clique no grupo para recolher.",
      "Tela dividida: duas páginas lado a lado (Ctrl+Alt+Shift+S ou clique direito na guia); arraste a divisória para ajustar.",
      "Painéis laterais com WhatsApp, Telegram, Messenger e Instagram ao lado da página (escolha outros no +).",
      "Busca de comandos (Ctrl+K): ache qualquer comando, guia, workspace ou favorito digitando.",
      "Barra de endereço: o primeiro clique seleciona o endereço todo; o ícone de link copia o endereço, e favorito, ajustes do site e proteção aparecem ao pausar o mouse.",
      "Personalização: escolha uma nova cor de acento para a interface, papel de parede na aba inicial e efeito de desfoque translúcido nos painéis (Configurações > Personalização).",
    ],
  },
  {
    version: "1.5.5",
    date: "2026-10-04",
    items: [
      "Com um menu aberto, clicar fora fecha o menu e o clique já vale (link, guia ou botão), como no Comet.",
    ],
  },
  {
    version: "1.5.4",
    date: "2026-10-03",
    items: [
      "Menus da toolbar não congelam mais o vídeo da página: o menu ⋯, downloads, proteção, site, favorito e cofre abrem por cima e a página continua viva.",
      "Com um menu aberto, a rolagem fora dele rola a página; clicar fora ou Esc fecham.",
    ],
  },
  {
    version: "1.5.3",
    date: "2026-10-02",
    items: [
      "Ctrl+Tab: soltar o Ctrl confirma a guia escolhida sempre, não só às vezes.",
      "O seletor do Ctrl+Tab aparece por cima da página, que continua à vista.",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-10-01",
    items: [
      "Ctrl+Tab: soltar o Ctrl já abre a guia escolhida (antes só com Enter).",
      "Pare o mouse sobre uma guia para ver a prévia da página, a memória (RAM) e a CPU que ela usa.",
      "Configurações completas em uma página própria (Ctrl+,), com seções e busca.",
      "O menu ⋯ ficou mais enxuto: o essencial à mão, com zoom e tema.",
      "No Mac, a barra de menus superior traz tudo, inclusive Configurações (⌘,) e copiar/colar.",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-09-30",
    items: [
      "Picture-in-picture em qualquer vídeo (YouTube ou outro player): botão na barra, Ctrl+Shift+P ou clique direito no vídeo.",
      "Arraste as guias para reordenar, na horizontal ou na vertical (ou Ctrl+Shift+PgUp/PgDn).",
      "Depois de cada atualização, este aviso mostra o que mudou.",
      "Novidades da versão atual em Configurações.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-29",
    items: [
      "Várias janelas: Ctrl+N abre uma nova e dá para mover uma guia para outra janela sem recarregar.",
      "Se o app fechar de repente, janelas e guias voltam como estavam.",
      "Telas de erro claras: sem internet, site inexistente, certificado inválido e página travada.",
      "Guias paradas hibernam e liberam memória; voltam do ponto onde você parou.",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-09-28",
    items: [
      "Atualização automática corrigida no Windows.",
      "Se uma atualização falhar, o motivo aparece em Configurações.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-09-27",
    items: [
      "Ícone e nome Agzos Browser no Windows e no Mac.",
      "Pedido de permissão em faixa acima da página.",
      "Atalhos de teclado corrigidos no Windows.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-26",
    items: [
      "Histórico (Ctrl+H) e favoritos com pastas.",
      "Barra de endereço com sugestões do histórico, favoritos e buscador.",
      "Permissões lembradas por site e atualização automática.",
    ],
  },
];

/** -1, 0 ou 1, comparando "1.4.10" com "1.4.9" do jeito certo. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * Novidades de quem estava em `from` e agora está em `to` (as versões puladas também, até
 * `limit`). Sem `from`, só as da versão atual.
 */
export function changesBetween(
  from: string | null,
  to: string,
  entries: ChangelogEntry[] = CHANGELOG,
  limit = 3,
): ChangelogEntry[] {
  return entries
    .filter(
      (entry) =>
        compareVersions(entry.version, to) <= 0 &&
        (from ? compareVersions(entry.version, from) > 0 : entry.version === to),
    )
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, limit);
}
