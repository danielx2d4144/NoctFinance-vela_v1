// +build wasm

package main

import (
	"github.com/HorizenOfficial/vela-common-go/wasm/types"
	"github.com/HorizenOfficial/vela-common-go/wasm/utils"
	"github.com/noctfinance/noct-demo-wasm/app"
)

// WASM exports required by Vela v0.2.0

//export deploy
func deploy(appId int64, paramsPtr *byte, paramsLen int32) *byte {
	paramsJSON := utils.PtrToString(paramsPtr, paramsLen)

	utils.LogInfo("NoctFinance Demo: Deploying application %d", appId)
	utils.LogInfo("Constructor params: %s", paramsJSON)

	result := app.Deploy(appId, paramsJSON)
	return types.SerializeAndWriteResult(result)
}

//export load_module
func load_module(appId int64) *byte {
	utils.LogInfo("NoctFinance Demo: Loading module %d (fallback)", appId)
	
	result := app.LoadModule(appId)
	return types.SerializeAndWriteResult(result)
}

//export deposit
func deposit(appId int64, senderPtr *byte, senderLen int32,
	tokenPtr *byte, tokenLen int32,
	valuePtr *byte, valueLen int32,
	statePtr *byte, stateLen int32) *byte {

	sender := types.PtrToAddress(senderPtr, senderLen)
	token := types.PtrToAddress(tokenPtr, tokenLen)
	value := types.PtrToUint256(valuePtr, valueLen)
	state := utils.PtrToString(statePtr, stateLen)

	utils.LogInfo("NoctFinance Demo: Deposit from %s, token %s, amount %s",
		sender.Hex(), token.Hex(), value.ToHex())

	result := app.DepositFunds(appId, sender, token, value, state)
	return types.SerializeAndWriteResult(result)
}

//export process_request
func process_request(appId int64, senderPtr *byte, senderLen int32,
	requestType int32,
	payloadPtr *byte, payloadLen int32,
	statePtr *byte, stateLen int32) *byte {
	
	sender := types.PtrToAddress(senderPtr, senderLen)
	payload := utils.PtrToString(payloadPtr, payloadLen)
	state := utils.PtrToString(statePtr, stateLen)
	
	utils.LogInfo("NoctFinance Demo: Processing request type %d from %s",
		requestType, sender.Hex())
	
	result := app.ProcessRequest(appId, sender, requestType, payload, state)
	return types.SerializeAndWriteResult(result)
}

func main() {
	// Required for TinyGo WASM target
	// The actual entry points are the exported functions above
}

