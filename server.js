const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────── DATA ─────────── */
const STOCKS = {
  AAPL: {
    name: 'Apple Inc.', fullName: 'AAPL · Apple Inc.', base: 211.5, vol: 0.018,
    models: {
      rf:   { acc: 92.4, rmse: 3.21, r2: 0.941 },
      lr:   { acc: 84.1, rmse: 6.87, r2: 0.863 },
      svm:  { acc: 88.7, rmse: 5.12, r2: 0.901 },
      lstm: { acc: 90.1, rmse: 4.44, r2: 0.918 }
    },
    rsi: 58.4, ma20: 207.8, ma50: 198.4, ma200: 183.2,
    macd: [0.42,0.61,0.38,-0.12,-0.28,0.15,0.52,0.71,0.44,0.22,-0.08,0.35],
    dayChg: +1.24
  },
  TSLA: {
    name: 'Tesla Inc.', fullName: 'TSLA · Tesla Inc.', base: 248.3, vol: 0.038,
    models: {
      rf:   { acc: 89.2, rmse: 8.14, r2: 0.907 },
      lr:   { acc: 79.6, rmse: 14.2, r2: 0.831 },
      svm:  { acc: 85.3, rmse: 10.8, r2: 0.874 },
      lstm: { acc: 87.8, rmse: 9.55, r2: 0.891 }
    },
    rsi: 44.7, ma20: 255.1, ma50: 263.7, ma200: 228.4,
    macd: [-0.82,-1.1,-0.64,0.28,0.74,-0.31,-0.88,-1.2,-0.55,0.18,0.62,-0.44],
    dayChg: -3.87
  },
  GOOGL: {
    name: 'Alphabet Inc.', fullName: 'GOOGL · Alphabet Inc.', base: 171.4, vol: 0.021,
    models: {
      rf:   { acc: 91.8, rmse: 2.87, r2: 0.935 },
      lr:   { acc: 85.3, rmse: 5.41, r2: 0.878 },
      svm:  { acc: 89.0, rmse: 4.22, r2: 0.909 },
      lstm: { acc: 90.7, rmse: 3.65, r2: 0.924 }
    },
    rsi: 62.1, ma20: 168.9, ma50: 162.3, ma200: 149.8,
    macd: [0.28,0.44,0.19,-0.08,0.52,0.67,0.33,-0.15,0.41,0.58,0.24,-0.06],
    dayChg: +0.92
  }
};

/* ─────────── HELPERS ─────────── */
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function genPrices(ticker, days) {
  const st = STOCKS[ticker], r = seeded(ticker.charCodeAt(0) * days + 7);
  let p = st.base; const prices = [], dates = [], vols = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    p = Math.max(p + (r() - 0.5) * 2 * st.vol * p, 1);
    prices.push(+p.toFixed(2));
    dates.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    vols.push(Math.round((r() * 0.6 + 0.7) * 80e6));
  }
  return { prices, dates, vols };
}

function genMA(prices, n) {
  return prices.map((_, i) => {
    if (i < n - 1) return null;
    const s = prices.slice(i - n + 1, i + 1);
    return +(s.reduce((a, b) => a + b, 0) / n).toFixed(2);
  });
}

function genForecast(ticker, base) {
  const st = STOCKS[ticker], r = seeded(ticker.charCodeAt(0) + 99);
  const bias = st.rsi > 60 ? 0.003 : st.rsi < 40 ? -0.003 : 0.001;
  let p = base; const rows = [];
  const now = new Date();
  let dayCount = 0;
  for (let i = 1; dayCount < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    p = +(p + (r() - 0.48 + bias) * st.vol * p).toFixed(2);
    const delta = +(p - base).toFixed(2);
    const pct = +((delta / base) * 100).toFixed(2);
    const conf = +(97 - dayCount * 2.5).toFixed(1);
    const sig = pct > 0.8 ? 'Buy' : pct < -0.8 ? 'Sell' : 'Hold';
    rows.push({
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      price: p, delta, pct, conf, sig
    });
    dayCount++;
  }
  return rows;
}

/* ─────────── API ENDPOINTS ─────────── */

app.get('/api/stocks', (req, res) => {
  res.json(STOCKS);
});

app.get('/api/stocks/:ticker', (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const days = parseInt(req.query.days) || 30;

  if (!STOCKS[ticker]) {
    return res.status(404).json({ error: 'Stock not found' });
  }

  const { prices, dates, vols } = genPrices(ticker, days);
  const ma20 = genMA(prices, 20);
  const ma50 = genMA(prices, Math.min(50, prices.length));
  
  // Need to get exactly 30 days of prices for the metrics/current price calculation just like in the frontend
  const { prices: prices30 } = genPrices(ticker, 30);
  const currentPrice = prices30[prices30.length - 1];

  // We need to use `prices[prices.length - 1]` to generate forecast correctly based on requested days?
  // Wait, in frontend `genForecast(ticker, cur)` where cur is the latest price from 30 days.
  // Actually, the frontend uses the last price of whatever days was queried, BUT wait:
  // In `updateMetrics`:
  //   const { prices } = genPrices(ticker, 30);
  //   const cur = prices[prices.length - 1];
  // So current price is ALWAYS based on 30-day generation (since seeded rand depends on `days`).
  // In `renderPriceChart`:
  //   const { prices, dates } = genPrices(ticker, days);
  //   const last = prices[prices.length - 1];
  //   const fcast = genForecast(ticker, last);
  // So for consistency, the backend will return all the data the frontend needs.

  const fcast = genForecast(ticker, currentPrice);

  res.json({
    ticker,
    data: STOCKS[ticker],
    chartData: { prices, dates, vols, ma20, ma50 },
    currentPrice,
    forecast: fcast
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
