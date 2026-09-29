import type { CrashReason, LoadFailure } from "./desktop";

/** Tipo de tela de erro: decide ícone, texto e ações. */
export type LoadErrorKind =
  | "offline"
  | "dns"
  | "connection"
  | "timeout"
  | "certificate"
  | "blocked"
  | "redirects"
  | "file"
  | "generic";

export type LoadErrorInfo = {
  kind: LoadErrorKind;
  title: string;
  message: string;
  /** Código do Chromium, como o Chrome mostra (ex.: ERR_NAME_NOT_RESOLVED). */
  code: string;
  /** Volta sozinho quando a conexão voltar (o Chrome faz o mesmo). */
  retryWhenOnline: boolean;
};

// https://source.chromium.org/chromium/chromium/src/+/main:net/base/net_error_list.h
const NET_ERRORS: Record<number, string> = {
  [-2]: "ERR_FAILED",
  [-6]: "ERR_FILE_NOT_FOUND",
  [-7]: "ERR_TIMED_OUT",
  [-10]: "ERR_ACCESS_DENIED",
  [-20]: "ERR_BLOCKED_BY_CLIENT",
  [-21]: "ERR_NETWORK_CHANGED",
  [-27]: "ERR_BLOCKED_BY_RESPONSE",
  [-100]: "ERR_CONNECTION_CLOSED",
  [-101]: "ERR_CONNECTION_RESET",
  [-102]: "ERR_CONNECTION_REFUSED",
  [-104]: "ERR_CONNECTION_FAILED",
  [-105]: "ERR_NAME_NOT_RESOLVED",
  [-106]: "ERR_INTERNET_DISCONNECTED",
  [-107]: "ERR_SSL_PROTOCOL_ERROR",
  [-109]: "ERR_ADDRESS_UNREACHABLE",
  [-113]: "ERR_SSL_VERSION_OR_CIPHER_MISMATCH",
  [-118]: "ERR_CONNECTION_TIMED_OUT",
  [-130]: "ERR_PROXY_CONNECTION_FAILED",
  [-137]: "ERR_NAME_RESOLUTION_FAILED",
  [-200]: "ERR_CERT_COMMON_NAME_INVALID",
  [-201]: "ERR_CERT_DATE_INVALID",
  [-202]: "ERR_CERT_AUTHORITY_INVALID",
  [-203]: "ERR_CERT_CONTAINS_ERRORS",
  [-206]: "ERR_CERT_REVOKED",
  [-207]: "ERR_CERT_INVALID",
  [-300]: "ERR_INVALID_URL",
  [-301]: "ERR_DISALLOWED_URL_SCHEME",
  [-310]: "ERR_TOO_MANY_REDIRECTS",
  [-312]: "ERR_UNSAFE_PORT",
  [-324]: "ERR_EMPTY_RESPONSE",
};

export function errorCodeName(failure: LoadFailure): string {
  if (NET_ERRORS[failure.code]) return NET_ERRORS[failure.code]!;
  const description = failure.description.replace(/^net::/, "");
  return /^ERR_[A-Z_]+$/.test(description) ? description : `ERRO ${failure.code}`;
}

export function hostOfFailure(failure: LoadFailure): string {
  try {
    return new URL(failure.url).host || failure.url;
  } catch {
    return failure.url;
  }
}

/** Erros de certificado (-200 a -299): a tela oferece "Continuar mesmo assim". */
export function isCertificateError(code: number) {
  return code <= -200 && code > -300;
}

export function describeLoadError(failure: LoadFailure): LoadErrorInfo {
  const host = hostOfFailure(failure);
  const code = errorCodeName(failure);
  const info = (kind: LoadErrorKind, title: string, message: string, retryWhenOnline = false) => ({
    kind,
    title,
    message,
    code,
    retryWhenOnline,
  });
  if (isCertificateError(failure.code)) {
    return info(
      "certificate",
      "Sua conexão não é particular",
      `O certificado de segurança de ${host} não é confiável. Alguém pode estar tentando ler o que você envia (senhas, mensagens, cartões).`,
    );
  }
  switch (failure.code) {
    case -106:
    case -21:
      return info(
        "offline",
        "Sem conexão com a internet",
        "Verifique o Wi-Fi ou o cabo de rede. A página carrega sozinha quando a conexão voltar.",
        true,
      );
    case -105:
    case -137:
      return info(
        "dns",
        "Não foi possível encontrar este site",
        `O endereço de ${host} não foi encontrado. Confira se ele está escrito certo.`,
        true,
      );
    case -7:
    case -118:
      return info(
        "timeout",
        "O site demorou demais para responder",
        `${host} não respondeu a tempo. Ele pode estar fora do ar ou lento.`,
        true,
      );
    case -100:
    case -101:
    case -102:
    case -104:
    case -109:
    case -130:
    case -324:
      return info(
        "connection",
        "Este site não pode ser acessado",
        `${host} recusou a conexão ou a encerrou antes de enviar a página.`,
        true,
      );
    case -20:
      return info(
        "blocked",
        "O escudo bloqueou esta página",
        `${host} está nas listas de anúncios ou rastreadores. Se confia no site, permita-o no escudo.`,
      );
    case -27:
      return info(
        "blocked",
        "O site não permite ser aberto assim",
        `${host} recusou ser exibido nesta página.`,
      );
    case -310:
      return info(
        "redirects",
        "A página entrou em um ciclo de redirecionamentos",
        `${host} redirecionou vezes demais. Limpar os cookies do site costuma resolver.`,
      );
    case -6:
    case -10:
      return info("file", "Arquivo não encontrado", "O arquivo pode ter sido movido ou apagado.");
    default:
      return info(
        "generic",
        "Não foi possível abrir esta página",
        `Algo deu errado ao carregar ${host}.`,
      );
  }
}

export function describeCrash(reason: CrashReason | undefined): { title: string; message: string } {
  switch (reason) {
    case "oom":
      return {
        title: "Esta página ficou sem memória",
        message: "Feche guias que não está usando e recarregue a página.",
      };
    case "killed":
      return {
        title: "Esta página foi encerrada",
        message: "O processo da página foi finalizado (por você ou pelo sistema).",
      };
    case "launch-failed":
      return {
        title: "Não foi possível abrir esta página",
        message: "O processo da página não iniciou. Um antivírus pode estar bloqueando.",
      };
    default:
      return {
        title: "Esta guia travou",
        message: "O processo desta página parou de responder.",
      };
  }
}
