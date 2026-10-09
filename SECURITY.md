# Segurança

## Assinatura e atualização no Mac

- O Agzos Browser para Mac é assinado com o certificado autoassinado "Rodrigo Dev Local"
  (SHA-1 `D0582BBAA268109351724BA351903BC911344EC4`). **Não há notarização da Apple.** A
  assinatura só é confiável nos Macs onde esse certificado foi marcado como confiável. Em
  outros Macs, o Gatekeeper trata o app como de desenvolvedor não identificado.
- O `.p12` e a senha ficam só no servidor de build, em `/root/.agzos-signing/` (`600`,
  dono root), fora do repositório. Nunca vão para a linha de comando, para logs nem para
  artefatos. A cópia convertida que o `rcodesign` usa vive numa pasta temporária `700` e
  é apagada no fim, inclusive em falha. Os secrets `MAC_CERT_P12` e `MAC_CERT_PASSWORD`
  do GitHub não são usados pelo build atual.
- A release falha se algum binário do Mac sair ad-hoc, sem runtime endurecido ou assinado
  por outro certificado (`scripts/verify-mac-signature.sh`). Nunca se publica ad-hoc.
- O updater do Mac (`electron/updater.cjs`) confere o SHA-256 do pacote, que vem no
  `latest.json` servido por HTTPS. Antes de instalar, também roda
  `codesign --verify --deep --strict` no `.app` novo e exige que o certificado folha
  tenha o SHA-1 fixado. Um pacote trocado no servidor não passa sem a chave privada. O
  manifesto não tem assinatura própria (Ed25519 ou outra).
- Por que isso importa: o macOS guarda o "Permitir sempre" das Chaves ("Agzos Browser
  Safe Storage", a chave que cifra cookies e senhas) preso ao requisito designado do
  app. Com o certificado fixo, esse requisito é
  `identifier "br.agzos.browser" and certificate root = H"d058…"`, igual em todas as
  versões, e a permissão continua valendo depois de cada OTA. Com ad-hoc, o requisito era
  o hash do binário e mudava a cada versão.
- Entitlements (`scripts/entitlements.mac.plist`):
  - `allow-jit`, `allow-unsigned-executable-memory` e `disable-library-validation`, que o
    Electron precisa com o runtime endurecido e um certificado sem Team ID;
  - microfone e câmera.

  Nenhuma chave de desenvolvedor da Apple: sem perfil pago, o app não abriria.

## Windows

- O instalador é por usuário (sem administrador), grava só em HKCU e nunca apaga o perfil
  (`%APPDATA%\Agzos Browser`) nem cópias portáteis. Não tem assinatura Authenticode.
- O OTA confere o SHA-256 do ZIP antes de copiar.

## Reportar um problema

Fale com a Agzos pelo site https://agzosagency.com.br/.
