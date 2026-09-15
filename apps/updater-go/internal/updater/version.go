package updater

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var nativeSemver = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

type nativeVersion struct {
	major, minor, patch int64
	pre                 string
}

func parseNativeVersion(value string) (nativeVersion, error) {
	match := nativeSemver.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return nativeVersion{}, fmt.Errorf("invalid semantic version %q", value)
	}
	numbers := make([]int64, 3)
	for index, text := range match[1:4] {
		if len(text) > 1 && text[0] == '0' {
			return nativeVersion{}, fmt.Errorf("invalid semantic version %q", value)
		}
		number, err := strconv.ParseInt(text, 10, 64)
		if err != nil {
			return nativeVersion{}, fmt.Errorf("invalid semantic version %q", value)
		}
		numbers[index] = number
	}
	return nativeVersion{major: numbers[0], minor: numbers[1], patch: numbers[2], pre: match[4]}, nil
}

func compareNativeVersions(left, right string) (int, error) {
	a, err := parseNativeVersion(left)
	if err != nil {
		return 0, err
	}
	b, err := parseNativeVersion(right)
	if err != nil {
		return 0, err
	}
	for _, pair := range [][2]int64{{a.major, b.major}, {a.minor, b.minor}, {a.patch, b.patch}} {
		if pair[0] < pair[1] {
			return -1, nil
		}
		if pair[0] > pair[1] {
			return 1, nil
		}
	}
	if a.pre == b.pre {
		return 0, nil
	}
	if a.pre == "" {
		return 1, nil
	}
	if b.pre == "" {
		return -1, nil
	}
	leftParts := strings.Split(a.pre, ".")
	rightParts := strings.Split(b.pre, ".")
	for index := 0; index < len(leftParts) && index < len(rightParts); index++ {
		leftPart, rightPart := leftParts[index], rightParts[index]
		leftNumeric := isDigits(leftPart)
		rightNumeric := isDigits(rightPart)
		if leftNumeric && rightNumeric {
			leftNumber, _ := strconv.ParseInt(leftPart, 10, 64)
			rightNumber, _ := strconv.ParseInt(rightPart, 10, 64)
			if leftNumber < rightNumber {
				return -1, nil
			}
			if leftNumber > rightNumber {
				return 1, nil
			}
		} else if leftNumeric != rightNumeric {
			if leftNumeric {
				return -1, nil
			}
			return 1, nil
		} else if leftPart != rightPart {
			if leftPart < rightPart {
				return -1, nil
			}
			return 1, nil
		}
	}
	if len(leftParts) < len(rightParts) {
		return -1, nil
	}
	return 1, nil
}

func isDigits(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}
