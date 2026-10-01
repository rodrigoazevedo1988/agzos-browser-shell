#!/bin/bash
set -e

VERSION="2.2.4"
# Arquivos do processo principal que vão para resources/app/electron.
# adblocker.vendor.cjs e argon2.vendor.cjs são gerados pelo `bun run desktop:build`
# (bundles do @ghostery/adblocker e do @noble/hashes, sem node_modules).
ELECTRON_FILES=(main.cjs preload.cjs page-preload.cjs db.cjs adblock.cjs adblock-worker.cjs argon2-worker.cjs adblocker.vendor.cjs argon2.vendor.cjs downloads.cjs zoom.cjs permissions.cjs suggest.cjs updater.cjs install-update.cjs windows.cjs hibernate.cjs hover-card.cjs switcher-layer.cjs chrome-overlay.cjs overlay-preload.cjs agzos-key.cjs)

command -v rcodesign >/dev/null || { echo "rcodesign ausente (github.com/indygreg/apple-platform-rs, apple-codesign)" >&2; exit 1; }

cd /var/www/agzos-browser
sed -i -E "s/\"version\": \"[0-9.]+\"/\"version\": \"$VERSION\"/" package.json
bun run desktop:build
for f in "${ELECTRON_FILES[@]}"; do
  [ -f "electron/$f" ] || { echo "electron/$f ausente depois do desktop:build" >&2; exit 1; }
done

SCRATCH="/tmp/electron-build"
mkdir -p "$SCRATCH"
cd "$SCRATCH"

# Download if not present
for f in electron-v44.4.5-win32-x64.zip electron-v44.4.5-linux-x64.zip electron-v44.4.5-darwin-arm64.zip electron-v44.4.5-darwin-x64.zip; do
  if [ ! -f "$f" ]; then
    echo "Downloading $f..."
    curl -fL --retry 2 -sS -O "https://github.com/electron/electron/releases/download/v44.4.5/$f"
  fi
done

APPJSON="{ \"name\": \"agzos-browser\", \"productName\": \"Agzos Browser\", \"version\": \"$VERSION\", \"main\": \"electron/main.cjs\", \"private\": true }"
ARTIFACTS="/var/www/agzosagency/browser-artifacts-v${VERSION//./}"
mkdir -p "$ARTIFACTS"
# zip/xorriso reaproveitam arquivos existentes; recomeça do zero a cada build.
rm -f "$ARTIFACTS"/Agnos-Browser-*

rm -rf v$VERSION && mkdir v$VERSION && cd v$VERSION

# Win
echo "Building Win..."
rm -rf win && mkdir win && unzip -q ../electron-v44.4.5-win32-x64.zip -d win
mkdir -p win/resources/app/electron
for f in "${ELECTRON_FILES[@]}"; do cp "/var/www/agzos-browser/electron/$f" win/resources/app/electron/; done
mkdir -p win/resources/app/electron/icons && cp /var/www/agzos-browser/electron/icons/icon.png win/resources/app/electron/icons/
cp -r /var/www/agzos-browser/dist win/resources/app/dist
printf '%s\n' "$APPJSON" > win/resources/app/package.json
rm -f win/resources/default_app.asar
mv win/electron.exe win/AgzosBrowser.exe
# Nome "Agzos Browser" e ícone no .exe (o Gerenciador de Tarefas mostra a descrição do .exe).
node /var/www/agzos-browser/scripts/brand-win.mjs win/AgzosBrowser.exe /var/www/agzos-browser/electron/icons/icon.ico "$VERSION"
(cd win/locales && ls | grep -v -E '^(en-US|pt-BR)\.pak$' | xargs rm -f)
(cd win && zip -qr9 "$ARTIFACTS/Agnos-Browser-win32-x64.zip" .)
echo "Win OK"

# Linux
echo "Building Linux..."
rm -rf linux && mkdir linux && unzip -q ../electron-v44.4.5-linux-x64.zip -d linux
mkdir -p linux/resources/app/electron
for f in "${ELECTRON_FILES[@]}"; do cp "/var/www/agzos-browser/electron/$f" linux/resources/app/electron/; done
mkdir -p linux/resources/app/electron/icons && cp /var/www/agzos-browser/electron/icons/icon.png linux/resources/app/electron/icons/
cp -r /var/www/agzos-browser/dist linux/resources/app/dist
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
  rm -rf mac-$arch && mkdir mac-$arch && unzip -q ../electron-v44.4.5-darwin-$arch.zip -d mac-$arch
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
  printf '%s\n' "$APPJSON" > "$APP/Contents/Resources/app/package.json"
  rm -f "$APP/Contents/Resources/default_app.asar"
  (cd "$APP/Contents/Resources" && ls -d *.lproj | grep -v -E '^(en|pt-BR)\.lproj$' | xargs rm -rf)

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
bash scripts/release-browser.sh --version $VERSION --artifacts "$ARTIFACTS" --yes --notes "Correção: as pastas da barra de favoritos abriam o menu atrás da página do site; agora o menu da pasta aparece sempre por cima."
