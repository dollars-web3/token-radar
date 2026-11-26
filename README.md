# Token Launch Radar

Every protocol that records no token yet, ranked by what its launch could be worth — with a plan to farm each one.

A fitted peer model: each category's implied values start from the median market-cap/TVL ratio of that
category's already-tokened protocols in the sealed DefiLlama snapshot, then apply size, momentum and
maturity factors whose slopes are fitted on the peer set itself — peer ratios shrink as TVL grows, and a
hot week of inflows prices at a discount among peers that already trade, so the model tempers both
instead of extrapolating them. The program grades its own fit by leave-one-out re-pricing of every peer
(median miss ×4.3, against ×5.4 for a plain median-multiple baseline) and every row carries a value
range from its category's interquartile peer multiples. A structural screen first sets aside wrapped,
staked and bridged products of tokens that already trade (and exchange reserve trackers) — listed on the
page with their reasons — so the board ranks only protocols with a launch of their own still to come.
The dashboard is a static page — sortable, filterable, with a detail view and farm plan for every
protocol — that recomputes every value it shows from the same inputs, so the page and board.json are
visibly the same arithmetic.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/dollars-web3/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/dollars-web3/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
