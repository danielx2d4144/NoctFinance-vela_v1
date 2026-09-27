package main

import (
"fmt"
"math/big"
)

func main() {
h := "f0f0f0f0f0f0f0f00f0f0f0f0f0f0f0ffedcba98765432100123456789abcdef"
v, ok := new(big.Int).SetString(h, 16)
if !ok { panic("bad hex") }
fmt.Println("dec:", v.String())
fmt.Println("len:", len(v.String()))
}
