# Brand files

The Michel's Tools logo. Original artwork by Michel Bado.

| File | Use |
|---|---|
| `icon.svg`, `icon-NNN.png` (16 to 1024) | The mark (three stacked windows with an M). 16 and 32 px for browser tabs, 28 px in the Start button, 192/512 in `site.webmanifest`. |
| `favicon.svg` | Simplified mark for very small sizes. Source file: the page uses `favicon.ico` (7 sizes) instead. |
| `icon-mono.svg` | One-colour mark (for print or dark backgrounds). |
| `logo-light.png/.svg`, `logo-dark.png/.svg` | Mark plus name and tagline, for light and for dark backgrounds. The dark one is also the desktop watermark. |
| `social-preview.png` | 1280x640 picture for GitHub (Settings, Social preview): the card shown when the repository link is shared. Not used by the page. |

The page uses the **PNG** files. The SVG files draw the letters with the fonts Trebuchet MS / Tahoma (not converted to outlines), so
on a device without those fonts they would look different. Convert the text to outlines before using the SVGs on a website.

Next to the page itself (`web/`): `favicon.ico`, `apple-touch-icon.png`, `site.webmanifest`.
