// Token Launch Radar — the page. No network, no framework: every byte it shows comes from
// ../data.js, which main.ts writes from the same snapshot and the same model as board.json.
// The implied values below are RECOMPUTED here from each row's raw inputs (TVL, peer multiple,
// size, growth and maturity factors) with the model's stated formula, so the page's arithmetic
// and the board's numbers are visibly one and the same. The size and growth factors use the
// slopes the program fitted on the peer set; they are printed in the model panel above.

const R = window.RADAR;
const $ = (id) => document.getElementById(id);

function fmt(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
/** The model's formula, restated: implied = TVL x peer multiple x size x growth x maturity. */
function impliedOf(r) {
  return Math.max(1, Math.round(r.tvl_usd * r.multiple * r.size_mult * r.growth_mult * r.age_mult));
}
function ageLabel(days) {
  if (days === null) return 'unknown';
  if (days < 365) return Math.round(days / 30) + ' mo';
  return (days / 365).toFixed(1) + ' yr';
}

// --- header, stats, model panel -------------------------------------------
$('asOf').textContent = R.as_of;
$('modelVersion').textContent = R.model_version;
$('globalMult').textContent = '×' + R.global_multiple.toFixed(2);
$('setAside').textContent = R.set_aside;
$('fitPeers').textContent = R.fit.peers;
$('sizeSlope').textContent = R.fit.size_slope.toFixed(2);
$('growthBeta').textContent = R.fit.growth_beta.toFixed(3) + ' per +1%';
$('looModel').textContent = '×' + Math.exp(R.fit.loo_model).toFixed(1);
$('looBase').textContent = '×' + Math.exp(R.fit.loo_baseline).toFixed(1);
const totalImplied = R.rows.reduce((s, r) => s + r.implied_value_usd, 0);
$('stats').innerHTML = [
  [R.scanned, 'protocols scanned'],
  [R.pre_token, 'ranked pre-token'],
  [R.watchlist_size, 'on the $50M+ watchlist'],
  [fmt(totalImplied), 'combined implied value'],
].map(([v, k]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');

const maxMult = Math.max(...R.multiples.map((m) => m.multiple));
$('mults').innerHTML = R.multiples.slice(0, 14).map((m) =>
  `<div class="mult"><span class="name">${esc(m.category)}</span><span class="bar"><span class="fill" style="width:${Math.max(3, (m.multiple / maxMult) * 100)}%"></span></span><span class="val">×${m.multiple.toFixed(2)} · ${m.peers} peers</span></div>`
).join('');

// --- filters ----------------------------------------------------------------
const cats = [...new Set(R.rows.map((r) => r.category || 'Uncategorised'))].sort();
$('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
$('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');

function currentRows() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('cat').value;
  const chain = $('chain').value;
  const minTvl = Number($('minTvl').value);
  const watchOnly = $('watchOnly').checked;
  let rows = R.rows.filter((r) =>
    (q === '' || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (cat === '' || (r.category || 'Uncategorised') === cat) &&
    (chain === '' || r.chains.includes(chain)) &&
    r.tvl_usd >= minTvl &&
    (!watchOnly || r.watchlist)
  );
  const sort = $('sort').value;
  const key = {
    rank: (r) => r.rank,
    tvl: (r) => -r.tvl_usd,
    growth: (r) => -(r.change_7d ?? -Infinity),
    age: (r) => -(r.age_days ?? -1),
    signal: (r) => -r.signal,
  }[sort];
  return rows.sort((a, b) => key(a) - key(b) || a.rank - b.rank);
}

function renderBoard() {
  const rows = currentRows();
  $('count').textContent = rows.length + ' protocols';
  $('rows').innerHTML = rows.map((r) => `
    <tr data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : ''}<br><span class="pslug">${esc(r.slug)}</span></td>
      <td>${esc(r.category || '—')}</td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ' +' + (r.chains.length - 3) : ''}</td>
      <td class="num">${fmt(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</td>
      <td class="num">${ageLabel(r.age_days)}</td>
      <td class="num">×${r.multiple.toFixed(2)}</td>
      <td class="num implied">${fmt(impliedOf(r))}</td>
      <td><span class="sig"><span class="bar"><span class="fill" style="width:${r.signal}%"></span></span><span class="n">${r.signal}</span></span></td>
    </tr>`).join('');
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
  }
}

// --- detail view --------------------------------------------------------------
function openDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  const implied = impliedOf(r);
  $('detailView').innerHTML = `
  <section class="panel">
    <div class="detail-head">
      <div>
        <h2>${esc(r.name)}${r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : ''}</h2>
        <span class="pslug">${esc(r.slug)} · rank #${r.rank} of ${R.rows.length} pre-token protocols</span>
      </div>
      <div style="text-align:right">
        <div class="big-implied">${fmt(implied)}<small>IMPLIED LAUNCH VALUE</small></div>
        <button class="back" id="backBtn">← Back to the board</button>
      </div>
    </div>
    <div class="kv">
      <div class="cell"><div class="k">TVL</div><div class="v">${fmt(r.tvl_usd)}</div></div>
      <div class="cell"><div class="k">7-day TVL change</div><div class="v">${r.change_7d === null ? 'not reported' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}</div></div>
      <div class="cell"><div class="k">Running without a token</div><div class="v">${r.age_days === null ? 'unknown' : r.age_days + ' days'}</div></div>
      <div class="cell"><div class="k">Category</div><div class="v">${esc(r.category || 'Uncategorised')}</div></div>
      <div class="cell"><div class="k">Chains</div><div class="v">${esc(r.chains.join(', ') || '—')}</div></div>
      <div class="cell"><div class="k">Signal score</div><div class="v">${r.signal} / 100</div></div>
    </div>
    <h2>Why this value</h2>
    <div class="breakdown">
      base&nbsp;&nbsp;&nbsp;= TVL ${fmt(r.tvl_usd)} × peer multiple ×${r.multiple.toFixed(2)} <span style="color:var(--muted)">(${esc(r.peer_basis)})</span><br>
      size&nbsp;&nbsp;&nbsp;= ×${r.size_mult.toFixed(2)} <span style="color:var(--muted)">(fitted size slope ${R.fit.size_slope.toFixed(2)}: peer ratios shrink as TVL grows, so large TVL is tempered)</span><br>
      growth&nbsp;= ×${r.growth_mult.toFixed(2)} <span style="color:var(--muted)">(7-day TVL ${r.change_7d === null ? 'unreported, scored neutral' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'}, fitted momentum beta ${R.fit.growth_beta.toFixed(3)} per +1%)</span><br>
      maturity = ×${r.age_mult.toFixed(2)} <span style="color:var(--muted)">(${r.age_days === null ? 'age unknown, scored as 1 year' : r.age_days + ' days tracked with no token'})</span><br>
      <span class="res">implied = ${fmt(implied)}</span><br>
      range&nbsp;&nbsp;= ${fmt(r.band_low_usd)} – ${fmt(r.band_high_usd)} <span style="color:var(--muted)">(this category's interquartile peer multiples, 25th–75th percentile, through the same factors)</span>
    </div>
    <h2 style="margin-top:18px">How to farm it</h2>
    <ol class="plan">
      ${r.steps.map((s) => `<li><span class="no"></span><span class="txt">${esc(s.text)}<span class="chips"><span class="chip">Cost: ${esc(s.cost)}</span><span class="chip time">Time: ${esc(s.time)}</span></span></span></li>`).join('')}
    </ol>
  </section>`;
  $('boardView').hidden = true;
  $('stats').hidden = true;
  $('modelPanel').hidden = true;
  $('detailView').hidden = false;
  $('backBtn').addEventListener('click', closeDetail);
  window.scrollTo(0, 0);
}
function closeDetail() {
  $('detailView').hidden = true;
  $('stats').hidden = false;
  $('modelPanel').hidden = false;
  $('boardView').hidden = false;
}

// --- live peers -----------------------------------------------------------------
$('liveRows').innerHTML = R.live.map((p) => `
  <tr>
    <td><span class="pname">${esc(p.name)}</span><br><span class="pslug">${esc(p.slug)}</span></td>
    <td>${esc(p.symbol || '—')}</td>
    <td>${esc(p.category || '—')}</td>
    <td class="num">${fmt(p.tvl_usd)}</td>
    <td class="num">${fmt(p.mcap_usd)}</td>
    <td class="num">×${p.ratio.toFixed(2)}</td>
  </tr>`).join('');

// --- set aside ------------------------------------------------------------------
const ASIDE_SHOWN = 40;
$('asideRows').innerHTML = R.aside.slice(0, ASIDE_SHOWN).map((p) => `
  <tr>
    <td><span class="pname">${esc(p.name)}</span><br><span class="pslug">${esc(p.slug)}</span></td>
    <td>${esc(p.category || '—')}</td>
    <td class="num">${fmt(p.tvl_usd)}</td>
    <td>${esc(p.reason)}</td>
  </tr>`).join('');
$('asideCount').textContent = R.aside.length > ASIDE_SHOWN
  ? `Showing the ${ASIDE_SHOWN} largest of ${R.aside.length} set-aside entries, by TVL.`
  : `${R.aside.length} entries set aside in total.`;

for (const id of ['q', 'cat', 'chain', 'minTvl', 'sort', 'watchOnly']) {
  $(id).addEventListener('input', renderBoard);
  $(id).addEventListener('change', renderBoard);
}
renderBoard();
