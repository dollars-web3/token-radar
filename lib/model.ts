// The token radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY protocol in the snapshot that records no token and passes the
// structural screen below — the 40-name watchlist (TVL at or above the floor) is the floor of
// the board, never its ceiling: the radar exists to surface the smaller, earlier names below
// it. Protocols whose token already trades are never ranked; they form the peer set the value
// model is calibrated on, and the dashboard shows them apart, with the market's own values.
//
// Implied value is derived only from the snapshot's own figures, the same function for every row:
//
//   peers      = the protocols in the same category whose token already trades (mcap and TVL known)
//   multiple   = median(mcap / TVL) over those peers, clamped to [0.05, 8]; a category with fewer
//                than PEER_MIN peers falls back to the median over every tokened protocol
//   growthMult = 1 + 0.6 x clamp(change_7d, -50, 100) / 100     (no reported change: 1.0)
//   ageMult    = 0.8 + 0.4 x min(age_days, 1460) / 1460         (age unknown: 365 days)
//   implied    = round(TVL x multiple x growthMult x ageMult), at least 1
//
// No protocol name is ever special-cased: change the snapshot and the board re-derives itself.
// The constants are stated on the dashboard, and the page recomputes every row from the same
// inputs, so what the reader sees is the arithmetic the board.json file carries.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard. */
export const MODEL = {
  peer_min: 3,
  multiple_floor: 0.05,
  multiple_cap: 8,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.8,
  age_range: 0.4,
  age_days_cap: 1460,
  unknown_age_days: 365,
} as const;

/** The model's version label, named on the dashboard. */
export const MODEL_VERSION = 'radar-2 (peer-calibrated)';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked board row: the gate's fields plus everything the detail view shows. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  peer_count: number;
  peer_basis: string;
  growth_mult: number;
  age_mult: number;
  signal: number;
  watchlist: boolean;
  steps: FarmStep[];
}

/** A protocol whose token already trades: a calibration peer, never a board row. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  symbol: string | null;
}

/** Everything the dashboard renders. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  model_version: string;
  scanned: number;
  pre_token: number;
  set_aside: number;
  watchlist_size: number;
  rows: BoardRow[];
  live: LiveRow[];
  multiples: { category: string; multiple: number; peers: number }[];
  global_multiple: number;
}

/** Parse and lightly validate the sealed snapshot text. */
export function parseSnapshot(text: string): Snapshot {
  const snap = JSON.parse(text) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return snap;
}

const DAY_MS = 86_400_000;

/** Whole days from a YYYY-MM-DD listing day to the snapshot's as-of day; null when unknown. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / DAY_MS);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

/** A protocol records no token when the snapshot carries neither a Gecko id nor a symbol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// The structural screen: the same test the snapshot's watchlist applies at the $50M floor,
// applied here at every size. An entry is set aside — never ranked — when it is a wrapped,
// staked or bridged product of a token that already trades, or an exchange's reserve tracker:
// its value already trades under another name, so it has no launch of its own to radar.
// The signals are the house's own: the category, a whole word wrapped/staked/staking in the
// name, a version marker ending the name, or an exchange's name opening it.
const SET_ASIDE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** True when the entry is structurally a product of a token that already trades. */
export function structurallySetAside(p: SnapshotProtocol): boolean {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (/\s(V\d+|v\d+|\d+\.0)$/.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** The peer calibration: a mcap/TVL multiple per category, plus the global fallback. */
export function calibrate(protocols: SnapshotProtocol[]): {
  byCategory: Map<string, { multiple: number; peers: number }>;
  global: { multiple: number; peers: number };
} {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const global = { multiple: clamp(median(all), MODEL.multiple_floor, MODEL.multiple_cap), peers: all.length };
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length >= MODEL.peer_min) {
      byCategory.set(category, { multiple: clamp(median(ratios), MODEL.multiple_floor, MODEL.multiple_cap), peers: ratios.length });
    }
  }
  return { byCategory, global };
}

/** The multiple one protocol is valued with, and where it came from. */
function multipleFor(
  p: SnapshotProtocol,
  calib: ReturnType<typeof calibrate>,
): { multiple: number; peers: number; basis: string } {
  const own = p.category === null ? undefined : calib.byCategory.get(p.category);
  if (own !== undefined) {
    return { multiple: own.multiple, peers: own.peers, basis: `median of ${own.peers} tokened ${p.category} peers` };
  }
  return {
    multiple: calib.global.multiple,
    peers: calib.global.peers,
    basis: `global median of ${calib.global.peers} tokened protocols (too few tokened ${p.category ?? 'uncategorised'} peers to calibrate)`,
  };
}

/** The growth multiplier from the 7-day TVL change; 1.0 when the snapshot reports none. */
export function growthMult(change7d: number | null): number {
  if (change7d === null) return 1;
  return 1 + (MODEL.growth_weight * clamp(change7d, MODEL.growth_floor, MODEL.growth_cap)) / 100;
}

/** The maturity multiplier from the protocol's age; an unknown age scores as one year. */
export function ageMult(age: number | null): number {
  const days = age ?? MODEL.unknown_age_days;
  return MODEL.age_floor + (MODEL.age_range * Math.min(days, MODEL.age_days_cap)) / MODEL.age_days_cap;
}

/** Percentile (0..1) of value within a sorted-ascending copy of the population. */
function percentile(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return sortedAsc.length <= 1 ? 1 : lo / (sortedAsc.length - 1);
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is derived from the protocol's own snapshot figures —
// its category picks the playbook, its first chain names where the work
// happens, and its TVL tier sizes the suggested position. Every step states
// the action, what it costs and how long it takes; nothing is name-specific.
// ---------------------------------------------------------------------------

/** Position sizing by TVL tier: bigger, proven protocols justify a core position. */
function tierOf(tvl: number): { label: string; stake: string } {
  if (tvl >= 250_000_000) return { label: 'core', stake: '$5,000–$25,000' };
  if (tvl >= 25_000_000) return { label: 'standard', stake: '$1,000–$5,000' };
  return { label: 'early test', stake: '$200–$1,000' };
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

type Playbook = (p: SnapshotProtocol) => FarmStep[];

function steps(p: SnapshotProtocol, list: [string, string, string][]): FarmStep[] {
  return list.map(([text, cost, time]) => ({ text, cost, time }));
}

const LENDING: Playbook = (p) => {
  const chain = p.chains[0] ?? 'its main chain';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Open ${p.name} on ${chain} and supply a ${t.stake} ${t.label} position in ETH or a major stablecoin; suppliers are the users a launch rewards first.`, 'Gas $2–$15 on L2s, $15–$60 on mainnet', '15 minutes'],
    [`Borrow against the position at under 50% loan-to-value and re-supply the borrowed asset once, so both sides of the market record your address as active.`, 'One extra borrow/repay cycle of gas, about $3–$20', '10 minutes'],
    [`Keep the position open and rebalance weekly; long, continuous supply history is what snapshot-based distributions usually measure, not one-day spikes.`, 'About $2–$10 a week in gas', '5 minutes a week, for 8+ weeks'],
    [`Repay in full once a month and re-borrow, so the address shows completed loan lifecycles rather than a single parked deposit.`, 'Gas for two transactions, about $2–$12', '10 minutes a month'],
    [`Join the protocol's Discord or forum with the same wallet linked, and vote in any governance polls; off-chain participation lists are cheap to keep and often merged with on-chain ones.`, 'Free', '20 minutes once'],
  ]);
};

const DEXS: Playbook = (p) => {
  const chain = p.chains[0] ?? 'its main chain';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Connect to ${p.name} on ${chain} and make your first swaps totalling at least $500 of volume across two or three pairs, so the address registers as a trader, not a bot probe.`, 'Swap fees plus gas, about $3–$15', '15 minutes'],
    [`Add a ${t.stake} ${t.label} liquidity position to a major pair (ETH/stablecoin) and leave it in range; liquidity providers are the second group most launches reward.`, 'Gas $3–$20 to open', '15 minutes'],
    [`Trade small amounts on at least 8 separate days a month — $50–$200 a swap — because distinct active days are the metric filters most often apply.`, 'About $1–$5 a session in fees and gas', '10 minutes a session'],
    [`Claim and re-stake any fee or incentive rewards the interface offers each week, compounding the position and adding claim transactions to your history.`, 'Gas under $2 a claim on L2s', '5 minutes a week'],
  ]);
};

const BRIDGE: Playbook = (p) => {
  const chain = p.chains[0] ?? 'Ethereum';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Bridge a ${t.stake} ${t.label} amount from ${chain} to a second chain ${p.name} supports, using the protocol's own interface rather than an aggregator, so the transfer is attributed to its contract.`, 'Bridge fee plus gas, about $5–$25', '10–30 minutes including arrival'],
    [`Bridge back a week later instead of the same day; round trips separated in time read as real usage, same-hour loops read as farming and get filtered.`, 'About $5–$25', '10–30 minutes'],
    [`Repeat monthly in both directions and vary the asset (ETH one month, a stablecoin the next) to build a varied, long-lived transfer history.`, 'About $10–$50 a month', '30 minutes a month'],
    [`If the protocol offers a relayer, validator or liquidity role for its bridge pools, take the smallest useful one; infrastructure roles are scarce and usually weighted heavily.`, 'Varies; pool deposits from $500', '1 hour to set up'],
  ]);
};

const STAKING: Playbook = (p) => {
  const chain = p.chains[0] ?? 'Ethereum';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Stake a ${t.stake} ${t.label} position through ${p.name} on ${chain} and hold the liquid staking or restaking receipt token in the same wallet.`, 'Gas $5–$40 depending on chain', '15 minutes'],
    [`Put the receipt token to work in one integrated money market or DEX pool listed on the protocol's own integrations page; composability is what points systems count twice.`, 'Gas $3–$15', '15 minutes'],
    [`Add a small second stake every month rather than one lump sum, so the address shows a growing, recurring staking history.`, 'From $100 a month plus gas', '10 minutes a month'],
    [`Run the position for at least a full quarter before unstaking; duration-weighted rewards punish short stakes, and unstaking early forfeits the season.`, 'Opportunity cost only', '3+ months holding'],
  ]);
};

const YIELD: Playbook = (p) => {
  const chain = p.chains[0] ?? 'its main chain';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Deposit a ${t.stake} ${t.label} position into ${p.name}'s flagship vault on ${chain}; vault depositors are the exact cohort a token launch is built to reward.`, 'Gas $3–$20', '10 minutes'],
    [`Split a second, smaller deposit into a higher-yield vault on another chain the protocol supports, so your address appears in more than one vault's records.`, 'From $200 plus bridge and gas, about $8–$30', '25 minutes'],
    [`Harvest and re-deposit rewards monthly instead of selling them; compounding addresses are easy to distinguish from mercenary ones in the data.`, 'Gas $2–$10 a harvest', '10 minutes a month'],
    [`Stay deposited through any points or season snapshot the team announces, and keep at least half the position for a full quarter.`, 'Opportunity cost only', '3+ months holding'],
  ]);
};

const DERIVATIVES: Playbook = (p) => {
  const chain = p.chains[0] ?? 'its main chain';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Deposit a ${t.stake} ${t.label} margin balance on ${p.name} (${chain}) and open a first small position — $100–$300 of notional — to activate the account.`, 'Gas or deposit fee, about $2–$15', '15 minutes'],
    [`Trade on at least 8 separate days a month with modest size and both directions represented; consistent, two-sided flow is what market-maker-style rewards measure.`, 'Trading fees about 0.05% of volume', '15 minutes a session'],
    [`Provide liquidity to the protocol's house vault or LP pool if it has one, alongside trading; vault depositors share fees and are first in line at most launches.`, 'From $500 in the vault', '10 minutes to deposit'],
    [`Keep total volume growing month over month rather than front-loading it; growth curves survive anti-sybil filters that flat farmed volume does not.`, 'Fees scale with volume', 'Ongoing, 2+ months'],
  ]);
};

const CDP: Playbook = (p) => {
  const chain = p.chains[0] ?? 'Ethereum';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Open a vault on ${p.name} (${chain}) with a ${t.stake} ${t.label} collateral deposit and mint the protocol's stablecoin at a conservative 40–50% of the liquidation threshold.`, 'Gas $10–$50 on mainnet, less on L2s', '20 minutes'],
    [`Put the minted stablecoin to work in the protocol's own stability pool or a listed DEX pair, keeping it inside the ecosystem the launch will measure.`, 'Gas $3–$15', '15 minutes'],
    [`Top up collateral whenever the health factor drifts, and repay and re-mint once a quarter so the vault shows a full, managed lifecycle.`, 'Gas $5–$20 a quarter', '15 minutes a quarter'],
    [`Hold the position through a full quarter; CDP users are few, sticky and historically among the best-rewarded cohorts per dollar deposited.`, 'Interest on the mint, typically 2–6% APR', '3+ months holding'],
  ]);
};

const RWA: Playbook = (p) => {
  const chain = p.chains[0] ?? 'Ethereum';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Complete ${p.name}'s onboarding or allowlist step if it has one — for real-world-asset protocols the verified-user list is usually the distribution list.`, 'Free; identity checks where required', '20–40 minutes'],
    [`Make a ${t.stake} ${t.label} deposit or purchase of the protocol's flagship asset on ${chain} and hold it in the same wallet that onboarded.`, 'Gas $5–$30', '15 minutes'],
    [`Use one protocol feature beyond holding — staking the asset, supplying it as collateral, or voting — so the address counts as a user, not a passer-by.`, 'Gas $3–$15', '15 minutes'],
    [`Hold for at least two quarters; RWA user bases are small, so a persistent mid-size holder is visible in any snapshot the team takes.`, 'Opportunity cost only', '6+ months holding'],
  ]);
};

const CURATOR: Playbook = (p) => {
  const chain = p.chains[0] ?? 'its main chain';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Deposit a ${t.stake} ${t.label} position into one of ${p.name}'s curated vaults on ${chain}; allocator and curator launches reward the depositors whose capital they allocate.`, 'Gas $3–$20', '10 minutes'],
    [`Spread a second deposit across a vault run by a different curator on the same platform, diversifying which curator's records carry your address.`, 'From $250 plus gas', '10 minutes'],
    [`Rebalance only when a vault's strategy changes materially; steady capital is the product curators sell, and it is what their snapshots reward.`, 'Gas $2–$10 when needed', '10 minutes a month'],
    [`Keep the deposits for a full quarter and claim any incentive rewards in-protocol rather than through third-party dashboards.`, 'Opportunity cost only', '3+ months holding'],
  ]);
};

const CHAIN: Playbook = (p) => {
  const chain = p.chains[0] ?? p.name;
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Bridge a ${t.stake} ${t.label} amount onto ${chain} through the chain's canonical bridge and keep it there; bridged-and-held balances are the base layer of every chain launch snapshot.`, 'Bridge fee plus gas, about $5–$25', '15–30 minutes'],
    [`Become a weekly active address: one swap, one contract interaction and one transfer on three separate days each week, using the chain's native apps.`, 'About $1–$5 a week in gas on L2s', '15 minutes a week'],
    [`Deploy or use two of the chain's flagship dapps (its main DEX and lending market) so the address appears across the ecosystem, not in one contract.`, 'Gas $2–$10 to start each', '30 minutes once'],
    [`If the chain runs a public testnet or a validator programme, join with the same wallet; testnet participant lists are routinely merged into mainnet launch allocations.`, 'Free on testnet', '1 hour to set up'],
  ]);
};

const GENERIC: Playbook = (p) => {
  const chain = p.chains[0] ?? 'its main chain';
  const t = tierOf(p.tvl_usd);
  return steps(p, [
    [`Start with ${p.name}'s core product on ${chain}: make a ${t.stake} ${t.label} first deposit, trade or stake — whichever the protocol is built around — from a wallet you control long-term.`, 'Gas $3–$25 depending on chain', '15–20 minutes'],
    [`Return on at least 8 separate days in the first month and repeat the core action in modest size; distinct active days are the filter nearly every launch applies.`, 'About $2–$10 a session', '10 minutes a session'],
    [`Use a second feature of the protocol (a second market, vault, chain or its governance) so the address reads as a genuine user of the whole product.`, 'Gas $2–$15', '20 minutes'],
    [`Hold the position and the usage history for a full quarter, and link the wallet in the protocol's community channels if it runs a points or season programme.`, 'Opportunity cost only', '3+ months holding'],
  ]);
};

const PLAYBOOKS: Record<string, Playbook> = {
  Lending: LENDING,
  'Uncollateralized Lending': LENDING,
  Dexs: DEXS,
  Bridge: BRIDGE,
  'Cross Chain Bridge': BRIDGE,
  'Canonical Bridge': BRIDGE,
  'Liquid Staking': STAKING,
  Restaking: STAKING,
  'Liquid Restaking': STAKING,
  'Staking Pool': STAKING,
  Yield: YIELD,
  'Yield Aggregator': YIELD,
  Farm: YIELD,
  'Leveraged Farming': YIELD,
  Derivatives: DERIVATIVES,
  Options: DERIVATIVES,
  'Interest Rate Derivatives': DERIVATIVES,
  CDP: CDP,
  'CDP Manager': CDP,
  RWA: RWA,
  'Risk Curators': CURATOR,
  'Onchain Capital Allocator': CURATOR,
  Chain: CHAIN,
};

/** The farm plan for one protocol, as structured steps. */
export function farmPlan(p: SnapshotProtocol): FarmStep[] {
  const playbook = (p.category !== null && PLAYBOOKS[p.category]) || GENERIC;
  return playbook(p);
}

/** The board.json form of a step: one string carrying the action, its cost and its time. */
export function stepText(s: FarmStep): string {
  return `${s.text} Cost: ${s.cost}. Time: ${s.time}.`;
}

// ---------------------------------------------------------------------------
// Assembly: score every pre-token protocol, rank by implied value, and set
// the tokened protocols aside as the calibration peers.
// ---------------------------------------------------------------------------

/** Build the whole radar from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const calib = calibrate(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const noToken = snapshot.protocols.filter(recordsNoToken);
  const preToken = noToken.filter((p) => !structurallySetAside(p));

  const tvls = preToken.map((p) => Math.log10(Math.max(1, p.tvl_usd))).sort((a, b) => a - b);
  const growths = preToken.map((p) => p.change_7d ?? 0).sort((a, b) => a - b);
  const ages = preToken.map((p) => ageDays(p.listed_at, snapshot.as_of) ?? MODEL.unknown_age_days).sort((a, b) => a - b);

  const scored = preToken.map((p) => {
    const { multiple, peers, basis } = multipleFor(p, calib);
    const g = growthMult(p.change_7d);
    const age = ageDays(p.listed_at, snapshot.as_of);
    const a = ageMult(age);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * g * a));
    const signal = Math.round(
      100 * (0.5 * percentile(tvls, Math.log10(Math.max(1, p.tvl_usd))) + 0.3 * percentile(growths, p.change_7d ?? 0) + 0.2 * percentile(ages, age ?? MODEL.unknown_age_days)),
    );
    const plan = farmPlan(p);
    const row: BoardRow = {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: plan.map(stepText),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: age,
      multiple,
      peer_count: peers,
      peer_basis: basis,
      growth_mult: g,
      age_mult: a,
      signal,
      watchlist: watch.has(p.slug),
      steps: plan,
    };
    return row;
  });

  // Rank by implied value; ties fall to TVL, then slug, so two runs agree byte for byte.
  scored.sort((x, y) => y.implied_value_usd - x.implied_value_usd || y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1));
  scored.forEach((row, i) => {
    row.rank = i + 1;
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: p.mcap_usd! / p.tvl_usd,
      symbol: p.symbol,
    }))
    .sort((x, y) => y.mcap_usd - x.mcap_usd)
    .slice(0, 24);

  const multiples = [...calib.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, peers: v.peers }))
    .sort((x, y) => y.multiple - x.multiple);

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    scanned: snapshot.protocols.length,
    pre_token: preToken.length,
    set_aside: noToken.length - preToken.length,
    watchlist_size: snapshot.watchlist.length,
    rows: scored,
    live,
    multiples,
    global_multiple: calib.global.multiple,
  };
  return { board: scored, radar };
}

/** The gate's board rules, checked before anything is written; null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const [i, row] of board.entries()) {
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `row ${i + 1}: slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!(row.implied_value_usd >= 1) || row.implied_value_usd > 100_000_000_000_000) return `row ${i + 1}: implied value out of range`;
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3..12`;
    for (const s of row.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20..600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every implied value is the same: the board ranks nothing';
  }
  return null;
}

/** The dashboard's data file: the same rows the board carries, plus the live peer set. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** Compact dollar formatting the dashboard and this file agree on. */
export function fmtMoney(n: number): string {
  return money(n);
}
