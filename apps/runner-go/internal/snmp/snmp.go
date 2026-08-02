// Package snmp implements the small subset of SNMPv1 the runner needs to read
// device-level truth from a network printer: a single GetRequest over UDP with
// hand-rolled BER encoding and decoding.
//
// The runner ships as a static binary with no third-party dependencies, so the
// wire format is built here rather than pulled in. Only GetRequest is needed —
// every Printer MIB value the runner reads is scalar.
//
// Nothing in this package panics. Truncated, malformed or unanswered exchanges
// are reported as errors so callers can treat "cannot verify" as distinct from
// "the print failed".
package snmp

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand/v2"
	"net"
	"strconv"
	"strings"
	"time"
)

// Defaults applied when Options leaves a field zero.
const (
	// DefaultCommunity is the SNMPv1 read community used when none is set.
	DefaultCommunity = "public"
	// DefaultPort is the standard SNMP agent port.
	DefaultPort = 161
	// DefaultTimeout bounds a single request/response exchange.
	DefaultTimeout = 2 * time.Second
)

// BER tags used by SNMPv1.
const (
	tagInteger     byte = 0x02
	tagOctetString byte = 0x04
	tagNull        byte = 0x05
	tagOID         byte = 0x06
	tagSequence    byte = 0x30
	tagCounter32   byte = 0x41
	tagGauge32     byte = 0x42
	tagTimeTicks   byte = 0x43

	tagGetRequest  byte = 0xa0
	tagGetNext     byte = 0xa1
	tagGetResponse byte = 0xa2
)

const (
	// maxResponseBytes caps a single datagram read. Printer MIB scalars are
	// tiny; anything larger is not a reply we can use.
	maxResponseBytes = 8192
	// maxParseDepth bounds recursion into nested SEQUENCEs.
	maxParseDepth = 6
	// maxIntegerBytes rejects absurd integer encodings before they overflow.
	maxIntegerBytes = 8
)

// ErrNoValue reports that the agent answered but did not return a usable value
// for the requested OID (unsupported OID, or a Null in an error response).
var ErrNoValue = errors.New("snmp: agent returned no value for the requested oid")

// Varbind is one decoded OID/value pair from a response.
type Varbind struct {
	// OID is the dotted object identifier the value belongs to.
	OID string
	// Tag is the BER tag the agent used for the value.
	Tag byte
	// Num holds INTEGER, Counter32, Gauge32 and TimeTicks values. Valid only
	// when HasNum is true.
	Num int64
	// HasNum reports whether Num was populated.
	HasNum bool
	// Bytes holds OCTET STRING values as raw octets. Error bitmasks are
	// byte-oriented, so no text decoding is applied.
	Bytes []byte
}

// Options tunes a single Get exchange. The zero value is valid and uses the
// package defaults.
type Options struct {
	// Community is the SNMPv1 read community (default "public").
	Community string
	// Timeout bounds the whole exchange (default 2s).
	Timeout time.Duration
	// Port is the agent UDP port (default 161).
	Port int
}

func (o Options) community() string {
	if strings.TrimSpace(o.Community) == "" {
		return DefaultCommunity
	}
	return o.Community
}

func (o Options) timeout() time.Duration {
	if o.Timeout <= 0 {
		return DefaultTimeout
	}
	return o.Timeout
}

func (o Options) port() int {
	if o.Port <= 0 {
		return DefaultPort
	}
	return o.Port
}

// Get issues one SNMPv1 GetRequest and returns the decoded varbinds.
//
// host may be an IPv4 address, a hostname, or an IPv6 address carrying a zone
// id (for example "fe80::5257:9cff:fe4f:6a3c%6"), which is the only address a
// WSD-attached printer exposes.
func Get(host string, oids []string, opts Options) ([]Varbind, error) {
	host = strings.TrimSpace(host)
	if host == "" {
		return nil, errors.New("snmp: host is empty")
	}
	if len(oids) == 0 {
		return nil, errors.New("snmp: no oids requested")
	}

	request, err := buildGetRequest(opts.community(), oids, newRequestID())
	if err != nil {
		return nil, err
	}

	addr := dialAddress(host, opts.port())
	timeout := opts.timeout()

	conn, err := net.DialTimeout("udp", addr, timeout)
	if err != nil {
		return nil, fmt.Errorf("snmp: dial %s: %w", addr, err)
	}
	defer func() { _ = conn.Close() }()

	if err := conn.SetDeadline(time.Now().Add(timeout)); err != nil {
		return nil, fmt.Errorf("snmp: set deadline: %w", err)
	}
	if _, err := conn.Write(request); err != nil {
		return nil, fmt.Errorf("snmp: send to %s: %w", addr, err)
	}

	buf := make([]byte, maxResponseBytes)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, fmt.Errorf("snmp: read from %s: %w", addr, err)
	}
	return ParseResponse(buf[:n])
}

// Lookup returns the varbind for oid from a decoded response.
func Lookup(vbs []Varbind, oid string) (Varbind, bool) {
	for _, vb := range vbs {
		if vb.OID == oid {
			return vb, true
		}
	}
	return Varbind{}, false
}

// dialAddress builds the net.Dial target for a host. net.JoinHostPort brackets
// IPv6 literals, preserving the "%zone" suffix that WSD printers require.
func dialAddress(host string, port int) string {
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// newRequestID picks a non-zero request id. SNMPv1 agents echo it back; the
// runner performs one exchange per socket so no correlation is needed.
func newRequestID() int64 {
	return int64(rand.IntN(0x7ffe)) + 1
}

// ── BER encoding ──────────────────────────────────────────────────────

// encodeLength emits a BER definite-form length.
func encodeLength(n int) []byte {
	if n < 0x80 {
		return []byte{byte(n)}
	}
	var body []byte
	for v := n; v > 0; v >>= 8 {
		body = append([]byte{byte(v & 0xff)}, body...)
	}
	return append([]byte{0x80 | byte(len(body))}, body...)
}

// tlv wraps body in a tag/length/value triple.
func tlv(tag byte, body []byte) []byte {
	out := make([]byte, 0, len(body)+5)
	out = append(out, tag)
	out = append(out, encodeLength(len(body))...)
	return append(out, body...)
}

// encodeInteger emits a minimal two's-complement BER INTEGER.
func encodeInteger(v int64) []byte {
	var raw [8]byte
	binary.BigEndian.PutUint64(raw[:], uint64(v))

	start := 0
	for start < 7 {
		lead, next := raw[start], raw[start+1]
		if (lead == 0x00 && next&0x80 == 0) || (lead == 0xff && next&0x80 != 0) {
			start++
			continue
		}
		break
	}
	return tlv(tagInteger, raw[start:])
}

// encodeOID emits a BER OBJECT IDENTIFIER from its dotted form.
func encodeOID(oid string) ([]byte, error) {
	trimmed := strings.TrimSpace(oid)
	if trimmed == "" {
		return nil, errors.New("snmp: oid is empty")
	}
	parts := strings.Split(trimmed, ".")
	if len(parts) < 2 {
		return nil, fmt.Errorf("snmp: oid %q needs at least two arcs", oid)
	}

	arcs := make([]uint64, 0, len(parts))
	for _, part := range parts {
		arc, err := strconv.ParseUint(part, 10, 32)
		if err != nil {
			return nil, fmt.Errorf("snmp: oid %q has invalid arc %q", oid, part)
		}
		arcs = append(arcs, arc)
	}
	if arcs[0] > 2 || arcs[1] > 39 {
		return nil, fmt.Errorf("snmp: oid %q has an unencodable first pair", oid)
	}

	body := []byte{byte(arcs[0]*40 + arcs[1])}
	for _, arc := range arcs[2:] {
		body = appendBase128(body, arc)
	}
	return tlv(tagOID, body), nil
}

// appendBase128 appends an OID arc in base-128 continuation form.
func appendBase128(dst []byte, v uint64) []byte {
	if v < 0x80 {
		return append(dst, byte(v))
	}
	var tmp [10]byte
	i := len(tmp) - 1
	tmp[i] = byte(v & 0x7f)
	for v >>= 7; v > 0; v >>= 7 {
		i--
		tmp[i] = byte(v&0x7f) | 0x80
	}
	return append(dst, tmp[i:]...)
}

// buildGetRequest assembles a complete SNMPv1 GetRequest message.
func buildGetRequest(community string, oids []string, requestID int64) ([]byte, error) {
	var varbinds []byte
	for _, oid := range oids {
		encoded, err := encodeOID(oid)
		if err != nil {
			return nil, err
		}
		entry := append(encoded, tlv(tagNull, nil)...)
		varbinds = append(varbinds, tlv(tagSequence, entry)...)
	}

	var pdu []byte
	pdu = append(pdu, encodeInteger(requestID)...)
	pdu = append(pdu, encodeInteger(0)...) // error-status
	pdu = append(pdu, encodeInteger(0)...) // error-index
	pdu = append(pdu, tlv(tagSequence, varbinds)...)

	var message []byte
	message = append(message, encodeInteger(0)...) // version 1
	message = append(message, tlv(tagOctetString, []byte(community))...)
	message = append(message, tlv(tagGetRequest, pdu)...)
	return tlv(tagSequence, message), nil
}

// ── BER decoding ──────────────────────────────────────────────────────

// readLength decodes a definite-form length starting at offset, returning the
// length and the offset of the first content byte.
func readLength(buf []byte, offset int) (length, next int, ok bool) {
	if offset < 0 || offset >= len(buf) {
		return 0, 0, false
	}
	first := buf[offset]
	if first < 0x80 {
		return int(first), offset + 1, true
	}
	count := int(first & 0x7f)
	if count == 0 || count > 4 || offset+count >= len(buf) {
		return 0, 0, false
	}
	value := 0
	for i := 1; i <= count; i++ {
		value = value<<8 | int(buf[offset+i])
	}
	if value < 0 {
		return 0, 0, false
	}
	return value, offset + 1 + count, true
}

// decodeOID renders BER OID content bytes back to dotted form.
func decodeOID(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var sb strings.Builder
	first := uint64(body[0])
	sb.WriteString(strconv.FormatUint(first/40, 10))
	sb.WriteByte('.')
	sb.WriteString(strconv.FormatUint(first%40, 10))

	var arc uint64
	for _, b := range body[1:] {
		if arc>>56 != 0 {
			// Absurd arc: stop rather than wrap around silently.
			return sb.String()
		}
		arc = arc<<7 | uint64(b&0x7f)
		if b&0x80 == 0 {
			sb.WriteByte('.')
			sb.WriteString(strconv.FormatUint(arc, 10))
			arc = 0
		}
	}
	return sb.String()
}

// decodeSigned reads a two's-complement BER INTEGER body.
func decodeSigned(body []byte) (int64, bool) {
	if len(body) == 0 || len(body) > maxIntegerBytes {
		return 0, false
	}
	value := int64(0)
	if body[0]&0x80 != 0 {
		value = -1
	}
	for _, b := range body {
		value = value<<8 | int64(b)
	}
	return value, true
}

// decodeUnsigned reads a Counter32/Gauge32/TimeTicks body, which is unsigned.
func decodeUnsigned(body []byte) (int64, bool) {
	if len(body) == 0 || len(body) > maxIntegerBytes {
		return 0, false
	}
	var value uint64
	for _, b := range body {
		value = value<<8 | uint64(b)
	}
	if value > uint64(1)<<62 {
		return 0, false
	}
	return int64(value), true
}

// ParseResponse extracts the varbinds from an SNMP response message.
//
// It is deliberately tolerant of shape: the varbind list is located by walking
// the message rather than by asserting an exact layout, and every offset is
// bounds-checked so a truncated datagram yields an error instead of a panic.
func ParseResponse(buf []byte) ([]Varbind, error) {
	if len(buf) < 2 {
		return nil, errors.New("snmp: response too short")
	}
	if buf[0] != tagSequence {
		return nil, fmt.Errorf("snmp: unexpected top-level tag 0x%02x", buf[0])
	}
	length, next, ok := readLength(buf, 1)
	if !ok {
		return nil, errors.New("snmp: malformed top-level length")
	}
	end := min(next+length, len(buf))

	var out []Varbind
	collectVarbinds(buf, next, end, 0, &out)
	if len(out) == 0 {
		return nil, errors.New("snmp: response contained no varbinds")
	}
	return out, nil
}

// collectVarbinds walks [start,end) appending every varbind SEQUENCE it finds.
func collectVarbinds(buf []byte, start, end, depth int, out *[]Varbind) {
	if depth > maxParseDepth {
		return
	}
	offset := start
	for offset < end && offset < len(buf) {
		tag := buf[offset]
		length, next, ok := readLength(buf, offset+1)
		if !ok {
			return
		}
		bodyEnd := min(next+length, len(buf))
		if next > bodyEnd {
			return
		}
		body := buf[next:bodyEnd]

		switch {
		case tag == tagSequence && len(body) > 0 && body[0] == tagOID:
			if vb, ok := decodeVarbind(body); ok {
				*out = append(*out, vb)
			}
		case tag == tagSequence, tag == tagGetRequest, tag == tagGetNext, tag == tagGetResponse:
			collectVarbinds(buf, next, bodyEnd, depth+1, out)
		}

		if bodyEnd <= offset {
			// No forward progress means the encoding is malformed; stop
			// rather than spin.
			return
		}
		offset = bodyEnd
	}
}

// decodeVarbind decodes a SEQUENCE { OID, value } body.
func decodeVarbind(body []byte) (Varbind, bool) {
	oidLen, oidStart, ok := readLength(body, 1)
	if !ok {
		return Varbind{}, false
	}
	oidEnd := oidStart + oidLen
	if oidEnd > len(body) || oidStart > oidEnd {
		return Varbind{}, false
	}
	vb := Varbind{OID: decodeOID(body[oidStart:oidEnd])}
	if vb.OID == "" {
		return Varbind{}, false
	}

	if oidEnd >= len(body) {
		return Varbind{}, false
	}
	valueTag := body[oidEnd]
	valueLen, valueStart, ok := readLength(body, oidEnd+1)
	if !ok {
		return Varbind{}, false
	}
	valueEnd := min(valueStart+valueLen, len(body))
	if valueStart > valueEnd {
		return Varbind{}, false
	}
	value := body[valueStart:valueEnd]

	vb.Tag = valueTag
	switch valueTag {
	case tagInteger:
		vb.Num, vb.HasNum = decodeSigned(value)
	case tagCounter32, tagGauge32, tagTimeTicks:
		vb.Num, vb.HasNum = decodeUnsigned(value)
	case tagOctetString:
		vb.Bytes = append([]byte(nil), value...)
	}
	return vb, true
}
