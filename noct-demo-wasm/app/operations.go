package app

import (
	"encoding/json"
	"fmt"

	"github.com/HorizenOfficial/vela-common-go/wasm/types"
	"github.com/HorizenOfficial/vela-common-go/wasm/utils"
)

// Deploy initializes the application state
func Deploy(appId int64, paramsJSON string) types.DeployResult {
	utils.LogInfo("Deploying NoctFinance demo app %d", appId)

	// Parse constructor params
	var params struct {
		CollateralRatio uint64 `json:"collateral_ratio"`
		ProtocolVersion string `json:"protocol_version"`
	}

	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		utils.LogError("Failed to parse constructor params: %v", err)
		return types.DeployResult{
			State: []byte("{}"),
			Fuel:  types.NewUint256(1000),
			Error: fmt.Sprintf("invalid constructor params: %v", err),
		}
	}

	// Default to 200% collateralization if not specified
	if params.CollateralRatio == 0 {
		params.CollateralRatio = 200
	}

	// Create initial state
	state := NewState(params.CollateralRatio)
	stateBytes, _ := state.Serialize()

	utils.LogInfo("Deploy complete: collateral ratio = %d%%", params.CollateralRatio)

	return types.DeployResult{
		State: stateBytes,
		Fuel:  types.NewUint256(5000),
		Error: "",
	}
}

// LoadModule is the fallback initialization (deprecated in favor of Deploy)
func LoadModule(appId int64) types.LoadModuleResult {
	utils.LogInfo("Loading module %d (fallback)", appId)

	state := NewState(200) // Default 200% collateralization
	stateBytes, _ := state.Serialize()

	return types.LoadModuleResult{
		State: stateBytes,
		Fuel:  types.NewUint256(1000),
		Error: "",
	}
}

// DepositFunds handles deposit operations
func DepositFunds(appId int64, sender *types.Address, token *types.Address,
	amount *types.Uint256, stateJSON string) types.DepositResult {

	utils.LogInfo("Deposit request from %s", sender.Hex())

	// Deserialize state
	state, err := DeserializeState(stateJSON)
	if err != nil {
		utils.LogError("Failed to deserialize state: %v", err)
		return types.DepositResult{
			State:     []byte(stateJSON),
			Events:    []types.PlainEvent{},
			AppEvents: []types.AppEvent{},
			Fuel:      types.NewUint256(1000),
			Error:     fmt.Sprintf("state deserialization error: %v", err),
		}
	}

	// Process deposit
	newState, events, err := ProcessDeposit(state, sender, token, amount)
	if err != nil {
		utils.LogError("Deposit failed: %v", err)
		stateBytes, _ := state.Serialize()
		return types.DepositResult{
			State:     stateBytes,
			Events:    []types.PlainEvent{},
			AppEvents: []types.AppEvent{},
			Fuel:      types.NewUint256(2000),
			Error:     err.Error(),
		}
	}

	// Serialize new state
	newStateBytes, _ := newState.Serialize()

	utils.LogInfo("Deposit processed successfully")

	return types.DepositResult{
		State:     newStateBytes,
		Events:    events,
		AppEvents: []types.AppEvent{},
		Fuel:      types.NewUint256(5000),
		Error:     "",
	}
}

// ProcessRequest handles all user requests
func ProcessRequest(appId int64, sender *types.Address, requestType int32,
	payloadJSON string, stateJSON string) types.ProcessResult {

	utils.LogInfo("ProcessRequest from %s, type %d", sender.Hex(), requestType)

	// Handle deanonymization (requestType = 2)
	if requestType == 2 {
		return handleDeanonymization(appId, sender, payloadJSON, stateJSON)
	}

	// Standard processing (requestType = 1)
	state, err := DeserializeState(stateJSON)
	if err != nil {
		utils.LogError("Failed to deserialize state: %v", err)
		return types.ProcessResult{
			State:       []byte(stateJSON),
			Events:      []types.PlainEvent{},
			AppEvents:   []types.AppEvent{},
			Withdrawals: []types.Withdrawal{},
			Report:      nil,
			Fuel:        types.NewUint256(1000),
			Error:       fmt.Sprintf("state error: %v", err),
		}
	}

	// Parse operation request
	var req OperationRequest
	if err := json.Unmarshal([]byte(payloadJSON), &req); err != nil {
		utils.LogError("Failed to parse request: %v", err)
		stateBytes, _ := state.Serialize()
		return types.ProcessResult{
			State:       stateBytes,
			Events:      []types.PlainEvent{},
			AppEvents:   []types.AppEvent{},
			Withdrawals: []types.Withdrawal{},
			Report:      nil,
			Fuel:        types.NewUint256(1000),
			Error:       fmt.Sprintf("invalid request: %v", err),
		}
	}

	utils.LogInfo("Operation: %s", req.Operation)

	var newState *NoctState
	var events []types.PlainEvent
	var withdrawals []types.Withdrawal

	switch req.Operation {
	case OpBorrow:
		amount, err := ParseUint256(req.Amount)
		if err != nil {
			stateBytes, _ := state.Serialize()
			return types.ProcessResult{
				State:       stateBytes,
				Events:      []types.PlainEvent{},
				AppEvents:   []types.AppEvent{},
				Withdrawals: []types.Withdrawal{},
				Report:      nil,
				Fuel:        types.NewUint256(2000),
				Error:       "invalid amount",
			}
		}
		newState, events, withdrawals, err = ProcessBorrow(state, sender, amount)

	case OpRepay:
		amount, err := ParseUint256(req.Amount)
		if err != nil {
			stateBytes, _ := state.Serialize()
			return types.ProcessResult{
				State:       stateBytes,
				Events:      []types.PlainEvent{},
				AppEvents:   []types.AppEvent{},
				Withdrawals: []types.Withdrawal{},
				Report:      nil,
				Fuel:        types.NewUint256(2000),
				Error:       "invalid amount",
			}
		}
		// Repay needs the deposit to have been processed first
		zeroAddr := types.Address{}
		newState, events, err = ProcessRepay(state, sender, &zeroAddr, amount)

	case OpWithdraw:
		amount, err := ParseUint256(req.Amount)
		if err != nil {
			stateBytes, _ := state.Serialize()
			return types.ProcessResult{
				State:       stateBytes,
				Events:      []types.PlainEvent{},
				AppEvents:   []types.AppEvent{},
				Withdrawals: []types.Withdrawal{},
				Report:      nil,
				Fuel:        types.NewUint256(2000),
				Error:       "invalid amount",
			}
		}
		newState, events, withdrawals, err = ProcessWithdraw(state, sender, amount)

	case OpViewBalance:
		events, err = ViewBalance(state, sender)
		newState = state // No state change for view

	default:
		stateBytes, _ := state.Serialize()
		return types.ProcessResult{
			State:       stateBytes,
			Events:      []types.PlainEvent{},
			AppEvents:   []types.AppEvent{},
			Withdrawals: []types.Withdrawal{},
			Report:      nil,
			Fuel:        types.NewUint256(1000),
			Error:       fmt.Sprintf("unknown operation: %s", req.Operation),
		}
	}

	if err != nil {
		utils.LogError("Operation failed: %v", err)
		stateBytes, _ := state.Serialize()
		return types.ProcessResult{
			State:       stateBytes,
			Events:      []types.PlainEvent{},
			AppEvents:   []types.AppEvent{},
			Withdrawals: []types.Withdrawal{},
			Report:      nil,
			Fuel:        types.NewUint256(3000),
			Error:       err.Error(),
		}
	}

	newStateBytes, _ := newState.Serialize()
	utils.LogInfo("Operation %s completed successfully", req.Operation)

	return types.ProcessResult{
		State:       newStateBytes,
		Events:      events,
		AppEvents:   []types.AppEvent{},
		Withdrawals: withdrawals,
		Report:      nil,
		Fuel:        types.NewUint256(10000),
		Error:       "",
	}
}

func handleDeanonymization(appId int64, sender *types.Address, payloadJSON string, stateJSON string) types.ProcessResult {
	utils.LogInfo("Deanonymization request from %s", sender.Hex())

	state, err := DeserializeState(stateJSON)
	if err != nil {
		return types.ProcessResult{
			State:       []byte(stateJSON),
			Events:      []types.PlainEvent{},
			AppEvents:   []types.AppEvent{},
			Withdrawals: []types.Withdrawal{},
			Report:      nil,
			Fuel:        types.NewUint256(1000),
			Error:       fmt.Sprintf("state error: %v", err),
		}
	}

	// Create compliance report (simplified for demo)
	report := map[string]interface{}{
		"app_id":         appId,
		"total_accounts": len(state.Accounts),
		"total_deposits": state.TotalDeposits,
		"total_borrows":  state.TotalBorrows,
		"accounts":       state.Accounts,
	}

	reportBytes, _ := json.Marshal(report)
	stateBytes, _ := state.Serialize()

	utils.LogInfo("Deanonymization report generated")

	return types.ProcessResult{
		State:       stateBytes,
		Events:      []types.PlainEvent{},
		AppEvents:   []types.AppEvent{},
		Withdrawals: []types.Withdrawal{},
		Report:      reportBytes,
		Fuel:        types.NewUint256(5000),
		Error:       "",
	}
}
