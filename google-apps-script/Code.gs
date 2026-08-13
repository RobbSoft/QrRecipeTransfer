/**
 * Google Apps Script Web App for importing CSV rows into Google Sheets.
 *
 * Deployment:
 * 1. Create a new Apps Script project bound to your spreadsheet (Extensions > Apps Script)
 * 2. Paste this code and set SHARED_SECRET if desired
 * 3. Deploy > New deployment > Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web App URL into QrSink
 */

const SHARED_SECRET = ''; // Optional: set a shared secret matching QrSink config

/**
 * Handles POST requests from QrSink.
 * @param {GoogleAppsScript.Events.DoPost} e
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && payload.secret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    if (!payload.spreadsheetId || !Array.isArray(payload.rows)) {
      return jsonResponse({ ok: false, error: 'Invalid payload' });
    }

    const sheetName = payload.sheetName || 'Sheet1';
    const spreadsheet = SpreadsheetApp.openById(payload.spreadsheetId);
    const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);

    if (!payload.rows.length) {
      return jsonResponse({ ok: false, error: 'No rows provided' });
    }

    sheet.clearContents();
    sheet.getRange(1, 1, payload.rows.length, payload.rows[0].length).setValues(payload.rows);

    return jsonResponse({
      ok: true,
      rowsWritten: payload.rows.length,
      sheetName: sheet.getName(),
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) });
  }
}

/**
 * Simple health check endpoint.
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function doGet() {
  return jsonResponse({ ok: true, service: 'QrSink Google Sheets Importer' });
}

/**
 * @param {object} body
 * @returns {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
