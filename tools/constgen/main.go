package main

import (
"fmt"
"math/big"
)

func limbs(s string) {
v, _ := new(big.Int).SetString(s, 10)
b := v.Bytes()
var pad [32]byte
copy(pad[32-len(b):], b)
var w [4]uint64
for i := 0; i < 4; i++ {
for j := 0; j < 8; j++ {
w[i] = w[i]<<8 | uint64(pad[32-8*(i+1)+j])
}
}
fmt.Printf("%-8s dec=%-32s hex=0x%064x\n         limbs=[4]uint64{0x%016x, 0x%016x, 0x%016x, 0x%016x}\n", s, s, v, w[0], w[1], w[2], w[3])
}

func main() {
limbs("1000000000000000000")
limbs("1000000000000000000000000000")
limbs("31536000")
for d := 0; d <= 18; d++ {
v := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(18-d)), nil)
fmt.Printf("quantum(10^%d)=%s\n", d, v.String())
}
mx := new(big.Int).Sub(new(big.Int).Exp(big.NewInt(2), big.NewInt(256), nil), big.NewInt(1))
fmt.Printf("MAX=0x%x\n", mx)
}
