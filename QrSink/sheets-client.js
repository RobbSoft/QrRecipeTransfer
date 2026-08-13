/**
 * Sends parsed CSV rows to a Google Apps Script Web App endpoint.
 * @param {string} webAppUrl
 * @param {{ spreadsheetId: string, sheetName?: string, secret?: string, rows: string[][] }} payload
 * @returns {Promise<object>}
 */
export async function sendToGoogleSheet(webAppUrl, payload) {
  if (!webAppUrl) {
    throw new Error('Google Apps Script Web-App-URL fehlt.');
  }

  if (!payload.spreadsheetId) {
    throw new Error('Spreadsheet-ID fehlt.');
  }

  const response = await fetch(webAppUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    result = { ok: response.ok, message: responseText };
  }

  if (!response.ok || result.ok === false) {
    throw new Error(result.error || result.message || 'Google Sheet Upload fehlgeschlagen.');
  }

  return result;
}

/**
 * Parses CSV text into a 2D array of cell values (RFC 4180-ish).
 * @param {string} csvText
 * @returns {string[][]}
 */
export function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

/**
 * Triggers a CSV file download in the browser.
 * @param {string} csvText
 * @param {string} fileName
 */
export function downloadCsv(csvText, fileName = 'export.csv') {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
