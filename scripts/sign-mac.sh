#!/bin/bash
# Assina o Agzos Browser.app com o certificado "Rodrigo Dev Local" (4.8.4) e confere.
# Uso: scripts/sign-mac.sh <app> <p12> <arquivo-da-senha> <sha1-esperado>
#
# O rcodesign assina de dentro para fora sozinho (dylibs, .node, frameworks, Helpers e
# por último o bundle), com runtime endurecido em todo Mach-O e sem servidor de
# timestamp. Os entitlements (scripts/entitlements.mac.plist) vão no executável principal
# e nos quatro Helpers. Sem notarização: a confiança vale só no Mac onde o certificado
# está marcado como confiável. Falha se a assinatura sair ad-hoc ou com outro certificado.
set -euo pipefail
set +x # a senha nunca vai para o log

APP="$1"
P12="$2"
PASSFILE="$3"
EXPECTED_SHA1="$(tr -d ':' <<< "$4" | tr 'a-f' 'A-F')"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENT="$HERE/entitlements.mac.plist"
NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$APP/Contents/Info.plist" 2>/dev/null ||
  python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["CFBundleName"])' "$APP/Contents/Info.plist")"

# O certificado do .p12 é o fixado (antes de gastar tempo assinando).
# .p12 antigo (RC2-40, "legacy"): o openssl 3 só lê com -legacy; o AES, sem. Tenta os dois.
p12() { openssl pkcs12 "$@" 2>/dev/null || openssl pkcs12 -legacy "$@" 2>/dev/null; }
cert_sha1() { # .p12, senha → SHA-1 do certificado folha
  p12 -in "$1" -passin "file:$2" -nokeys -clcerts |
    openssl x509 -noout -fingerprint -sha1 | sed 's/.*=//; s/://g'
}
[ "$(cert_sha1 "$P12" "$PASSFILE")" = "$EXPECTED_SHA1" ] || {
  echo "O .p12 não é o certificado esperado ($EXPECTED_SHA1)." >&2
  exit 1
}

# O rcodesign 0.29 só abre PKCS#12 com 3DES; com AES (padrão do openssl 3) o erro sai
# como "incorrect password". Regrava sempre em 3DES (-legacy na exportação). Converte numa pasta temporária só do root,
# apagada no fim (inclusive em falha).
umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
p12 -in "$P12" -passin "file:$PASSFILE" -nodes -out "$WORK/key.pem" &&
  openssl pkcs12 -export -legacy -in "$WORK/key.pem" -passout "file:$PASSFILE" \
    -out "$WORK/sign.p12" 2>/dev/null || true
rm -f "$WORK/key.pem"
[ -s "$WORK/sign.p12" ] || { echo "Não foi possível ler o .p12 (senha ou formato)." >&2; exit 1; }

# Runtime endurecido em todo Mach-O: no rcodesign a flag sem escopo vale só para o
# executável principal, e o escopo de um .framework não desce até o binário dele. Cada
# Mach-O do bundle (Helpers, frameworks, dylibs, crashpad, ShipIt, node-pty) recebe a sua.
scoped=(--code-signature-flags runtime --entitlements-xml-file "$ENT")
while IFS= read -r -d '' file; do
  if head -c 4 "$file" | od -An -tx1 | grep -q -E 'cf fa ed fe|ca fe ba be'; then
    scoped+=(--code-signature-flags "${file#"$APP/"}:runtime")
  fi
done < <(find "$APP/Contents" -type f -not -path "$APP/Contents/MacOS/*" -print0)
for helper in "$APP/Contents/Frameworks/$NAME Helper"*.app; do
  scoped+=(--entitlements-xml-file "Contents/Frameworks/$(basename "$helper"):$ENT")
done

LOG="$WORK/sign.log"
rcodesign sign \
  --p12-file "$WORK/sign.p12" --p12-password-file "$PASSFILE" \
  --timestamp-url none \
  "${scoped[@]}" \
  "$APP" > "$LOG" 2>&1 || { grep -v -i "password" "$LOG" >&2; exit 1; }
if grep -q "could not find main executable" "$LOG"; then
  grep "could not find main executable" "$LOG" >&2
  echo "Assinatura incompleta em $APP" >&2
  exit 1
fi

bash "$HERE/verify-mac-signature.sh" "$APP" "$EXPECTED_SHA1"
