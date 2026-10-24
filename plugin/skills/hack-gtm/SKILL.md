---
name: hack-gtm
description: "Launch kit for a Kane CLI Hack Day project built with OpenAI and tested with Kane CLI. From a project brief (idea, how Kane CLI was used, repo, Ship Page, Kane runs) it drafts an X thread and LinkedIn post that tag TestMu AI and OpenAI and read human, a Show HN post, a launch blog, an HTML deck, and an MP4 showcase video with voice-over built from the Kane CLI evidence pack. Use it when a participant or organizer says launch, GTM, announce, write the post, write the blog, make the deck or make the video. For submitting or finalizing, use hack-os."
---

# hack-gtm

Turn a finished hackathon build into a public launch. One input (the project brief), six outputs, each written so it could pass as the builder's own work.

## Inputs

Collect these before writing anything. Ask once, in one message, for whatever is missing. `assets/brief-template.md` is the form; paste it to the user if they have nothing yet.

| Field | Why it matters |
|---|---|
| Project name, one-line pitch, longer description | Everything hangs off the pitch |
| Problem and who has it | Opens the blog and the LinkedIn post |
| What was built with OpenAI (model, API, Codex, Agents SDK, Realtime, etc.) | "Built with OpenAI" claim must be specific and true |
| How Kane CLI was used: commands run, what was asserted, bugs it caught, number of runs, pass/fail history | This is the story. Vague "we tested it" is not usable |
| Repo URL and submitted SHA | Ship Page and HN both need it |
| Ship Page URL (`/ship/<team>`), and the deck URL (`/ship/<team>/deck`) if they published a deck in the site's Studio | The Ship Page goes in X post 1 so people can find the project |
| Path to the `.evidence` pack(s) | Source for the video and the proof screenshots. The pack itself stays private (non-negotiable 8) |
| Team members, their X and LinkedIn handles, who posts | Tagging and authorship |
| Demo URL, screenshots, any recorded screen capture | Optional, improves blog and video |
| Voice notes: how the author actually talks, favourite phrases, things they would never say | Keeps the copy human |

If the brief does not say what Kane CLI caught, ask "what did a Kane run fail on, and what did you change?" That single answer makes every asset better.

## Non-negotiables

1. Tag the right accounts, with the right form per platform (see `references/handles.md`). TestMu AI on X is `@testmuai`; on LinkedIn it is the company page `TestMu AI` (linkedin.com/company/testmu-ai). Kane CLI has no separate account; write "Kane CLI" in text and tag TestMu AI. OpenAI is `@OpenAI` on X and the `OpenAI` company page on LinkedIn.
2. Know what counts. The site's minimum for the shipped prize: the three essentials (repo, live URL or run command, Kane CLI run report) plus any two of video, blog, X post and HN post, all live by 18:00 Pacific on event day, with their links added on the team's Submit tab. Deck and video are never required. The event team asks for the full set, so offer all of it, but never tell anyone a piece is required when the site doesn't require it. The Submit tab's preflight (the `submission_preflight` tool in hack-os) is the authority. Put the Ship Page URL in X post 1, not in a reply.
3. Credit both layers in one breath: "built with OpenAI, tested with Kane CLI". OpenAI's team asked for "association", not "partnership", so never write "in partnership with OpenAI" or imply OpenAI endorsed the project. The event is "Kane CLI Hack Day" (OpenAI is a supporter); never call it "Kane CLI x OpenAI Hack Day".
4. Every claim about what Kane CLI did must trace to a real run: a command, a step, a screenshot in the evidence pack. No invented pass counts. Use the official Kane CLI skill (`kane-cli`) for any Kane command; don't invent flags.
5. Write like a person. Apply `references/humanize.md` to every piece before handing it over. Vary sentence length, use the author's own words from the brief, name specifics, drop filler. Never ship copy with em dashes, "here's the thing", negative parallelism, tricolons, or "delve/leverage/robust/seamless".
6. Media is not spam. One real asset per post, project first and tooling as a one-line credit, no logo walls, no reposting, no tagging people who were not involved. `references/media.md` is the rulebook; run its checklist on every image, video and PDF.
7. The person approves every piece before it goes anywhere public: each post, every teammate variant, the blog, the HN post, the deck and the video (its narration and every line of text on screen). Show the exact content, wait for a yes. Never post for them, by API or by driving a website: hand them the text and files, and they post it themselves.
8. Evidence packs stay private. They hold network and console logs that can include cookies, tokens and test passwords, and the site shows them only to the team, judges and organizers. Never commit a `.evidence` pack, or anything extracted from it, to a public repo; never attach one to a post; never tell readers they can open it. Describe what Kane checked and show screenshots the person has looked at. The scripts redact what they copy, but read every frame's text with the person before rendering.
9. Ask before installing anything or spending money. The video needs Python 3.9+, ffmpeg and Pillow (ffmpeg path) or Node 18+ (Remotion path, whose first render runs `npm install` and downloads a headless Chrome into `launch/remotion`). The voice is macOS `say` (free, local) unless they choose edge-tts (free, sends the narration text to Microsoft) or OpenAI TTS (paid, on their own OpenAI account). On Windows use `python` or `py -3` instead of `python3`, and Git Bash for `render.sh`.

## Workflow

Run in this order. Later steps reuse earlier ones.

### 1. Read and reduce the brief

Produce `launch/brief.md`: a 10-line digest with the pitch, the problem, the OpenAI usage, the three most concrete Kane CLI moments (command, what it checked, what happened), the URLs, and the author's voice notes. Every other asset is written from this digest, which keeps them consistent. Put the `key: value` lines from `assets/brief-template.md` at the top: the video script reads only those, and names any it can't find.

If an evidence pack is provided, run step 1 of 5a first (storyboard extraction) so you have real step names and screenshots to quote in the blog and posts. `<skill>` below is the folder this file is in (usually `~/.agents/skills/hack-gtm`); run the scripts from the project folder so `launch/` lands there.

### 2. Social posts

Read `references/social.md`. Write:

- `launch/x-thread.md`: 4 to 6 posts. Post 1 is the hook plus the Ship Page link (and the deck link if they published one) plus `@testmuai` and `@OpenAI`. Posts 2 to 4 each carry one concrete thing (the problem, the moment Kane CLI failed a run and what changed, the demo). Last post credits the team by handle and links the repo. Under 280 characters each, counted.
- `launch/linkedin.md`: 1,100 to 1,600 characters. Narrative, first person, one paragraph per idea, line breaks between paragraphs, no bullet wall. Mention `TestMu AI` and `OpenAI` as text the author will convert to tags when pasting (LinkedIn tags cannot be pre-encoded in plain text; say so in a note). Three hashtags max at the end: `#KaneCLIHackDay #KaneCLI` plus one domain tag.
- `launch/team-posts.md`: one short variant per teammate so the posts do not look copy-pasted when several people share.

### 3. Hacker News

Read `references/hackernews.md`. Write `launch/hackernews.md` with a `Show HN:` title under 80 characters that says what it does in plain words, a first comment from the author (why they built it, what is rough, what Kane CLI caught, direct questions for the thread), and a note on timing. The submitted URL is the project's showcase page on kaneclihack.sh (`/ship/<team>`); the repo URL goes in the first comment.

### 4. Launch blog

Read `references/blog.md`. Write `launch/blog.md` with these sections, each publishable on its own if the author wants to split them into a series:

1. What we built (problem, pitch, demo link, who it is for)
2. Use cases (three to five, each a short scenario)
3. How we built it (architecture in prose, the OpenAI pieces, decisions and tradeoffs)
4. Where Kane CLI changed the build (the test loop, actual commands, a failed run and the fix, screenshots the person has checked)
5. What is next, how to try it, credits

Target 1,400 to 2,200 words. Include a front-matter block (title, description under 160 chars, tags, canonical URL placeholder, hero image suggestion). Add a one-paragraph TL;DR after the title. Describe the proof in words and checked screenshots; never link or attach the evidence pack, which stays private.

### 5. Deck

Read `references/deck.md`. Build `launch/deck/index.html`: a self-contained HTML deck (keyboard navigation, 16:9, prints to PDF), 8 to 10 slides, following the Hack OS deck guideline: title, problem, what we built, demo (video or screenshots), how it works, the Kane CLI proof slide (one failed run, one passed run, checked screenshots), what we learned, team and links. Few boxes per slide, one idea per slide, large type. This deck is for presenting from a laptop or keeping in the repo, so it must work with no external dependencies. The public deck at `/ship/<team>/deck` is the one the team publishes in the site's Studio (`/studio/<team>/deck`); custom HTML is never shown publicly, so reuse the slide text there.

### 5a. Video with voice-over

Read `references/video.md`. Pipeline:

```bash
# 1. storyboard from the evidence pack (real steps, screenshots, verdict)
python3 <skill>/scripts/evidence_to_storyboard.py <pack.evidence> --brief launch/brief.md --out launch/video/
#    screenshots are left out until the person has looked at each one; after their yes,
#    rerun with --include-screenshots (before editing narration: a rerun rewrites the drafts)

# 2. write narration into launch/video/storyboard.json (one line per scene; the script seeds drafts),
#    then show the person every scene's narration and on-screen text and get a yes.
#    Both renderers refuse a storyboard that still has a TODO: placeholder in it.
# 3. voice-over: macOS say by default; --provider edge or openai only if they chose it
python3 <skill>/scripts/tts.py launch/video/storyboard.json --out launch/video/audio/

# 4a. render with Remotion (preferred)
bash <skill>/scripts/remotion/render.sh launch/video/   # builds in ./launch/remotion

# 4b. or fallback with ffmpeg only
python3 <skill>/scripts/render_ffmpeg.py launch/video/storyboard.json --out launch/video/showcase.mp4
```

Three acts, in this order, and the order is the point:

1. The pitch (35 to 40s): hook, problem, who pays, what it does, demo screens, why it matters. Shark Tank shape. No tooling named yet. A viewer who stops here knows the product.
2. How we built it (8 to 10s): the OpenAI layer, model named, one decision.
3. How effectively we used Kane CLI (25 to 35s): the objective string, the failed run with annotated screenshots and the error, the fix, the passing run, the verdict from `run.yaml`.
4. Close (7s): both URLs and the credits.

60 to 90 seconds. Never trim the pitch act to fit more Kane steps. Deliver `showcase.mp4` (1920x1080) plus a 1080x1920 cut if the user wants Shorts or Reels. The brief fields `hook`, `problem`, `who`, `solution`, `demo`, `why` feed the pitch act; if they are empty, ask for them before rendering, since the pitch cannot be derived from the evidence pack.

### 6. Package and hand over

Write `launch/README.md`: the posting order and timing, who posts what, the approval checklist, and the single list of links. Then show the person each piece verbatim, one at a time, and ask for approval. Do not post. Remind them to add each live link on the team's Submit tab before 18:00 Pacific; hack-os walks the captain through finalizing.

## Posting order (default)

Everything that should count for the prize goes live today, before 18:00 Pacific, and its link goes on the Submit tab. After that they can keep sharing; it just doesn't count.

1. Ship Page live (if they want, check it loads with a Kane run, written with the Kane CLI skill).
2. Blog published (so the posts have somewhere to send people).
3. X thread from the team captain's account.
4. LinkedIn post from the captain; teammates share with their own variant.
5. Show HN, with the author ready to answer comments. (A weekday morning US Eastern gets more readers, but for the prize it has to be live today.)
6. Video uploaded natively to X and LinkedIn (not as a YouTube link).

## Files in this skill

- `references/handles.md` : exact handles, tag syntax per platform, what not to say about OpenAI
- `references/humanize.md` : the anti-AI-tell pass, with before/after examples
- `references/social.md` : X thread and LinkedIn structure, length, hooks that work for dev tools
- `references/hackernews.md` : Show HN rules and first-comment template
- `references/blog.md` : launch blog structure, SEO block, how to write the Kane CLI section from evidence
- `references/deck.md` : slide list and HTML deck conventions
- `references/media.md` : anti-spam rules for every image, video, carousel and PDF, plus distribution behaviour
- `references/video.md` : evidence pack layout, storyboard schema, Remotion and ffmpeg paths, TTS options
- `scripts/evidence_to_storyboard.py` : unzips `.evidence`, reads `run.yaml`, `result.yaml`, `steps/*/step.json`, copies screenshots, drafts narration; redacts what it copies
- `scripts/tts.py` : voice-over from storyboard (macOS `say` by default; edge-tts or OpenAI TTS only when the person picks them)
- `scripts/render_ffmpeg.py` : dependency-light renderer
- `scripts/remotion/` : Remotion project (`render.sh`, `src/Showcase.tsx`) reading the same storyboard
- `assets/brief-template.md` : intake form
- `assets/deck-template.html` : starting point for the HTML deck
