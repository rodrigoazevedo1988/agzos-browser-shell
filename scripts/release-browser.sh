#!/usr/bin/env bash
set -euo pipefail

KEEP=2
DEST="/var/www/agzosagency/browser"
VERSION=""
ARTIFACTS=""
ASSUME_YES=0
NOTES=""

# A partir da 4.7.1 o nome canônico é "Agzos-Browser-*" (grafia do produto, igual à do
# APK no Android). Até a 4.7.0 os artefatos saíram como "Agnos-Browser-*" — um typo que
# virou contrato. O build novo sempre gera o canônico; a compatibilidade fica na
# leitura (pkg_name), porque a política KEEP=2 mantém a versão antiga publicada ao lado
# da nova e a página de download precisa linkar o nome que existe em cada uma.
EXPECTED=(
  "Agzos-Browser-win32-x64.zip"
  "Agzos-Browser-linux-x64.tar.gz"
  "Agzos-Browser-mac-arm64.dmg"
  "Agzos-Browser-mac-x64.dmg"
  "Agzos-Browser-mac-arm64.app.zip"
  "Agzos-Browser-mac-x64.app.zip"
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
cp -f "$ARTIFACTS"/Agzos-Browser-*.zip "$ARTIFACTS"/Agzos-Browser-*.tar.gz "$ARTIFACTS"/Agzos-Browser-*.dmg "$TARGET/"
( cd "$ARTIFACTS" && sha256sum "${EXPECTED[@]}" > "$TARGET/SHA256SUMS.txt" )

# Feed da atualização automática (electron/updater.cjs): versão nova, pacote de cada
# plataforma, tamanho e SHA-256. Escrito por último e trocado de uma vez (mv), para o
# app nunca ler um manifesto apontando para arquivos que ainda não chegaram.
python3 - "$TARGET" "$VERSION" "$NOTES" "$DEST/latest.json" <<'PY'
import datetime, hashlib, json, os, sys
target, version, notes, out = sys.argv[1:5]
packages = {
    "win32-x64": "Agzos-Browser-win32-x64.zip",
    "linux-x64": "Agzos-Browser-linux-x64.tar.gz",
    "darwin-arm64": "Agzos-Browser-mac-arm64.app.zip",
    "darwin-x64": "Agzos-Browser-mac-x64.app.zip",
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
with open(tmp, "w", encoding="utf-8") as f:
    # ensure_ascii=False: as notas vêm do changelog em português e saem legíveis no
    # arquivo. O JSON continua válido dos dois jeitos (o app faz JSON.parse), mas ler o
    # manifesto no disco com \u00ed não ajuda ninguém.
    json.dump(manifest, f, indent=2, ensure_ascii=False)
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

# Nome real do pacote dentro de uma versão publicada. Até a 4.7.0 os arquivos saíram
# como "Agnos-Browser-*"; da 4.7.1 em diante como "Agzos-Browser-*". A política KEEP=2
# mantém as duas lado a lado, então a página precisa linkar o nome que existe de fato
# em cada diretório — senão o link da versão antiga daria 404 depois do próximo deploy.
pkg_name() { # diretório, nome canônico
  local dir="$1" canonical="$2" legacy="Agnos-Browser-${canonical#Agzos-Browser-}"
  if [[ -f "$DEST/$dir/$canonical" ]]; then echo "$canonical"
  elif [[ -f "$DEST/$dir/$legacy" ]]; then echo "$legacy"
  else echo "$canonical"  # ainda não publicado: mostra o canônico
  fi
}

# Uma linha de download. $3 = rótulo, $4 = dica, $5 = nome canônico, $6 = rótulo de formato.
render_dl() {
  local dir="$1" label="$2" hint="$3" canonical="$4" format="$5"
  local file; file="$(pkg_name "$dir" "$canonical")"
  printf '  <a class="dl" href="%s/%s"><span><strong>%s</strong><small>%s</small></span><span class="size">%s · %s</span></a>\n' \
    "$dir" "$file" "$label" "$hint" "$format" "$(size_of "$dir/$file")"
}

render_version() {
  local dir="$1" tag="$2"
  printf '  <h2>%s · <a class="sums" href="%s/SHA256SUMS.txt">SHA256SUMS.txt</a></h2>\n' "$tag" "$dir"
  render_dl "$dir" "Windows" 'portátil x64 — extraia o ZIP e execute <code>AgzosBrowser.exe</code>' \
    "Agzos-Browser-win32-x64.zip" "ZIP"
  render_dl "$dir" "Linux" 'x64 — extraia e execute <code>agzos-browser</code>' \
    "Agzos-Browser-linux-x64.tar.gz" "TAR.GZ"
  render_dl "$dir" "macOS Apple Silicon" 'arm64 — abra o DMG e arraste para Applications' \
    "Agzos-Browser-mac-arm64.dmg" "DMG"
  render_dl "$dir" "macOS Intel" 'x64 — abra o DMG e arraste para Applications' \
    "Agzos-Browser-mac-x64.dmg" "DMG"
  render_dl "$dir" "macOS Apple Silicon — compactado" 'alternativa menor ao DMG' \
    "Agzos-Browser-mac-arm64.app.zip" "ZIP"
  render_dl "$dir" "macOS Intel — compactado" 'alternativa menor ao DMG' \
    "Agzos-Browser-mac-x64.app.zip" "ZIP"
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
