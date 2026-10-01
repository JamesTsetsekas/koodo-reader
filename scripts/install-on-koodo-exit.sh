#!/usr/bin/env bash
set -euo pipefail

# Do not compete with a live reader or its local TTS worker. This service is
# started after a source update and only packages the next-launch app once the
# user has closed Koodo normally.
while pgrep -f '^/home/james/.local/opt/koodo-reader-custom/koodo-reader( |$)' >/dev/null; do
  sleep 20
done

export PATH="/home/james/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:${PATH}"
export NODE_OPTIONS="--max-old-space-size=2304"
cd /home/james/Projects/koodo-reader-custom

node scripts/build-local.cjs
cp -a build/. runtime-app/build/
cp main.js local-coqui.cjs package.json runtime-app/
temporary_asar="/home/james/.local/opt/koodo-reader-custom/resources/app.asar.next"
rm -f "${temporary_asar}"
node node_modules/@electron/asar/bin/asar.js pack runtime-app "${temporary_asar}" --unpack '**/*.node'
mv -f "${temporary_asar}" /home/james/.local/opt/koodo-reader-custom/resources/app.asar
