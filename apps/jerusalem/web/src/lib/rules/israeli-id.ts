/**
 * Israeli identity, company and nonprofit numbers share one check digit: weights 1,2,1,2...
 * over nine digits, digits of each product summed, total divisible by 10.
 */
export function validCheckDigit(number: string): boolean {
  if (!/^\d{5,9}$/.test(number)) return false;
  const digits = number.padStart(9, '0');
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    const product = Number(digits[index]) * ((index % 2) + 1);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0;
}
