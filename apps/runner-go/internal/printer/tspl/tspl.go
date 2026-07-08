// Package tspl provides a skeleton TSPL/TSPL2 payload builder for TSPL-capable
// thermal printers (e.g. Postek G2000). It constructs raw TSPL byte slices
// suitable for the raw TCP executor.
//
// STATUS: skeleton. The current builder emits a minimal valid label so the
// pipeline can be exercised end-to-end. A full template/render pipeline will be
// layered on top in later iterations.
package tspl

import (
	"fmt"
	"strings"
)

// LabelSpec describes the minimal fields needed to render a TSPL label.
type LabelSpec struct {
	// WidthMM / HeightMM define the label dimensions in millimetres.
	WidthMM  float64
	HeightMM float64
	// GapMM is the vertical gap between labels in millimetres.
	GapMM float64
	// TextLines are rendered top-to-bottom with a fixed pitch (in dots).
	TextLines []string
	// Barcode (optional) value rendered as CODE 128.
	Barcode string
}

// Builder constructs TSPL payloads.
type Builder struct {
	// DefaultWidthMM / DefaultHeightMM used when a spec omits dimensions.
	DefaultWidthMM  float64
	DefaultHeightMM float64
	DefaultGapMM    float64
	// DPI assumed for converting mm pitch; default 203.
	DPI int
}

// New returns a Builder with sensible 4x6-inch defaults at 203dpi.
func New() *Builder {
	return &Builder{DefaultWidthMM: 101.6, DefaultHeightMM: 152.4, DefaultGapMM: 2.0, DPI: 203}
}

// Build renders the spec into TSPL bytes.
func (b *Builder) Build(spec LabelSpec) ([]byte, error) {
	width := spec.WidthMM
	if width <= 0 {
		width = b.DefaultWidthMM
	}
	height := spec.HeightMM
	if height <= 0 {
		height = b.DefaultHeightMM
	}
	gap := spec.GapMM
	if gap <= 0 {
		gap = b.DefaultGapMM
	}

	var sb strings.Builder
	// SIZE and GAP set the label dimensions and inter-label gap.
	fmt.Fprintf(&sb, "SIZE %.1f mm,%.1f mm\n", width, height)
	fmt.Fprintf(&sb, "GAP %.1f mm,0 mm\n", gap)
	// CLS clears the image buffer.
	sb.WriteString("CLS\n")

	// Render text lines with a fixed dot pitch.
	const startX, startY, pitch, fontWidth, fontHeight = 40, 40, 60, 3, 3
	for i, line := range spec.TextLines {
		y := startY + i*pitch
		fmt.Fprintf(&sb, "TEXT %d,%d,\"3\",0,%d,%d,\"%s\"\n", startX, y, fontHeight, fontWidth, escapeText(line))
	}

	// Optional CODE 128 barcode below text.
	if strings.TrimSpace(spec.Barcode) != "" {
		y := startY + len(spec.TextLines)*pitch + 20
		fmt.Fprintf(&sb, "BARCODE %d,%d,\"128\",100,1,0,2,2,\"%s\"\n", startX, y, escapeText(spec.Barcode))
	}

	// PRINT emits the label.
	sb.WriteString("PRINT 1\n")
	return []byte(sb.String()), nil
}

// escapeText escapes double quotes/backslashes inside TSPL string literals.
func escapeText(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	return s
}
