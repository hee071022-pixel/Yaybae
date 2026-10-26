#!/usr/bin/env bash
# 애드온 런처 빌드 (Linux/macOS/Git Bash 에서 Windows exe 를 크로스 컴파일)
#   ./build.sh addons/breathblade   → dist/BreathBladeLauncher.exe
#   ./build.sh addons/medieval      → dist/MedievalArsenalLauncher.exe (먼저 python3 tools/build.py)
# 필요: Go 1.25+, jq, unzip
set -euo pipefail
ADDON_DIR=$(realpath "${1:?사용법: ./build.sh addons/<이름>}")
cd "$(dirname "$0")"
CFG="$ADDON_DIR/launcher.json"
cfg() { jq -er "$1" "$CFG"; }

MCADDON="$ADDON_DIR/$(cfg .addonFile)"
EXE=$(cfg .exeName)
TITLE=$(cfg .windowTitle)

rm -rf payload
mkdir -p payload/icons payload/x
cp "$CFG" payload/launcher.json
cp "$MCADDON" payload/addon.mcaddon
unzip -q payload/addon.mcaddon -d payload/x
cp "payload/x/$(cfg .bpManifest)" payload/manifest.json
cp "payload/x/$(cfg .packIcon)" payload/pack_icon.png
cp "payload/x/$(cfg .iconsDir)"/*.png payload/icons/
rm -rf payload/x

# exe 아이콘 + DPI/공용 컨트롤 매니페스트 (rsrc_windows_amd64.syso 생성)
go run github.com/tc-hib/go-winres@v0.3.3 simply \
  --icon payload/pack_icon.png --manifest gui \
  --product-name "$TITLE" --file-description "$TITLE" \
  --arch amd64

go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" \
  -o "../dist/$EXE" .
echo "완료: dist/$EXE"
