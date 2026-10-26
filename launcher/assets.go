package main

import (
	"embed"
	_ "embed"
)

// build.sh 가 빌드 전에 payload/ 로 애드온과 아이콘을 복사한다.

//go:embed payload/Medieval_Arsenal.mcaddon
var addonPayload []byte

//go:embed payload/manifest.json
var bpManifest []byte

//go:embed payload/icons/*.png payload/pack_icon.png
var iconFS embed.FS

//go:embed ui.html
var uiHTML string
