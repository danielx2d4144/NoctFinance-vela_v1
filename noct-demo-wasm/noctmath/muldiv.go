package noctmath

// MulDivDown returns floor(a*b/den) with the multiplication evaluated at full
// 512-bit width.
//
// This is the primitive mandated by File 08:37, File 10:23 and File 19:50-60. It
// succeeds whenever the quotient fits in 256 bits, even when a*b does not:
//
//	MulDivDownErr(2^200, 2^200, 2^200) == 2^200   // product is 2^400, still exact
//
// It returns ErrDivByZero when den == 0, and ErrOverflow when the quotient does
// not fit in 256 bits. It never wraps, never panics and never traps.
func MulDivDownErr(a, b, den U256) (U256, error) {
	q, _, err := quoRem512(mul512(a, b), den)
	if err != nil {
		return uZero, err
	}
	return q, nil
}

// MulDivUp returns ceil(a*b/den) with the multiplication evaluated at full
// 512-bit width.
//
// Upward rounding is not a cosmetic choice: File 09:92-99 and File 10:40-48
// require repayment, debt settlement and debt-index conversion to round in the
// protocol's favour so a borrower can never settle for less than the debt they
// accrued. Using MulDivDown where MulDivUp is required is a solvency defect.
//
// It returns ErrDivByZero when den == 0, and ErrOverflow when the rounded-up
// quotient does not fit in 256 bits -- including the edge case where the exact
// quotient is already 2^256-1 with a non-zero remainder.
func MulDivUpErr(a, b, den U256) (U256, error) {
	q, rem, err := quoRem512(mul512(a, b), den)
	if err != nil {
		return uZero, err
	}
	if rem.IsZero() {
		return q, nil
	}
	// Add is checked, so q == 2^256-1 with a remainder surfaces as ErrOverflow
	// rather than wrapping to zero.
	q, err = q.Add(uOne)
	if err != nil {
		return uZero, err
	}
	return q, nil
}
