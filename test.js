const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { RSI, MACD, SMA } = require('technicalindicators');

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

async function testRoute() {
  const ticker = 'RELIANCE.NS';
  const days = 30;

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
    
    const ma20 = ma20All.slice(-days);
    const ma50 = ma50All.slice(-days);
    const ma200 = ma200All[ma200All.length - 1]; 
    
    const latestPrice = recentPrices[recentPrices.length - 1];
    const latestRSI = rsiAll[rsiAll.length - 1];
    
    const recentMacd = macdAll.slice(-12).map(m => m.histogram);

    const fcast = genForecast(ticker, latestPrice, 0.02, latestRSI);
    
    const quote = await yahooFinance.quote(ticker);
    console.log("SUCCESS");
  } catch(e) {
    console.error(e);
  }
}
testRoute();
