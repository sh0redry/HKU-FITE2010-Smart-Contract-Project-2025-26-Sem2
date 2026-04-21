export const MARKET_CONFIGS = {
  AAPL: { basePremiumBps: 150, annualVolBps: 2800, downsideRiskBps: 120, upsideRiskBps: 90, startPrice: 185 },
  TSLA: { basePremiumBps: 190, annualVolBps: 4200, downsideRiskBps: 180, upsideRiskBps: 140, startPrice: 172 },
  NVDA: { basePremiumBps: 175, annualVolBps: 3600, downsideRiskBps: 150, upsideRiskBps: 120, startPrice: 890 },
  MSFT: { basePremiumBps: 135, annualVolBps: 2100, downsideRiskBps: 100, upsideRiskBps: 85, startPrice: 415 }
};

export const MARKET_SCENARIOS = {
  AAPL: [
    { date: "2025-01-02", price: 185 },
    { date: "2025-01-03", price: 183 },
    { date: "2025-01-06", price: 179 },
    { date: "2025-01-07", price: 176 },
    { date: "2025-01-08", price: 170 },
    { date: "2025-01-09", price: 173 },
    { date: "2025-01-10", price: 177 },
    { date: "2025-01-13", price: 181 },
    { date: "2025-01-14", price: 188 }
  ],
  TSLA: [
    { date: "2025-01-02", price: 172 },
    { date: "2025-01-03", price: 165 },
    { date: "2025-01-06", price: 158 },
    { date: "2025-01-07", price: 150 },
    { date: "2025-01-08", price: 161 },
    { date: "2025-01-09", price: 170 },
    { date: "2025-01-10", price: 178 },
    { date: "2025-01-13", price: 185 },
    { date: "2025-01-14", price: 192 }
  ],
  NVDA: [
    { date: "2025-01-02", price: 890 },
    { date: "2025-01-03", price: 910 },
    { date: "2025-01-06", price: 940 },
    { date: "2025-01-07", price: 980 },
    { date: "2025-01-08", price: 1025 },
    { date: "2025-01-09", price: 995 },
    { date: "2025-01-10", price: 970 },
    { date: "2025-01-13", price: 945 },
    { date: "2025-01-14", price: 930 }
  ],
  MSFT: [
    { date: "2025-01-02", price: 415 },
    { date: "2025-01-03", price: 418 },
    { date: "2025-01-06", price: 422 },
    { date: "2025-01-07", price: 426 },
    { date: "2025-01-08", price: 430 },
    { date: "2025-01-09", price: 428 },
    { date: "2025-01-10", price: 424 },
    { date: "2025-01-13", price: 419 },
    { date: "2025-01-14", price: 412 }
  ]
};
