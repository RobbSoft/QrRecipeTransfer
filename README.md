# QrRecipeTransfer

Clientseitiges Air-Gap-Transfer-System zur optischen Übertragung großer CSV-Dateien (~50–100 KB) über QR-Codes.

Das System besteht aus zwei statischen Webanwendungen, optimiert für **GitHub Pages** ohne Build-Step:

- **QrSource** — CSV laden, komprimieren, verschlüsseln und als QR-Sequenz abspielen
- **QrSink** — QR-Sequenz scannen, Chunks zusammensetzen, entschlüsseln und in Google Sheets schreiben

## Live Demo

Nach Aktivierung von GitHub Pages:

`https://robbsoft.github.io/QrRecipeTransfer/`

## Projektstruktur

```text
/
├── index.html
├── QrSource/
├── QrSink/
├── shared/
└── google-apps-script/
```

## Lokaler Start

ES-Module benötigen einen HTTP-Server (nicht `file://`):

```bash
npx serve .
# oder
python3 -m http.server 8080
```

Dann öffnen:

- Landingpage: `http://localhost:3000/` (serve) bzw. `http://localhost:8080/`
- QrSource: `/QrSource/`
- QrSink: `/QrSink/`

## Workflow

1. CSV-Datei in **QrSource** laden
2. Passwort setzen und QR-Sequenz starten
3. **QrSink** auf dem Smartphone öffnen, Kamera starten und scannen
4. Nach vollständigem Empfang: Passwort eingeben und Daten exportieren

## Protokoll

Jeder QR-Code enthält einen JSON-Header:

```json
{
  "v": 2,
  "f": "<16-char session id>",
  "s": 1,
  "n": 52,
  "tc": 123456789,
  "c": 987654321,
  "p": "<base64 chunk bytes>"
}
```

Pipeline:

1. CSV → gzip (pako)
2. AES-GCM Verschlüsselung (Web Crypto API, PBKDF2)
3. Chunking (200 Bytes pro Chunk, kompaktes JSON v2)
4. QR-Sequenz mit CRC32-Validierung pro Chunk und gesamt

## Google Sheets Setup

1. Öffne [`google-apps-script/Code.gs`](google-apps-script/Code.gs) in deinem Google Sheet (Extensions → Apps Script)
2. Optional: `SHARED_SECRET` setzen
3. Deploy → New deployment → Web app
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Web-App-URL, Spreadsheet-ID und Sheet-Name in **QrSink** eintragen

### Spreadsheet-ID finden

In der Sheet-URL:

`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`

## Sicherheit

- Die QR-Daten sind passwortgeschützt (AES-GCM)
- Die Google Apps Script Web-App ist öffentlich erreichbar — nutze optional ein Shared Secret
- Für hochsensible Daten zusätzliche Schutzmaßnahmen erwägen

## GitHub Pages Deployment

1. Repository → Settings → Pages
2. Source: **Deploy from branch**
3. Branch: `main` / root (`/`)

Keine Build-Pipeline erforderlich.

## Technologien

- Plain HTML / CSS / JavaScript (ES Modules)
- [pako](https://github.com/nodeca/pako) — gzip compression
- [qrcode](https://github.com/soldair/node-qrcode) — QR generation
- [@zxing/library](https://github.com/zxing-js/library) — QR scanning
- Web Crypto API — AES-GCM + PBKDF2

## Lizenz

MIT — siehe [LICENSE](LICENSE)
