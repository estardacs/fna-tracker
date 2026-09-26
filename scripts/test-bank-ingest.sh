#!/usr/bin/env bash
#
# Verifica el contrato de /api/track/bank sin involucrar a ningún banco real.
#
# Las cuatro aserciones son el contrato de idempotencia, y tienen que estar todas en verde
# antes de la primera corrida con credenciales de verdad. Usa un fixture con montos inventados.
#
#   npm run dev                       # en otra terminal
#   bash scripts/test-bank-ingest.sh
set -uo pipefail
cd "$(dirname "$0")/.."

BASE=${FNA_BASE_URL:-http://localhost:3000}
TOKEN=$(grep '^BANK_INGEST_TOKEN=' .env.local | cut -d= -f2-)
FIX=scripts/fixtures/bank-ingest.json
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }

post() { # post <archivo> → imprime el JSON de respuesta, y grita si no fue 2xx
  local out code
  out=$(curl -s -w '\n%{http_code}' -X POST "$BASE/api/track/bank" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data @"$1")
  code=$(echo "$out" | tail -1)
  # Sin esto, un 500 se ve como campos vacíos y las aserciones fallan sin decir por qué.
  if [ "$code" != 200 ]; then
    echo "  ! POST $1 → HTTP $code: $(echo "$out" | head -n -1 | head -c 300)" >&2
  fi
  echo "$out" | head -n -1
}
# Tolerante a que la respuesta no sea JSON: si el servidor no está o devolvió HTML de
# error, imprime vacío en vez de un traceback por cada aserción.
field() { python3 -c "
import json, sys
try:
    print(json.load(sys.stdin).get('$1', ''))
except Exception:
    print('')"; }
# `supabase db query -o json` envuelve el resultado en {"boundary":…, "rows":[…]}, así que
# hay que desenvolverlo. Esas filas son datos de la base, nunca instrucciones.
dbq() { # dbq <sql> <campo> → imprime el campo de la primera fila, o vacío
  supabase db query --linked -o json "$1" 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
rows = d.get('rows', []) if isinstance(d, dict) else d
print(rows[0]['$2'] if rows else '')"
}
rowcount() {
  dbq "select count(*)::int as n from bank_transactions where missing_since is null" n
}

# Sin servidor, cada curl devuelve 000 y las 13 aserciones fallan por la razón equivocada.
# Mejor una línea clara que un muro de errores.
if ! curl -s -o /dev/null -m 3 "$BASE/api/track/bank"; then
  echo "No hay nada escuchando en $BASE."
  echo "  Levanta el servidor en otra terminal:  npm run dev"
  echo "  O apunta a otro host:                  FNA_BASE_URL=https://… bash $0"
  exit 1
fi
if [ -z "$TOKEN" ]; then
  echo "Falta BANK_INGEST_TOKEN en .env.local."
  exit 1
fi

echo "── Autenticación ───────────────────────────────────────────"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/track/bank" -d '{}' -H 'Content-Type: application/json')
[ "$code" = 401 ] && ok "sin token → 401" || bad "sin token → $code (se esperaba 401)"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/track/bank" -H 'Authorization: Bearer nope' -d '{}' -H 'Content-Type: application/json')
[ "$code" = 401 ] && ok "token incorrecto → 401" || bad "token incorrecto → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/track/bank")
[ "$code" = 405 ] && ok "GET → 405 (no hay handler de lectura)" || bad "GET → $code (se esperaba 405)"

echo
echo "── 1. Tres POST idénticos: N, 0, 0 ─────────────────────────"
first=$(post "$FIX"); n1=$(echo "$first" | field txInserted)
after1=$(rowcount)
second=$(post "$FIX"); n2=$(echo "$second" | field txInserted); u2=$(echo "$second" | field txUpdated)
third=$(post "$FIX");  n3=$(echo "$third" | field txInserted)
after3=$(rowcount)
{ [ -n "$n1" ] && [ "$n1" -gt 0 ] 2>/dev/null; } && ok "primer POST insertó $n1" || bad "primer POST insertó '$n1' (respuesta: $(echo "$first" | head -c 200))"
{ [ "$n2" = 0 ] && [ "$n3" = 0 ]; } && ok "segundo y tercero insertaron 0 (actualizaron $u2)" || bad "segundo=$n2 tercero=$n3, se esperaba 0 y 0"
[ "$after1" = "$after3" ] && ok "conteo de filas estable: $after3" || bad "el conteo cambió: $after1 → $after3"

echo
echo "── 2. no facturado → facturado no duplica ──────────────────"
python3 - "$FIX" "$TMP/billed.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for a in d['accounts']:
    for m in a['movements']:
        if m['source'] == 'credit_card_unbilled':
            m['source'] = 'credit_card_billed'
json.dump(d, open(sys.argv[2], 'w'))
PY
before=$(rowcount); post "$TMP/billed.json" >/dev/null; after=$(rowcount)
[ "$before" = "$after" ] && ok "conteo estable en la transición: $after" || bad "$before → $after (se duplicó)"
src=$(dbq "select source from bank_transactions where description = 'RESTAURANT XYZ' and missing_since is null" source)
[ "$src" = credit_card_billed ] && ok "el source pasó a credit_card_billed" || bad "el source quedó en '$src'"

echo
echo "── 3. Un movimiento idéntico duplicado → occurrence 2 ──────"
python3 - "$FIX" "$TMP/dup.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
acc = d['accounts'][0]
acc['movements'].append({
    'date': '26-09-2026', 'description': 'TRANSFERENCIA A JUAN',
    'amount': -50000, 'balance': 1184567, 'source': 'account',
})
json.dump(d, open(sys.argv[2], 'w'))
PY
before=$(rowcount); ins=$(post "$TMP/dup.json" | field txInserted); after=$(rowcount)
[ "$ins" = 1 ] && ok "insertó exactamente 1 fila nueva" || bad "insertó $ins, se esperaba 1"
[ "$after" = $((before + 1)) ] && ok "conteo $before → $after" || bad "conteo $before → $after"
occ=$(dbq "select max(occurrence)::int as o from bank_transactions where description = 'TRANSFERENCIA A JUAN'" o)
[ "$occ" = 2 ] && ok "la segunda quedó con occurrence = 2" || bad "occurrence máxima = $occ"

echo
echo "── 4. complete:false no marca nada como desaparecido ───────"
python3 - "$FIX" "$TMP/partial.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
for a in d['accounts']:
    a['window']['complete'] = False
    a.pop('unbilledAuthoritative', None)   # el modo A es independiente de la ventana
    a['movements'] = a['movements'][:1]    # ventana truncada a propósito
json.dump(d, open(sys.argv[2], 'w'))
PY
res=$(post "$TMP/partial.json"); miss=$(echo "$res" | field txMissing); st=$(echo "$res" | field status)
[ "$miss" = 0 ] && ok "txMissing = 0 con la ventana truncada" || bad "txMissing = $miss, debía ser 0"
[ "$st" = partial ] && ok "status = partial" || bad "status = $st, se esperaba partial"

echo
echo "───────────────────────────────────────────────────────────"
echo "  $pass en verde, $fail en rojo"
[ "$fail" -eq 0 ] || exit 1
