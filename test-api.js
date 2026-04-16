const { NseIndia } = require('stock-nse-india');
const nse = new NseIndia();

async function testNse() {
  try {
    const details = await nse.getEquityDetails('RELIANCE');
    console.log('RELIANCE Details:', details.priceInfo);
    
    const hist = await nse.getEquityHistoricalData('RELIANCE');
    console.log('RELIANCE Hist length:', hist.length);
  } catch (err) {
    console.error('NSE Error:', err);
  }
}

testNse();
