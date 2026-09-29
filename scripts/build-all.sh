#!/bin/bash
set -e

VERSION="1.3.7"
# Arquivos do processo principal que vão para resources/app/electron.
# adblocker.vendor.cjs é gerado pelo `bun run desktop:build` (bundle do @ghostery/adblocker).
ELECTRON_FILES=(main.cjs preload.cjs db.cjs adblock.cjs adblock-worker.cjs adblocker.vendor.cjs downloads.cjs zoom.cjs)

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
cp -r /var/www/agzos-browser/dist win/resources/app/dist
printf '%s\n' "$APPJSON" > win/resources/app/package.json
rm -f win/resources/default_app.asar
mv win/electron.exe win/AgzosBrowser.exe
(cd win/locales && ls | grep -v -E '^(en-US|pt-BR)\.pak$' | xargs rm -f)
(cd win && zip -qr9 "$ARTIFACTS/Agnos-Browser-win32-x64.zip" .)
echo "Win OK"

# Linux
echo "Building Linux..."
rm -rf linux && mkdir linux && unzip -q ../electron-v44.4.5-linux-x64.zip -d linux
mkdir -p linux/resources/app/electron
for f in "${ELECTRON_FILES[@]}"; do cp "/var/www/agzos-browser/electron/$f" linux/resources/app/electron/; done
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

  # Os helpers do Electron vêm sem CFBundleExecutable. O codesign da Apple deduz o
  # executável pelo nome, o rcodesign não: sem a chave ele sela o bundle mas assina o
  # binário como Mach-O avulso (sem Info.plist/recursos) e o Gatekeeper acusa "danificado".
  python3 - "$APP" <<'PY'
import glob, os, plistlib, sys
for path in glob.glob(os.path.join(sys.argv[1], "Contents/Frameworks/*.app/Contents/Info.plist")):
    with open(path, "rb") as f:
        data = plistlib.load(f)
    if "CFBundleExecutable" not in data:
        data["CFBundleExecutable"] = data["CFBundleName"]
        with open(path, "wb") as f:
            plistlib.dump(data, f)
PY

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
bash scripts/release-browser.sh --version $VERSION --artifacts "$ARTIFACTS" --yes
