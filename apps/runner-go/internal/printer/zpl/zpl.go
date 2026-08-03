// Package zpl provides a skeleton ZPL (Zebra Programming Language) payload
// builder. It constructs raw ZPL II byte slices suitable for the raw TCP
// executor.
//
// STATUS: skeleton. The current builder emits a minimal valid label so the
// pipeline can be exercised end-to-end against a ZPL-capable printer or
// emulator. A full template/render pipeline (variables, barcode, QR, fonts)
// will be layered on top in later iterations.
package zpl

import (
	"fmt"
	"strings"
)

// LabelSpec describes the minimal fields needed to render a ZPL label.
type LabelSpec struct {
	// WidthDots / HeightDots define the label dimensions in printer dots.
	WidthDots  int
	HeightDots int
	// TextLines are rendered top-to-bottom with a fixed pitch.
	TextLines []string
	// Barcode (optional) human-readable value rendered as Code 128.
	Barcode string
}

// Builder constructs ZPL payloads.
type Builder struct {
	// DefaultWidthDots / DefaultHeightDots used when a spec omits dimensions.
	DefaultWidthDots  int
	DefaultHeightDots int
}

// New returns a Builder with sensible 4x6-inch @203dpi defaults.
func New() *Builder {
	return &Builder{DefaultWidthDots: 812, DefaultHeightDots: 1218}
}

// Build renders the spec into ZPL II bytes.
func (b *Builder) Build(spec LabelSpec) ([]byte, error) {
	width := spec.WidthDots
	if width <= 0 {
		width = b.DefaultWidthDots
	}
	height := spec.HeightDots
	if height <= 0 {
		height = b.DefaultHeightDots
	}

	var sb strings.Builder
	// Start of label + label format.
	sb.WriteString("^XA")
	// Label length setting (^LL) and width (^PW).
	fmt.Fprintf(&sb, "^PW%d", width)
	fmt.Fprintf(&sb, "^LL%d", height)

	// Render text lines with a 40-dot pitch starting at y=40.
	const startX, startY, pitch, fontWidth, fontHeight = 40, 40, 60, 30, 30
	for i, line := range spec.TextLines {
		y := startY + i*pitch
		fmt.Fprintf(&sb, "^FO%d,%d^A0N,%d,%d^FD%s^FS", startX, y, fontHeight, fontWidth, escapeFD(line))
	}

	// Optional Code 128 barcode below text.
	if strings.TrimSpace(spec.Barcode) != "" {
		y := startY + len(spec.TextLines)*pitch + 20
		fmt.Fprintf(&sb, "^FO%d,%d^BCN,100,Y,N,N^FD%s^FS", startX, y, escapeFD(spec.Barcode))
	}

	sb.WriteString("^XZ")
	return []byte(sb.String()), nil
}

// escapeFD escapes characters that are special inside ^FD fields. Only the most
// common metacharacter (^) is escaped to avoid malformed format commands.
func escapeFD(s string) string {
	return strings.ReplaceAll(s, "^", "\\^")
}
