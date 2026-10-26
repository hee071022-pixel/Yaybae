package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

type info struct {
	Version        string            `json:"version"`
	MinEngine      string            `json:"minEngine"`
	Installed      string            `json:"installed"` // 설치된 버전, 없으면 ""
	MinecraftFound bool              `json:"minecraftFound"`
	Icons          map[string]string `json:"icons"` // 아이템 id → data URI
	CanUpdate      bool              `json:"canUpdate"`
	Config         json.RawMessage   `json:"config"`
}

var appTitle = "애드온 런처"

type launcher struct {
	w        webview2.WebView
	cfg      *config
	manifest *manifest
	busy     bool
}

func main() {
	cfg, err := parseConfig(configJSON)
	if err != nil {
		fatal("launcher.json 을 읽을 수 없습니다: " + err.Error())
	}
	appTitle = cfg.WindowTitle
	m, err := parseManifest(bpManifest)
	if err != nil {
		fatal("내장된 애드온 정보를 읽을 수 없습니다: " + err.Error())
	}

	dataPath := ""
	if dir, err := os.UserCacheDir(); err == nil {
		dataPath = filepath.Join(dir, strings.TrimSuffix(cfg.ExeName, ".exe"))
	}
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  appTitle,
			Width:  1000,
			Height: 640,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		fatal("WebView2 런타임을 찾을 수 없습니다.\n\nhttps://developer.microsoft.com/microsoft-edge/webview2/ 에서 설치한 뒤 다시 실행해 주세요.")
	}
	defer w.Destroy()
	w.SetSize(1000, 640, webview2.HintFixed)

	l := &launcher{w: w, cfg: cfg, manifest: m}
	w.Bind("getInfo", l.getInfo)
	w.Bind("installAddon", l.installAddon)
	w.Bind("launchGame", l.launchGame)
	w.Bind("checkUpdate", l.checkUpdate)
	w.Bind("installUpdate", l.installUpdate)
	w.Bind("openFolder", l.openFolder)
	w.SetHtml(uiHTML)
	w.Run()
}

func fatal(msg string) {
	t, _ := windows.UTF16PtrFromString(appTitle)
	b, _ := windows.UTF16PtrFromString(msg)
	windows.MessageBox(0, b, t, windows.MB_OK|windows.MB_ICONERROR)
	os.Exit(1)
}

func mojangDirs() []string {
	return comMojangDirs(os.Getenv("LOCALAPPDATA"), os.Getenv("APPDATA"))
}

func (l *launcher) getInfo() info {
	dirs := mojangDirs()
	in := info{
		Version:        versionString(l.manifest.Header.Version),
		MinEngine:      versionString(l.manifest.Header.MinEngineVersion),
		MinecraftFound: len(dirs) > 0,
		Icons:          map[string]string{},
		CanUpdate:      l.cfg.Update.ManifestURL != "",
		Config:         configJSON,
	}
	if v := findInstalledVersion(dirs, l.manifest.Header.UUID); v != nil {
		in.Installed = versionString(v)
	}
	fs.WalkDir(iconFS, "payload", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		data, _ := iconFS.ReadFile(p)
		in.Icons[strings.TrimSuffix(path.Base(p), ".png")] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
		return nil
	})
	return in
}

// emit 은 백그라운드 작업 결과를 UI 스레드에서 JS 함수로 전달한다.
func (l *launcher) emit(fn string, v interface{}) {
	b, _ := json.Marshal(v)
	l.w.Dispatch(func() { l.w.Eval(fmt.Sprintf("window.%s && window.%s(%s)", fn, fn, b)) })
}

// shellOpen 은 파일이나 URI 를 Windows 기본 연결 프로그램으로 연다.
func (l *launcher) shellOpen(target string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.ShellExecute(windows.Handle(uintptr(l.w.Window())), verb, file, nil, nil, windows.SW_SHOWNORMAL)
}

func (l *launcher) addonTempPath() string {
	return filepath.Join(os.TempDir(), strings.TrimSuffix(l.cfg.ExeName, ".exe")+".mcaddon")
}

// installAddon 은 내장된 .mcaddon 을 임시 폴더에 풀고 열어서 마인크래프트가 가져오게 한다.
func (l *launcher) installAddon() error {
	p := l.addonTempPath()
	if err := os.WriteFile(p, addonPayload, 0o644); err != nil {
		return fmt.Errorf("임시 파일을 만들 수 없습니다: %w", err)
	}
	if err := l.shellOpen(p); err != nil {
		return fmt.Errorf(".mcaddon 을 열 수 없습니다. 마인크래프트 베드락이 설치되어 있는지 확인해 주세요. (%v)", err)
	}
	return nil
}

func (l *launcher) launchGame() error {
	if err := l.shellOpen("minecraft:"); err != nil {
		return fmt.Errorf("마인크래프트를 실행할 수 없습니다. (%v)", err)
	}
	return nil
}

type updateResult struct {
	Ok      bool   `json:"ok"`
	Latest  string `json:"latest"`
	Newer   bool   `json:"newer"`
	Message string `json:"message"`
}

func (l *launcher) checkUpdate() {
	go func() {
		if l.cfg.Update.ManifestURL == "" {
			l.emit("onUpdate", updateResult{Message: "이 런처는 업데이트 확인을 지원하지 않습니다."})
			return
		}
		rm, err := fetchRemoteManifest(l.cfg.Update.ManifestURL)
		if err != nil {
			l.emit("onUpdate", updateResult{Message: "업데이트 서버에 연결할 수 없습니다: " + err.Error()})
			return
		}
		l.emit("onUpdate", updateResult{
			Ok:     true,
			Latest: versionString(rm.Header.Version),
			Newer:  compareVersions(rm.Header.Version, l.manifest.Header.Version) > 0,
		})
	}()
}

func (l *launcher) installUpdate() {
	if l.busy || l.cfg.Update.AddonURL == "" {
		return
	}
	l.busy = true
	go func() {
		defer func() { l.busy = false }()
		p := l.addonTempPath()
		err := download(l.cfg.Update.AddonURL, p, func(f float64) { l.emit("onProgress", f) })
		if err == nil {
			l.w.Dispatch(func() {
				if oerr := l.shellOpen(p); oerr != nil {
					l.emit("onUpdateDone", oerr.Error())
					return
				}
				l.emit("onUpdateDone", "")
			})
			return
		}
		l.emit("onUpdateDone", err.Error())
	}()
}

func (l *launcher) openFolder() error {
	dirs := mojangDirs()
	if len(dirs) == 0 {
		return fmt.Errorf("마인크래프트 데이터 폴더를 찾을 수 없습니다")
	}
	return l.shellOpen(dirs[0])
}
