package app

import (
	"github.com/HorizenOfficial/vela-common-go/wasm/types"
)

// ParseUint256 parses a hex string into a Uint256
func ParseUint256(hexStr string) (*types.Uint256, error) {
	var u types.Uint256
	err := u.SetHex(hexStr)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// AddUint256 adds two Uint256 values and returns the result with overflow flag
func AddUint256(a, b *types.Uint256) (*types.Uint256, bool) {
	var result types.Uint256
	overflow := result.AddOverflow(*a, *b)
	return &result, overflow
}

// SubUint256 subtracts b from a and returns the result with underflow flag
func SubUint256(a, b *types.Uint256) (*types.Uint256, bool) {
	var result types.Uint256
	underflow := result.SubOverflow(*a, *b)
	return &result, underflow
}
