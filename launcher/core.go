package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 업데이트 확인 주소. raw.githubusercontent.com 의 HEAD 는 저장소 기본 브랜치를 가리킨다.
const (
	updateBase        = "https://raw.githubusercontent.com/hee071022-pixel/yaybae/HEAD/"
	remoteManifestURL = updateBase + "Medieval_BP/manifest.json"
	remoteAddonURL    = updateBase + "dist/Medieval_Arsenal.mcaddon"
)

type manifest struct {
	Header struct {
		UUID             string `json:"uuid"`
		Version          []int  `json:"version"`
		MinEngineVersion []int  `json:"min_engine_version"`
	} `json:"header"`
}

func parseManifest(data []byte) (*manifest, error) {
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	if m.Header.UUID == "" {
		return nil, fmt.Errorf("manifest 에 uuid 가 없습니다")
	}
	return &m, nil
}

func versionString(v []int) string {
	parts := make([]string, len(v))
	for i, n := range v {
		parts[i] = fmt.Sprint(n)
	}
	return strings.Join(parts, ".")
}

// compareVersions 는 a<b 이면 -1, 같으면 0, a>b 이면 1 을 돌려준다.
func compareVersions(a, b []int) int {
	for i := 0; i < len(a) || i < len(b); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

// comMojangDirs 는 이 PC 에서 찾을 수 있는 com.mojang 폴더 목록이다.
// UWP 버전(구버전)과 GDK 버전(1.21.120 이후, %APPDATA%\Minecraft Bedrock)을 모두 본다.
func comMojangDirs(localAppData, appData string) []string {
	var dirs []string
	if localAppData != "" {
		dirs = append(dirs, filepath.Join(localAppData, "Packages", "Microsoft.MinecraftUWP_8wekyb3d8bbwe", "LocalState", "games", "com.mojang"))
	}
	if appData != "" {
		users, _ := filepath.Glob(filepath.Join(appData, "Minecraft Bedrock", "Users", "*", "games", "com.mojang"))
		dirs = append(dirs, users...)
	}
	var found []string
	for _, d := range dirs {
		if st, err := os.Stat(d); err == nil && st.IsDir() {
			found = append(found, d)
		}
	}
	return found
}

// findInstalledVersion 은 behavior_packs 아래에서 uuid 가 같은 팩을 찾아 가장 높은 버전을 돌려준다.
func findInstalledVersion(comMojang []string, uuid string) []int {
	var best []int
	for _, root := range comMojang {
		for _, sub := range []string{"behavior_packs", "development_behavior_packs"} {
			files, _ := filepath.Glob(filepath.Join(root, sub, "*", "manifest.json"))
			for _, f := range files {
				data, err := os.ReadFile(f)
				if err != nil {
					continue
				}
				m, err := parseManifest(data)
				if err != nil || !strings.EqualFold(m.Header.UUID, uuid) {
					continue
				}
				if best == nil || compareVersions(m.Header.Version, best) > 0 {
					best = m.Header.Version
				}
			}
		}
	}
	return best
}

var httpClient = &http.Client{Timeout: 60 * time.Second}

func fetchRemoteManifest() (*manifest, error) {
	resp, err := httpClient.Get(remoteManifestURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("업데이트 서버 응답: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	return parseManifest(data)
}

// download 는 url 을 dest 로 받는다. progress 에는 0~1 사이 값이 전달된다 (크기를 모르면 -1).
func download(url, dest string, progress func(float64)) error {
	resp, err := httpClient.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("다운로드 실패: %s", resp.Status)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	total := resp.ContentLength
	var done int64
	buf := make([]byte, 64*1024)
	last := time.Time{}
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				return werr
			}
			done += int64(n)
			if time.Since(last) > 100*time.Millisecond {
				last = time.Now()
				if total > 0 {
					progress(float64(done) / float64(total))
				} else {
					progress(-1)
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			return rerr
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	progress(1)
	os.Remove(dest)
	return os.Rename(tmp, dest)
}
