// TODO: replace hardcoded rates with real FX provider (e.g. OpenExchangeRates)
const RATES = {
  USD: 1.00,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  AUD: 0.66,
  CAD: 0.73,
  CHF: 1.13,
  CNY: 0.14,
  INR: 0.012,
  MXN: 0.058,
  BRL: 0.20,
  SGD: 0.74,
  HKD: 0.13,
  AED: 0.27,
};

export const getRate = (currency) => {
  if (!currency) return null;
  const code = currency.toUpperCase();
  return RATES[code] ?? null;
};

export const toUsd = (amount, currency) => {
  const rate = getRate(currency);
  if (rate === null) return { amount_usd: null, fx_rate: null };
  return { amount_usd: Math.round(amount * rate * 100) / 100, fx_rate: rate };
};
