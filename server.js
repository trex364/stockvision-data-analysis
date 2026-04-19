const express = require('express');
const cors = require('cors');
const path = require('path');
const { NseIndia } = require('stock-nse-india');
const nse = new NseIndia();
const { RSI, MACD, SMA } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────── DATA ─────────── */
const STOCKS = {
  'RELIANCE': {
    name: 'Reliance Industries', fullName: 'RELIANCE · Reliance Industries Ltd.',
    models: {
      rf:   { acc: 91.2, rmse: 12.4, r2: 0.921 },
      lr:   { acc: 82.5, rmse: 24.1, r2: 0.842 },
      svm:  { acc: 86.4, rmse: 18.2, r2: 0.885 },
      lstm: { acc: 89.3, rmse: 15.6, r2: 0.902 }
    }
  },
  'TCS': {
    name: 'Tata Consultancy Services', fullName: 'TCS · Tata Consultancy Services Ltd.',
    models: {
      rf:   { acc: 93.1, rmse: 22.5, r2: 0.945 },
      lr:   { acc: 84.7, rmse: 45.2, r2: 0.871 },
      svm:  { acc: 88.9, rmse: 31.4, r2: 0.912 },
      lstm: { acc: 91.5, rmse: 26.8, r2: 0.933 }
    }
  },
  'HDFCBANK': {
    name: 'HDFC Bank', fullName: 'HDFCBANK · HDFC Bank Ltd.',
    models: {
      rf:   { acc: 90.5, rmse: 8.2, r2: 0.915 },
      lr:   { acc: 81.2, rmse: 16.5, r2: 0.835 },
      svm:  { acc: 85.8, rmse: 12.1, r2: 0.878 },
      lstm: { acc: 88.6, rmse: 10.4, r2: 0.896 }
    }
  }
};

/* ─────────── HELPERS ─────────── */
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function genForecast(ticker, base, vol, rsi) {
  const r = seeded(ticker.charCodeAt(0) + 99);
  const bias = rsi > 60 ? 0.003 : rsi < 40 ? -0.003 : 0.001;
  let p = base; const rows = [];
  const now = new Date();
  let dayCount = 0;
  for (let i = 1; dayCount < 7; i++) {
    const d = new Date(now); d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    p = +(p + (r() - 0.48 + bias) * vol * p).toFixed(2);
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

function generateMockHistory(ticker, currentPrice, totalDays) {
  const r = seeded(ticker.charCodeAt(0) + 1234);
  const prices = [];
  const vols = [];
  const dates = [];
  let p = currentPrice;
  
  const now = new Date();
  let dayCount = 0;
  for (let i = 0; dayCount < totalDays; i++) {
    const d = new Date(now); 
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    
    const changePct = (r() - 0.5) * 0.04;
    
    if (dayCount === 0) {
      prices.unshift(p);
    } else {
      p = +(p / (1 + changePct)).toFixed(2);
      prices.unshift(p);
    }
    
    vols.unshift(Math.floor((r() * 5000000) + 1000000));
    dates.unshift(d.toISOString());
    dayCount++;
  }
  return { prices, vols, dates };
}

/* ─────────── API ENDPOINTS ─────────── */

app.get('/api/stocks', async (req, res) => {
  try {
    const stockData = {};
    await Promise.all(Object.keys(STOCKS).map(async (ticker) => {
      try {
        const details = await nse.getEquityDetails(ticker);
        const info = details.priceInfo || {};
        stockData[ticker] = {
          ...STOCKS[ticker],
          dayChg: info.pChange || 0,
          base: info.lastPrice || 0
        };
      } catch (err) {
        console.error(`Error fetching ${ticker}:`, err.message);
        stockData[ticker] = {
          ...STOCKS[ticker],
          dayChg: 0,
          base: 0
        };
      }
    }));
    res.json(stockData);
  } catch(e) {
    console.error(e);
    res.status(500).json({error: 'Failed to fetch stock quotes'});
  }
});

app.get('/api/stocks/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const days = parseInt(req.query.days) || 30;

  if (!STOCKS[ticker]) {
    return res.status(404).json({ error: 'Stock not found' });
  }

  try {
    let info = {};
    try {
      const details = await nse.getEquityDetails(ticker);
      info = details.priceInfo || {};
    } catch(err) {
      console.error(`Error fetching details for ${ticker}:`, err.message);
    }
    
    const latestPrice = info.lastPrice || 1000;
    
    const totalHistoryNeeded = days + 200;
    const history = generateMockHistory(ticker, latestPrice, totalHistoryNeeded);
    
    const allPrices = history.prices;
    const allVols = history.vols;
    const allDates = history.dates;

    const ma20All = SMA.calculate({period: 20, values: allPrices});
    const ma50All = SMA.calculate({period: 50, values: allPrices});
    const ma200All = SMA.calculate({period: 200, values: allPrices});
    const rsiAll = RSI.calculate({period: 14, values: allPrices});
    const macdInput = {
      values: allPrices,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false
    };
    const macdAll = MACD.calculate(macdInput);

    const recentPrices = allPrices.slice(-days);
    const recentVols = allVols.slice(-days);
    const recentDates = allDates.slice(-days).map(d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    
    const ma20 = ma20All.slice(-days);
    const ma50 = ma50All.slice(-days);
    const ma200 = ma200All[ma200All.length - 1] || 0; 
    
    const latestRSI = rsiAll[rsiAll.length - 1] || 50;
    
    const recentMacd = macdAll.slice(-12).map(m => m.histogram);

    const fcast = genForecast(ticker, latestPrice, 0.02, latestRSI);

    res.json({
      ticker,
      data: {
        ...STOCKS[ticker],
        dayChg: info.pChange || 0,
        base: latestPrice,
        rsi: latestRSI,
        ma20: ma20[ma20.length - 1] || 0,
        ma50: ma50[ma50.length - 1] || 0,
        ma200: ma200,
        macd: recentMacd
      },
      chartData: { prices: recentPrices, dates: recentDates, vols: recentVols, ma20, ma50 },
      currentPrice: latestPrice,
      forecast: fcast
    });

  } catch(e) {
    console.error(e);
    res.status(500).json({error: 'Failed to fetch historical data'});
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
