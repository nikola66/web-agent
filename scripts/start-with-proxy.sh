#!/bin/sh
# Railpack static defaults to Caddy only; /api/proxy needs the JSON sidecar on 8799 first.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$ROOT"

node "$ROOT/scripts/cors-proxy-server.mjs" &

if [ -f /Caddyfile ]; then
	CADDY_CFG=/Caddyfile
elif [ -f "$ROOT/Caddyfile" ]; then
	CADDY_CFG="$ROOT/Caddyfile"
else
	echo "start-with-proxy: no Caddyfile (tried /Caddyfile and $ROOT/Caddyfile)" >&2
	exit 1
fi

exec caddy run --config "$CADDY_CFG" --adapter caddyfile
