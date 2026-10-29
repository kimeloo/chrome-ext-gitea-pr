#!/usr/bin/env bash
# extension/ 폴더를 Chrome 웹 스토어에 올릴 ZIP으로 묶는다. 결과: dist/gitea-pr-status-v{version}.zip
set -euo pipefail

cd "$(dirname "$0")/.."

version="$(node -p "JSON.parse(require('fs').readFileSync('extension/manifest.json', 'utf8')).version")"
out="dist/gitea-pr-status-v${version}.zip"

mkdir -p dist
rm -f "$out"
# manifest.json이 ZIP의 최상위에 오도록 extension 안에서 압축한다.
(cd extension && zip -q -r -X "../$out" . -x '*.DS_Store')

echo "생성: $out"
