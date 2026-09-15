package snmp

import (
	"bytes"
	"testing"
)

func TestEncodeLength(t *testing.T) {
	cases := []struct {
		name string
		in   int
		want []byte
	}{
		{"zero", 0, []byte{0x00}},
		{"short form max", 0x7f, []byte{0x7f}},
		{"long form one byte", 0x80, []byte{0x81, 0x80}},
		{"long form one byte max", 0xff, []byte{0x81, 0xff}},
		{"long form two bytes", 0x0123, []byte{0x82, 0x01, 0x23}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := encodeLength(tc.in); !bytes.Equal(got, tc.want) {
				t.Errorf("encodeLength(%d) = % x, want % x", tc.in, got, tc.want)
			}
		})
	}
}

func TestEncodeIntegerRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		in   int64
		want []byte
	}{
		{"zero", 0, []byte{0x02, 0x01, 0x00}},
		{"small positive", 2, []byte{0x02, 0x01, 0x02}},
		{"needs pad byte", 128, []byte{0x02, 0x02, 0x00, 0x80}},
		{"request id", 12345, []byte{0x02, 0x02, 0x30, 0x39}},
		{"negative one", -1, []byte{0x02, 0x01, 0xff}},
		{"supply level unknown", -2, []byte{0x02, 0x01, 0xfe}},
		{"negative needs pad", -129, []byte{0x02, 0x02, 0xff, 0x7f}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := encodeInteger(tc.in)
			if !bytes.Equal(got, tc.want) {
				t.Fatalf("encodeInteger(%d) = % x, want % x", tc.in, got, tc.want)
			}
			back, ok := decodeSigned(got[2:])
			if !ok {
				t.Fatalf("decodeSigned(% x) reported failure", got[2:])
			}
			if back != tc.in {
				t.Errorf("round trip of %d gave %d", tc.in, back)
			}
		})
	}
}

func TestEncodeOIDRoundTrip(t *testing.T) {
	cases := []struct {
		name string
		oid  string
		want []byte
	}{
		{
			name: "hrDeviceStatus",
			oid:  OIDDeviceStatus,
			want: []byte{0x06, 0x0b, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x19, 0x03, 0x02, 0x01, 0x05, 0x01},
		},
		{
			name: "prtMarkerLifeCount",
			oid:  OIDMarkerLifeCount,
			want: []byte{0x06, 0x0c, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x2b, 0x0a, 0x02, 0x01, 0x04, 0x01, 0x01},
		},
		{
			name: "sysName",
			oid:  OIDSysName,
			want: []byte{0x06, 0x08, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x05, 0x00},
		},
		{
			name: "multi byte arc",
			oid:  "1.3.6.1.4.1.1248",
			want: []byte{0x06, 0x07, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x89, 0x60},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := encodeOID(tc.oid)
			if err != nil {
				t.Fatalf("encodeOID(%q) failed: %v", tc.oid, err)
			}
			if !bytes.Equal(got, tc.want) {
				t.Fatalf("encodeOID(%q) = % x, want % x", tc.oid, got, tc.want)
			}
			if back := decodeOID(got[2:]); back != tc.oid {
				t.Errorf("decodeOID round trip = %q, want %q", back, tc.oid)
			}
		})
	}
}

func TestEncodeOIDRejectsGarbage(t *testing.T) {
	cases := []string{"", "1", "1.3.x.1", "1.-3.6", "3.1.1", "1.40.1"}
	for _, oid := range cases {
		if _, err := encodeOID(oid); err == nil {
			t.Errorf("encodeOID(%q) should have failed", oid)
		}
	}
}

func TestReadLength(t *testing.T) {
	cases := []struct {
		name       string
		buf        []byte
		offset     int
		wantLength int
		wantNext   int
		wantOK     bool
	}{
		{"short form", []byte{0x05, 0xff}, 0, 5, 1, true},
		{"long form one byte", []byte{0x81, 0x90, 0x00}, 0, 0x90, 2, true},
		{"long form two bytes", []byte{0x82, 0x01, 0x23, 0x00}, 0, 0x0123, 3, true},
		{"offset past end", []byte{0x05}, 4, 0, 0, false},
		{"truncated long form", []byte{0x82, 0x01}, 0, 0, 0, false},
		{"indefinite form rejected", []byte{0x80, 0x01}, 0, 0, 0, false},
		{"oversized count rejected", []byte{0x86, 1, 2, 3, 4, 5, 6}, 0, 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			length, next, ok := readLength(tc.buf, tc.offset)
			if ok != tc.wantOK || (ok && (length != tc.wantLength || next != tc.wantNext)) {
				t.Errorf("readLength(% x, %d) = (%d, %d, %v), want (%d, %d, %v)",
					tc.buf, tc.offset, length, next, ok, tc.wantLength, tc.wantNext, tc.wantOK)
			}
		})
	}
}

// capturedResponse has the exact shape a printer's SNMPv1 GetResponse takes on
// the wire: SEQUENCE { version, community, GetResponse { ids, varbind list } }.
//
//	30 54                                   SEQUENCE (84 bytes)
//	  02 01 00                              version = 0 (SNMPv1)
//	  04 06 "public"                        community
//	  a2 47                                 GetResponse PDU (71 bytes)
//	    02 02 30 39                         request-id 12345
//	    02 01 00                            error-status 0
//	    02 01 00                            error-index 0
//	    30 3b                               varbind list (59 bytes)
//	      hrDeviceStatus            INTEGER      2   (running)
//	      hrPrinterDetectedError..  OCTET STRING 40 00 (noPaper)
//	      prtMarkerLifeCount        Counter32    100000
var capturedResponse = []byte{
	0x30, 0x54,
	0x02, 0x01, 0x00,
	0x04, 0x06, 'p', 'u', 'b', 'l', 'i', 'c',
	0xa2, 0x47,
	0x02, 0x02, 0x30, 0x39,
	0x02, 0x01, 0x00,
	0x02, 0x01, 0x00,
	0x30, 0x3b,
	0x30, 0x10,
	0x06, 0x0b, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x19, 0x03, 0x02, 0x01, 0x05, 0x01,
	0x02, 0x01, 0x02,
	0x30, 0x11,
	0x06, 0x0b, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x19, 0x03, 0x05, 0x01, 0x02, 0x01,
	0x04, 0x02, 0x40, 0x00,
	0x30, 0x14,
	0x06, 0x0c, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x2b, 0x0a, 0x02, 0x01, 0x04, 0x01, 0x01,
	0x41, 0x04, 0x00, 0x01, 0x86, 0xa0,
}

func TestParseResponse_CapturedShape(t *testing.T) {
	vbs, err := ParseResponse(capturedResponse)
	if err != nil {
		t.Fatalf("ParseResponse failed: %v", err)
	}
	if len(vbs) != 3 {
		t.Fatalf("got %d varbinds, want 3", len(vbs))
	}

	status, ok := Lookup(vbs, OIDDeviceStatus)
	if !ok || !status.HasNum || status.Num != 2 {
		t.Errorf("hrDeviceStatus = %+v, want numeric 2", status)
	}

	errState, ok := Lookup(vbs, OIDPrinterDetectedErrorState)
	if !ok || !bytes.Equal(errState.Bytes, []byte{0x40, 0x00}) {
		t.Errorf("hrPrinterDetectedErrorState = %+v, want octets 40 00", errState)
	}
	if names := DecodeErrorState(errState.Bytes); len(names) != 1 || names[0] != "noPaper" {
		t.Errorf("decoded errors = %v, want [noPaper]", names)
	}

	pages, ok := Lookup(vbs, OIDMarkerLifeCount)
	if !ok || !pages.HasNum || pages.Num != 100000 {
		t.Errorf("prtMarkerLifeCount = %+v, want numeric 100000", pages)
	}
	if pages.Tag != tagCounter32 {
		t.Errorf("prtMarkerLifeCount tag = 0x%02x, want 0x%02x", pages.Tag, tagCounter32)
	}
}

// TestParseResponse_Truncated feeds every prefix of a valid response. None may
// panic; each must either decode what it can or return an error.
func TestParseResponse_Truncated(t *testing.T) {
	for n := range capturedResponse {
		if _, err := ParseResponse(capturedResponse[:n]); err != nil {
			continue // expected for most prefixes
		}
	}
}

func TestParseResponse_Malformed(t *testing.T) {
	cases := []struct {
		name string
		buf  []byte
	}{
		{"empty", nil},
		{"one byte", []byte{0x30}},
		{"wrong top level tag", []byte{0x31, 0x02, 0x02, 0x00}},
		{"bad top level length", []byte{0x30, 0x82, 0x01}},
		{"no varbinds", []byte{0x30, 0x03, 0x02, 0x01, 0x00}},
		{"length overruns buffer", []byte{0x30, 0x40, 0x02, 0x01, 0x00}},
		{"varbind with truncated value", []byte{
			0x30, 0x0f,
			0x30, 0x0d,
			0x06, 0x0b, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x19, 0x03, 0x02, 0x01, 0x05, 0x01,
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// The contract is "no panic"; an error or a partial decode are both
			// acceptable outcomes.
			if _, err := ParseResponse(tc.buf); err != nil {
				return
			}
		})
	}
}

// TestBuildGetRequest_RoundTrip encodes a request and decodes it again: the
// request and response PDUs share the varbind layout, so the walker sees the
// exact OIDs that were asked for.
func TestBuildGetRequest_RoundTrip(t *testing.T) {
	oids := []string{OIDDeviceStatus, OIDPrinterDetectedErrorState, OIDMarkerLifeCount}
	req, err := buildGetRequest("public", oids, 12345)
	if err != nil {
		t.Fatalf("buildGetRequest failed: %v", err)
	}
	if req[0] != tagSequence {
		t.Fatalf("request tag = 0x%02x, want 0x%02x", req[0], tagSequence)
	}

	vbs, err := ParseResponse(req)
	if err != nil {
		t.Fatalf("ParseResponse of own request failed: %v", err)
	}
	if len(vbs) != len(oids) {
		t.Fatalf("got %d varbinds, want %d", len(vbs), len(oids))
	}
	for i, oid := range oids {
		if vbs[i].OID != oid {
			t.Errorf("varbind %d oid = %q, want %q", i, vbs[i].OID, oid)
		}
		if vbs[i].Tag != tagNull {
			t.Errorf("varbind %d tag = 0x%02x, want Null", i, vbs[i].Tag)
		}
	}
}

func TestBuildGetRequest_RejectsBadOID(t *testing.T) {
	if _, err := buildGetRequest("public", []string{"nonsense"}, 1); err == nil {
		t.Error("expected an error for an unencodable oid")
	}
}

// TestDialAddress covers the WSD case: an IPv6 link-local with a zone id must
// come out bracketed so net.Dial accepts it.
func TestDialAddress(t *testing.T) {
	cases := []struct {
		name string
		host string
		port int
		want string
	}{
		{"ipv4", "192.168.1.50", 161, "192.168.1.50:161"},
		{"hostname", "epson-lab.local", 161, "epson-lab.local:161"},
		{"ipv6 link local with zone", "fe80::5257:9cff:fe4f:6a3c%6", 161, "[fe80::5257:9cff:fe4f:6a3c%6]:161"},
		{"ipv6 no zone", "2001:db8::1", 1161, "[2001:db8::1]:1161"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := dialAddress(tc.host, tc.port); got != tc.want {
				t.Errorf("dialAddress(%q, %d) = %q, want %q", tc.host, tc.port, got, tc.want)
			}
		})
	}
}

func TestGetRejectsBadInput(t *testing.T) {
	if _, err := Get("", []string{OIDMarkerLifeCount}, Options{}); err == nil {
		t.Error("expected an error for an empty host")
	}
	if _, err := Get("127.0.0.1", nil, Options{}); err == nil {
		t.Error("expected an error for no oids")
	}
}

func TestOptionsDefaults(t *testing.T) {
	var zero Options
	if zero.community() != DefaultCommunity {
		t.Errorf("community default = %q, want %q", zero.community(), DefaultCommunity)
	}
	if zero.port() != DefaultPort {
		t.Errorf("port default = %d, want %d", zero.port(), DefaultPort)
	}
	if zero.timeout() != DefaultTimeout {
		t.Errorf("timeout default = %v, want %v", zero.timeout(), DefaultTimeout)
	}
	custom := Options{Community: "private", Port: 1161}
	if custom.community() != "private" || custom.port() != 1161 {
		t.Errorf("explicit options were not honoured: %+v", custom)
	}
}
