// Motor semântico de formulários (autofill do Agzos Key e perfis de preenchimento).
//
// Tudo fica dentro de formIntelFactory(), sem referência a nada de fora: o mesmo código
// roda em três lugares.
// - no main (Node): regras puras (classificar, formatar, sites e frames permitidos);
// - no page-preload.cjs (mundo isolado de cada frame): o preload em sandbox não pode dar
//   require num arquivo local, então pede o fonte ao main (agzos:form-intel-source) uma
//   vez por frame e monta com new Function. É o nosso próprio código, vindo do main;
// - nos testes (vitest), sem DOM: só a parte pura.
//
// Ideia: cada campo vira um conjunto de sinais (autocomplete, type, name, id, label,
// aria-*, placeholder, title, texto ao lado, pattern, maxlength, inputmode, data-*). Os
// sinais são normalizados (sem acento, camelCase quebrado, PT/EN/ES) e pontuados contra
// um dicionário por tipo canônico. O formulário inteiro decide o papel de cada campo
// (login, login em etapas, cadastro, troca de senha, endereço, contato).
//
// Cartão de crédito só é reconhecido para NUNCA ser preenchido com dado de perfil: o
// cofre não guarda número de cartão aqui.

function formIntelFactory() {
  // --- Texto -------------------------------------------------------------------------

  /** Sem acento, camelCase quebrado, só letras/dígitos separados por espaço. */
  function norm(text) {
    return String(text == null ? "" : text)
      .replace(/([a-zà-ÿ])([A-Z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const digits = (value) => String(value == null ? "" : value).replace(/\D+/g, "");

  // --- Tipos canônicos ----------------------------------------------------------------

  /** Tipos que um perfil de preenchimento guarda (a ordem é a do editor). */
  const PROFILE_TYPES = [
    "given-name",
    "family-name",
    "name",
    "email",
    "tel",
    "cpf",
    "cnpj",
    "rg",
    "birth-date",
    "company",
    "job-title",
    "website",
    "postal-code",
    "street",
    "address-number",
    "address-complement",
    "neighborhood",
    "city",
    "state",
    "country",
  ];
  /** Tipos derivados de outro campo do perfil (não aparecem no editor). */
  const DERIVED_TYPES = ["tel-area-code", "tel-local"];
  const PASSWORD_TYPES = ["current-password", "new-password", "confirm-password"];
  const LOGIN_TYPES = ["username", ...PASSWORD_TYPES, "otp"];
  /** Reconhecidos só para não errar: nunca preenchidos com perfil. */
  const GUARD_TYPES = ["cc-number", "cc-name", "cc-exp", "cc-csc", "search", "captcha"];
  const ALL_TYPES = [...PROFILE_TYPES, ...DERIVED_TYPES, ...LOGIN_TYPES, ...GUARD_TYPES];

  const ADDRESS_TYPES = new Set([
    "postal-code",
    "street",
    "address-number",
    "address-complement",
    "neighborhood",
    "city",
    "state",
    "country",
  ]);
  const PERSON_TYPES = new Set([
    "given-name",
    "family-name",
    "name",
    "email",
    "tel",
    "tel-area-code",
    "tel-local",
    "cpf",
    "cnpj",
    "rg",
    "birth-date",
    "company",
    "job-title",
    "website",
  ]);
  const FILLABLE = new Set([...PROFILE_TYPES, ...DERIVED_TYPES]);

  // autocomplete (HTML) → tipo canônico.
  const AUTOCOMPLETE = {
    "given-name": "given-name",
    "additional-name": null,
    "family-name": "family-name",
    name: "name",
    nickname: "username",
    email: "email",
    username: "username",
    tel: "tel",
    "tel-national": "tel",
    "tel-area-code": "tel-area-code",
    "tel-local": "tel-local",
    bday: "birth-date",
    "postal-code": "postal-code",
    "street-address": "street",
    "address-line1": "street",
    "address-line2": "address-complement",
    "address-line3": "neighborhood",
    "address-level1": "state",
    "address-level2": "city",
    "address-level3": "neighborhood",
    country: "country",
    "country-name": "country",
    organization: "company",
    "organization-title": "job-title",
    url: "website",
    "current-password": "current-password",
    "new-password": "new-password",
    "one-time-code": "otp",
    "cc-number": "cc-number",
    "cc-name": "cc-name",
    "cc-exp": "cc-exp",
    "cc-exp-month": "cc-exp",
    "cc-exp-year": "cc-exp",
    "cc-csc": "cc-csc",
  };

  // Dicionário: tipo → [expressão sobre o texto normalizado, peso relativo 0..1].
  // Texto normalizado: "data de nascimento", "txt cpf", "first name"...
  const W = (source) => new RegExp(`(?:^| )(?:${source})(?= |$)`);
  const DICT = {
    "given-name": [
      [W("primeiro nome|nome proprio|prenome|first ?name|given ?name|fname|nombre de pila"), 1],
    ],
    "family-name": [
      [W("sobrenome|ultimo nome|last ?name|family ?name|surname|lname|apellidos?"), 1],
    ],
    name: [
      [W("nome completo|full ?name|seu nome|your name|nombre completo|nome e sobrenome"), 1],
      [W("nome|name|nombre|cliente|aluno|candidato|responsavel|titular da conta"), 0.6],
    ],
    email: [[W("e ?mail|email|correo( electronico)?|endereco eletronico|mail"), 1]],
    tel: [
      [
        W(
          "telefone|celular|cel|fone|tel|whats ?app|zap|phone|mobile|movil|telephone|contato telefonico|numero de (telefone|celular)",
        ),
        1,
      ],
    ],
    "tel-area-code": [[W("ddd|cod(igo)? de area|area code"), 1]],
    cpf: [[W("cpf|cadastro de pessoa fisica|cpf cnpj|documento cpf"), 1]],
    cnpj: [[W("cnpj|cadastro nacional de pessoa juridica"), 1]],
    rg: [[W("rg|identidade|carteira de identidade|registro geral|numero do rg"), 1]],
    "birth-date": [
      [
        W(
          "data de nascimento|nascimento|nasc|data nasc|dt nasc|dtnasc|birth ?date|birthday|date of birth|dob|aniversario|fecha de nacimiento|bday",
        ),
        1,
      ],
    ],
    "postal-code": [
      [W("cep|codigo postal|cod postal|postal ?code|zip( ?code)?|postcode|cep do endereco"), 1],
    ],
    street: [
      [
        W(
          "endereco|logradouro|rua|avenida|av|address( line 1| 1)?|street( address)?|calle|direccion|domicilio|morada",
        ),
        1,
      ],
    ],
    "address-number": [
      [W("numero|num|nro|n|no|n o|number|house number|street number|numero da casa"), 0.7],
    ],
    "address-complement": [
      [
        W(
          "complemento|compl|apto|apartamento|bloco|address line 2|address 2|line 2|suite|apt|referencia",
        ),
        1,
      ],
    ],
    neighborhood: [[W("bairro|distrito|neighbou?rhood|colonia|barrio|vila"), 1]],
    city: [[W("cidade|municipio|city|town|localidade|ciudad|locality"), 1]],
    state: [[W("estado|uf|state|province|provincia|regiao|region"), 1]],
    country: [[W("pais|country|nacao"), 1]],
    company: [
      [
        W(
          "empresa|companhia|company|organization|organisation|organizacao|razao social|nome fantasia|employer|empregador|instituicao|escola|universidade",
        ),
        1,
      ],
    ],
    "job-title": [
      [W("cargo|funcao|profissao|ocupacao|job ?title|position|occupation|profession|puesto"), 1],
    ],
    website: [
      [W("site|website|web site|url|home ?page|pagina pessoal|portfolio|linkedin|blog"), 1],
    ],
    username: [
      [
        W(
          "usuario|user ?name|user|login|nome de usuario|apelido|nick|conta|account|identifier|ident|identificacao|matricula|codigo de acesso|acesso|user id|userid|logon|id de usuario|cpf ou e ?mail|e ?mail ou cpf",
        ),
        1,
      ],
    ],
    "current-password": [
      [
        W(
          "senha|password|pass|passwd|pwd|pw|palavra passe|contrasena|clave|chave de acesso|secret|passcode",
        ),
        1,
      ],
    ],
    otp: [
      [
        W(
          "one ?time|otp|totp|2fa|mfa|two factor|codigo de verificacao|verificacao|verification( code)?|token|codigo|code|authenticator|autenticacao|codigo sms|sms code|pin",
        ),
        1,
      ],
    ],
    "cc-number": [
      [
        W("numero do cartao|cartao|card ?number|cc ?num(ber)?|credit card|card no|numero cartao"),
        1,
      ],
    ],
    "cc-name": [[W("nome no cartao|nome impresso|cardholder|name on card|titular do cartao"), 1]],
    "cc-exp": [
      [W("validade|expira(cao)?|expiration|exp date|mm aa|mm yy|vencimento do cartao"), 1],
    ],
    "cc-csc": [[W("cvv|cvc|csc|cvv2|codigo de seguranca|security code"), 1]],
    search: [[W("buscar|busca|pesquisar|pesquisa|search|procurar|filtrar|filtro|q|query"), 1]],
    captcha: [
      [W("captcha|recaptcha|codigo da imagem|digite os caracteres|caracteres da imagem"), 1],
    ],
  };

  // Identificadores colados ("nomecompleto", "datanascimento"): só os inequívocos.
  const COMPACT = [
    [/nomecompleto|fullname/, "name"],
    [/primeironome|firstname|givenname/, "given-name"],
    [/sobrenome|lastname|familyname|surname/, "family-name"],
    [/email/, "email"],
    [/telefone|celular|whatsapp|phone|mobile/, "tel"],
    [/cpf/, "cpf"],
    [/cnpj/, "cnpj"],
    [/datanasc|dtnasc|nascimento|birthdate|birthday|dateofbirth/, "birth-date"],
    [/zipcode|postalcode|postcode/, "postal-code"],
    [/endereco|logradouro|streetaddress/, "street"],
    [/complemento/, "address-complement"],
    [/bairro|neighborhood/, "neighborhood"],
    [/cidade|municipio/, "city"],
    [/empresa|razaosocial|nomefantasia/, "company"],
    [/username|usuario|userid|loginid/, "username"],
    [/senha|password|passwd/, "current-password"],
    [/onetimecode|otpcode|totp/, "otp"],
    [/cardnumber|ccnumber|numerocartao|creditcard/, "cc-number"],
    [/captcha/, "captcha"],
  ];

  // Palavras que derrubam um tipo (o rótulo cita outra coisa).
  const NEGATIVE = {
    name: W(
      "user ?name|usuario|nome de usuario|empresa|company|fantasia|razao social|mae|pai|cartao|card|arquivo|file|produto|evento|cidade|rua|bairro|login|social|da conta|do pet|primeiro|ultimo|sobrenome|first|last|apelido",
    ),
    street: W("e ?mail|eletronico|ip|web|numero|complemento|cep|bairro|cidade|line 2|url|site"),
    "address-number": W(
      "cartao|card|telefone|celular|fone|documento|rg|cpf|cnpj|pedido|whats ?app|pessoas|quantidade|qtd|parcelas|protocolo|matricula|nf|nota|conta|agencia|serie|lote|ddd",
    ),
    state: W("civil|status|situacao|marital|estado do pedido|conservacao"),
    email: W("confirmar senha|senha"),
    tel: W("ddd|codigo de area|area code"),
    username: W("senha|password|nome completo|full name"),
    "current-password": W(
      "esqueci|esqueceu|forgot|lembrar|remember|mostrar|show|exibir|recuperar|reset|dica|hint|strength|forca",
    ),
    otp: W(
      "senha|password|postal|cep|zip|promo\\w*|cupom|coupon|desconto|discount|referral|indicacao|convite|invite|pais|country|area",
    ),
    company: W("cargo|funcao"),
    website: W("e ?mail"),
    search: W("cep|endereco|e ?mail|senha"),
  };

  const SOURCE_WEIGHT = {
    label: 48,
    aria: 42,
    placeholder: 38,
    name: 40,
    id: 34,
    data: 30,
    title: 26,
    nearby: 24,
    klass: 10,
  };

  function emptyScores() {
    const scores = {};
    for (const type of ALL_TYPES) scores[type] = 0;
    return scores;
  }

  /** Tokens do autocomplete que valem (ignora "off", "on", seções e lixo aleatório). */
  function autocompleteType(value) {
    const tokens = String(value || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (Object.prototype.hasOwnProperty.call(AUTOCOMPLETE, tokens[i])) {
        return AUTOCOMPLETE[tokens[i]];
      }
    }
    return null;
  }

  /** Texto de senha: atual, nova ou confirmação. */
  function passwordKind(text, auto) {
    if (auto === "new-password") {
      return /(?:^| )(confirm\w*|repet\w*|repita|redigite|novamente|again|re ?enter|verify|verifique|outra vez)(?= |$)/.test(
        text,
      )
        ? "confirm-password"
        : "new-password";
    }
    if (auto === "current-password") return "current-password";
    if (
      /(?:^| )(confirm\w*|repet\w*|repita|redigite|novamente|again|re ?enter|retype|verify|verifique|outra vez|conf)(?= |$)/.test(
        text,
      )
    )
      return "confirm-password";
    if (
      /(?:^| )(nova|novo|new|criar|crie|create|choose|escolha|definir|defina|cadastr\w*|register|registro|nueva)(?= |$)/.test(
        text,
      )
    )
      return "new-password";
    return "current-password";
  }

  /**
   * Classifica um campo pelos sinais. `signals`: { tag, type, autocomplete, name, id,
   * label, aria, placeholder, title, nearby, data, klass, inputmode, maxLength, pattern,
   * options, masked }. Devolve { type, score, confidence, password }.
   */
  function classifyField(signals) {
    const sig = signals || {};
    const tag = String(sig.tag || "input").toLowerCase();
    const inputType = String(sig.type || (tag === "input" ? "text" : tag)).toLowerCase();
    const scores = emptyScores();
    const texts = {};
    for (const source of Object.keys(SOURCE_WEIGHT)) texts[source] = norm(sig[source]);
    const all = Object.values(texts).filter(Boolean).join(" ");
    const auto = String(sig.autocomplete || "").toLowerCase();
    const autoType = autocompleteType(auto);

    for (const [type, rules] of Object.entries(DICT)) {
      for (const [source, weight] of Object.entries(SOURCE_WEIGHT)) {
        const text = texts[source];
        if (!text) continue;
        for (const [re, factor] of rules) {
          if (re.test(text)) {
            // O rótulo inteiro igual ao termo ("CPF", "E-mail") pesa mais que citado no meio.
            const exact = text.split(" ").length <= 3 ? 1.15 : 1;
            scores[type] += weight * factor * exact;
            break;
          }
        }
      }
    }
    // Identificadores colados (name/id/data sem separador).
    const compact = [texts.name, texts.id, texts.data].join(" ").replace(/ /g, "");
    for (const [re, type] of COMPACT) if (re.test(compact)) scores[type] += 30;

    for (const [type, re] of Object.entries(NEGATIVE)) {
      if (scores[type] > 0 && re.test(all)) scores[type] -= 70;
    }

    // "Nome" sozinho é o nome completo; quando o texto cita primeiro/último nome o tipo
    // específico ganha.
    if (scores["given-name"] > 0 || scores["family-name"] > 0) scores.name *= 0.4;
    // "Número" só vale como número do endereço quando o rótulo é curto ("Número", "Nº").
    if (scores["address-number"] > 0) {
      const short = [texts.label, texts.placeholder, texts.aria, texts.nearby].some(
        (text) => text && text.split(" ").length <= 2,
      );
      if (!short && !/num|numero|number/.test(texts.name + texts.id))
        scores["address-number"] *= 0.4;
    }
    // CPF/CNPJ no mesmo campo: CPF primeiro (perfil pessoal), CNPJ só se citado sozinho.
    if (scores.cpf > 0 && scores.cnpj > 0) scores.cnpj *= 0.5;
    // Login por CPF/e-mail/telefone: o campo "CPF ou e-mail" é usuário.
    if (/(?:^| )ou(?= |$)|(?:^| )or(?= |$)/.test(texts.label + " " + texts.placeholder)) {
      if (scores.cpf > 0 || scores.email > 0) scores.username += 40;
    }

    // Tipo do <input>.
    if (inputType === "email") scores.email += 70;
    if (inputType === "tel") scores.tel += 45;
    if (inputType === "url") scores.website += 60;
    if (inputType === "search") scores.search += 80;
    if (inputType === "date") scores["birth-date"] += 12;
    const numeric =
      /numeric|decimal|tel/.test(String(sig.inputmode || "")) || inputType === "number";
    const maxLength = Number(sig.maxLength) > 0 ? Number(sig.maxLength) : 0;
    if (numeric) {
      for (const type of ["cpf", "cnpj", "postal-code", "tel", "otp", "address-number", "rg"])
        if (scores[type] > 0) scores[type] += 6;
    }
    if (maxLength) {
      if (scores.cpf > 0 && (maxLength === 11 || maxLength === 14)) scores.cpf += 10;
      if (scores["postal-code"] > 0 && (maxLength === 8 || maxLength === 9))
        scores["postal-code"] += 10;
      if (scores.state > 0 && maxLength === 2) scores.state += 10;
      if (scores.otp > 0 && maxLength >= 4 && maxLength <= 8) scores.otp += 25;
      if (scores["tel-area-code"] > 0 && maxLength <= 3) scores["tel-area-code"] += 20;
    }
    // <select> de UF/país: as opções dizem o que é.
    if (tag === "select" && Array.isArray(sig.options) && sig.options.length) {
      const options = sig.options.map((option) => norm(option)).filter(Boolean);
      const ufs = options.filter(
        (option) => UF_BY_CODE[option.toUpperCase()] || UF_BY_NAME[option],
      );
      if (ufs.length >= 20) scores.state += 60;
      if (
        options.some((option) => /^(brasil|brazil|argentina|portugal|united states)$/.test(option))
      )
        scores.country += options.length > 20 ? 60 : 20;
    }

    // Senha: type=password, ou campo de texto que se mascara (senha que começa como texto
    // e vira password depois, ou -webkit-text-security).
    const passwordInput = inputType === "password" || sig.masked === true;
    const pwScore = scores["current-password"];
    if (passwordInput) {
      // Num campo mascarado só cabe senha, PIN/código ou CVV.
      if (scores["cc-csc"] > 30) return result("cc-csc", scores["cc-csc"], scores, true);
      if (
        autoType === "otp" ||
        (scores.otp >= 40 && scores.otp > pwScore + 10 && maxLength && maxLength <= 8)
      )
        return result("otp", Math.max(scores.otp, 60), scores, true);
      const kind = passwordKind(all, autoType);
      return result(kind, Math.max(100, pwScore), scores, true);
    }
    if (autoType && autoType !== "username" && !PASSWORD_TYPES.includes(autoType)) {
      scores[autoType] += 120;
    } else if (autoType === "username") {
      scores.username += 90;
    } else if (autoType && PASSWORD_TYPES.includes(autoType)) {
      return result(passwordKind(all, autoType), 120, scores, true);
    }
    // Texto com cara forte de senha (rótulo/nome "Senha", "password"): senha sem máscara.
    if (
      pwScore >= 45 &&
      TEXT_LIKE.has(inputType) &&
      pwScore >= Math.max(scores.username, scores.email, scores.otp) + 10
    ) {
      return result(passwordKind(all, autoType), pwScore, scores, true);
    }
    // Sem senha aqui: tira a pontuação de senha da disputa.
    scores["current-password"] = 0;
    if (!TEXT_LIKE.has(inputType) && tag === "input" && inputType !== "radio") {
      if (inputType === "date") return result("birth-date", scores["birth-date"], scores, false);
      return result(null, 0, scores, false);
    }
    let best = null;
    let bestScore = 0;
    for (const type of ALL_TYPES) {
      if (PASSWORD_TYPES.includes(type)) continue;
      if (scores[type] > bestScore) {
        best = type;
        bestScore = scores[type];
      }
    }
    return result(bestScore >= 30 ? best : null, bestScore, scores, false);
  }

  const TEXT_LIKE = new Set(["text", "email", "tel", "number", "url", "search", "", "textarea"]);

  function result(type, score, scores, password) {
    let second = 0;
    for (const [other, value] of Object.entries(scores)) {
      if (other !== type && value > second) second = value;
    }
    const confidence = type
      ? Math.max(
          0,
          Math.min(1, (score / 100) * (1 - Math.min(0.6, second / Math.max(score, 1) / 2))),
        )
      : 0;
    return {
      type,
      score: Math.round(score),
      confidence: Math.round(confidence * 100) / 100,
      password,
    };
  }

  // --- Formulário ---------------------------------------------------------------------

  const SUBMIT_RE =
    /(?:^| )(entrar|login|log in|logon|sign in|signin|acessar|continuar|continue|proximo|next|avancar|verificar|verify|enviar|submit|confirmar|ok|go|ir|logar|autenticar|validar|prosseguir|cadastrar|registrar|criar conta|sign up|register|salvar|save|send|ingresar|iniciar sesion)(?= |$)/;
  const LOGIN_BUTTON_RE =
    /(?:^| )(entrar|login|log in|logon|sign in|signin|acessar|logar|autenticar|ingresar|iniciar sesion)(?= |$)/;
  const NEXT_BUTTON_RE = /(?:^| )(continuar|continue|proximo|next|avancar|prosseguir)(?= |$)/;
  const SIGNUP_RE =
    /(?:^| )(cadastr\w*|registr\w*|criar( uma)? conta|crie sua conta|sign up|signup|register|create account|inscrev\w*)(?= |$)/;

  function isSubmitLabel(text) {
    return SUBMIT_RE.test(norm(text));
  }

  /**
   * Decide o papel de cada campo do formulário. `fields`: [{ type, score, password,
   * inputType, signals }] na ordem do documento; `context`: { buttons: [texto], text }.
   * Devolve { kind, roles: [tipo final por campo], username, password, newPassword,
   * confirm } (índices; -1 = não há).
   */
  function resolveForm(fields, context) {
    const list = Array.isArray(fields) ? fields : [];
    const buttons = ((context && context.buttons) || []).map(norm).join(" | ");
    const formText = norm(context && context.text);
    const roles = list.map((field) => (field ? field.type : null));
    const passwords = [];
    roles.forEach((type, index) => {
      if (PASSWORD_TYPES.includes(type)) passwords.push(index);
    });

    // Duas ou três senhas sem autocomplete explícito: atual/nova/confirmação pela ordem.
    const explicit = (index) =>
      /current-password|new-password/.test(String((list[index].signals || {}).autocomplete || ""));
    if (passwords.length >= 3) {
      const [a, b, c] = passwords;
      if (!explicit(a)) roles[a] = "current-password";
      if (!explicit(b)) roles[b] = "new-password";
      if (!explicit(c)) roles[c] = "confirm-password";
    } else if (passwords.length === 2) {
      const [a, b] = passwords;
      if (roles[a] === "current-password" && roles[b] === "current-password") {
        const changing = /(?:^| )(atual|current|old|antiga|anterior)(?= |$)/.test(
          norm(JSON.stringify(list[a].signals || {})),
        );
        roles[a] = changing ? "current-password" : "new-password";
        roles[b] = changing ? "new-password" : "confirm-password";
      } else if (roles[a] === "new-password" && roles[b] !== "current-password") {
        roles[b] = "confirm-password";
      } else if (
        roles[b] === "confirm-password" &&
        roles[a] === "current-password" &&
        !explicit(a)
      ) {
        roles[a] = "new-password";
      }
    }

    // Usuário: o melhor campo de texto antes da (primeira) senha, por pontuação semântica;
    // sem nenhum sinal, o campo de texto logo antes dela.
    let username = -1;
    const firstPassword = passwords.length ? passwords[0] : -1;
    const loginish = (index) => {
      const field = list[index];
      if (!field || field.password) return -1;
      if (!TEXT_LIKE.has(String(field.inputType || "text"))) return -1;
      const type = roles[index];
      if (type === "search" || type === "captcha" || type === "otp" || GUARD_TYPES.includes(type))
        return -1;
      const base =
        type === "username"
          ? 100
          : type === "email"
            ? 90
            : type === "cpf" || type === "tel" || type === "cnpj"
              ? 60
              : type === null
                ? 20
                : 10;
      return base + Math.min(40, field.score || 0) / 4;
    };
    if (firstPassword >= 0) {
      let best = -1;
      let bestScore = 0;
      for (let i = firstPassword - 1; i >= 0; i--) {
        const score = loginish(i) + (i === firstPassword - 1 ? 8 : 0);
        if (score > bestScore) {
          best = i;
          bestScore = score;
        }
      }
      username = best;
    } else {
      // Sem senha: login em etapas se houver um campo de usuário/e-mail sozinho e um botão
      // de entrar/continuar.
      const candidates = list
        .map((_field, index) => index)
        .filter((index) => loginish(index) >= 60);
      const fillable = list.filter((_field, index) => roles[index] && FILLABLE.has(roles[index]));
      if (
        candidates.length === 1 &&
        fillable.length <= 1 &&
        (roles[candidates[0]] === "username" ||
          LOGIN_BUTTON_RE.test(buttons) ||
          NEXT_BUTTON_RE.test(buttons) ||
          /login|signin|auth|entrar/.test(formText))
      ) {
        username = candidates[0];
      }
    }
    if (username >= 0 && roles[username] !== "username" && firstPassword >= 0) {
      // O papel de login não apaga o tipo: guarda os dois (e-mail usado como usuário).
      roles[username] = roles[username] === "email" ? "email" : "username";
    }

    const has = (type) => roles.includes(type);
    const count = (set) => roles.filter((type) => type && set.has(type)).length;
    const otpOnly = has("otp") && passwords.length === 0 && count(new Set(PROFILE_TYPES)) === 0;
    let kind = "generic";
    if (otpOnly) kind = "otp";
    else if (has("new-password") && has("current-password")) kind = "password-change";
    else if (has("new-password") || has("confirm-password")) kind = "signup";
    else if (passwords.length && (count(PERSON_TYPES) >= 3 || SIGNUP_RE.test(buttons)))
      kind = "signup";
    else if (passwords.length) kind = "login";
    else if (username >= 0) kind = "login-step";
    else if (count(ADDRESS_TYPES) >= 2) kind = "address";
    else if (count(PERSON_TYPES) >= 1 && list.length >= 2) kind = "contact";
    else if (roles.length && roles.every((type) => type === "search" || type === null)) {
      kind = roles.includes("search") ? "search" : "generic";
    }

    const password =
      kind === "signup" ? -1 : roles.findIndex((type) => type === "current-password");
    return {
      kind,
      roles,
      username,
      password,
      newPassword: roles.indexOf("new-password"),
      confirm: roles.indexOf("confirm-password"),
    };
  }

  // --- Valores e formatos -------------------------------------------------------------

  const UFS = [
    ["AC", "Acre"],
    ["AL", "Alagoas"],
    ["AP", "Amapá"],
    ["AM", "Amazonas"],
    ["BA", "Bahia"],
    ["CE", "Ceará"],
    ["DF", "Distrito Federal"],
    ["ES", "Espírito Santo"],
    ["GO", "Goiás"],
    ["MA", "Maranhão"],
    ["MT", "Mato Grosso"],
    ["MS", "Mato Grosso do Sul"],
    ["MG", "Minas Gerais"],
    ["PA", "Pará"],
    ["PB", "Paraíba"],
    ["PR", "Paraná"],
    ["PE", "Pernambuco"],
    ["PI", "Piauí"],
    ["RJ", "Rio de Janeiro"],
    ["RN", "Rio Grande do Norte"],
    ["RS", "Rio Grande do Sul"],
    ["RO", "Rondônia"],
    ["RR", "Roraima"],
    ["SC", "Santa Catarina"],
    ["SP", "São Paulo"],
    ["SE", "Sergipe"],
    ["TO", "Tocantins"],
  ];
  const UF_BY_CODE = {};
  const UF_BY_NAME = {};
  for (const [code, name] of UFS) {
    UF_BY_CODE[code] = name;
    UF_BY_NAME[norm(name)] = code;
  }
  const COUNTRY_ALIASES = [["brasil", "brazil", "br", "bra", "republica federativa do brasil"]];

  /** Valores do perfil, com os derivados (nome completo ↔ partes, DDD, UF). */
  function profileValues(fields) {
    const values = {};
    const source = fields && typeof fields === "object" ? fields : {};
    for (const type of PROFILE_TYPES) {
      const value = typeof source[type] === "string" ? source[type].trim() : "";
      if (value) values[type] = value;
    }
    if (!values.name && (values["given-name"] || values["family-name"])) {
      values.name = [values["given-name"], values["family-name"]].filter(Boolean).join(" ");
    }
    if (values.name && !values["given-name"]) {
      const parts = values.name.split(/\s+/);
      values["given-name"] = parts[0];
      if (parts.length > 1 && !values["family-name"])
        values["family-name"] = parts.slice(1).join(" ");
    }
    if (values.tel) {
      let tel = digits(values.tel);
      if (tel.length >= 12 && tel.startsWith("55")) tel = tel.slice(2);
      if (tel.length >= 10) {
        values["tel-area-code"] = tel.slice(0, 2);
        values["tel-local"] = tel.slice(2);
      }
    }
    if (values.state && values.state.length > 2) {
      const code = UF_BY_NAME[norm(values.state)];
      if (code) values.state = code;
    }
    return values;
  }

  const fit = (value, maxLength) =>
    maxLength > 0 && value.length > maxLength ? value.slice(0, maxLength) : value;

  /**
   * Valor do perfil no formato que o campo espera (máscara de CPF/CNPJ/CEP/telefone,
   * data ISO no <input type=date>, UF de 2 letras), respeitando o maxlength.
   * `field`: { inputType, maxLength, placeholder, pattern }.
   */
  function formatValue(type, raw, field) {
    const info = field || {};
    const maxLength = Number(info.maxLength) > 0 ? Number(info.maxLength) : 0;
    const placeholder = String(info.placeholder || "");
    const pattern = String(info.pattern || "");
    const value = String(raw == null ? "" : raw).trim();
    if (!value) return "";
    // O campo quer só dígitos (pattern \d+, maxlength do tamanho sem máscara, type=number).
    const digitsOnly = (size) =>
      info.inputType === "number" ||
      maxLength === size ||
      /^\^?(\\d|\[0-9\])[{+*]/.test(pattern) ||
      (placeholder && /^\d+$/.test(placeholder.replace(/\s/g, "")));
    const masked = (d, size, mask) => {
      if (d.length !== size) return fit(value, maxLength);
      if (digitsOnly(size)) return d;
      let index = 0;
      const out = mask.replace(/0/g, () => d[index++]);
      return fit(out, maxLength);
    };
    switch (type) {
      case "cpf":
        return masked(digits(value), 11, "000.000.000-00");
      case "cnpj":
        return masked(digits(value), 14, "00.000.000/0000-00");
      case "postal-code":
        return masked(digits(value), 8, "00000-000");
      case "tel": {
        let d = digits(value);
        const intl = d.length >= 12 && d.startsWith("55");
        if (intl) d = d.slice(2);
        if (d.length !== 10 && d.length !== 11) return fit(value, maxLength);
        if (digitsOnly(d.length) || (maxLength && maxLength < 14)) return fit(d, maxLength);
        const local = d.slice(2);
        const split = local.length === 9 ? 5 : 4;
        const pretty = `(${d.slice(0, 2)}) ${local.slice(0, split)}-${local.slice(split)}`;
        if (/^\+/.test(placeholder) || (intl && /\+/.test(value)))
          return fit(`+55 ${pretty}`, maxLength);
        return fit(pretty, maxLength);
      }
      case "tel-area-code":
      case "tel-local":
        return fit(digits(value), maxLength);
      case "birth-date": {
        const iso = isoDate(value);
        if (!iso) return fit(value, maxLength);
        const [y, m, d] = iso.split("-");
        if (info.inputType === "date") return iso;
        if (/^(mm|MM)/.test(placeholder)) return fit(`${m}/${d}/${y}`, maxLength);
        if (/^(yyyy|aaaa|YYYY|AAAA)/.test(placeholder)) return fit(`${y}-${m}-${d}`, maxLength);
        if (maxLength === 8 || /^\d{8}$/.test(placeholder)) return `${d}${m}${y}`;
        return fit(`${d}/${m}/${y}`, maxLength);
      }
      case "state": {
        const code = value.length === 2 ? value.toUpperCase() : UF_BY_NAME[norm(value)];
        if (maxLength && maxLength <= 2 && code) return code;
        return fit(value, maxLength);
      }
      default:
        return fit(value, maxLength);
    }
  }

  /** Data em ISO (AAAA-MM-DD) a partir de DD/MM/AAAA, AAAA-MM-DD ou DDMMAAAA. */
  function isoDate(value) {
    const text = String(value || "").trim();
    let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
    match = /^(\d{2})(\d{2})(\d{4})$/.exec(text);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return null;
  }

  /**
   * Opção de um <select> (ou grupo de rádios) para o valor: valor/texto iguais, UF ↔
   * nome do estado, apelidos de país, depois começo do texto. -1 quando nada serve.
   * `options`: [{ value, text }].
   */
  function matchOption(type, value, options) {
    const list = Array.isArray(options) ? options : [];
    const target = norm(value);
    if (!target) return -1;
    const wanted = new Set([target]);
    if (type === "state") {
      const code = value.length === 2 ? value.toUpperCase() : UF_BY_NAME[target];
      if (code) {
        wanted.add(norm(code));
        wanted.add(norm(UF_BY_CODE[code] || ""));
      }
    }
    if (type === "country") {
      for (const aliases of COUNTRY_ALIASES)
        if (aliases.includes(target)) aliases.forEach((a) => wanted.add(a));
    }
    if (type === "birth-date") return -1;
    const norms = list.map((option) => ({ value: norm(option.value), text: norm(option.text) }));
    let index = norms.findIndex((option) => wanted.has(option.value) || wanted.has(option.text));
    if (index >= 0) return index;
    // "SP - São Paulo", "São Paulo (SP)": o valor aparece como palavra(s) inteira(s).
    index = norms.findIndex((option) =>
      [...wanted].some(
        (w) => (w.length > 2 || type === "state") && ` ${option.text} `.includes(` ${w} `),
      ),
    );
    if (index >= 0) return index;
    index = norms.findIndex(
      (option) => option.text && target.length >= 3 && option.text.startsWith(target),
    );
    return index;
  }

  /** Assinatura estável do campo, para o mapeamento por site. */
  function fieldSignature(signals) {
    const sig = signals || {};
    const tag = String(sig.tag || "input").toLowerCase();
    const type = String(sig.type || "").toLowerCase();
    const key =
      norm(sig.name) || norm(sig.id) || norm(sig.label) || norm(sig.aria) || norm(sig.placeholder);
    return `${tag}:${type}:${key.slice(0, 60)}`;
  }

  // --- Sites e frames -----------------------------------------------------------------

  // Mesma regra de src/features/browser/vault.ts (siteOf): domínio registrável aproximado.
  const SECOND_LEVEL = new Set(
    "com net org gov edu co ac app art blog eng ind inf jus leg mil adv arq med srv tv".split(" "),
  );
  const SHARED_HOSTS = new Set(
    "github.io vercel.app netlify.app pages.dev web.app firebaseapp.com herokuapp.com blogspot.com azurewebsites.net cloudfront.net amazonaws.com onrender.com googleusercontent.com".split(
      " ",
    ),
  );

  function hostOf(url) {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) return "";
      return parsed.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return "";
    }
  }

  function siteOfHost(host) {
    const labels = String(host || "").split(".");
    if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1])) return host;
    const tld = labels[labels.length - 1];
    const second = labels[labels.length - 2];
    const shared = SHARED_HOSTS.has(`${second}.${tld}`);
    const take = shared || (tld.length === 2 && SECOND_LEVEL.has(second)) ? 3 : 2;
    return labels.slice(-take).join(".");
  }

  // Embutidos confiáveis: o HTML do Google Apps Script (HtmlService) roda num iframe em
  // *.script.googleusercontent.com dentro de script.google.com (ou do Google Sites). O
  // login do app é do app: vale a URL de cima, não o host aleatório do sandbox.
  const TRUSTED_EMBEDS = [
    {
      top: /^(script|sites|docs)\.google\.com$/,
      frame: /(^|[.-])script\.googleusercontent\.com$/,
    },
  ];

  /**
   * O frame pode receber/mandar credenciais e dados de perfil da guia? Mesmo site da
   * página (domínio registrável) ou um embutido confiável. `extra`: pares de teste.
   */
  function frameAllowed(topUrl, frameUrl, extra) {
    const top = hostOf(topUrl);
    const frame = hostOf(frameUrl);
    if (!top || !frame) return false;
    if (top === frame || siteOfHost(top) === siteOfHost(frame)) return true;
    const embeds = TRUSTED_EMBEDS.concat(Array.isArray(extra) ? extra : []);
    return embeds.some((rule) =>
      typeof rule.top === "string"
        ? rule.top === top && rule.frame === frame
        : rule.top.test(top) && rule.frame.test(frame),
    );
  }

  /**
   * Chave do site para mapeamentos e "nunca preencher": host sem www.; para apps do Apps
   * Script (script.google.com/macros/s/<id>) vale o app, não o Google inteiro.
   */
  function siteKey(url) {
    const host = hostOf(url);
    if (!host) return "";
    if (host === "script.google.com") {
      try {
        const match = /^\/(?:a\/macros\/[^/]+|macros)\/s\/([^/]+)/.exec(new URL(url).pathname);
        if (match) return `${host}/macros/s/${match[1]}`;
      } catch {
        /* cai no host */
      }
    }
    return host;
  }

  // --- DOM (preload e scripts injetados) ---------------------------------------------

  const SKIP_INPUTS = new Set([
    "hidden",
    "submit",
    "button",
    "image",
    "reset",
    "file",
    "range",
    "color",
  ]);

  function isFieldElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "SELECT" || tag === "TEXTAREA") return true;
    return tag === "INPUT" && !SKIP_INPUTS.has(String(el.type || "text").toLowerCase());
  }

  function viewOf(el) {
    return (el && el.ownerDocument && el.ownerDocument.defaultView) || null;
  }

  function isVisible(el) {
    if (!el || !el.isConnected || el.disabled) return false;
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    const view = viewOf(el);
    if (!view) return false;
    const style = view.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    return Number(style.opacity) > 0.01 || el === el.ownerDocument.activeElement;
  }

  /** Campos do documento e das shadow roots abertas (iframes ficam com o frame deles). */
  function deepFields(root, shallow) {
    const out = [];
    const walk = (node, depth) => {
      if (!node || depth > 12) return;
      const list = node.querySelectorAll ? node.querySelectorAll("input, select, textarea") : [];
      for (const el of list) if (isFieldElement(el)) out.push(el);
      if (shallow) return;
      const all = node.querySelectorAll ? node.querySelectorAll("*") : [];
      for (const el of all) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    };
    walk(root, 0);
    // Ordem do documento (os de shadow root entram onde o host está).
    return out;
  }

  const clean = (text, max) =>
    String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max || 120);

  function textOf(node) {
    if (!node) return "";
    // innerText respeita o que está visível; textContent como plano B.
    return clean(node.innerText || node.textContent || "");
  }

  function labelOf(el) {
    const parts = [];
    try {
      if (el.labels) for (const label of el.labels) parts.push(textOf(label));
    } catch {
      /* elementos sem labels */
    }
    const root = el.getRootNode ? el.getRootNode() : el.ownerDocument;
    const ids = String(el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .filter(Boolean);
    for (const id of ids) {
      const node = root && root.getElementById ? root.getElementById(id) : null;
      if (node) parts.push(textOf(node));
    }
    if (!parts.length) {
      const wrap = el.closest && el.closest("label");
      if (wrap) parts.push(textOf(wrap));
    }
    return clean(parts.join(" "));
  }

  /** Texto logo antes do campo (rótulos soltos, células de tabela, mat-label). */
  function nearbyOf(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node; depth++) {
      let sibling = node.previousSibling;
      let hops = 0;
      while (sibling && hops < 4) {
        hops++;
        if (sibling.nodeType === 3) {
          const text = clean(sibling.textContent, 80);
          if (text) return text;
        } else if (sibling.nodeType === 1) {
          if (sibling.querySelector && sibling.querySelector("input, select, textarea")) break;
          const text = textOf(sibling);
          if (text && text.length <= 80) return text;
        }
        sibling = sibling.previousSibling;
      }
      const parent = node.parentElement;
      if (!parent) break;
      // Rótulo flutuante (Material, Bootstrap): <label> irmão dentro do mesmo contêiner.
      const floating =
        parent.querySelector &&
        parent.querySelector(
          ":scope > label, :scope > mat-label, :scope > .label, :scope > span.label",
        );
      if (floating && floating !== el && !floating.contains(el)) {
        const text = textOf(floating);
        if (text) return text;
      }
      if (parent.tagName === "TD" && parent.previousElementSibling) {
        const text = textOf(parent.previousElementSibling);
        if (text) return text;
      }
      if (parent.querySelectorAll("input, select, textarea").length > 1) break;
      node = parent;
    }
    return "";
  }

  function dataOf(el) {
    const parts = [];
    for (const name of [
      "data-field",
      "data-name",
      "data-type",
      "data-testid",
      "data-qa",
      "data-cy",
      "formcontrolname",
      "ng-model",
      "v-model",
      "data-bind",
    ]) {
      const value = el.getAttribute(name);
      if (value) parts.push(value);
    }
    return clean(parts.join(" "), 80);
  }

  function isMasked(el) {
    if (el.tagName !== "INPUT") return false;
    if (String(el.type).toLowerCase() === "password") return true;
    const view = viewOf(el);
    try {
      const style = view && view.getComputedStyle(el);
      const security =
        style && (style.webkitTextSecurity || style.getPropertyValue("-webkit-text-security"));
      return Boolean(security && security !== "none");
    } catch {
      return false;
    }
  }

  /** Rádio: o rótulo do grupo (legend do fieldset ou o radiogroup), não o da opção. */
  function radioGroupLabel(el) {
    const fieldset = el.closest && el.closest("fieldset");
    const legend = fieldset && fieldset.querySelector("legend");
    if (legend) return textOf(legend);
    const group = el.closest && el.closest("[role=radiogroup]");
    if (group) return clean(group.getAttribute("aria-label") || labelOf(group));
    return "";
  }

  function signalsOf(el) {
    const tag = el.tagName.toLowerCase();
    const radio = tag === "input" && String(el.type).toLowerCase() === "radio";
    const options =
      tag === "select"
        ? Array.from(el.options || [])
            .slice(0, 300)
            .map((option) => option.text)
        : undefined;
    return {
      tag,
      type: tag === "input" ? String(el.type || "text").toLowerCase() : tag,
      autocomplete: el.getAttribute("autocomplete") || "",
      name: el.getAttribute("name") || "",
      id: el.id || "",
      label: radio ? radioGroupLabel(el) : labelOf(el),
      aria: clean(el.getAttribute("aria-label") || el.getAttribute("aria-description") || ""),
      placeholder: clean(el.getAttribute("placeholder") || ""),
      title: clean(el.getAttribute("title") || ""),
      nearby: radio ? "" : nearbyOf(el),
      data: dataOf(el),
      klass: clean(typeof el.className === "string" ? el.className : "", 80),
      inputmode: el.getAttribute("inputmode") || "",
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
      pattern: el.getAttribute("pattern") || "",
      options,
      masked: isMasked(el),
    };
  }

  /** Grupo do campo: o <form>, ou o "formulário" sem <form> do documento/shadow root. */
  function groupOf(el) {
    if (el.form) return el.form;
    const root = el.getRootNode ? el.getRootNode() : el.ownerDocument;
    return root;
  }

  function buttonsOf(scope) {
    const list =
      scope && scope.querySelectorAll
        ? scope.querySelectorAll(
            "button, input[type=submit], input[type=button], input[type=image], [role=button], a[href], [onclick]",
          )
        : [];
    const out = [];
    for (const el of list) {
      if (out.length >= 24) break;
      if (!isVisible(el)) continue;
      out.push(
        clean(
          `${el.innerText || el.value || ""} ${el.getAttribute("aria-label") || ""} ${el.id || ""}`,
          60,
        ),
      );
    }
    return out;
  }

  /**
   * Analisa os campos visíveis de um documento (ou do grupo de `focus`). Devolve grupos
   * { scope, fields: [{ el, signals, type, score, password, inputType }], form }.
   */
  function analyze(doc, options) {
    const only = options && options.focus ? groupOf(options.focus) : null;
    const mappings = (options && options.mappings) || {};
    const groups = new Map();
    for (const el of deepFields(doc, options && options.shallow)) {
      if (!isVisible(el) && !(options && options.includeHidden && el.value)) continue;
      const scope = groupOf(el);
      if (only && scope !== only) continue;
      let group = groups.get(scope);
      if (!group) {
        group = { scope, fields: [] };
        groups.set(scope, group);
      }
      const signals = signalsOf(el);
      const verdict = classifyField(signals);
      const signature = fieldSignature(signals);
      let type = verdict.type;
      let mapped = false;
      if (Object.prototype.hasOwnProperty.call(mappings, signature)) {
        type = mappings[signature] === "ignore" ? null : mappings[signature];
        mapped = true;
      }
      group.fields.push({
        el,
        signals,
        signature,
        type,
        score: mapped ? 200 : verdict.score,
        confidence: mapped ? 1 : verdict.confidence,
        password: PASSWORD_TYPES.includes(type) || (verdict.password && !mapped),
        ignored: mapped && mappings[signature] === "ignore",
        inputType: signals.type,
      });
    }
    const out = [];
    for (const group of groups.values()) {
      if (group.fields.length > 80) group.fields = group.fields.slice(0, 80);
      const text =
        group.scope && group.scope.nodeType === 1
          ? `${group.scope.id || ""} ${group.scope.getAttribute("name") || ""} ${group.scope.getAttribute("action") || ""} ${group.scope.className || ""}`
          : "";
      group.form = resolveForm(group.fields, { buttons: buttonsOf(group.scope), text });
      out.push(group);
    }
    return out;
  }

  /** Papel do campo para o Agzos Key: password, username, otp, form (perfil) ou null. */
  function fieldRole(el, groups) {
    for (const group of groups) {
      const index = group.fields.findIndex((field) => field.el === el);
      if (index < 0) continue;
      const field = group.fields[index];
      const role = group.form.roles[index];
      if (field.ignored) return null;
      if (PASSWORD_TYPES.includes(role)) {
        return { role: "password", type: role, kind: group.form.kind, group, index };
      }
      if (role === "otp") return { role: "otp", type: role, kind: group.form.kind, group, index };
      if (
        index === group.form.username &&
        (group.form.kind === "login" || group.form.kind === "login-step")
      ) {
        return { role: "username", type: role, kind: group.form.kind, group, index };
      }
      const fillable = group.fields.filter(
        (item, i) => !item.ignored && FILLABLE.has(group.form.roles[i]),
      ).length;
      if (FILLABLE.has(role) && (fillable >= 2 || group.form.kind === "signup")) {
        return { role: "form", type: role, kind: group.form.kind, group, index, fillable };
      }
      if (index === group.form.username) {
        return { role: "username", type: role, kind: group.form.kind, group, index };
      }
      return null;
    }
    return null;
  }

  /** Escreve o valor como o usuário faria: setter nativo + input/change (React, Vue, Angular). */
  function setValue(el, value, options) {
    const view = viewOf(el);
    if (!view) return false;
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* elementos sem foco */
    }
    if (el.tagName === "SELECT") {
      el.selectedIndex = value;
    } else {
      const proto =
        el.tagName === "TEXTAREA"
          ? view.HTMLTextAreaElement.prototype
          : view.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) descriptor.set.call(el, value);
      else el.value = value;
    }
    const Input = view.InputEvent || view.Event;
    el.dispatchEvent(
      new Input("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: String(value),
      }),
    );
    el.dispatchEvent(new view.Event("change", { bubbles: true }));
    if (options && options.blur) el.dispatchEvent(new view.FocusEvent("blur"));
    return true;
  }

  function editable(el) {
    return el && !el.disabled && !el.readOnly && isVisible(el);
  }

  function activeIn(doc) {
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement)
      active = active.shadowRoot.activeElement;
    return active;
  }

  /** Grupo de login: o do campo em foco, senão o primeiro com senha, senão o de usuário. */
  function loginGroup(groups, active) {
    const withField = groups.find((group) => group.fields.some((field) => field.el === active));
    if (
      withField &&
      (withField.form.password >= 0 ||
        withField.form.username >= 0 ||
        withField.form.newPassword >= 0)
    )
      return withField;
    return (
      groups.find((group) => group.form.kind === "login") ||
      groups.find((group) => group.form.password >= 0) ||
      groups.find((group) => group.form.kind === "login-step") ||
      groups.find((group) => group.form.username >= 0) ||
      null
    );
  }

  /** Preenche usuário/senha (data: { username, password }). */
  function fillLogin(doc, data) {
    const groups = analyze(doc);
    const active = activeIn(doc);
    const group = loginGroup(groups, active);
    if (!group) return { filled: false, password: false, username: false };
    const { form, fields } = group;
    const passIndex =
      form.password >= 0
        ? form.password
        : form.newPassword >= 0 && form.kind !== "signup"
          ? form.newPassword
          : fields.findIndex((field) => field.password);
    const pass = passIndex >= 0 ? fields[passIndex].el : null;
    const user = form.username >= 0 ? fields[form.username].el : null;
    let filled = false;
    if (data.username && user && editable(user)) filled = setValue(user, data.username) || filled;
    if (data.password && pass && editable(pass)) filled = setValue(pass, data.password) || filled;
    if (pass && data.password && editable(pass)) {
      try {
        pass.focus();
      } catch {
        /* sem foco */
      }
    }
    return { filled, password: Boolean(pass), username: Boolean(user) };
  }

  /** O que o usuário já digitou no login (para "salvar login"). */
  function readLogin(doc) {
    const groups = analyze(doc, { includeHidden: true });
    for (const group of groups) {
      const passField =
        (group.form.password >= 0 && group.fields[group.form.password]) ||
        (group.form.newPassword >= 0 && group.fields[group.form.newPassword]) ||
        group.fields.find((field) => field.password);
      if (!passField || !passField.el.value) continue;
      const user = group.form.username >= 0 ? group.fields[group.form.username].el.value : "";
      return { username: user || "", password: passField.el.value, kind: group.form.kind };
    }
    return { username: "", password: "", kind: null };
  }

  /**
   * Preenche com um perfil o grupo do campo em foco (ou todos os grupos de perfil).
   * `data`: { values: {tipo: valor}, mappings: {assinatura: tipo|"ignore"}, overwrite }.
   * Devolve { filled, fields: [{ signature, type, label }] } e os elementos preenchidos.
   */
  function fillProfile(doc, data) {
    const values = (data && data.values) || {};
    const groups = analyze(doc, { mappings: (data && data.mappings) || {} });
    const active = activeIn(doc);
    const focused = groups.find((group) => group.fields.some((field) => field.el === active));
    const targets = focused ? [focused] : groups.filter((group) => group.form.kind !== "login");
    const done = [];
    const elements = [];
    for (const group of targets) {
      const radios = new Map();
      group.fields.forEach((field, index) => {
        const type = group.form.roles[index];
        if (!type || field.ignored || !FILLABLE.has(type)) return;
        // Usuário do login nunca recebe dado de perfil por aqui.
        if (index === group.form.username && group.form.kind === "login") return;
        const value = values[type];
        if (!value) return;
        const el = field.el;
        if (!editable(el)) return;
        if (el.type === "radio" || el.type === "checkbox") {
          if (el.type === "radio" && el.name) {
            const list = radios.get(el.name) || [];
            list.push({ el, field, type });
            radios.set(el.name, list);
          }
          return;
        }
        const filledAlready =
          el.tagName === "SELECT" ? el.selectedIndex > 0 && Boolean(el.value) : Boolean(el.value);
        if (filledAlready && !(data && data.overwrite) && el !== active) return;
        if (el.tagName === "SELECT") {
          const options = Array.from(el.options).map((option) => ({
            value: option.value,
            text: option.text,
          }));
          const index = matchOption(type, value, options);
          if (index < 0) return;
          setValue(el, index, { blur: true });
        } else {
          const formatted = formatValue(type, value, {
            inputType: field.inputType,
            maxLength: field.signals.maxLength,
            placeholder: field.signals.placeholder,
            pattern: field.signals.pattern,
          });
          if (!formatted) return;
          setValue(el, formatted, { blur: true });
        }
        done.push({
          signature: field.signature,
          type,
          label: field.signals.label || field.signals.placeholder || field.signals.name || "",
        });
        elements.push({ el, type, signature: field.signature, value: el.value });
      });
      // Rádios: marca só quando uma opção bate sem ambiguidade com o valor.
      for (const list of radios.values()) {
        const type = list[0].type;
        const options = list.map((item) => ({
          value: item.el.value,
          text: labelOf(item.el) || item.el.value,
        }));
        const index = matchOption(type, values[type], options);
        if (index < 0) continue;
        const target = list[index].el;
        if (!target.checked) {
          target.checked = true;
          const view = viewOf(target);
          target.dispatchEvent(new view.Event("input", { bubbles: true }));
          target.dispatchEvent(new view.Event("change", { bubbles: true }));
        }
        done.push({ signature: list[index].field.signature, type, label: options[index].text });
      }
    }
    try {
      if (active && active.focus) active.focus({ preventScroll: true });
    } catch {
      /* sem foco */
    }
    return { filled: done.length, fields: done, elements };
  }

  /** Tipo do perfil cujo valor é este (para aprender com uma correção do usuário). */
  function typeForValue(values, raw) {
    const target = norm(raw);
    const targetDigits = digits(raw);
    if (!target) return null;
    for (const [type, value] of Object.entries(values || {})) {
      if (!FILLABLE.has(type)) continue;
      if (norm(value) === target) return type;
      if (targetDigits.length >= 8 && digits(value) === targetDigits) return type;
    }
    return null;
  }

  return {
    PROFILE_TYPES,
    PASSWORD_TYPES,
    ALL_TYPES,
    FILLABLE,
    UFS,
    norm,
    autocompleteType,
    classifyField,
    resolveForm,
    isSubmitLabel,
    profileValues,
    formatValue,
    isoDate,
    matchOption,
    fieldSignature,
    hostOf,
    siteOfHost,
    frameAllowed,
    siteKey,
    typeForValue,
    // DOM
    isFieldElement,
    isVisible,
    deepFields,
    signalsOf,
    groupOf,
    buttonsOf,
    analyze,
    fieldRole,
    setValue,
    activeIn,
    fillLogin,
    readLogin,
    fillProfile,
  };
}

const FORM_INTEL_SOURCE = formIntelFactory.toString();

module.exports = { formIntelFactory, FORM_INTEL_SOURCE, ...formIntelFactory() };
