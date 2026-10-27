// Formats a DECIMAL string from MySQL ("12500.00") as rupees ("₹12,500.00")
// using string operations only, so no float rounding ever touches money.
export function formatINR(decimalString) {
  if (decimalString === null || decimalString === undefined) return '₹0.00';
  const [rawInt, rawFrac = ''] = String(decimalString).split('.');
  const negative = rawInt.startsWith('-');
  const intPart = negative ? rawInt.slice(1) : rawInt;
  const frac = (rawFrac + '00').slice(0, 2);

  // Indian grouping: last three digits, then groups of two (12,34,567).
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;

  return `${negative ? '-' : ''}₹${grouped}.${frac}`;
}
