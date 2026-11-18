## Install

1. Download `social-evidence-<version>.zip` below and extract it to a permanent folder.
2. Open `chrome://extensions`, switch on **Developer mode**, choose **Load unpacked** and select the extracted folder.

Step-by-step guide in Hebrew, with screenshots: [docs/guide.he.md](https://github.com/matnael332/Social-evidence/blob/main/docs/guide.he.md)
מדריך התקנה ושימוש בעברית, עם צילומי מסך, נמצא בקישור שלמעלה.

## Verify the download

The `.sha256` file holds the SHA-256 of the ZIP. Both were produced by this repository's release workflow from the tagged commit, after the type check, the tests and the build check passed.

```
sha256sum -c social-evidence-<version>.zip.sha256
```

## Updating

Export your cases first. Then replace the files in the folder the extension is loaded from and press the reload icon on `chrome://extensions`. Removing the extension, or loading it from a different folder, does not carry your saved cases over.
