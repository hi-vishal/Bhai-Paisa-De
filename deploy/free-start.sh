#!/bin/sh
# Restore the database from the bucket if this machine has none, then run the app under Litestream
# so every change is copied off-box within about a second.
set -eu
: "${LITESTREAM_BUCKET:?set LITESTREAM_BUCKET (and the other LITESTREAM_* values)}"
: "${BPD_NOSTR_SECRET:?set BPD_NOSTR_SECRET}"
: "${BPD_AUTH_SECRET:?set BPD_AUTH_SECRET}"
litestream restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists /data/bhai.sqlite
exec litestream replicate -config /etc/litestream.yml \
  -exec "node --disable-warning=ExperimentalWarning --enable-source-maps dist-server/index.js"
