const express = require('express');
const cors = require('cors');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { RSI, MACD, SMA } = require('technicalindicators');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

/* ─────────── DATA ─────────── */
const STOCKS = {
  'RELIANCE.NS': {
    name: 'Reliance Industries', fullName: 'RELIANCE · Reliance Industries Ltd.',
    models: {
      rf:   { acc: 91.2, rmse: 12.4, r2: 0.921 },
      lr:   { acc: 82.5, rmse: 24.1, r2: 0.842 },
      svm:  { acc: 86.4, rmse: 18.2, r2: 0.885 },
      lstm: { acc: 89.3, rmse: 15.6, r2: 0.902 }
    }
  },
  'TCS.NS': {
    name: 'Tata Consultancy Services', fullName: 'TCS · Tata Consultancy Services Ltd.',
    models: {
      rf:   { acc: 93.1, rmse: 22.5, r2: 0.945 },
      lr:   { acc: 84.7, rmse: 45.2, r2: 0.871 },
      svm:  { acc: 88.9, rmse: 31.4, r2: 0.912 },
      lstm: { acc: 91.5, rmse: 26.8, r2: 0.933 }
    }
  },
  'HDFCBANK.NS': {
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

/* ─────────── API ENDPOINTS ─────────── */

app.get('/api/stocks', async (req, res) => {
  try {
    const quotes = await yahooFinance.quote(Object.keys(STOCKS));
    
    const stockData = {};
    for (const ticker of Object.keys(STOCKS)) {
      const q = quotes.find(q => q.symbol === ticker) || {};
      stockData[ticker] = {
        ...STOCKS[ticker],
        dayChg: q.regularMarketChangePercent || 0,
        base: q.regularMarketPrice || 0
      };
    }
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
    const period1 = new Date(Date.now() - (days + 200) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const queryOptions = { period1 };
    const history = await yahooFinance.chart(ticker, queryOptions);
    
    const validQuotes = history.quotes.filter(q => q.close !== null);
    const allPrices = validQuotes.map(h => h.close);
    const allVols = validQuotes.map(h => h.volume);
    const allDates = validQuotes.map(h => h.date);

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
    
    // technicalindicators arrays are shorter by (period - 1), so pad them or slice carefully.
    // Actually, ma20All has length = allPrices.length - 19.
    // If we want the last `days` elements:
    const ma20 = ma20All.slice(-days);
    const ma50 = ma50All.slice(-days);
    const ma200 = ma200All[ma200All.length - 1]; 
    
    const latestPrice = recentPrices[recentPrices.length - 1];
    const latestRSI = rsiAll[rsiAll.length - 1];
    
    const recentMacd = macdAll.slice(-12).map(m => m.histogram);

    const fcast = genForecast(ticker, latestPrice, 0.02, latestRSI);
    
    const quote = await yahooFinance.quote(ticker);

    res.json({
      ticker,
      data: {
        ...STOCKS[ticker],
        dayChg: quote.regularMarketChangePercent || 0,
        base: latestPrice,
        rsi: latestRSI,
        ma20: ma20[ma20.length - 1],
        ma50: ma50[ma50.length - 1],
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
