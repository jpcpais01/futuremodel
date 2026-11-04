// Everything tunable lives here: the universe, the council roster, budget presets, model prices and portfolio limits.
'use strict';

/* ── Universe ────────────────────────────────────────────────────────────────
   Every name here is read by an analyst on every session. Nothing is cut by code.
   [ticker, name, sector, kind]  kind: S = stock, E = ETF / fund */
const UNIVERSE = [
  // Technology: platforms and software
  ['AAPL', 'Apple', 'Technology', 'S'], ['MSFT', 'Microsoft', 'Technology', 'S'], ['ORCL', 'Oracle', 'Technology', 'S'],
  ['CRM', 'Salesforce', 'Technology', 'S'], ['ADBE', 'Adobe', 'Technology', 'S'], ['NOW', 'ServiceNow', 'Technology', 'S'],
  ['INTU', 'Intuit', 'Technology', 'S'], ['PLTR', 'Palantir', 'Technology', 'S'], ['IBM', 'IBM', 'Technology', 'S'],
  ['CRWD', 'CrowdStrike', 'Technology', 'S'], ['PANW', 'Palo Alto Networks', 'Technology', 'S'], ['NET', 'Cloudflare', 'Technology', 'S'],
  ['SNOW', 'Snowflake', 'Technology', 'S'], ['DDOG', 'Datadog', 'Technology', 'S'], ['SHOP', 'Shopify', 'Technology', 'S'],
  ['DELL', 'Dell', 'Technology', 'S'], ['ANET', 'Arista Networks', 'Technology', 'S'], ['CSCO', 'Cisco', 'Technology', 'S'],
  ['APP', 'AppLovin', 'Technology', 'S'], ['NBIS', 'Nebius', 'Technology', 'S'], ['CRWV', 'CoreWeave', 'Technology', 'S'],
  // Semiconductors and hardware
  ['NVDA', 'Nvidia', 'Semiconductors', 'S'], ['AVGO', 'Broadcom', 'Semiconductors', 'S'], ['AMD', 'AMD', 'Semiconductors', 'S'],
  ['TSM', 'TSMC', 'Semiconductors', 'S'], ['ASML', 'ASML', 'Semiconductors', 'S'], ['MU', 'Micron', 'Semiconductors', 'S'],
  ['QCOM', 'Qualcomm', 'Semiconductors', 'S'], ['INTC', 'Intel', 'Semiconductors', 'S'], ['AMAT', 'Applied Materials', 'Semiconductors', 'S'],
  ['LRCX', 'Lam Research', 'Semiconductors', 'S'], ['KLAC', 'KLA', 'Semiconductors', 'S'], ['MRVL', 'Marvell', 'Semiconductors', 'S'],
  ['ARM', 'Arm Holdings', 'Semiconductors', 'S'], ['TXN', 'Texas Instruments', 'Semiconductors', 'S'], ['SNDK', 'Sandisk', 'Semiconductors', 'S'],
  ['WDC', 'Western Digital', 'Semiconductors', 'S'], ['STX', 'Seagate', 'Semiconductors', 'S'], ['SMCI', 'Super Micro', 'Semiconductors', 'S'],
  ['COHR', 'Coherent', 'Semiconductors', 'S'], ['GLW', 'Corning', 'Semiconductors', 'S'],
  // Communication and internet
  ['GOOGL', 'Alphabet', 'Communication', 'S'], ['META', 'Meta Platforms', 'Communication', 'S'], ['NFLX', 'Netflix', 'Communication', 'S'],
  ['TMUS', 'T-Mobile US', 'Communication', 'S'], ['DIS', 'Disney', 'Communication', 'S'], ['RDDT', 'Reddit', 'Communication', 'S'],
  ['SPOT', 'Spotify', 'Communication', 'S'], ['TTWO', 'Take-Two', 'Communication', 'S'],
  // Consumer
  ['AMZN', 'Amazon', 'Consumer', 'S'], ['TSLA', 'Tesla', 'Consumer', 'S'], ['COST', 'Costco', 'Consumer', 'S'],
  ['WMT', 'Walmart', 'Consumer', 'S'], ['HD', 'Home Depot', 'Consumer', 'S'], ['MCD', "McDonald's", 'Consumer', 'S'],
  ['NKE', 'Nike', 'Consumer', 'S'], ['SBUX', 'Starbucks', 'Consumer', 'S'], ['BKNG', 'Booking Holdings', 'Consumer', 'S'],
  ['UBER', 'Uber', 'Consumer', 'S'], ['ABNB', 'Airbnb', 'Consumer', 'S'], ['MELI', 'MercadoLibre', 'Consumer', 'S'],
  ['EBAY', 'eBay', 'Consumer', 'S'], ['PG', 'Procter & Gamble', 'Consumer', 'S'], ['KO', 'Coca-Cola', 'Consumer', 'S'],
  ['PEP', 'PepsiCo', 'Consumer', 'S'], ['DKNG', 'DraftKings', 'Consumer', 'S'], ['BABA', 'Alibaba', 'Consumer', 'S'],
  // Financials
  ['JPM', 'JPMorgan Chase', 'Financials', 'S'], ['BAC', 'Bank of America', 'Financials', 'S'], ['GS', 'Goldman Sachs', 'Financials', 'S'],
  ['MS', 'Morgan Stanley', 'Financials', 'S'], ['V', 'Visa', 'Financials', 'S'], ['MA', 'Mastercard', 'Financials', 'S'],
  ['AXP', 'American Express', 'Financials', 'S'], ['BRK-B', 'Berkshire Hathaway', 'Financials', 'S'], ['BX', 'Blackstone', 'Financials', 'S'],
  ['ICE', 'Intercontinental Exchange', 'Financials', 'S'], ['CME', 'CME Group', 'Financials', 'S'], ['SCHW', 'Charles Schwab', 'Financials', 'S'],
  ['HOOD', 'Robinhood', 'Financials', 'S'], ['COIN', 'Coinbase', 'Financials', 'S'], ['SOFI', 'SoFi Technologies', 'Financials', 'S'],
  ['PYPL', 'PayPal', 'Financials', 'S'], ['MSTR', 'Strategy', 'Financials', 'S'],
  // Health care
  ['LLY', 'Eli Lilly', 'Health Care', 'S'], ['UNH', 'UnitedHealth', 'Health Care', 'S'], ['JNJ', 'Johnson & Johnson', 'Health Care', 'S'],
  ['ABBV', 'AbbVie', 'Health Care', 'S'], ['MRK', 'Merck', 'Health Care', 'S'], ['NVO', 'Novo Nordisk', 'Health Care', 'S'],
  ['ISRG', 'Intuitive Surgical', 'Health Care', 'S'], ['TMO', 'Thermo Fisher', 'Health Care', 'S'], ['VRTX', 'Vertex Pharmaceuticals', 'Health Care', 'S'],
  ['AMGN', 'Amgen', 'Health Care', 'S'], ['HIMS', 'Hims & Hers', 'Health Care', 'S'], ['MRNA', 'Moderna', 'Health Care', 'S'],
  // Industrials and defense
  ['GE', 'GE Aerospace', 'Industrials', 'S'], ['GEV', 'GE Vernova', 'Industrials', 'S'], ['CAT', 'Caterpillar', 'Industrials', 'S'],
  ['RTX', 'RTX', 'Industrials', 'S'], ['LMT', 'Lockheed Martin', 'Industrials', 'S'], ['BA', 'Boeing', 'Industrials', 'S'],
  ['HON', 'Honeywell', 'Industrials', 'S'], ['DE', 'Deere', 'Industrials', 'S'], ['UNP', 'Union Pacific', 'Industrials', 'S'],
  ['ETN', 'Eaton', 'Industrials', 'S'], ['VRT', 'Vertiv', 'Industrials', 'S'], ['RKLB', 'Rocket Lab', 'Industrials', 'S'],
  ['BE', 'Bloom Energy', 'Industrials', 'S'],
  // Energy, utilities, materials
  ['XOM', 'Exxon Mobil', 'Energy', 'S'], ['CVX', 'Chevron', 'Energy', 'S'], ['COP', 'ConocoPhillips', 'Energy', 'S'],
  ['OXY', 'Occidental', 'Energy', 'S'], ['VST', 'Vistra', 'Utilities', 'S'], ['CEG', 'Constellation Energy', 'Utilities', 'S'],
  ['NEE', 'NextEra Energy', 'Utilities', 'S'], ['FCX', 'Freeport-McMoRan', 'Materials', 'S'], ['NEM', 'Newmont', 'Materials', 'S'],
  ['LIN', 'Linde', 'Materials', 'S'], ['IREN', 'IREN', 'Technology', 'S'],
  // Real estate
  ['PLD', 'Prologis', 'Real Estate', 'S'], ['EQIX', 'Equinix', 'Real Estate', 'S'], ['AMT', 'American Tower', 'Real Estate', 'S'],
  // Broad, sector and thematic ETFs, hedges and real assets
  ['SPY', 'S&P 500 ETF', 'Broad market', 'E'], ['QQQ', 'Nasdaq-100 ETF', 'Broad market', 'E'], ['IWM', 'Russell 2000 ETF', 'Broad market', 'E'],
  ['RSP', 'S&P 500 Equal Weight ETF', 'Broad market', 'E'], ['SMH', 'Semiconductor ETF', 'Semiconductors', 'E'], ['XLE', 'Energy Select ETF', 'Energy', 'E'],
  ['XLF', 'Financial Select ETF', 'Financials', 'E'], ['XLV', 'Health Care Select ETF', 'Health Care', 'E'], ['XLU', 'Utilities Select ETF', 'Utilities', 'E'],
  ['XLP', 'Consumer Staples Select ETF', 'Consumer', 'E'], ['XLI', 'Industrial Select ETF', 'Industrials', 'E'], ['XBI', 'Biotech ETF', 'Health Care', 'E'],
  ['IGV', 'Software ETF', 'Technology', 'E'], ['ITA', 'Aerospace & Defense ETF', 'Industrials', 'E'], ['URA', 'Uranium ETF', 'Energy', 'E'],
  ['GDX', 'Gold Miners ETF', 'Materials', 'E'], ['TLT', '20+ Year Treasury ETF', 'Bonds', 'E'], ['IEF', '7-10 Year Treasury ETF', 'Bonds', 'E'],
  ['SHY', '1-3 Year Treasury ETF', 'Bonds', 'E'], ['HYG', 'High Yield Bond ETF', 'Bonds', 'E'], ['GLD', 'Gold', 'Commodities', 'E'],
  ['SLV', 'Silver', 'Commodities', 'E'], ['CPER', 'Copper', 'Commodities', 'E'], ['USO', 'Crude Oil', 'Commodities', 'E'],
  ['IBIT', 'Bitcoin ETF', 'Crypto', 'E'], ['EWJ', 'Japan ETF', 'International', 'E'], ['EWT', 'Taiwan ETF', 'International', 'E'],
  ['EWY', 'South Korea ETF', 'International', 'E'], ['EWZ', 'Brazil ETF', 'International', 'E'], ['FXI', 'China Large-Cap ETF', 'International', 'E'],
  ['INDA', 'India ETF', 'International', 'E'], ['VGK', 'Europe ETF', 'International', 'E'],
];

/* Market context: read for the macro brief, not offered as holdings. */
const CONTEXT = [
  ['^VIX', 'VIX'], ['^VIX3M', 'VIX 3-month'], ['^TNX', '10-year yield'], ['^IRX', '13-week T-bill'], ['DX-Y.NYB', 'US dollar index'],
  ['CL=F', 'WTI crude'], ['GC=F', 'Gold futures'], ['HG=F', 'Copper futures'], ['BTC-USD', 'Bitcoin'], ['^GSPC', 'S&P 500'], ['^NDX', 'Nasdaq-100'],
];

/* FRED series, free, no key (fredgraph.csv). */
const FRED = [
  ['DFF', 'Fed funds effective rate', '%'], ['DGS2', '2-year Treasury', '%'], ['DGS10', '10-year Treasury', '%'],
  ['T10Y2Y', '10y minus 2y', 'pp'], ['T10YIE', '10-year breakeven inflation', '%'], ['DFII10', '10-year real yield', '%'],
  ['BAMLH0A0HYM2', 'High-yield credit spread', 'pp'], ['BAMLC0A0CM', 'Investment-grade credit spread', 'pp'],
  ['NFCI', 'Chicago Fed financial conditions', 'index'], ['ICSA', 'Initial jobless claims', 'k'], ['UNRATE', 'Unemployment rate', '%'],
  ['CPIAUCSL', 'CPI (index)', 'index'], ['PCEPILFE', 'Core PCE (index)', 'index'], ['INDPRO', 'Industrial production', 'index'],
  ['UMCSENT', 'Consumer sentiment', 'index'], ['WALCL', 'Fed balance sheet', '$M'], ['RRPONTSYD', 'Reverse repo', '$B'], ['M2SL', 'M2 money supply', '$B'],
];

/* Free RSS feeds for the macro and market news brief. */
const MACRO_FEEDS = [
  ['Federal Reserve', 'https://www.federalreserve.gov/feeds/press_all.xml'],
  ['Fed speeches', 'https://www.federalreserve.gov/feeds/speeches.xml'],
  ['CNBC Top News', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'],
  ['CNBC Finance', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664'],
  ['CNBC Economy', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258'],
  ['Google News: markets', 'https://news.google.com/rss/search?q=stock+market+when:3d&hl=en-US&gl=US&ceid=US:en'],
  ['Google News: Fed and rates', 'https://news.google.com/rss/search?q=%22Federal+Reserve%22+OR+inflation+OR+Treasury+yields+when:7d&hl=en-US&gl=US&ceid=US:en'],
];

/* ── Council roster ──────────────────────────────────────────────────────────
   Each seat has a real mandate, not just a tone. Colours drive the chamber visual. */
const SEATS = {
  atlas:    { name: 'Atlas',    role: 'Macro strategist',     color: '#5b8cff', glyph: 'globe',
    mandate: 'You own the top-down view: growth, inflation, the Fed and liquidity, rates, the dollar, credit and the business cycle. Decide how much risk the portfolio should carry and which sectors the regime favours. You may hold cash, bonds, gold or defensives when the regime says so.' },
  nova:     { name: 'Nova',     role: 'Growth hunter',        color: '#b06cff', glyph: 'spark',
    mandate: 'You hunt for compounding growth: revenue acceleration, expanding margins, durable secular demand and pricing power. You accept a premium valuation when growth earns it, but you must name the evidence that growth is accelerating, not just high.' },
  anchor:   { name: 'Anchor',   role: 'Value and quality',    color: '#2fd6a8', glyph: 'anchor',
    mandate: 'You protect against overpaying. You favour cash generation, balance-sheet strength, returns on capital and a margin of safety. Point out where the price already assumes perfection, and find quality that is mispriced.' },
  pulse:    { name: 'Pulse',    role: 'Momentum and quant',   color: '#ffb547', glyph: 'pulse',
    mandate: 'You read price and positioning: trend, relative strength across horizons, volatility, drawdowns and breadth. Momentum is one of the most robust effects in markets, so respect it, but flag exhaustion and crowding. Ground every claim in the numbers you were given.' },
  raven:    { name: 'Raven',    role: 'Contrarian',           color: '#ff6b81', glyph: 'eye',
    mandate: 'You look where the crowd is not. Find hated or neglected assets whose news is improving faster than their price, and crowded favourites whose story is already fully priced. Disagreeing for its own sake is useless; bring a specific catalyst or a specific mispricing.' },
  forge:    { name: 'Forge',    role: 'Tech and AI specialist', color: '#33c3ff', glyph: 'chip',
    mandate: 'You are the specialist on semiconductors, AI infrastructure, cloud and software. Judge supply chains, capex cycles, pricing (memory, GPUs), competitive position and who actually captures the AI spend.' },
  harbor:   { name: 'Harbor',   role: 'Defensives and real assets', color: '#8fd16a', glyph: 'shield',
    mandate: 'You cover what holds up when growth stumbles: health care, staples, utilities, energy, gold, Treasuries and other real assets. Argue for the hedges and diversifiers the portfolio needs, and say what they cost in expected return.' },
  scout:    { name: 'Scout',    role: 'Events and catalysts', color: '#ff9f5a', glyph: 'flag',
    mandate: 'You track what happens next: earnings dates, guidance changes, product launches, regulation, M&A, index changes and policy events. Favour names with a near-term catalyst that the market underestimates, and warn about event risk.' },
};
/* Seats that do not propose portfolios. */
const OFFICERS = {
  vex:      { name: 'Vex',      role: 'Red team',             color: '#ff4d6d', glyph: 'blade' },
  sentinel: { name: 'Sentinel', role: 'Risk manager',         color: '#e6e8ef', glyph: 'gauge' },
  arbiter:  { name: 'Arbiter',  role: 'Chair',                color: '#ffd76a', glyph: 'crown' },
};

/* ── Models and prices (USD per million tokens) ─────────────────────────────── */
const MODELS = {
  'claude-opus-5-5':   { label: 'Opus 5.5',   in: 4,   out: 20,  cacheWrite: 5,    cacheRead: 0.20 },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', in: 2,   out: 10,  cacheWrite: 2.5,  cacheRead: 0.20 },
  'claude-haiku-5-5':  { label: 'Haiku 5.5',  in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  // Fallback models the API may route a declined request to. Priced so the meter stays honest.
  'claude-opus-4-8':   { label: 'Opus 4.8',   in: 5,   out: 25,  cacheWrite: 6.25, cacheRead: 0.50 },
  'claude-opus-5':     { label: 'Opus 5',     in: 5,   out: 25,  cacheWrite: 6.25, cacheRead: 0.25 },
};
const WEB_SEARCH_PER_CALL = 0.01;

/* ── Budget levels ───────────────────────────────────────────────────────────
   Every level runs the same meeting: the research desk, the scout's web research, all eight seats, every debate
   round, the red team, rebuttals, the risk manager and the chair. A level only chooses the models and how hard
   they think. How many debate rounds to hold is a separate choice (ROUNDS). */
const ALL_SEATS = ['atlas', 'nova', 'anchor', 'pulse', 'raven', 'forge', 'harbor', 'scout'];
const PRESETS = {
  low: {
    label: 'Low', blurb: 'Fast models thinking lightly. Same meeting, lowest cost.',
    analyst: { model: 'claude-haiku-5-5', effort: 'low', batch: 12 },
    member: { model: 'claude-sonnet-5-5', effort: 'low' },
    officer: { model: 'claude-sonnet-5-5', effort: 'low' },
    scout: { model: 'claude-sonnet-5-5', effort: 'low', searches: 6 },
    chair: { model: 'claude-opus-5-5', effort: 'medium' },
  },
  normal: {
    label: 'Normal', blurb: 'Opus on every seat, thinking with care.',
    analyst: { model: 'claude-haiku-5-5', effort: 'medium', batch: 8 },
    member: { model: 'claude-opus-5-5', effort: 'medium' },
    officer: { model: 'claude-opus-5-5', effort: 'medium' },
    scout: { model: 'claude-sonnet-5-5', effort: 'medium', searches: 10 },
    chair: { model: 'claude-opus-5-5', effort: 'high' },
  },
  high: {
    label: 'High', blurb: 'Opus thinking hard everywhere, Sonnet reading every stock, the chair at its deepest.',
    analyst: { model: 'claude-sonnet-5-5', effort: 'medium', batch: 6 },
    member: { model: 'claude-opus-5-5', effort: 'high' },
    officer: { model: 'claude-opus-5-5', effort: 'high' },
    scout: { model: 'claude-sonnet-5-5', effort: 'high', searches: 14 },
    chair: { model: 'claude-opus-5-5', effort: 'xhigh' },
  },
};
for (const p of Object.values(PRESETS)) p.members = ALL_SEATS;

/* ── Debate formats ──────────────────────────────────────────────────────────
   After the opening proposals the council holds 1 to 8 debate rounds (chosen before each meeting, any level).
   Each round has its own format, so the council attacks the problem from a different side every time.
   The last round is always the closing round. calls: model calls per seat in that round. */
const FORMATS = {
  floor:    { label: 'Open floor',        calls: 1, blurb: 'Everyone sees everyone. Challenge the weakest arguments, concede what is right, revise.' },
  cross:    { label: 'Cross-examination', calls: 2, blurb: 'Each seat puts hard questions to another seat, then answers the questions put to it.' },
  devil:    { label: "Devil's advocate",  calls: 1, blurb: 'Each seat attacks its own two largest picks as hard as it can, then keeps or cuts them.' },
  duel:     { label: 'Duels',             calls: 1, blurb: 'Seats are paired with the seat they disagree with most and rebut each other directly.' },
  premortem:{ label: 'Pre-mortem',        calls: 1, blurb: 'Six months on, the portfolio has lost 20%. Each seat explains why, then fixes it.' },
  steelman: { label: 'Steelman',          calls: 1, blurb: 'Each seat makes the strongest case for the view furthest from its own, then takes what is right.' },
  closing:  { label: 'Closing arguments', calls: 1, blurb: 'Final proposals, with the one reason each seat would give the chair.' },
};
const FORMAT_ORDER = ['floor', 'cross', 'devil', 'duel', 'premortem', 'steelman', 'floor'];
const ROUNDS = { min: 1, max: 8, default: 3 };
/* The formats of a meeting with n debate rounds: the last is always the closing round. */
function roundPlan(n) {
  n = Math.max(ROUNDS.min, Math.min(ROUNDS.max, Math.round(+n || ROUNDS.default)));
  return [...Array.from({ length: n - 1 }, (_, i) => FORMAT_ORDER[i % FORMAT_ORDER.length]), 'closing'];
}

/* ── Portfolio rules, enforced by code after the chair decides ───────────────── */
const LIMITS = {
  minPositions: 5, maxPositions: 15,
  maxStock: 15, maxEtf: 25, minWeight: 2,      // percent of the portfolio
  maxSector: 40, maxCash: 40,                  // percent
  costBps: 10,                                 // assumed one-way trading cost, in basis points
  startCapital: 100000,
};

module.exports = { UNIVERSE, CONTEXT, FRED, MACRO_FEEDS, SEATS, OFFICERS, MODELS, WEB_SEARCH_PER_CALL, PRESETS, FORMATS, ROUNDS, roundPlan, LIMITS };
