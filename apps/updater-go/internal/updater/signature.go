package updater

import (
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
)

func verifyArtifact(request Request) error {
	file, err := os.Open(request.ArtifactPath)
	if err != nil {
		return fmt.Errorf("open staged artifact: %w", err)
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := file.WriteTo(hash); err != nil {
		return fmt.Errorf("hash staged artifact: %w", err)
	}
	digest := hash.Sum(nil)
	if !strings.EqualFold(hex.EncodeToString(digest), request.ArtifactSHA256) {
		return fmt.Errorf("staged artifact SHA-256 does not match the handoff")
	}
	if !request.RequireSignature {
		return nil
	}
	publicKey, err := decodePublicKey(request.PublicKey)
	if err != nil {
		return err
	}
	signature, err := decodeSignature(request.ArtifactSignature)
	if err != nil || !ed25519.Verify(publicKey, digest, signature) {
		return fmt.Errorf("staged artifact Ed25519 signature is invalid")
	}
	return nil
}

func decodePublicKey(value string) (ed25519.PublicKey, error) {
	trimmed := strings.TrimSpace(value)
	if strings.Contains(trimmed, "BEGIN PUBLIC KEY") {
		block, _ := pem.Decode([]byte(trimmed))
		if block == nil {
			return nil, fmt.Errorf("Ed25519 public key PEM is invalid")
		}
		parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse Ed25519 public key PEM: %w", err)
		}
		key, ok := parsed.(ed25519.PublicKey)
		if !ok {
			return nil, fmt.Errorf("OTA public key is not Ed25519")
		}
		return key, nil
	}
	if raw, err := hex.DecodeString(trimmed); err == nil && len(raw) == ed25519.PublicKeySize {
		return ed25519.PublicKey(raw), nil
	}
	raw, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("Ed25519 public key must be 32 raw bytes in hex or base64")
	}
	return ed25519.PublicKey(raw), nil
}

func decodeSignature(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if raw, err := hex.DecodeString(trimmed); err == nil && len(raw) == ed25519.SignatureSize {
		return raw, nil
	}
	raw, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil || len(raw) != ed25519.SignatureSize {
		return nil, fmt.Errorf("Ed25519 signature must be 64 bytes in hex or base64")
	}
	return raw, nil
}
