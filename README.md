# Post Evidence Capture

A Chrome extension for documenting social media posts as evidence, one click per post.

You browse and search yourself. When a post matters, you press a shortcut: the extension takes a screenshot, stamps it with the page address, the time and a running number, and opens a short form for the details. Each case exports as a ZIP with numbered images and a matching table.

> **Status: stage 2 of 5 (MVP).** Visible-area capture, the information strip, the form, one case, and ZIP export with CSV work today. Metadata extraction, multiple cases, XLSX, a hash list, an audit log, full-page capture, the full management screen and a public demo page follow. The plan is in [SPEC.md](SPEC.md). This README grows into the full version in stage 5.

## What it does not do

- It does not browse, scroll through feeds, scrape, or call any platform API. It acts only when you click, and only on the tab in front of you.
- It sends nothing anywhere. There is no server and no analytics. Everything stays in the browser's local database until you export it.

## Try it

Requires Node 20 or newer and Chrome 116 or newer.

```bash
npm install
```

```bash
npm run build
```

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Choose **Load unpacked** and select the `dist` folder.
3. Open any web page and press `Alt+Shift+S`, or click the extension's icon.

The interface is in Hebrew and right-to-left.

## How to document a post

1. **Open the post on its own page first**, by clicking the post's date or time. The tab address is then the post's permalink. That address is printed on the screenshot, so capturing from a feed would record the feed's address instead.
2. Press `Alt+Shift+S` or click the extension's icon. The side panel opens with the screenshot and the form.
3. Correct the details and press **שמור**. The record gets the next running number of the case.
4. Open **ניהול וייצוא** in the panel and press **ייצוא ZIP** to download the case.

Things worth knowing:

- The screenshot shows the page as it is displayed next to the side panel. Chrome only lets an extension open the panel at the moment of the click, so it opens first and the screenshot follows once the page has settled. Keep the panel open while you work and every capture is immediate.
- The strip is added below the screenshot. It never covers the page.
- If you change the post link in the form, the strip gains a second line with that link, marked as entered manually. The first line is always the address the tab really had.
- Record type, group or page name, group admins and keyword keep their last saved values for the next capture. One button clears them.
- A capture you discard does not use up a number.

## The export

```
images/0001.png …   numbered; the number matches the row in the table
records.csv         UTF-8 with a byte order mark, so Excel shows Hebrew correctly
```

The table columns: number, capture time, publication date as shown, publication date (normalized), platform, link, publisher, shared by, group or page, group admins, keyword, record type, notes, file name, SHA-256.

Cells that a spreadsheet would read as a formula are neutralized with a leading apostrophe.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Take a screenshot of the current tab. Chrome grants it only when you click the icon or press the shortcut, and only for that tab. |
| `sidePanel` | Show the form beside the page. A popup would close as soon as you click the page. |
| `unlimitedStorage` | Hundreds of screenshots can exceed the browser's default storage quota. |

There are no host permissions. The extension cannot read any page you have not asked it to capture.

## Privacy and limits

- Captures can contain personal data of other people. Collecting and handling it lawfully is your responsibility. The extension does not redact anything.
- The timestamp comes from your computer's clock. Nobody outside verifies it.
- A SHA-256 shows that a file has not changed since it was hashed. It does not show what the page displayed.
- Removing the extension or clearing the browser profile deletes the stored cases. Export regularly.
- This is not legal advice, and the extension makes no claim about admissibility. If the material is meant for a complaint or a court, ask a lawyer how it must be collected and kept.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run dev
```

`npm run dev` rebuilds `dist` on every change; reload the extension in `chrome://extensions` to pick it up.

The code is split so that the logic worth testing has no browser dependencies: platform detection, numbering, timestamps, CSV, hashing, the strip layout, the record builder and the ZIP writer are pure modules under `src/domain`, `src/platform` and `src/watermark/layout.ts`. The storage layer is tested against an in-memory IndexedDB.

All test data is invented. No real names, pages or screenshots belong in this repository.

## License

[MIT](LICENSE). The bundled font, Noto Sans Hebrew, is licensed under the SIL Open Font License 1.1.
