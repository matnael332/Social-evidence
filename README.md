# Social Evidence

A Chrome extension for documenting social media posts as evidence, one click per post.

You browse and search yourself. When a post matters, you press a shortcut: the extension takes a screenshot, stamps it with the page address, the time and a running number, reads what it can about the post from the page, and opens a short form for you to check and complete. Each case exports as a ZIP with numbered images, a matching table, and the hashes to verify them.

> **Status: stage 3 of 5.** Capture, the information strip, page details read automatically, multiple cases, the audit log, the integrity check and the full export work today. Full-page capture, the case dashboard with editing and deletion, and a public demo page follow. The plan is in [SPEC.md](SPEC.md). This README grows into the full version in stage 5.

## What it does not do

- It does not browse, scroll through feeds, scrape, or call any platform API. It acts only when you click, and only on the tab in front of you.
- It sends nothing anywhere. There is no server and no analytics, and the browser itself is told to block every outbound request the extension might make. Everything stays in the browser's local database until you export it.

## Try it

Requires Node 20 or newer and Chrome 116 or newer.

```bash
git clone https://github.com/matnael332/Social-evidence.git
```

```bash
cd Social-evidence
```

```bash
npm ci
```

```bash
npm run build
```

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Choose **Load unpacked** and select the `dist` folder.
3. Open any web page and press `Alt+Shift+S`, or click the extension's icon.

The interface is in Hebrew and right-to-left.

## How to document a post

1. **Open the post on its own page first**, by clicking the post's date or time. The tab address is then the post's permalink. That address is printed on the screenshot, and the details are read from that page, so capturing from a feed would record the feed's address and possibly a neighbouring post. The form warns you when the address does not look like a single post.
2. Press `Alt+Shift+S` or click the extension's icon. The side panel opens with the screenshot and the form.
3. Check the details. Fields marked **מהדף** were read from the page and need your confirmation; correct them where they are wrong.
4. Press **שמור**. The record gets the next running number of the active case.
5. Open **ניהול וייצוא** in the panel, open the case, and press **ייצוא ZIP**.

Things worth knowing:

- The screenshot shows the page as it is displayed next to the side panel. Chrome only lets an extension open the panel at the moment of the click, so it opens first and the screenshot follows once the page has settled. Keep the panel open while you work and every capture is immediate.
- The strip is added below the screenshot. It never covers the page.
- If you change the post link in the form, the strip gains a second line with that link, marked as entered manually. The first line is always the address the tab really had.
- Record type, group admins and keyword keep their last saved values for the next capture, per case. So does the group or page name, unless the page itself supplied one. One button clears them.
- A capture you discard does not use up a number.
- Each case has its own numbering and its own audit log. You choose the active case in the side panel.

### How reliable is the automatic reading?

- **Ordinary websites:** standard metadata (author, site name, publication date). Reliable where the site publishes it.
- **Facebook, TikTok, Instagram:** the address is parsed exactly. Reading names and dates from the page is a best effort, written from the general structure of those pages and tested only on invented markup. It has not been checked against the live sites, and those sites change often. Treat every **מהדף** value as a suggestion.

## The export

```
images/0001.png …   numbered; the number matches the row in the table
records.csv         the table, UTF-8 with a byte order mark so Excel shows Hebrew correctly
records.xlsx        the same table for Excel, right-to-left
deleted.csv         deleted records: number, time of deletion, image hash
audit-log.csv       every action in the case, as a hash chain
README.txt          what the files are, how to verify them, and the limits
hashes.txt          SHA-256 of every other file
```

The table columns: number, capture time, publication date as shown, publication date (normalized), platform, link, publisher, shared by, group or page, group admins, keyword, record type, notes, file name, SHA-256.

To verify an export on Linux, in the extracted folder:

```bash
sha256sum -c hashes.txt
```

On macOS:

```bash
shasum -a 256 -c hashes.txt
```

In `audit-log.csv`, the `entry` column is the exact text that was hashed. Its SHA-256 equals the `hash` column, and the `prevHash` inside it equals the previous row's `hash`. No part of the extension is needed to check it.

The **בדיקת שלמות** button in a case runs the same checks on the stored data: every image against its hash, every record against the log, and the log against itself.

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Take a screenshot of the current tab and read the post's details from it. Chrome grants it only when you click the icon or press the shortcut, and only for that tab. |
| `scripting` | Run the extension's own reader in that tab, after the screenshot. It only reads the page. |
| `sidePanel` | Show the form beside the page. A popup would close as soon as you click the page. |
| `unlimitedStorage` | Hundreds of screenshots can exceed the browser's default storage quota. |

There are no host permissions. The extension cannot read any page you have not asked it to capture, and it cannot do anything in the background.

## Security, privacy and limits

- **Nothing leaves the browser.** The extension's content security policy forbids all outbound requests, and `npm run check:build` fails if the build contains network code, a remote address, or a permission beyond the four above.
- **The data on your computer is not encrypted.** Anyone who can use your account on the computer can read and change the stored cases. Use disk encryption, consider a separate browser profile for this work, and keep exports somewhere else.
- **Install only a build you trust.** A modified copy could act on the page you capture.
- Captures can contain personal data of other people. Collecting and handling it lawfully is your responsibility. The extension does not redact anything.
- The timestamp comes from your computer's clock. Nobody outside verifies it.
- A SHA-256 shows that a file has not changed since it was hashed. It does not show what the page displayed.
- The audit log makes later changes detectable, not impossible. It is worth something only together with a copy of `hashes.txt` kept outside the computer.
- Removing the extension or clearing the browser profile deletes the stored cases. Export regularly.
- This is not legal advice, and the extension makes no claim about admissibility. If the material is meant for a complaint or a court, ask a lawyer how it must be collected and kept.

The threat model is in [SECURITY.md](SECURITY.md).

## Development

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run check:build
```

`npm run dev` rebuilds the pages and the service worker on every change; the page reader (`adapter.js`) is rebuilt by `npm run build`. Reload the extension in `chrome://extensions` to pick up a new build.

The code is split so that the logic worth testing has no browser dependencies: platform detection, numbering, timestamps, CSV, XLSX, hashing, the audit chain, the integrity check, the strip layout, the sanitizer and the URL parsers are pure modules. The storage layer is tested against an in-memory IndexedDB, and the page readers against invented pages.

All test data is invented. No real names, pages or screenshots belong in this repository.

## License

[MIT](LICENSE). The bundled font, Noto Sans Hebrew, is licensed under the SIL Open Font License 1.1.
