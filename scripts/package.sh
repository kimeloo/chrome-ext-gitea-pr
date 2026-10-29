#!/usr/bin/env bash
# extension/ 폴더를 브라우저 수동 설치 및 배포용 ZIP으로 묶는다. 결과: dist/gitea-pr-extension.zip
set -euo pipefail

cd "$(dirname "$0")/.."

out="dist/gitea-pr-extension.zip"

mkdir -p dist
rm -f "$out"
# manifest.json이 ZIP의 최상위에 오도록 extension 안에서 압축한다.
(cd extension && zip -q -r -X "../$out" . -x '*.DS_Store')

echo "생성: $out"
