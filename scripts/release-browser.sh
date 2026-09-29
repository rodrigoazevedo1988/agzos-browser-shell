#!/usr/bin/env bash
set -euo pipefail

KEEP=2
DEST="/var/www/agzosagency/browser"
VERSION=""
ARTIFACTS=""
ASSUME_YES=0
NOTES=""

EXPECTED=(
  "Agnos-Browser-win32-x64.zip"
  "Agnos-Browser-linux-x64.tar.gz"
  "Agnos-Browser-mac-arm64.dmg"
  "Agnos-Browser-mac-x64.dmg"
  "Agnos-Browser-mac-arm64.app.zip"
  "Agnos-Browser-mac-x64.app.zip"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --artifacts) ARTIFACTS="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --notes) NOTES="$2"; shift 2 ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$VERSION" || -z "$ARTIFACTS" ]]; then
  echo "Uso: $0 --version 1.3.0 --artifacts <pasta-com-builds> [--dest $DEST] [--yes]" >&2
  exit 2
fi

if [[ ! -d "$ARTIFACTS" ]]; then
  echo "Pasta de artefatos não encontrada: $ARTIFACTS" >&2
  exit 1
fi

for file in "${EXPECTED[@]}"; do
  if [[ ! -f "$ARTIFACTS/$file" ]]; then
    echo "Artefato ausente em $ARTIFACTS: $file" >&2
    exit 1
  fi
done

TARGET="$DEST/v$VERSION"
mkdir -p "$TARGET"
cp -f "$ARTIFACTS"/Agnos-Browser-*.zip "$ARTIFACTS"/Agnos-Browser-*.tar.gz "$ARTIFACTS"/Agnos-Browser-*.dmg "$TARGET/"
( cd "$ARTIFACTS" && sha256sum "${EXPECTED[@]}" > "$TARGET/SHA256SUMS.txt" )

# Feed da atualização automática (electron/updater.cjs): versão nova, pacote de cada
# plataforma, tamanho e SHA-256. Escrito por último e trocado de uma vez (mv), para o
# app nunca ler um manifesto apontando para arquivos que ainda não chegaram.
python3 - "$TARGET" "$VERSION" "$NOTES" "$DEST/latest.json" <<'PY'
import datetime, hashlib, json, os, sys
target, version, notes, out = sys.argv[1:5]
packages = {
    "win32-x64": "Agnos-Browser-win32-x64.zip",
    "linux-x64": "Agnos-Browser-linux-x64.tar.gz",
    "darwin-arm64": "Agnos-Browser-mac-arm64.app.zip",
    "darwin-x64": "Agnos-Browser-mac-x64.app.zip",
}
files = {}
for key, name in packages.items():
    path = os.path.join(target, name)
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    files[key] = {"url": f"v{version}/{name}", "sha256": digest.hexdigest(), "size": os.path.getsize(path)}
manifest = {
    "version": version,
    "releasedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "notes": notes,
    "files": files,
}
tmp = out + ".tmp"
with open(tmp, "w") as f:
    json.dump(manifest, f, indent=2)
os.replace(tmp, out)
print(f"latest.json: {version} ({len(files)} pacotes)")
PY

VERSIONS=$(
  cd "$DEST" && ls -d v[0-9]* 2>/dev/null | sort -V
)
COUNT=$(echo "$VERSIONS" | grep -c . || true)

if (( COUNT > KEEP )); then
  REMOVE=$(( COUNT - KEEP ))
  OLD=$(echo "$VERSIONS" | head -n "$REMOVE")
  echo "Política KEEP=$KEEP: removendo versões antigas:"
  echo "$OLD"
  if (( ASSUME_YES )); then
    while IFS= read -r dir; do rm -rf "$DEST/$dir"; done <<< "$OLD"
  else
    echo "Reexecute com --yes para confirmar a remoção." >&2
    exit 1
  fi
fi

REMAINING=$( ( cd "$DEST" && ls -d v[0-9]* 2>/dev/null | sort -Vr ) )
COUNT=$(echo "$REMAINING" | grep -c . || true)
if (( COUNT > KEEP )); then
  echo "Falha: $COUNT versões no destino (máximo $KEEP)." >&2
  exit 1
fi

NEWEST=$(echo "$REMAINING" | head -n 1)
PREVIOUS=$(echo "$REMAINING" | sed -n 2p)

size_of() { du -h "$DEST/$1" | cut -f1; }

render_version() {
  local dir="$1" tag="$2"
  cat <<EOF
  <h2>$tag · <a class="sums" href="$dir/SHA256SUMS.txt">SHA256SUMS.txt</a></h2>
  <a class="dl" href="$dir/Agnos-Browser-win32-x64.zip"><span><strong>Windows</strong><small>portátil x64 — extraia o ZIP e execute <code>AgzosBrowser.exe</code></small></span><span class="size">ZIP · $(size_of "$dir/Agnos-Browser-win32-x64.zip")</span></a>
  <a class="dl" href="$dir/Agnos-Browser-linux-x64.tar.gz"><span><strong>Linux</strong><small>x64 — extraia e execute <code>agzos-browser</code></small></span><span class="size">TAR.GZ · $(size_of "$dir/Agnos-Browser-linux-x64.tar.gz")</span></a>
  <a class="dl" href="$dir/Agnos-Browser-mac-arm64.dmg"><span><strong>macOS Apple Silicon</strong><small>arm64 — abra o DMG e arraste para Applications</small></span><span class="size">DMG · $(size_of "$dir/Agnos-Browser-mac-arm64.dmg")</span></a>
  <a class="dl" href="$dir/Agnos-Browser-mac-x64.dmg"><span><strong>macOS Intel</strong><small>x64 — abra o DMG e arraste para Applications</small></span><span class="size">DMG · $(size_of "$dir/Agnos-Browser-mac-x64.dmg")</span></a>
  <a class="dl" href="$dir/Agnos-Browser-mac-arm64.app.zip"><span><strong>macOS Apple Silicon — compactado</strong><small>alternativa menor ao DMG</small></span><span class="size">ZIP · $(size_of "$dir/Agnos-Browser-mac-arm64.app.zip")</span></a>
  <a class="dl" href="$dir/Agnos-Browser-mac-x64.app.zip"><span><strong>macOS Intel — compactado</strong><small>alternativa menor ao DMG</small></span><span class="size">ZIP · $(size_of "$dir/Agnos-Browser-mac-x64.app.zip")</span></a>
EOF
}

{
cat <<'HEAD'
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agzos Browser — Downloads</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0E0E;color:#FFFDFD;font-family:"Manrope","Segoe UI",sans-serif}
  main{width:min(660px,92vw);padding:48px 8px}
  h1{font-family:Georgia,serif;font-weight:500;font-size:34px;margin:0 0 6px}
  p.sub{color:#c9c5c5;margin:0 0 30px;font-size:14px}
  a.dl{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:15px 18px;margin-bottom:10px;border:1px solid #3a3636;border-radius:10px;color:#FFFDFD;text-decoration:none;transition:border-color .2s}
  a.dl:hover{border-color:#D10A11}
  a.dl strong{display:block;font-size:14px}
  a.dl small{color:#a5a0a0;font-size:11px}
  a.dl .size{color:#D10A11;font-weight:700;font-size:12px;white-space:nowrap}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#8f8a8a;margin:26px 0 10px}
  a.sums{color:#D10A11;text-transform:none;letter-spacing:0;font-size:11px}
  .note{color:#8f8a8a;font-size:11px;line-height:1.7;margin-top:22px}
  code{background:#1c1a1a;padding:1px 5px;border-radius:4px;font-size:10px}
</style>
</head>
<body>
<main>
  <h1>Agzos Browser</h1>
  <p class="sub">Navegue com clareza. Decida com controle. · Electron 44 · dados 100% locais</p>
  <p class="sub">Mantemos apenas as duas versões mais recentes dos instaladores (~1 GB por geração).</p>
HEAD
if [[ -n "$NEWEST" ]]; then render_version "$NEWEST" "Versão atual (${NEWEST#v})"; fi
if [[ -n "$PREVIOUS" ]]; then render_version "$PREVIOUS" "Versão anterior (${PREVIOUS#v})"; fi
cat <<'FOOT'
  <p class="note">
    Builds não assinados (sem notarização). <strong>Windows</strong>: o SmartScreen pode avisar — "Mais informações" → "Executar assim mesmo". <strong>macOS</strong>: se aparecer "não pode ser aberto", vá em Ajustes do Sistema → Privacidade e Segurança → "Abrir Mesmo Assim", ou execute <code>xattr -cr "/Applications/Agzos Browser.app"</code>. <strong>Linux</strong>: garanta permissão de execução com <code>chmod +x agzos-browser</code> se necessário.<br><br>
    Verificação de integridade: use o <code>SHA256SUMS.txt</code> de cada versão, linkado ao lado do título. Suas abas e preferências ficam apenas no seu dispositivo (localStorage); credenciais do Agzos Key ficam criptografadas (safeStorage).
  </p>
</main>
</body>
</html>
FOOT
} > "$DEST/index.html"

chown -R www-data:www-data "$DEST"
echo "Publicado: v$VERSION em $TARGET"
echo "Versões no destino ($(echo "$REMAINING" | wc -l)):"
echo "$REMAINING"
