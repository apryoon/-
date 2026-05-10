export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sheetId = process.env.GOOGLE_SHEET_ID;
    
    if (!sheetId) {
      return res.status(500).json({ error: 'Google Sheet ID not configured' });
    }

    // Google Sheets CSV export URL
    const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sheet: ${response.status}`);
    }

    const csvText = await response.text();
    
    return res.status(200).send(csvText);

  } catch (error) {
    console.error('Sheets fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
}
