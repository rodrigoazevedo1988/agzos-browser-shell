# Build e publicação

Toda versão é gerada e publicada **neste servidor** (`vmi2934451`, 157.173.206.196), como
root, por `scripts/build-all.sh`. O script baixa o Electron da castLabs, monta Windows,
Linux e Mac, assina, verifica e chama `scripts/release-browser.sh`, que publica em
`https://agzosagency.com.br/browser/` e grava o `latest.json` do OTA. O `ci.yml` do
GitHub roda só lint, typecheck, testes unitários e e2e. Ele não gera nem publica releases.

```sh
bash scripts/build-all.sh   # a versão vem de VERSION= no topo do script
```

Antes de publicar, rode `bun run lint`, `bun run typecheck`, `bun run test`,
`bun run test:e2e:web` e `xvfb-run -a bun run test:e2e:desktop` (ver `AGENTS.md`).

## Artefatos

| Arquivo                             | Para quê                                                     |
| ----------------------------------- | ------------------------------------------------------------ |
| `Agzos-Browser-win32-x64-setup.exe` | Instalador do Windows (NSIS, por usuário, sem administrador) |
| `Agzos-Browser-win32-x64.zip`       | Portátil do Windows e pacote do OTA                          |
| `Agzos-Browser-linux-x64.tar.gz`    | Linux e pacote do OTA                                        |
| `Agzos-Browser-mac-<arch>.dmg`      | Mac: arrastar para Aplicativos                               |
| `Agzos-Browser-mac-<arch>.app.zip`  | Mac: pacote do OTA                                           |

## Windows: instalador

`scripts/windows-installer.nsi` é compilado pelo `makensis` (pacote `nsis` do Ubuntu).
Ele roda em segundo plano enquanto o Linux e o Mac são montados. O instalador:

- grava em `%LOCALAPPDATA%\Programs\Agzos Browser`;
- cria os atalhos na Área de trabalho e no menu Iniciar;
- grava a entrada de "Programas e Recursos" em HKCU;
- nunca toca no perfil (`%APPDATA%\Agzos Browser`) nem em cópias portáteis.

O desinstalador também mantém o perfil. O OTA continua usando o ZIP e copia por cima da
pasta instalada. Ao abrir, o app acerta a versão em "Programas e Recursos"
(`electron/win-install.cjs`). O `.exe` não tem assinatura Authenticode, então o
SmartScreen avisa na primeira execução.

## Mac: assinatura com o certificado "Rodrigo Dev Local"

O Mac é assinado no Linux pelo `rcodesign` com um certificado de assinatura de código
**autoassinado**, fixado pelo SHA-1 `D0582BBAA268109351724BA351903BC911344EC4`. Não há
Apple Developer ID nem notarização. A confiança vale só nos Macs onde esse certificado foi
marcado como confiável.

### Onde fica o certificado

| Arquivo                                       | Conteúdo                                    | Permissão          |
| --------------------------------------------- | ------------------------------------------- | ------------------ |
| `/root/.agzos-signing/rodrigo-dev-local.p12`  | PKCS#12 com o certificado e a chave privada | `600`, dono `root` |
| `/root/.agzos-signing/rodrigo-dev-local.pass` | só a senha do `.p12` (uma linha)            | `600`, dono `root` |

A pasta pode ser trocada com `AGZOS_SIGNING_DIR`. O `.p12` pode vir do openssl 3 (AES)
ou estar no formato legacy (3DES): o `scripts/sign-mac.sh` converte para legacy numa
pasta temporária só do root, que é apagada no fim, porque o `rcodesign` 0.29 só lê
legacy. A senha nunca vai para a linha de comando nem para o log (`set +x`,
`-passin file:`, `--p12-password-file`).

Para copiar do Mac para o servidor:

```sh
ssh root@157.173.206.196 'install -d -m 700 /root/.agzos-signing'
scp rodrigo-dev-local.p12 root@157.173.206.196:/root/.agzos-signing/
ssh root@157.173.206.196 'umask 077; cat > /root/.agzos-signing/rodrigo-dev-local.pass'
#   (cole a senha, Enter, Ctrl+D)
ssh root@157.173.206.196 'chmod 600 /root/.agzos-signing/*; chown root:root /root/.agzos-signing/*'
```

### O que o build faz

1. Logo no início, confere que os dois arquivos existem com `600 root` e que o
   certificado do `.p12` tem o SHA-1 fixado. Senão, para antes de compilar.
2. `scripts/sign-mac.sh` assina de dentro para fora: dylibs, `.node`, frameworks
   (Electron, Squirrel, Mantle, ReactiveObjC), os quatro Helpers e, por último, o
   bundle.
   - Runtime endurecido (`runtime`) em todo Mach-O.
   - Sem timestamp (`--timestamp-url none`) e sem `--deep`.
   - Entitlements de `scripts/entitlements.mac.plist` no executável e nos Helpers.
3. `scripts/verify-mac-signature.sh` confere o `.app` e depois o `.app.zip` publicado. A
   release falha se:
   - algum Mach-O estiver sem assinatura, ad-hoc ou sem runtime;
   - algum Mach-O for assinado por outro certificado;
   - faltar o `CodeResources`;
   - o identificador não for `br.agzos.browser`.

Os identificadores são fixos: `br.agzos.browser` e `br.agzos.browser.helper[.GPU|.Renderer|.Plugin]`.

### Como conferir

No log do build aparece uma linha por arquitetura:

```
Assinatura do Mac OK: 15 binários, Authority=CN=Rodrigo Dev Local, SHA-1=D0582BBAA268109351724BA351903BC911344EC4
```

No servidor, para um artefato já publicado:

```sh
bash scripts/verify-mac-signature.sh /var/www/agzosagency/browser/v<versão>/Agzos-Browser-mac-arm64.app.zip D0582BBAA268109351724BA351903BC911344EC4
```

No Mac:

```sh
codesign --verify --deep --strict --verbose=2 "/Applications/Agzos Browser.app"
codesign -dvv "/Applications/Agzos Browser.app" 2>&1 | grep -E "Authority|Identifier|flags"
codesign -d --extract-certificates=/tmp/agzos "/Applications/Agzos Browser.app" && shasum -a 1 /tmp/agzos0
```

### DMG

O DMG é uma imagem ISO 9660 gerada pelo `xorriso`, com o app e um atalho para
Aplicativos. Esse formato não aceita assinatura de código, por isso o DMG em si não é
assinado. O app dentro dele é, e o OTA usa o `.app.zip`.

### PWAs instalados (clones)

O `.app` de cada PWA é montado no Mac do usuário (`electron/pwa-mac.cjs`). Se o
`security find-identity -v -p codesigning` listar o SHA-1 fixado, em qualquer keychain da
lista de busca, o clone é assinado com ele. Senão, sai ad-hoc e a casca avisa. O
identificador de cada clone é fixo: `br.agzos.browser.pwa.<id>`.
