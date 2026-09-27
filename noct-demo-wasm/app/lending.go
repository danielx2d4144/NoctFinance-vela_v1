package app

import (
	"encoding/json"
	"fmt"

	"github.com/HorizenOfficial/vela-common-go/wasm/types"
	"github.com/HorizenOfficial/vela-common-go/wasm/utils"
)

// Operation types
const (
	OpDeposit      = "DEPOSIT"
	OpBorrow       = "BORROW"
	OpRepay        = "REPAY"
	OpWithdraw     = "WITHDRAW"
	OpViewBalance  = "VIEW_BALANCE"
)

// Request payload structure
type OperationRequest struct {
	Operation string `json:"operation"`
	Amount    string `json:"amount,omitempty"` // Uint256 hex string
}

// ProcessDeposit handles collateral deposits
func ProcessDeposit(state *NoctState, sender *types.Address, token *types.Address, amount *types.Uint256) (*NoctState, []types.PlainEvent, error) {
	utils.LogInfo("Processing deposit from %s", sender.Hex())

	// Get or create account
	account := state.GetOrCreateAccount(sender)

	// Parse current balances
	currentCollateral, err := ParseUint256(account.CollateralBalance)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid collateral balance: %w", err)
	}

	currentTotal, err := ParseUint256(state.TotalDeposits)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid total deposits: %w", err)
	}

	// Add deposit
	var newCollateral types.Uint256
	overflow := newCollateral.AddOverflow(*currentCollateral, *amount)
	if overflow {
		return nil, nil, fmt.Errorf("collateral overflow")
	}

	var newTotal types.Uint256
	overflow = newTotal.AddOverflow(*currentTotal, *amount)
	if overflow {
		return nil, nil, fmt.Errorf("total deposits overflow")
	}

	// Update state
	account.CollateralBalance = newCollateral.ToHex()
	account.Nonce++
	state.TotalDeposits = newTotal.ToHex()

	utils.LogInfo("Deposit successful: new collateral = %s", newCollateral.ToHex())

	// Emit encrypted event to user
	eventData, _ := json.Marshal(map[string]interface{}{
		"operation":      "DEPOSIT",
		"new_collateral": newCollateral.ToHex(),
		"timestamp":      account.Nonce,
	})

	events := []types.PlainEvent{
		{
			UserID:       *sender,
			EventSubType: [32]byte{},
			Data:         eventData,
		},
	}

	return state, events, nil
}

// ProcessBorrow handles borrowing against collateral
func ProcessBorrow(state *NoctState, sender *types.Address, borrowAmount *types.Uint256) (*NoctState, []types.PlainEvent, []types.Withdrawal, error) {
	utils.LogInfo("Processing borrow from %s", sender.Hex())

	account := state.GetOrCreateAccount(sender)

	// Parse balances
	collateral, err := ParseUint256(account.CollateralBalance)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("invalid collateral: %w", err)
	}

	currentBorrow, err := ParseUint256(account.BorrowedBalance)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("invalid borrow balance: %w", err)
	}

	// Calculate new total borrow
	var newBorrow types.Uint256
	overflow := newBorrow.AddOverflow(*currentBorrow, *borrowAmount)
	if overflow {
		return nil, nil, nil, fmt.Errorf("borrow overflow")
	}

	// Check collateralization: borrowed_amount * collateral_ratio <= collateral * 100
	maxBorrow := *collateral
	maxBorrow.Mul64(100)

	requiredCollateral := newBorrow
	requiredCollateral.Mul64(state.CollateralRatio)

	if requiredCollateral.Cmp(maxBorrow) > 0 {
		return nil, nil, nil, fmt.Errorf("insufficient collateral: need %d%% ratio", state.CollateralRatio)
	}

	// Update state
	account.BorrowedBalance = newBorrow.ToHex()
	account.Nonce++

	totalBorrows, _ := ParseUint256(state.TotalBorrows)
	var newTotalBorrows types.Uint256
	newTotalBorrows.AddOverflow(*totalBorrows, *borrowAmount)
	state.TotalBorrows = newTotalBorrows.ToHex()

	utils.LogInfo("Borrow successful: new borrowed = %s", newBorrow.ToHex())

	// Emit event
	eventData, _ := json.Marshal(map[string]interface{}{
		"operation":        "BORROW",
		"borrowed_amount":  borrowAmount.ToHex(),
		"new_total_borrow": newBorrow.ToHex(),
		"timestamp":        account.Nonce,
	})

	events := []types.PlainEvent{
		{
			UserID:       *sender,
			EventSubType: [32]byte{},
			Data:         eventData,
		},
	}

	// Create withdrawal for borrowed amount
	zeroAddress := types.Address{}
	withdrawals := []types.Withdrawal{
		{
			TokenAddress:       zeroAddress,
			DestinationAddress: *sender,
			Amount:             borrowAmount, // borrowAmount is *Uint256, don't dereference
		},
	}

	return state, events, withdrawals, nil
}

// ProcessRepay handles loan repayments
func ProcessRepay(state *NoctState, sender *types.Address, token *types.Address, repayAmount *types.Uint256) (*NoctState, []types.PlainEvent, error) {
	utils.LogInfo("Processing repay from %s", sender.Hex())

	account := state.GetOrCreateAccount(sender)

	currentBorrow, err := ParseUint256(account.BorrowedBalance)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid borrow balance: %w", err)
	}

	// Check if repayment exceeds debt
	if repayAmount.Cmp(*currentBorrow) > 0 {
		return nil, nil, fmt.Errorf("repayment exceeds debt")
	}

	// Update balances
	var newBorrow types.Uint256
	underflow := newBorrow.SubOverflow(*currentBorrow, *repayAmount)
	if underflow {
		return nil, nil, fmt.Errorf("repayment calculation error")
	}

	account.BorrowedBalance = newBorrow.ToHex()
	account.Nonce++

	totalBorrows, _ := ParseUint256(state.TotalBorrows)
	var newTotalBorrows types.Uint256
	newTotalBorrows.SubOverflow(*totalBorrows, *repayAmount)
	state.TotalBorrows = newTotalBorrows.ToHex()

	utils.LogInfo("Repay successful: remaining debt = %s", newBorrow.ToHex())

	// Emit event
	eventData, _ := json.Marshal(map[string]interface{}{
		"operation":      "REPAY",
		"repaid_amount":  repayAmount.ToHex(),
		"remaining_debt": newBorrow.ToHex(),
		"timestamp":      account.Nonce,
	})

	events := []types.PlainEvent{
		{
			UserID:       *sender,
			EventSubType: [32]byte{},
			Data:         eventData,
		},
	}

	return state, events, nil
}

// ProcessWithdraw handles collateral withdrawals
func ProcessWithdraw(state *NoctState, sender *types.Address, withdrawAmount *types.Uint256) (*NoctState, []types.PlainEvent, []types.Withdrawal, error) {
	utils.LogInfo("Processing withdraw from %s", sender.Hex())

	account := state.GetOrCreateAccount(sender)

	currentCollateral, err := ParseUint256(account.CollateralBalance)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("invalid collateral: %w", err)
	}

	currentBorrow, err := ParseUint256(account.BorrowedBalance)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("invalid borrow: %w", err)
	}

	// Calculate remaining collateral after withdrawal
	var remainingCollateral types.Uint256
	underflow := remainingCollateral.SubOverflow(*currentCollateral, *withdrawAmount)
	if underflow {
		return nil, nil, nil, fmt.Errorf("insufficient collateral")
	}

	// Check if remaining collateral maintains required ratio
	if !currentBorrow.IsZero() {
		maxBorrow := remainingCollateral
		maxBorrow.Mul64(100)

		requiredCollateral := *currentBorrow
		requiredCollateral.Mul64(state.CollateralRatio)

		if requiredCollateral.Cmp(maxBorrow) > 0 {
			return nil, nil, nil, fmt.Errorf("withdrawal would under-collateralize position")
		}
	}

	// Update state
	account.CollateralBalance = remainingCollateral.ToHex()
	account.Nonce++

	totalDeposits, _ := ParseUint256(state.TotalDeposits)
	var newTotalDeposits types.Uint256
	newTotalDeposits.SubOverflow(*totalDeposits, *withdrawAmount)
	state.TotalDeposits = newTotalDeposits.ToHex()

	utils.LogInfo("Withdraw successful: remaining collateral = %s", remainingCollateral.ToHex())

	// Emit event
	eventData, _ := json.Marshal(map[string]interface{}{
		"operation":            "WITHDRAW",
		"withdrawn_amount":     withdrawAmount.ToHex(),
		"remaining_collateral": remainingCollateral.ToHex(),
		"timestamp":            account.Nonce,
	})

	events := []types.PlainEvent{
		{
			UserID:       *sender,
			EventSubType: [32]byte{},
			Data:         eventData,
		},
	}

	// Create withdrawal
	zeroAddress := types.Address{}
	withdrawals := []types.Withdrawal{
		{
			TokenAddress:       zeroAddress,
			DestinationAddress: *sender,
			Amount:             withdrawAmount, // withdrawAmount is *Uint256, don't dereference
		},
	}

	return state, events, withdrawals, nil
}

// ViewBalance returns encrypted balance information to user
func ViewBalance(state *NoctState, sender *types.Address) ([]types.PlainEvent, error) {
	utils.LogInfo("View balance request from: %s", sender.Hex())

	account := state.GetOrCreateAccount(sender)

	// Create encrypted event with full balance info
	eventData, _ := json.Marshal(map[string]interface{}{
		"operation":        "VIEW_BALANCE",
		"collateral":       account.CollateralBalance,
		"borrowed":         account.BorrowedBalance,
		"nonce":            account.Nonce,
		"collateral_ratio": state.CollateralRatio,
	})

	events := []types.PlainEvent{
		{
			UserID:       *sender,
			EventSubType: [32]byte{},
			Data:         eventData,
		},
	}

	return events, nil
}
