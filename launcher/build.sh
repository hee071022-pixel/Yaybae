#!/usr/bin/env bash
# 중세 무기고 런처 빌드 (Linux/macOS/Git Bash 에서 Windows exe 를 크로스 컴파일)
#   먼저 python3 tools/build.py 로 dist/Medieval_Arsenal.mcaddon 을 만들어 두세요.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=..

rm -rf payload
mkdir -p payload/icons
cp "$ROOT/dist/Medieval_Arsenal.mcaddon" payload/
cp "$ROOT/Medieval_BP/manifest.json" payload/
cp "$ROOT/Medieval_RP/pack_icon.png" payload/
cp "$ROOT"/Medieval_RP/textures/items/mdv/*.png payload/icons/

# exe 아이콘 + DPI/공용 컨트롤 매니페스트 (rsrc_windows_amd64.syso 생성)
go run github.com/tc-hib/go-winres@v0.3.3 simply \
  --icon payload/pack_icon.png --manifest gui \
  --product-name "중세 무기고 런처" --file-description "Medieval Arsenal Launcher" \
  --arch amd64

go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" \
  -o "$ROOT/dist/MedievalArsenalLauncher.exe" .
echo "완료: dist/MedievalArsenalLauncher.exe"
