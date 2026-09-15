package snmp

import (
	"fmt"
	"strings"
)

// Printer MIB (RFC 3805) and Host Resources MIB (RFC 2790) object identifiers.
//
// These give device-level truth the Windows spooler cannot: the spooler reports
// a job done once it has handed the bytes to the driver, which on a real EPSON
// is roughly 15 seconds before the paper actually comes out.
const (
	// OIDSysName is the agent's configured system name.
	OIDSysName = "1.3.6.1.2.1.1.5.0"
	// OIDDeviceStatus is hrDeviceStatus: 1=unknown 2=running 3=warning
	// 4=testing 5=down.
	OIDDeviceStatus = "1.3.6.1.2.1.25.3.2.1.5.1"
	// OIDPrinterStatus is hrPrinterStatus: 1=other 2=unknown 3=idle
	// 4=printing 5=warmup.
	OIDPrinterStatus = "1.3.6.1.2.1.25.3.5.1.1.1"
	// OIDPrinterDetectedErrorState is hrPrinterDetectedErrorState, a bit field
	// decoded by DecodeErrorState.
	OIDPrinterDetectedErrorState = "1.3.6.1.2.1.25.3.5.1.2.1"
	// OIDMarkerLifeCount is prtMarkerLifeCount, the lifetime page counter. It
	// increments exactly once per printed page.
	OIDMarkerLifeCount = "1.3.6.1.2.1.43.10.2.1.4.1.1"
	// OIDMarkerSuppliesLevel is prtMarkerSuppliesLevel (-2 unknown,
	// -3 "some remaining").
	OIDMarkerSuppliesLevel = "1.3.6.1.2.1.43.11.1.1.9.1.1"
)

// printerErrorBits lists hrPrinterDetectedErrorState bit positions, most
// significant bit of the first octet first.
var printerErrorBits = [...]string{
	"lowPaper",
	"noPaper",
	"lowToner",
	"noToner",
	"doorOpen",
	"jammed",
	"offline",
	"serviceRequested",
	"inputTrayMissing",
	"outputTrayMissing",
	"markerSupplyMissing",
	"outputNearFull",
	"outputFull",
	"inputTrayEmpty",
	"overduePreventMaint",
}

// blockingErrors names the raised bits that mean the job will not print without
// human intervention.
var blockingErrors = map[string]bool{
	"noPaper":             true,
	"noToner":             true,
	"doorOpen":            true,
	"jammed":              true,
	"offline":             true,
	"serviceRequested":    true,
	"inputTrayMissing":    true,
	"markerSupplyMissing": true,
	"outputFull":          true,
	"inputTrayEmpty":      true,
}

// DeviceState is a point-in-time reading of a printer over SNMP. Optional
// fields are nil when the printer does not expose the corresponding object;
// callers must treat a missing PageCount as "cannot verify", never as failure.
type DeviceState struct {
	// Host is the address the reading came from.
	Host string
	// PageCount is prtMarkerLifeCount.
	PageCount *int64
	// DeviceStatus is hrDeviceStatus.
	DeviceStatus *int64
	// PrinterStatus is hrPrinterStatus.
	PrinterStatus *int64
	// Errors holds the decoded names of every raised error bit.
	Errors []string
	// Blocked is true when a raised error prevents printing.
	Blocked bool
	// SupplyLevel is prtMarkerSuppliesLevel.
	SupplyLevel *int64
}

// DecodeErrorState decodes an hrPrinterDetectedErrorState octet string into the
// names of the raised bits. An empty or all-clear value yields no names.
func DecodeErrorState(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var names []string
	for byteIndex, b := range raw {
		for bit := range 8 {
			if b&(0x80>>uint(bit)) == 0 {
				continue
			}
			index := byteIndex*8 + bit
			if index >= len(printerErrorBits) {
				continue
			}
			names = append(names, printerErrorBits[index])
		}
	}
	return names
}

// IsBlockingError reports whether a decoded error name prevents printing.
func IsBlockingError(name string) bool { return blockingErrors[name] }

// ReadDeviceState reads the full device state in one exchange. An error means
// the printer did not answer usefully — callers must treat that as "cannot
// verify" rather than as a print failure.
func ReadDeviceState(host string, opts Options) (*DeviceState, error) {
	vbs, err := Get(host, []string{
		OIDDeviceStatus,
		OIDPrinterStatus,
		OIDPrinterDetectedErrorState,
		OIDMarkerLifeCount,
		OIDMarkerSuppliesLevel,
	}, opts)
	if err != nil {
		return nil, err
	}

	state := &DeviceState{
		Host:          host,
		DeviceStatus:  numberAt(vbs, OIDDeviceStatus),
		PrinterStatus: numberAt(vbs, OIDPrinterStatus),
		PageCount:     numberAt(vbs, OIDMarkerLifeCount),
		SupplyLevel:   numberAt(vbs, OIDMarkerSuppliesLevel),
	}
	if vb, ok := Lookup(vbs, OIDPrinterDetectedErrorState); ok {
		state.Errors = DecodeErrorState(vb.Bytes)
	}
	for _, name := range state.Errors {
		if blockingErrors[name] {
			state.Blocked = true
			break
		}
	}
	return state, nil
}

// ReadPageCount reads only prtMarkerLifeCount — the cheap poll used while
// waiting for paper. It returns ErrNoValue when the printer answers but does
// not expose the counter.
func ReadPageCount(host string, opts Options) (int64, error) {
	vbs, err := Get(host, []string{OIDMarkerLifeCount}, opts)
	if err != nil {
		return 0, err
	}
	vb, ok := Lookup(vbs, OIDMarkerLifeCount)
	if !ok || !vb.HasNum {
		return 0, ErrNoValue
	}
	return vb.Num, nil
}

// Describe renders a short, non-sensitive summary for trace output.
func (s *DeviceState) Describe() string {
	if s == nil {
		return ""
	}
	var parts []string
	if s.PageCount != nil {
		parts = append(parts, fmt.Sprintf("pages=%d", *s.PageCount))
	}
	if s.PrinterStatus != nil {
		parts = append(parts, fmt.Sprintf("printerStatus=%d", *s.PrinterStatus))
	}
	if len(s.Errors) > 0 {
		parts = append(parts, "errors="+strings.Join(s.Errors, ","))
	}
	return strings.Join(parts, " ")
}

// numberAt returns the numeric value for oid, or nil when it is absent or not
// an integer-family value.
func numberAt(vbs []Varbind, oid string) *int64 {
	vb, ok := Lookup(vbs, oid)
	if !ok || !vb.HasNum {
		return nil
	}
	value := vb.Num
	return &value
}
