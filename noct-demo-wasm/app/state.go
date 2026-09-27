package app

import (
	"encoding/json"

	"github.com/HorizenOfficial/vela-common-go/wasm/types"
)

// NoctState represents the entire private state of the lending protocol
type NoctState struct {
	Accounts       map[string]*Account `json:"accounts"`
	TotalDeposits  string              `json:"total_deposits"`  // Uint256 as hex string
	TotalBorrows   string              `json:"total_borrows"`   // Uint256 as hex string
	CollateralRatio uint64             `json:"collateral_ratio"` // e.g., 200 means 200% (2:1)
	Version        string              `json:"version"`
}

// Account represents a user's lending position
type Account struct {
	CollateralBalance string `json:"collateral_balance"` // Uint256 as hex string
	BorrowedBalance   string `json:"borrowed_balance"`   // Uint256 as hex string
	Nonce             uint64 `json:"nonce"`
}

// NewState creates initial empty state
func NewState(collateralRatio uint64) *NoctState {
	return &NoctState{
		Accounts:        make(map[string]*Account),
		TotalDeposits:   types.NewUint256(0).ToHex(),
		TotalBorrows:    types.NewUint256(0).ToHex(),
		CollateralRatio: collateralRatio,
		Version:         "v0.1.0",
	}
}

// Serialize converts state to JSON bytes
func (s *NoctState) Serialize() ([]byte, error) {
	return json.Marshal(s)
}

// DeserializeState parses JSON state
func DeserializeState(data string) (*NoctState, error) {
	if data == "" || data == "{}" {
		return NewState(200), nil // Default 200% collateralization
	}

	var state NoctState
	if err := json.Unmarshal([]byte(data), &state); err != nil {
		return nil, err
	}

	if state.Accounts == nil {
		state.Accounts = make(map[string]*Account)
	}

	return &state, nil
}

// GetOrCreateAccount returns existing account or creates new one
func (s *NoctState) GetOrCreateAccount(address *types.Address) *Account {
	addrHex := address.Hex()

	if acc, exists := s.Accounts[addrHex]; exists {
		return acc
	}

	acc := &Account{
		CollateralBalance: types.NewUint256(0).ToHex(),
		BorrowedBalance:   types.NewUint256(0).ToHex(),
		Nonce:             0,
	}
	s.Accounts[addrHex] = acc
	return acc
}
