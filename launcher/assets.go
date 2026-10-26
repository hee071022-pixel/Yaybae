package main

import (
	"embed"
	_ "embed"
)

// build.sh 가 빌드 전에 선택한 애드온의 파일을 payload/ 로 준비한다.

//go:embed payload/addon.mcaddon
var addonPayload []byte

//go:embed payload/launcher.json
var configJSON []byte

//go:embed payload/manifest.json
var bpManifest []byte

//go:embed payload/icons/*.png payload/pack_icon.png
var iconFS embed.FS

//go:embed ui.html
var uiHTML string
