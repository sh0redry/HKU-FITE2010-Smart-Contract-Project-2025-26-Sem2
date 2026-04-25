import { MARKET_CONFIGS, MARKET_SCENARIOS } from "./scenarios.js";

const BPS = 10000;
const YEAR_HOURS = 365 * 24;
const SHORT_TERM_MAX = 7 * 24;
const MEDIUM_TERM_MAX = 21 * 24;
const policies = [];

// ── DOM references ──────────────────────────────────────────
const el = {
  simSymbol:           document.getElementById("simSymbol"),
  simDirection:        document.getElementById("simDirection"),
  simTrigger:          document.getElementById("simTrigger"),
  simNotional:         document.getElementById("simNotional"),
  simDeductible:       document.getElementById("simDeductible"),
  simPayoutCap:        document.getElementById("simPayoutCap"),
  simDuration:         document.getElementById("simDuration"),
  simStartIndex:       document.getElementById("simStartIndex"),
  addPolicyButton:     document.getElementById("addPolicyButton"),
  runSimulationButton: document.getElementById("runSimulationButton"),
  clearPoliciesButton: document.getElementById("clearPoliciesButton"),
  loadMockPackButton:  document.getElementById("loadMockPackButton"),
  playMockTimelineButton: document.getElementById("playMockTimelineButton"),
  scenarioOutput:      document.getElementById("scenarioOutput"),
  scenarioPathChart:   document.getElementById("scenarioPathChart"),
  queueCountPill:      document.getElementById("queueCountPill"),
  queueCompositionChart: document.getElementById("queueCompositionChart"),
  policiesQueueBody:   document.getElementById("policiesQueueBody"),
  policiesQueueOutput: document.getElementById("policiesQueueOutput"),
  simResultCard:       document.getElementById("simResultCard"),
  simStatusPill:       document.getElementById("simStatusPill"),
  simKpiRow:           document.getElementById("simKpiRow"),
  simPriceChart:       document.getElementById("simPriceChart"),
  simPayoutChart:      document.getElementById("simPayoutChart"),
  simResultsBody:      document.getElementById("simResultsBody"),
  simulationOutput:    document.getElementById("simulationOutput"),
  mockTimelineChart:   document.getElementById("mockTimelineChart"),
  timelinePill:        document.getElementById("timelinePill"),
  mockPlaybackOutput:  document.getElementById("mockPlaybackOutput")
};

// ── Chart helpers ──────────────────────────────────────────
const PAD = { l: 52, r: 20, t: 18, b: 28 };

function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function priceScale(prices, width, height) {
  const minP = Math.min(...prices) * 0.97;
  const maxP = Math.max(...prices) * 1.03;
  const w = width - PAD.l - PAD.r;
  const h = height - PAD.t - PAD.b;
  return {
    minP, maxP, w, h,
    sx: (i, total) => PAD.l + (i / Math.max(total - 1, 1)) * w,
    sy: p => PAD.t + h - ((p - minP) / (maxP - minP || 1)) * h
  };
}

function drawGrid(ctx, width, height, minP, maxP) {
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = PAD.t + (g / 4) * (height - PAD.t - PAD.b);
    ctx.strokeStyle = "rgba(55,130,255,0.1)";
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(width - PAD.r, y); ctx.stroke();
    const label = (maxP - g * (maxP - minP) / 4).toFixed(0);
    ctx.fillStyle = "rgba(106,140,176,0.7)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`$${label}`, PAD.l - 4, y + 3);
  }
  ctx.setLineDash([]);
  ctx.textAlign = "start";
}

function drawPriceLine(ctx, path, sx, sy, color = "#26d1c8") {
  if (path.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(0, path.length), sy(path[0].price));
  path.forEach((c, i) => ctx.lineTo(sx(i, path.length), sy(c.price)));
  ctx.stroke();
}

function drawAreaFill(ctx, path, sx, sy, height, color) {
  if (path.length === 0) return;
  const grad = ctx.createLinearGradient(0, PAD.t, 0, height - PAD.b);
  grad.addColorStop(0, color.replace(")", ",0.22)").replace("rgb", "rgba"));
  grad.addColorStop(1, color.replace(")", ",0.03)").replace("rgb", "rgba"));
  ctx.beginPath();
  ctx.moveTo(sx(0, path.length), sy(path[0].price));
  path.forEach((c, i) => ctx.lineTo(sx(i, path.length), sy(c.price)));
  ctx.lineTo(sx(path.length - 1, path.length), height - PAD.b);
  ctx.lineTo(sx(0, path.length), height - PAD.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

function pathToCandles(path) {
  if (!Array.isArray(path) || path.length === 0) return [];
  return path.map((point, index) => {
    const prev = path[Math.max(index - 1, 0)]?.price ?? point.price;
    const open = prev;
    const close = point.price;
    const wiggle = Math.max(point.price * 0.012, 0.04);
    const high = Math.max(open, close) + wiggle;
    const low = Math.max(0.01, Math.min(open, close) - wiggle);
    return { time: point.date, open, high, low, close };
  });
}

function drawCandles(ctx, candles, width, height, options = {}) {
  if (!candles.length) return null;
  const pad = options.pad || { l: 52, r: 20, t: 18, b: 28 };
  const pricesHigh = candles.map(c => c.high);
  const pricesLow = candles.map(c => c.low);
  const minP = Math.min(...pricesLow) * 0.995;
  const maxP = Math.max(...pricesHigh) * 1.005;
  const drawW = width - pad.l - pad.r;
  const drawH = height - pad.t - pad.b;
  const xStep = drawW / Math.max(candles.length, 1);
  const candleW = Math.max((xStep * 0.55), 2);
  const toY = (price) => pad.t + ((maxP - price) / Math.max(maxP - minP, 0.0001)) * drawH;

  // Grid
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g += 1) {
    const y = pad.t + (g / 4) * drawH;
    const label = maxP - (g / 4) * (maxP - minP);
    ctx.strokeStyle = "rgba(55,130,255,0.1)";
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(width - pad.r, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(106,140,176,0.7)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`$${label.toFixed(2)}`, pad.l - 5, y + 3);
  }
  ctx.setLineDash([]);
  ctx.textAlign = "start";

  candles.forEach((candle, index) => {
    const x = pad.l + index * xStep + xStep / 2;
    const openY = toY(candle.open);
    const closeY = toY(candle.close);
    const highY = toY(candle.high);
    const lowY = toY(candle.low);
    const isUp = candle.close >= candle.open;
    const upColor = options.upColor || "rgba(0,196,140,0.9)";
    const downColor = options.downColor || "rgba(247,75,103,0.9)";
    const color = isUp ? upColor : downColor;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, highY);
    ctx.lineTo(x, lowY);
    ctx.stroke();

    const top = Math.min(openY, closeY);
    const bodyH = Math.max(Math.abs(closeY - openY), 2);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - candleW / 2, top, candleW, bodyH, 1);
    ctx.fill();
  });

  return {
    minP,
    maxP,
    toY,
    toX: (idx) => pad.l + idx * xStep + xStep / 2,
    pad
  };
}

// ── Scenario path preview ──────────────────────────────────
function drawScenarioPath(symbol) {
  const canvas = el.scenarioPathChart;
  if (!canvas) return;
  const path = MARKET_SCENARIOS[symbol] || [];
  const { ctx, width, height } = setupCanvas(canvas);

  if (path.length === 0) {
    ctx.fillStyle = "rgba(106,140,176,0.5)";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("No scenario data.", 16, 32);
    return;
  }

  const candles = pathToCandles(path);
  const scales = drawCandles(ctx, candles, width, height, {
    upColor: "rgba(38,209,200,0.9)",
    downColor: "rgba(247,168,37,0.9)"
  });
  if (!scales) return;

  // Date labels
  ctx.fillStyle = "rgba(106,140,176,0.7)";
  ctx.font = "10px Inter, sans-serif";
  ctx.textAlign = "center";
  [0, Math.floor(path.length / 2), path.length - 1].forEach(i => {
    if (path[i]) ctx.fillText(path[i].date, scales.toX(i), height - scales.pad.b + 14);
  });
  const last = candles[candles.length - 1];
  ctx.fillStyle = "rgba(184,212,242,0.8)";
  ctx.font = "11px Inter, sans-serif";
  ctx.fillText(`${symbol} K-line preview`, scales.pad.l, 13);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(0,196,140,0.85)";
  ctx.fillText(`Last $${last.close.toFixed(2)}`, width - scales.pad.r, 13);
  ctx.textAlign = "start";
}

function updateScenarioPreview(symbol) {
  el.scenarioOutput.textContent = JSON.stringify(MARKET_SCENARIOS[symbol], null, 2);
  drawScenarioPath(symbol);
}

// ── Policy queue table ─────────────────────────────────────
function renderQueue() {
  el.queueCountPill.textContent = `${policies.length} queued`;
  el.policiesQueueBody.innerHTML = "";
  if (policies.length === 0) {
    el.policiesQueueBody.innerHTML = `<tr><td colspan="9" class="table-empty">Add a policy above.</td></tr>`;
    drawQueueCompositionChart();
    return;
  }
  policies.forEach((p, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${i + 1}</strong></td>
      <td><code style="color:#26d1c8">${p.symbol}</code></td>
      <td>${p.direction === "down" ? "⬇️ Down" : "⬆️ Up"}</td>
      <td>${p.triggerBps / 100}%</td>
      <td>$${p.notional}</td>
      <td>$${p.deductible}</td>
      <td>$${p.payoutCap}</td>
      <td>${p.durationSteps} days</td>
      <td>${p.startIndex}</td>
    `;
    el.policiesQueueBody.appendChild(tr);
  });
  drawQueueCompositionChart();
}

function drawQueueCompositionChart() {
  const canvas = el.queueCompositionChart;
  if (!canvas) return;
  const { ctx, width, height } = setupCanvas(canvas);
  if (policies.length === 0) {
    ctx.fillStyle = "rgba(106,140,176,0.55)";
    ctx.font = "13px Inter, sans-serif";
    ctx.fillText("No queued policies yet.", 16, 26);
    return;
  }

  const bySymbol = {};
  let downside = 0;
  let upside = 0;
  for (const policy of policies) {
    bySymbol[policy.symbol] = (bySymbol[policy.symbol] || 0) + 1;
    if (policy.direction === "down") downside += 1;
    else upside += 1;
  }
  const entries = Object.entries(bySymbol);
  const maxCount = Math.max(...entries.map(([, count]) => count), 1);
  const pad = { l: 40, r: 20, t: 24, b: 28 };
  const drawW = width - pad.l - pad.r;
  const drawH = height - pad.t - pad.b;
  const barW = Math.max(Math.floor(drawW / entries.length) - 16, 18);

  entries.forEach(([symbol, count], index) => {
    const x = pad.l + index * (drawW / entries.length) + 8;
    const h = Math.max((count / maxCount) * drawH, 2);
    const y = height - pad.b - h;
    ctx.fillStyle = "rgba(0,82,255,0.82)";
    ctx.beginPath();
    ctx.roundRect(x, y, barW, h, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(184,212,242,0.85)";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(symbol, x + barW / 2, height - 10);
    ctx.fillText(String(count), x + barW / 2, y - 6);
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(184,212,242,0.85)";
  ctx.font = "12px Inter, sans-serif";
  ctx.fillText(`Downside: ${downside}  |  Upside: ${upside}`, pad.l, 14);
}

// ── Pricing engine (mirrors contracts) ────────────────────
function estimateProbabilityBps(annualVolBps, durationHours, triggerBps, directionalRiskBps, riskScoreBps) {
  const timeScaledVolBps = Math.floor((annualVolBps * durationHours) / YEAR_HOURS);
  const difficulty = triggerBps + 250;
  const raw = Math.floor(((timeScaledVolBps + directionalRiskBps + Math.floor(riskScoreBps / 10) + 300) * BPS) / difficulty);
  return Math.max(300, Math.min(9000, raw));
}

function utilizationSurchargeBps(utilizationBps = 3500) {
  if (utilizationBps <= 7000) return Math.floor(utilizationBps / 20);
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
  const inventoryPressureBps = input.direction === "down" ? market.downsideInventoryPressureBps : market.upsideInventoryPressureBps;
  const termBps = termMultiplierBps(durationHours, market);
  const probabilityBps = estimateProbabilityBps(market.annualVolBps, durationHours, input.triggerBps, directionalRiskBps, market.riskScoreBps);
  const adjustedAnnualVolBps = Math.floor((market.annualVolBps * termBps) / BPS);
  const moveMagnitudeBps = input.triggerBps + Math.floor((adjustedAnnualVolBps * durationHours) / YEAR_HOURS);
  const stressPremiumBps = market.stressPremiumBps + Math.floor(market.riskScoreBps / 20);
  const totalRateBps =
    market.basePremiumBps + directionalRiskBps + inventoryPressureBps + stressPremiumBps +
    utilizationSurchargeBps() + Math.floor(probabilityBps / 12) +
    Math.floor(moveMagnitudeBps / 8) + Math.floor((input.payoutCap * 1000) / input.notional);

  return {
    premium: Math.floor((input.notional * totalRateBps) / BPS),
    entryPrice, strikePrice,
    estimatedProbabilityBps: probabilityBps,
    termStructureMultiplierBps: termBps,
    directionalRiskBps, inventoryPressureBps, stressPremiumBps,
    riskScoreBps: market.riskScoreBps
  };
}

// ── Simulation charts ──────────────────────────────────────
function drawSimPriceChart(results, symbol) {
  const canvas = el.simPriceChart;
  if (!canvas) return;
  const path = MARKET_SCENARIOS[symbol] || [];
  const { ctx, width, height } = setupCanvas(canvas);
  if (path.length === 0) return;

  const candles = pathToCandles(path);
  const scales = drawCandles(ctx, candles, width, height, {
    upColor: "rgba(0,196,140,0.88)",
    downColor: "rgba(247,75,103,0.88)"
  });
  if (!scales) return;

  // Strike lines and trigger markers for each policy
  const colors = ["#f74b67", "#f7a825", "#26d1c8", "#00c48c", "#9b59b6"];
  results.forEach((r, i) => {
    const color = colors[i % colors.length];
    const strikeSy = scales.toY(r.strikePrice);

    // Dashed strike line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(scales.pad.l, strikeSy);
    ctx.lineTo(width - scales.pad.r, strikeSy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Entry dot
    const entryI = policies[i]?.startIndex || 0;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(scales.toX(entryI), scales.toY(r.entryPrice), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Trigger label
    ctx.fillStyle = color;
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`P${i + 1} strike $${r.strikePrice.toFixed(0)}`, width - scales.pad.r - 4, strikeSy - 3);
    ctx.textAlign = "start";

    // Triggered indicator
    if (r.triggered) {
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      const exitI = (policies[i]?.startIndex || 0) + (policies[i]?.durationSteps || 1);
      const safeExit = Math.min(exitI, path.length - 1);
      ctx.beginPath();
      ctx.arc(scales.toX(safeExit), scales.toY(r.exitPrice), 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
}

function drawSimPayoutChart(results) {
  const canvas = el.simPayoutChart;
  if (!canvas || results.length === 0) return;
  const { ctx, width, height } = setupCanvas(canvas);

  const barW = Math.floor((width - 60) / results.length / 2 - 6);
  const maxVal = Math.max(...results.map(r => Math.max(r.premium, r.payout)), 1);

  results.forEach((r, i) => {
    const x = 30 + i * ((width - 60) / results.length);
    const premH = Math.max(((r.premium / maxVal) * (height - 56)), 2);
    const payH  = Math.max(((r.payout / maxVal)  * (height - 56)), r.payout > 0 ? 2 : 0);

    // Premium bar
    ctx.fillStyle = "#0052ff";
    ctx.beginPath();
    ctx.roundRect(x, height - PAD.b - premH, barW, premH, 4);
    ctx.fill();

    // Payout bar
    ctx.fillStyle = r.triggered ? "#f74b67" : "rgba(106,140,176,0.3)";
    ctx.beginPath();
    ctx.roundRect(x + barW + 4, height - PAD.b - payH, barW, Math.max(payH, 3), 4);
    ctx.fill();

    // Labels
    ctx.fillStyle = "#9bb4d8";
    ctx.font = "10px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`P${i + 1}`, x + barW, height - PAD.b + 14);
    if (r.triggered) {
      ctx.fillStyle = "#f74b67";
      ctx.fillText("💥", x + barW * 1.5 + 4, height - PAD.b - payH - 6);
    }
  });

  ctx.textAlign = "start";

  // Legend
  ctx.fillStyle = "#0052ff";
  ctx.fillRect(PAD.l, 6, 10, 10);
  ctx.fillStyle = "#9bb4d8";
  ctx.font = "11px Inter, sans-serif";
  ctx.fillText("Premium", PAD.l + 14, 15);

  ctx.fillStyle = "#f74b67";
  ctx.fillRect(PAD.l + 90, 6, 10, 10);
  ctx.fillStyle = "#9bb4d8";
  ctx.fillText("Payout", PAD.l + 104, 15);
}

// ── Run simulation ─────────────────────────────────────────
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
    if (policy.direction === "down" && exitPoint.price < quote.strikePrice)
      rawPayout = (policy.notional * (quote.strikePrice - exitPoint.price)) / quote.entryPrice;
    if (policy.direction === "up" && exitPoint.price > quote.strikePrice)
      rawPayout = (policy.notional * (exitPoint.price - quote.strikePrice)) / quote.entryPrice;

    let payout = 0;
    if (rawPayout > policy.deductible)
      payout = Math.min(rawPayout - policy.deductible, policy.payoutCap);

    totalPremium += quote.premium;
    totalPayout  += payout;
    results.push({
      symbol:                     policy.symbol,
      direction:                  policy.direction,
      triggerPct:                 `${policy.triggerBps / 100}%`,
      entryDate:                  path[policy.startIndex]?.date,
      exitDate:                   exitPoint.date,
      entryPrice:                 quote.entryPrice,
      exitPrice:                  exitPoint.price,
      strikePrice:                quote.strikePrice,
      premium:                    quote.premium,
      payout,
      triggered:                  payout > 0,
      protocolRevenue:            quote.premium - payout,
      estimatedProbabilityBps:    quote.estimatedProbabilityBps,
      termStructureMultiplierBps: quote.termStructureMultiplierBps,
      directionalRiskBps:         quote.directionalRiskBps,
      inventoryPressureBps:       quote.inventoryPressureBps,
      stressPremiumBps:           quote.stressPremiumBps,
      riskScoreBps:               quote.riskScoreBps
    });
  }

  const summary = {
    policyCount:      results.length,
    triggeredCount:   results.filter(r => r.triggered).length,
    totalPremium,
    totalPayout,
    protocolRevenue:  totalPremium - totalPayout
  };

  // Show result section
  el.simResultCard.style.display = "block";
  el.simResultCard.scrollIntoView({ behavior: "smooth", block: "start" });

  // Status pill
  const trigRate = Math.round((summary.triggeredCount / summary.policyCount) * 100);
  el.simStatusPill.textContent = `${summary.triggeredCount}/${summary.policyCount} triggered (${trigRate}%)`;
  el.simStatusPill.style.background = summary.triggeredCount > 0
    ? "rgba(247,75,103,0.16)" : "rgba(0,196,140,0.16)";
  el.simStatusPill.style.borderColor = summary.triggeredCount > 0
    ? "rgba(247,75,103,0.35)" : "rgba(0,196,140,0.35)";
  el.simStatusPill.style.color = summary.triggeredCount > 0 ? "#f74b67" : "#00c48c";

  // KPI boxes
  el.simKpiRow.innerHTML = `
    <div class="stat-box${summary.protocolRevenue >= 0 ? " positive" : " negative"}">
      <div class="stat-label">Pool P&amp;L</div>
      <div class="stat-value">$${summary.protocolRevenue.toFixed(0)}</div>
      <div class="stat-sub">premium − payout</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Premiums Earned</div>
      <div class="stat-value accent" style="color:var(--teal)">$${totalPremium.toFixed(0)}</div>
    </div>
    <div class="stat-box${summary.triggeredCount > 0 ? " negative" : ""}">
      <div class="stat-label">Claims Paid</div>
      <div class="stat-value">$${totalPayout.toFixed(0)}</div>
      <div class="stat-sub">${summary.triggeredCount} of ${summary.policyCount} triggered</div>
    </div>
    <div class="stat-box">
      <div class="stat-label">Trigger Rate</div>
      <div class="stat-value">${trigRate}%</div>
      <div class="stat-sub">policies activated</div>
    </div>
  `;

  // Results table
  el.simResultsBody.innerHTML = "";
  results.forEach((r, i) => {
    const pnl = r.premium - r.payout;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${i + 1}</strong></td>
      <td><code style="color:#26d1c8">${r.symbol}</code></td>
      <td>${r.direction === "down" ? "⬇️ Down" : "⬆️ Up"} ${r.triggerPct}</td>
      <td style="font-size:12px">${r.entryDate}<br><span style="color:var(--muted)">$${r.entryPrice.toFixed(2)}</span></td>
      <td style="font-size:12px">${r.exitDate}<br><span style="color:var(--muted)">$${r.exitPrice.toFixed(2)}</span></td>
      <td style="font-family:'JetBrains Mono',monospace">$${r.strikePrice.toFixed(2)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:var(--teal)">$${r.premium.toFixed(0)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:${r.payout > 0 ? "var(--danger)" : "var(--muted)"}">$${r.payout.toFixed(0)}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:${pnl >= 0 ? "var(--success)" : "var(--danger)"}">${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)}</td>
      <td>${r.triggered ? "💥 Yes" : "✓ No"}</td>
    `;
    el.simResultsBody.appendChild(tr);
  });

  // Charts
  const firstSymbol = policies[0]?.symbol || "MOCK";
  drawSimPriceChart(results, firstSymbol);
  drawSimPayoutChart(results);

  // JSON dump
  el.simulationOutput.textContent = JSON.stringify({ policies: results, summary }, null, 2);
}

// ── Queue management ───────────────────────────────────────
function addPolicy() {
  const symbol = el.simSymbol.value;
  const policy = {
    symbol,
    direction:     el.simDirection.value,
    triggerBps:    Number(el.simTrigger.value),
    notional:      Number(el.simNotional.value),
    deductible:    Number(el.simDeductible.value),
    payoutCap:     Number(el.simPayoutCap.value),
    durationSteps: Number(el.simDuration.value),
    startIndex:    Number(el.simStartIndex.value)
  };
  policies.push(policy);
  renderQueue();
  updateScenarioPreview(symbol);
}

function clearPolicies() {
  policies.length = 0;
  renderQueue();
  el.simResultCard.style.display = "none";
}

// ── MOCK preset ────────────────────────────────────────────
function loadMockPresentationPack() {
  policies.length = 0;
  policies.push(
    { symbol: "MOCK", direction: "down", triggerBps: 1500, notional: 1500, deductible: 25, payoutCap: 800, durationSteps: 20, startIndex: 0 },
    { symbol: "MOCK", direction: "up",   triggerBps: 1000, notional: 1200, deductible: 10, payoutCap: 500, durationSteps: 12, startIndex: 3 }
  );
  el.simSymbol.value     = "MOCK";
  el.simDirection.value  = "down";
  el.simTrigger.value    = "1500";
  el.simNotional.value   = "1500";
  el.simDeductible.value = "25";
  el.simPayoutCap.value  = "800";
  el.simDuration.value   = "20";
  el.simStartIndex.value = "0";
  renderQueue();
  updateScenarioPreview("MOCK");
}

// ── MOCK timeline animation ────────────────────────────────
async function playMockTimeline() {
  const path = MARKET_SCENARIOS.MOCK;
  if (!path) { el.mockPlaybackOutput.textContent = "MOCK scenario unavailable."; return; }

  el.timelinePill.textContent = "Playing…";
  el.timelinePill.style.color = "#26d1c8";
  const canvas = el.mockTimelineChart;
  const lines = [];

  for (let idx = 0; idx < path.length; idx++) {
    const candle = path[idx];
    lines.push(`step ${String(idx + 1).padStart(2)} | ${candle.date} | $${String(candle.price).padStart(8)}`);
    el.mockPlaybackOutput.textContent = lines.join("\n");

    // Draw progress on timeline chart
    if (canvas) {
      const { ctx, width, height } = setupCanvas(canvas);
      const fullCandles = pathToCandles(path);
      const subCandles = fullCandles.slice(0, idx + 1);
      const scales = drawCandles(ctx, fullCandles.map((c, i) => {
        if (i <= idx) return c;
        return { ...c, open: c.open, close: c.open, high: c.open, low: c.open };
      }), width, height, {
        upColor: "rgba(38,209,200,0.85)",
        downColor: "rgba(247,75,103,0.7)"
      });
      if (!scales) continue;

      // Cursor
      const cx = scales.toX(idx);
      const cy = scales.toY(candle.price);
      ctx.fillStyle = "#26d1c8";
      ctx.shadowColor = "#26d1c8";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Price label
      ctx.fillStyle = "#e8f2ff";
      ctx.font = "bold 11px JetBrains Mono, monospace";
      ctx.textAlign = "center";
      ctx.fillText(`$${candle.price}`, cx, Math.max(cy - 10, PAD.t + 10));
      ctx.fillStyle = "rgba(184,212,242,0.85)";
      ctx.font = "11px Inter, sans-serif";
      ctx.fillText(`${idx + 1}/${subCandles.length}`, cx, Math.min(height - 8, cy + 16));
      ctx.textAlign = "start";
    }

    await new Promise(resolve => setTimeout(resolve, 120));
  }

  el.timelinePill.textContent = "Done ✓";
  el.timelinePill.style.color = "#00c48c";
  el.mockPlaybackOutput.textContent += "\n\n✅ MOCK month replay complete.";
}

// ── Events ─────────────────────────────────────────────────
el.simSymbol.addEventListener("change",            () => updateScenarioPreview(el.simSymbol.value));
el.addPolicyButton.addEventListener("click",       addPolicy);
el.runSimulationButton.addEventListener("click",   runScenario);
el.clearPoliciesButton.addEventListener("click",   clearPolicies);
el.loadMockPackButton.addEventListener("click",    loadMockPresentationPack);
el.playMockTimelineButton.addEventListener("click", playMockTimeline);

// ── Init ───────────────────────────────────────────────────
updateScenarioPreview(el.simSymbol.value);
renderQueue();
