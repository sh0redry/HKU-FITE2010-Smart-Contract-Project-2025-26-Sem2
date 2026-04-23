import { MARKET_CONFIGS, MARKET_SCENARIOS } from "./scenarios.js";

const BPS = 10000;
const YEAR_HOURS = 365 * 24;
const SHORT_TERM_MAX = 7 * 24;
const MEDIUM_TERM_MAX = 21 * 24;
const policies = [];

const el = {
  simSymbol: document.getElementById("simSymbol"),
  simDirection: document.getElementById("simDirection"),
  simTrigger: document.getElementById("simTrigger"),
  simNotional: document.getElementById("simNotional"),
  simDeductible: document.getElementById("simDeductible"),
  simPayoutCap: document.getElementById("simPayoutCap"),
  simDuration: document.getElementById("simDuration"),
  simStartIndex: document.getElementById("simStartIndex"),
  addPolicyButton: document.getElementById("addPolicyButton"),
  runSimulationButton: document.getElementById("runSimulationButton"),
  loadMockPackButton: document.getElementById("loadMockPackButton"),
  playMockTimelineButton: document.getElementById("playMockTimelineButton"),
  scenarioOutput: document.getElementById("scenarioOutput"),
  policiesQueueOutput: document.getElementById("policiesQueueOutput"),
  simulationOutput: document.getElementById("simulationOutput"),
  mockPlaybackOutput: document.getElementById("mockPlaybackOutput")
};

function updateScenarioPreview(symbol) {
  el.scenarioOutput.textContent = JSON.stringify(MARKET_SCENARIOS[symbol], null, 2);
}

function estimateProbabilityBps(annualVolBps, durationHours, triggerBps, directionalRiskBps, riskScoreBps) {
  const timeScaledVolBps = Math.floor((annualVolBps * durationHours) / YEAR_HOURS);
  const difficulty = triggerBps + 250;
  const raw = Math.floor(((timeScaledVolBps + directionalRiskBps + Math.floor(riskScoreBps / 10) + 300) * BPS) / difficulty);
  return Math.max(300, Math.min(9000, raw));
}

function utilizationSurchargeBps(utilizationBps = 3500) {
  if (utilizationBps <= 7000) {
    return Math.floor(utilizationBps / 20);
  }
  const excess = utilizationBps - 7000;
  return 350 + Math.floor((excess * excess) / 900);
}

function termMultiplierBps(durationHours, market) {
  if (durationHours <= SHORT_TERM_MAX) return market.shortTermMultiplierBps;
  if (durationHours <= MEDIUM_TERM_MAX) return market.mediumTermMultiplierBps;
  return market.longTermMultiplierBps;
}

function quotePolicy(input) {
  const market = MARKET_CONFIGS[input.symbol];
  const entryPrice = MARKET_SCENARIOS[input.symbol][input.startIndex]?.price ?? market.startPrice;
  const durationHours = input.durationSteps * 24;
  const strikePrice = input.direction === "down"
    ? entryPrice * (BPS - input.triggerBps) / BPS
    : entryPrice * (BPS + input.triggerBps) / BPS;
  const directionalRiskBps = input.direction === "down" ? market.downsideSkewBps : market.upsideSkewBps;
  const inventoryPressureBps =
    input.direction === "down" ? market.downsideInventoryPressureBps : market.upsideInventoryPressureBps;
  const termBps = termMultiplierBps(durationHours, market);
  const probabilityBps = estimateProbabilityBps(
    market.annualVolBps,
    durationHours,
    input.triggerBps,
    directionalRiskBps,
    market.riskScoreBps
  );
  const adjustedAnnualVolBps = Math.floor((market.annualVolBps * termBps) / BPS);
  const moveMagnitudeBps = input.triggerBps + Math.floor((adjustedAnnualVolBps * durationHours) / YEAR_HOURS);
  const stressPremiumBps = market.stressPremiumBps + Math.floor(market.riskScoreBps / 20);
  const totalRateBps =
    market.basePremiumBps +
    directionalRiskBps +
    inventoryPressureBps +
    stressPremiumBps +
    utilizationSurchargeBps() +
    Math.floor(probabilityBps / 12) +
    Math.floor(moveMagnitudeBps / 8) +
    Math.floor((input.payoutCap * 1000) / input.notional);

  return {
    premium: Math.floor((input.notional * totalRateBps) / BPS),
    entryPrice,
    strikePrice,
    estimatedProbabilityBps: probabilityBps,
    termStructureMultiplierBps: termBps,
    directionalRiskBps,
    inventoryPressureBps,
    stressPremiumBps,
    riskScoreBps: market.riskScoreBps
  };
}

function runScenario() {
  if (policies.length === 0) {
    el.simulationOutput.textContent = "Queue at least one policy first.";
    return;
  }

  const results = [];
  let totalPremium = 0;
  let totalPayout = 0;

  for (const policy of policies) {
    const path = MARKET_SCENARIOS[policy.symbol];
    const exitIndex = Math.min(policy.startIndex + policy.durationSteps, path.length - 1);
    const exitPoint = path[exitIndex];
    const quote = quotePolicy(policy);

    let rawPayout = 0;
    if (policy.direction === "down" && exitPoint.price < quote.strikePrice) {
      rawPayout = (policy.notional * (quote.strikePrice - exitPoint.price)) / quote.entryPrice;
    }
    if (policy.direction === "up" && exitPoint.price > quote.strikePrice) {
      rawPayout = (policy.notional * (exitPoint.price - quote.strikePrice)) / quote.entryPrice;
    }

    let payout = 0;
    if (rawPayout > policy.deductible) {
      payout = Math.min(rawPayout - policy.deductible, policy.payoutCap);
    }

    totalPremium += quote.premium;
    totalPayout += payout;
    results.push({
      symbol: policy.symbol,
      direction: policy.direction,
      triggerPct: `${policy.triggerBps / 100}%`,
      entryDate: path[policy.startIndex]?.date,
      exitDate: exitPoint.date,
      entryPrice: quote.entryPrice,
      exitPrice: exitPoint.price,
      strikePrice: quote.strikePrice,
      premium: quote.premium,
      estimatedProbabilityBps: quote.estimatedProbabilityBps,
      termStructureMultiplierBps: quote.termStructureMultiplierBps,
      directionalRiskBps: quote.directionalRiskBps,
      inventoryPressureBps: quote.inventoryPressureBps,
      stressPremiumBps: quote.stressPremiumBps,
      riskScoreBps: quote.riskScoreBps,
      triggered: payout > 0,
      payout,
      protocolRevenue: quote.premium - payout
    });
  }

  el.simulationOutput.textContent = JSON.stringify({
    policies: results,
    summary: {
      policyCount: results.length,
      triggeredCount: results.filter((item) => item.triggered).length,
      totalPremium,
      totalPayout,
      protocolRevenue: totalPremium - totalPayout
    }
  }, null, 2);
}

function refreshQueue() {
  el.policiesQueueOutput.textContent = policies.length === 0 ? "No policies queued." : JSON.stringify(policies, null, 2);
}

function loadMockPresentationPack() {
  policies.length = 0;
  policies.push(
    {
      symbol: "MOCK",
      direction: "down",
      triggerBps: 1500,
      notional: 1500,
      deductible: 25,
      payoutCap: 800,
      durationSteps: 20,
      startIndex: 0
    },
    {
      symbol: "MOCK",
      direction: "up",
      triggerBps: 1000,
      notional: 1200,
      deductible: 10,
      payoutCap: 500,
      durationSteps: 12,
      startIndex: 3
    }
  );

  el.simSymbol.value = "MOCK";
  el.simDirection.value = "down";
  el.simTrigger.value = "1500";
  el.simNotional.value = "1500";
  el.simDeductible.value = "25";
  el.simPayoutCap.value = "800";
  el.simDuration.value = "20";
  el.simStartIndex.value = "0";
  refreshQueue();
  updateScenarioPreview("MOCK");
}

async function playMockTimeline() {
  const path = MARKET_SCENARIOS.MOCK;
  if (!path) {
    el.mockPlaybackOutput.textContent = "MOCK scenario unavailable.";
    return;
  }

  const lines = [];
  for (let index = 0; index < path.length; index += 1) {
    const candle = path[index];
    lines.push(`step ${index + 1}/${path.length} | ${candle.date} | ${candle.price}`);
    el.mockPlaybackOutput.textContent = lines.join("\n");
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  el.mockPlaybackOutput.textContent += "\n\nMOCK month replay finished.";
}

function addPolicy() {
  const symbol = el.simSymbol.value;
  const policy = {
    symbol,
    direction: el.simDirection.value,
    triggerBps: Number(el.simTrigger.value),
    notional: Number(el.simNotional.value),
    deductible: Number(el.simDeductible.value),
    payoutCap: Number(el.simPayoutCap.value),
    durationSteps: Number(el.simDuration.value),
    startIndex: Number(el.simStartIndex.value)
  };

  policies.push(policy);
  refreshQueue();
  updateScenarioPreview(symbol);
}

el.simSymbol.addEventListener("change", () => updateScenarioPreview(el.simSymbol.value));
el.addPolicyButton.addEventListener("click", addPolicy);
el.runSimulationButton.addEventListener("click", runScenario);
el.loadMockPackButton.addEventListener("click", loadMockPresentationPack);
el.playMockTimelineButton.addEventListener("click", playMockTimeline);

updateScenarioPreview(el.simSymbol.value);
