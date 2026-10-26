package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b []int
		want int
	}{
		{[]int{1, 0, 0}, []int{1, 0, 0}, 0},
		{[]int{1, 0, 0}, []int{1, 0, 1}, -1},
		{[]int{1, 2}, []int{1, 1, 9}, 1},
		{[]int{1}, []int{1, 0, 0}, 0},
	}
	for _, c := range cases {
		if got := compareVersions(c.a, c.b); got != c.want {
			t.Errorf("compareVersions(%v, %v) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestEmbeddedPayload(t *testing.T) {
	c, err := parseConfig(configJSON)
	if err != nil {
		t.Fatal(err)
	}
	if c.Title == "" || c.WindowTitle == "" {
		t.Fatal("launcher.json 에 title 이 없습니다")
	}
	m, err := parseManifest(bpManifest)
	if err != nil {
		t.Fatal(err)
	}
	if versionString(m.Header.Version) == "" {
		t.Fatal("버전이 비어 있습니다")
	}
	if len(addonPayload) < 1024 {
		t.Fatal("내장된 .mcaddon 이 비어 있습니다")
	}
}

func TestFindInstalledVersion(t *testing.T) {
	appData := t.TempDir()
	root := filepath.Join(appData, "Minecraft Bedrock", "Users", "Shared", "games", "com.mojang")
	write := func(dir, uuid, ver string) {
		p := filepath.Join(root, "behavior_packs", dir)
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		body := `{"header":{"uuid":"` + uuid + `","version":[` + ver + `]}}`
		if err := os.WriteFile(filepath.Join(p, "manifest.json"), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("a", "ABC", "1,0,0")
	write("b", "abc", "1,2,0")
	write("c", "other", "9,9,9")

	dirs := comMojangDirs("", appData)
	if len(dirs) != 1 {
		t.Fatalf("com.mojang 폴더 %d개 발견, 1개 기대", len(dirs))
	}
	got := findInstalledVersion(dirs, "abc")
	if versionString(got) != "1.2.0" {
		t.Fatalf("설치 버전 %v, 1.2.0 기대", got)
	}
	if findInstalledVersion(dirs, "none") != nil {
		t.Fatal("없는 팩이 발견됨")
	}
}
