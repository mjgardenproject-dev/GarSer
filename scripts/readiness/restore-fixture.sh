#!/usr/bin/env bash
# Restaura la configuración de referencia del jardinero sembrado para un servicio.
# El configurador del panel de jardinero reescribe `additional_config` al abrirse
# (toPersistedPhytosanitaryConfig materializa bloques legacy y sube precios), así que
# tras cualquier paso de navegador hay que volver al fixture antes de medir.
#
#   ./scripts/readiness/restore-fixture.sh fitosanitarios
set -euo pipefail
SERVICE="${1:?uso: restore-fixture.sh <servicio>}"
DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_GarSer-main_4}"
case "$SERVICE" in
  fitosanitarios) SERVICE_ID='47a66caa-7671-45ec-b321-df6179249efd' ;;
  *) echo "servicio desconocido: $SERVICE" >&2; exit 1 ;;
esac
CONFIG="$(cat "$DIR/fixtures/$SERVICE.config.json")"
docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
update public.gardener_service_prices
   set additional_config = \$json\$$CONFIG\$json\$::jsonb
 where service_id = '$SERVICE_ID'
   and gardener_id = '11111111-aaaa-4aaa-8aaa-111111111111';
SQL
echo "fixture de $SERVICE restaurado"
