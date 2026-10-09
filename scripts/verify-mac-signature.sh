#!/bin/bash
# Confere a assinatura do Agzos Browser.app (ou do .app.zip) antes de publicar (4.8.4).
# Uso: scripts/verify-mac-signature.sh <app ou .app.zip> <sha1-esperado>
#
# Falha se qualquer Mach-O do bundle estiver sem assinatura, ad-hoc, sem runtime
# endurecido ou assinado por outro certificado que não o fixado; se o selo do bundle
# (CodeResources) faltar; ou se o identificador do app não for br.agzos.browser.
# Imprime a Authority e o SHA-1 do certificado folha (é o que se confere no log do build).
set -euo pipefail

TARGET="$1"
EXPECTED="$(tr -d ':' <<< "$2" | tr 'a-f' 'A-F')"
WORK=""
cleanup() { if [ -n "$WORK" ]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

if [[ "$TARGET" == *.zip ]]; then
  WORK="$(mktemp -d)"
  unzip -q "$TARGET" -d "$WORK"
  APP="$(find "$WORK" -maxdepth 1 -name '*.app' -print -quit)"
else
  APP="$TARGET"
fi
[ -d "$APP" ] || { echo "Bundle não encontrado: $TARGET" >&2; exit 1; }

fail() { echo "Assinatura do Mac inválida: $*" >&2; exit 1; }

[ -f "$APP/Contents/_CodeSignature/CodeResources" ] || fail "sem selo do bundle (CodeResources)"

leaf_of() { # Mach-O → "SHA1|subject" do certificado folha
  rcodesign extract cms-raw "$1" 2>/dev/null |
    openssl pkcs7 -inform DER -print_certs 2>/dev/null |
    openssl x509 -noout -fingerprint -sha1 -subject -nameopt RFC2253 2>/dev/null |
    sed -n 's/^sha1 Fingerprint=//p; s/^subject=//p' | tr -d ':' | paste -sd '|'
}

main="$APP/Contents/MacOS/$(python3 -c 'import plistlib,sys; print(plistlib.load(open(sys.argv[1],"rb"))["CFBundleExecutable"])' "$APP/Contents/Info.plist")"
identifier="$(rcodesign print-signature-info "$main" 2>/dev/null | sed -n 's/^ *identifier: //p' | head -1)"
[ "$identifier" = "br.agzos.browser" ] || fail "identificador \"$identifier\" (esperado br.agzos.browser)"

count=0
while IFS= read -r -d '' file; do
  head -c 4 "$file" | od -An -tx1 | grep -q -E 'cf fa ed fe|ca fe ba be' || continue
  rel="${file#"$APP/"}"
  info="$(rcodesign print-signature-info "$file" 2>/dev/null)" || fail "$rel sem assinatura"
  flags="$(grep -m1 'flags: CodeSignatureFlags' <<< "$info" || true)"
  grep -q 'ADHOC' <<< "$flags" && fail "$rel assinado ad-hoc"
  grep -q 'RUNTIME' <<< "$flags" || fail "$rel sem runtime endurecido"
  leaf="$(leaf_of "$file")"
  [ "${leaf%%|*}" = "$EXPECTED" ] || fail "$rel assinado por ${leaf:-nenhum certificado} (esperado $EXPECTED)"
  count=$((count + 1))
done < <(find "$APP" -type f -print0)

[ "$count" -gt 0 ] || fail "nenhum Mach-O encontrado"
leaf="$(leaf_of "$main")"
echo "Assinatura do Mac OK: $count binários, Authority=${leaf#*|}, SHA-1=${leaf%%|*}"
