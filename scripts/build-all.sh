#!/bin/bash
set -e

VERSION="4.7.0"
# Arquivos do processo principal que vão para resources/app/electron.
# adblocker.vendor.cjs e argon2.vendor.cjs são gerados pelo `bun run desktop:build`
# (bundles do @ghostery/adblocker e do @noble/hashes, sem node_modules).
ELECTRON_FILES=(main.cjs preload.cjs page-preload.cjs db.cjs adblock.cjs adblock-worker.cjs argon2-worker.cjs adblocker.vendor.cjs argon2.vendor.cjs downloads.cjs zoom.cjs permissions.cjs suggest.cjs updater.cjs install-update.cjs windows.cjs hibernate.cjs hover-card.cjs switcher-layer.cjs chrome-overlay.cjs overlay-preload.cjs agzos-key.cjs gx-control.cjs panel-session.cjs gpu-flags.cjs ai.cjs ai-library.cjs terminal.cjs terminal-launch.cjs terminal-secrets.cjs ssh-keys.cjs cli-install.cjs files.cjs pwa.cjs session-tabs.cjs ports.cjs ports-service.cjs tunnel.cjs inspector.cjs reader.cjs scratchpad.cjs crx.cjs extensions.cjs capture.cjs tooltip.cjs download-rules.cjs page-theme.cjs color-tools.cjs pdf-tools.cjs)

command -v rcodesign >/dev/null || { echo "rcodesign ausente (github.com/indygreg/apple-platform-rs, apple-codesign)" >&2; exit 1; }

cd /var/www/agzos-browser
sed -i -E "s/\"version\": \"[0-9.]+\"/\"version\": \"$VERSION\"/" package.json
bun run desktop:build
for f in "${ELECTRON_FILES[@]}"; do
  [ -f "electron/$f" ] || { echo "electron/$f ausente depois do desktop:build" >&2; exit 1; }
done

# Terminal (4.0): o node-pty é o único módulo nativo (N-API: o mesmo binário serve ao
# Electron). Vai só o lib/ e o binário da plataforma, em resources/app/node_modules.
PTY_SRC=/var/www/agzos-browser/node_modules/node-pty
[ -f "$PTY_SRC/lib/index.js" ] || { echo "node-pty ausente (bun install)" >&2; exit 1; }
copy_pty() { # destino (resources/app), plataforma-arquitetura (win32-x64, darwin-arm64, linux-x64)
  mkdir -p "$1/node_modules/node-pty"
  local dest
  dest="$(cd "$1/node_modules/node-pty" && pwd)"
  cp "$PTY_SRC/package.json" "$PTY_SRC/LICENSE" "$dest/"
  (cd "$PTY_SRC" && find lib -name '*.js' ! -name '*.test.js' -print0 | xargs -0 cp --parents -t "$dest")
  if [ "$2" = "linux-x64" ]; then
    # Sem prebuild de Linux: o binário compilado pelo bun install.
    mkdir -p "$dest/build/Release" && cp "$PTY_SRC/build/Release/pty.node" "$dest/build/Release/"
  else
    mkdir -p "$dest/prebuilds" && cp -r "$PTY_SRC/prebuilds/$2" "$dest/prebuilds/"
    # Símbolos de depuração do Windows (.pdb, ~27 MB) não vão no app.
    find "$dest/prebuilds" -name '*.pdb' -delete
  fi
  # O pacote do npm traz o spawn-helper do macOS sem permissão de execução.
  if [ -f "$dest/prebuilds/$2/spawn-helper" ]; then chmod +x "$dest/prebuilds/$2/spawn-helper"; fi
}

SCRATCH="/tmp/electron-build"
mkdir -p "$SCRATCH"
cd "$SCRATCH"

# 4.5: Electron da castLabs (ECS, "+wvcus"): o mesmo Electron 44 com o módulo `components`,
# que baixa e registra o CDM Widevine oficial do Google (Netflix, Spotify). O Electron
# oficial não traz Widevine.
ELECTRON_TAG="v44.5.1+wvcus"
ELECTRON_URL="https://github.com/castlabs/electron-releases/releases/download/${ELECTRON_TAG//+/%2B}"
for plat in win32-x64 linux-x64 darwin-arm64 darwin-x64; do
  f="electron-$ELECTRON_TAG-$plat.zip"
  if [ ! -f "$f" ]; then
    echo "Downloading $f..."
    curl -fL --retry 2 -sS -o "$f" "$ELECTRON_URL/${f//+/%2B}"
  fi
done

# Assinatura VMP (castLabs EVS): sem ela o Widevine roda, mas a Netflix recusa no Windows e
# no macOS. Precisa de conta EVS (python3 -m castlabs_evs.account signup/reauth); sem
# conta o build segue e avisa.
vmp_sign() { # pasta do app
  if python3 -c "import castlabs_evs" 2>/dev/null; then
    python3 -m castlabs_evs.vmp sign-pkg "$1" || echo "Aviso: assinatura VMP falhou em $1" >&2
  else
    echo "Aviso: castlabs-evs ausente; $1 sai sem assinatura VMP (Netflix recusa no Windows/macOS)." >&2
  fi
}

APPJSON="{ \"name\": \"agzos-browser\", \"productName\": \"Agzos Browser\", \"version\": \"$VERSION\", \"main\": \"electron/main.cjs\", \"private\": true }"
ARTIFACTS="/var/www/agzosagency/browser-artifacts-v${VERSION//./}"
mkdir -p "$ARTIFACTS"
# zip/xorriso reaproveitam arquivos existentes; recomeça do zero a cada build.
rm -f "$ARTIFACTS"/Agnos-Browser-*

rm -rf v$VERSION && mkdir v$VERSION && cd v$VERSION

# Win
echo "Building Win..."
rm -rf win && mkdir win && unzip -q "../electron-$ELECTRON_TAG-win32-x64.zip" -d win
mkdir -p win/resources/app/electron
for f in "${ELECTRON_FILES[@]}"; do cp "/var/www/agzos-browser/electron/$f" win/resources/app/electron/; done
mkdir -p win/resources/app/electron/icons && cp /var/www/agzos-browser/electron/icons/icon.png win/resources/app/electron/icons/
cp -r /var/www/agzos-browser/dist win/resources/app/dist
copy_pty win/resources/app win32-x64
printf '%s\n' "$APPJSON" > win/resources/app/package.json
rm -f win/resources/default_app.asar
mv win/electron.exe win/AgzosBrowser.exe
# Nome "Agzos Browser" e ícone no .exe (o Gerenciador de Tarefas mostra a descrição do .exe).
node /var/www/agzos-browser/scripts/brand-win.mjs win/AgzosBrowser.exe /var/www/agzos-browser/electron/icons/icon.ico "$VERSION"
(cd win/locales && ls | grep -v -E '^(en-US|pt-BR)\.pak$' | xargs rm -f)
# Windows: a VMP vai depois de mexer no .exe (marca e ícone).
vmp_sign win
(cd win && zip -qr9 "$ARTIFACTS/Agnos-Browser-win32-x64.zip" .)
echo "Win OK"

# Linux
echo "Building Linux..."
rm -rf linux && mkdir linux && unzip -q "../electron-$ELECTRON_TAG-linux-x64.zip" -d linux
mkdir -p linux/resources/app/electron
for f in "${ELECTRON_FILES[@]}"; do cp "/var/www/agzos-browser/electron/$f" linux/resources/app/electron/; done
mkdir -p linux/resources/app/electron/icons && cp /var/www/agzos-browser/electron/icons/icon.png linux/resources/app/electron/icons/
cp -r /var/www/agzos-browser/dist linux/resources/app/dist
copy_pty linux/resources/app linux-x64
printf '%s\n' "$APPJSON" > linux/resources/app/package.json
rm -f linux/resources/default_app.asar
mv linux/electron linux/agzos-browser
chmod +x linux/agzos-browser
(cd linux/locales && ls | grep -v -E '^(en-US|pt-BR)\.pak$' | xargs rm -f)
tar -czf "$ARTIFACTS/Agnos-Browser-linux-x64.tar.gz" -C linux .
echo "Linux OK"

# Mac
for arch in arm64 x64; do
  echo "Building Mac $arch..."
  rm -rf mac-$arch && mkdir mac-$arch && unzip -q "../electron-$ELECTRON_TAG-darwin-$arch.zip" -d mac-$arch
  mv "mac-$arch/Electron.app" "mac-$arch/Agzos Browser.app"
  APP="mac-$arch/Agzos Browser.app"
  
  python3 - "$APP/Contents/Info.plist" <<PY
import plistlib, sys
path = sys.argv[1]
with open(path, "rb") as f:
    data = plistlib.load(f)
data["CFBundleName"] = "Agzos Browser"
data["CFBundleDisplayName"] = "Agzos Browser"
data["CFBundleIdentifier"] = "br.agzos.browser"
# Modo voz do terminal (4.1) e páginas que usam o microfone.
data["NSMicrophoneUsageDescription"] = "O Agzos usa o microfone no modo voz do terminal e nos sites que você permitir."
# 4.1.1 fix: aparece no "Abrir com" do Finder para qualquer arquivo (evento open-file).
data["CFBundleDocumentTypes"] = [{
    "CFBundleTypeName": "Arquivo",
    "CFBundleTypeRole": "Viewer",
    "LSHandlerRank": "Alternate",
    "LSItemContentTypes": ["public.data", "public.content"],
}]
with open(path, "wb") as f:
    plistlib.dump(data, f)
PY

  # Marca no Mac (como o electron-packager): executável "Agzos Browser", helpers
  # "Agzos Browser Helper (…)" (o Monitor de Atividade mostra esses nomes) e ícone.
  # O Electron acha os helpers pelo CFBundleName do app ("<nome> Helper").
  # Os helpers vêm sem CFBundleExecutable: o codesign da Apple deduz, o rcodesign não
  # (sem a chave ele assina o binário como Mach-O avulso e o Gatekeeper acusa "danificado").
  cp /var/www/agzos-browser/electron/icons/icon.icns "$APP/Contents/Resources/agzos.icns"
  python3 /var/www/agzos-browser/scripts/brand-mac.py "$APP"
  [ -x "$APP/Contents/MacOS/Agzos Browser" ] || { echo "Executável do Mac não renomeado" >&2; exit 1; }

  mkdir -p "$APP/Contents/Resources/app/electron"
  for f in "${ELECTRON_FILES[@]}"; do cp "/var/www/agzos-browser/electron/$f" "$APP/Contents/Resources/app/electron/"; done
  cp -r /var/www/agzos-browser/dist "$APP/Contents/Resources/app/dist"
  copy_pty "$APP/Contents/Resources/app" darwin-$arch
  printf '%s\n' "$APPJSON" > "$APP/Contents/Resources/app/package.json"
  rm -f "$APP/Contents/Resources/default_app.asar"
  (cd "$APP/Contents/Resources" && ls -d *.lproj | grep -v -E '^(en|pt-BR)\.lproj$' | xargs rm -rf)

  # macOS: a VMP vai antes da assinatura do bundle (o selo cobre o .sig).
  vmp_sign "mac-$arch"

  # O Electron vem só "linker-signed", sem selo do bundle; depois de mexer no
  # Info.plist e em Resources, o Gatekeeper do Apple Silicon acusa "danificado".
  # Assinatura ad-hoc (rcodesign) sela o bundle inteiro, helpers incluídos.
  rcodesign sign "$APP" > "mac-$arch/sign.log" 2>&1
  [ -f "$APP/Contents/_CodeSignature/CodeResources" ] || { echo "Falha ao assinar $APP" >&2; exit 1; }
  # Todo helper precisa ser assinado como executável principal do próprio bundle.
  if grep -q "could not find main executable" "mac-$arch/sign.log"; then
    grep "could not find main executable" "mac-$arch/sign.log" >&2
    echo "Assinatura incompleta em $APP (o Gatekeeper acusaria \"danificado\")" >&2
    exit 1
  fi

  (cd mac-$arch && zip -qry9 "$ARTIFACTS/Agnos-Browser-mac-$arch.app.zip" "Agzos Browser.app")
  
  rm -rf dmgstage-$arch && mkdir dmgstage-$arch
  cp -a "$APP" "dmgstage-$arch/"
  ln -s /Applications "dmgstage-$arch/Applications"
  xorriso -as mkisofs -quiet -R -J -V "Agzos Browser" -o "$ARTIFACTS/Agnos-Browser-mac-$arch.dmg" "dmgstage-$arch"
  echo "Mac $arch OK"
done

cd /var/www/agzos-browser
bash scripts/release-browser.sh --version $VERSION --artifacts "$ARTIFACTS" --yes --notes "4.7.0: gerenciador de downloads (Ctrl+J), tema Dark por site, ColorTools e PDF Tools local (editar, comprimir, senha, OCR)."
