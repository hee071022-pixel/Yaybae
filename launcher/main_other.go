//go:build !windows

package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "중세 무기고 런처는 Windows 전용입니다.")
	os.Exit(1)
}
