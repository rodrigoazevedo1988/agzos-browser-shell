#!/bin/bash
set -e

VERSION="1.3.2"

cd /var/www/agzos-browser
sed -i "s/\"version\": \"1.3.1\"/\"version\": \"$VERSION\"/" package.json
bun run desktop:build

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
ARTIFACTS="/var/www/agzosagency/browser-artifacts-v132"
mkdir -p "$ARTIFACTS"
# zip/xorriso reaproveitam arquivos existentes; recomeça do zero a cada build.
rm -f "$ARTIFACTS"/Agnos-Browser-*

rm -rf v$VERSION && mkdir v$VERSION && cd v$VERSION

# Win
echo "Building Win..."
rm -rf win && mkdir win && unzip -q ../electron-v44.4.5-win32-x64.zip -d win
mkdir -p win/resources/app/electron
cp /var/www/agzos-browser/electron/main.cjs win/resources/app/electron/
cp /var/www/agzos-browser/electron/preload.cjs win/resources/app/electron/
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
cp /var/www/agzos-browser/electron/main.cjs linux/resources/app/electron/
cp /var/www/agzos-browser/electron/preload.cjs linux/resources/app/electron/
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

  mkdir -p "$APP/Contents/Resources/app/electron"
  cp /var/www/agzos-browser/electron/main.cjs "$APP/Contents/Resources/app/electron/"
  cp /var/www/agzos-browser/electron/preload.cjs "$APP/Contents/Resources/app/electron/"
  cp -r /var/www/agzos-browser/dist "$APP/Contents/Resources/app/dist"
  printf '%s\n' "$APPJSON" > "$APP/Contents/Resources/app/package.json"
  rm -f "$APP/Contents/Resources/default_app.asar"
  (cd "$APP/Contents/Resources" && ls -d *.lproj | grep -v -E '^(en|pt-BR)\.lproj$' | xargs rm -rf)
  
  (cd mac-$arch && zip -qry9 "$ARTIFACTS/Agnos-Browser-mac-$arch.app.zip" "Agzos Browser.app")
  
  rm -rf dmgstage-$arch && mkdir dmgstage-$arch
  cp -a "$APP" "dmgstage-$arch/"
  ln -s /Applications "dmgstage-$arch/Applications"
  xorriso -as mkisofs -quiet -R -J -V "Agzos Browser" -o "$ARTIFACTS/Agnos-Browser-mac-$arch.dmg" "dmgstage-$arch"
  echo "Mac $arch OK"
done

cd /var/www/agzos-browser
bash scripts/release-browser.sh --version $VERSION --artifacts "$ARTIFACTS" --yes
