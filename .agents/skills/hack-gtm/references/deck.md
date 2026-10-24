# HTML deck

The deck is hosted at `/ship/<team>/deck` and its URL goes into the mandatory X post, so it has to be a single self-contained HTML file: inline CSS, inline JS, images as relative paths in the same folder (or base64 if the host only takes one file). No CDN fonts, no frameworks. Start from `assets/deck-template.html`.

## Slide list (8 to 10)

| # | Slide | Content | Rule |
|---|---|---|---|
| 1 | Title | Project name, one-line pitch, team, "Kane CLI x OpenAI Hack Day, <date>" | One sentence of text beyond the name |
| 2 | Problem | One scene, one sentence, one image or number | No bullet list |
| 3 | What we built | The pitch expanded to three short lines, hero screenshot | Screenshot takes 60% of the slide |
| 4 | Demo | Embedded `showcase.mp4` (muted, loop) or three screenshots | If video, add a poster image for print |
| 5 | How it works | One diagram: user, app, OpenAI layer, Kane CLI loop | Four boxes max, labelled arrows |
| 6 | Built with OpenAI | Model, API surface, what it owns, one tradeoff | Three lines |
| 7 | Tested with Kane CLI | Left: annotated screenshot of the failed step with the error line. Right: the passing run totals from `run.yaml`. Bottom: `kane-cli evidence serve <pack>` | This is the proof slide; every element traces to the pack |
| 8 | What we learned | Three honest lines | No "key takeaways" heading |
| 9 | Team and links | Names, handles, repo, Ship Page, deck URL, QR optional | |
| 10 | (optional) What's next | Three lines | |

## Design rules

- One idea per slide. If a slide needs a second box, it is two slides.
- No stacked rows of bordered boxes. Diagrams use at most four nodes.
- Type: headline 56 to 72px, body 28 to 36px at 1920x1080. If a line of body text wraps twice, cut it.
- Dark background, one accent colour, white text. Keep the TestMu AI and OpenAI wordmarks as text unless the event brand kit says otherwise.
- Presenter flow: each slide's headline should read as the next sentence of the story when you read headlines alone, top to bottom.

## Technical

- Keyboard: left/right arrows, space, and swipe navigate. `?` toggles a help overlay. `p` toggles print mode (all slides stacked, page-break-after each) so Cmd+P produces a PDF for the LinkedIn document post.
- URL hash `#5` opens slide 5.
- `<meta name="viewport">` and a scale transform so it fits phones.
- Open Graph tags: `og:title`, `og:description`, `og:image` (slide 3 screenshot) so the deck URL unfurls on X and LinkedIn.
- Test it with Kane CLI before posting: `kane-cli run "open <deck url>, press the right arrow 8 times, confirm the slide with the team names is visible" --agent`. Mention this run in the blog if you like; it is a small, true story.

## Export

- PDF: print mode then browser print to PDF, 16:9 custom page size.
- Images for the carousel: Playwright screenshot of each slide at 1920x1080 (`scripts/remotion` does not do this; use a 10-line Playwright script if asked).
