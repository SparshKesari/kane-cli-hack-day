# Social posts: X and LinkedIn

## X thread

Length: 4 to 6 posts. Each under 280 characters including URLs (a URL counts as 23 characters regardless of length). Count before handing over; put the count in a comment after each post.

### Post 1 (the eligibility post)

Must contain: hook sentence, the Ship Page URL, the deck URL, `@testmuai`, `@OpenAI`. Nothing else. Do not start with a mention.

Shape that works for dev tools:

```
We built <Project> at the Kane CLI x OpenAI Hack Day: <what it does in 8 words>.

Built with @OpenAI, tested with Kane CLI from @testmuai. Live proof and deck:
<ship page url>
<deck url>
```

Attach: the 1920x1080 showcase video if ready, else the hero screenshot. Native video gets more reach than a link.

### Post 2: the problem

One concrete scenario the author has lived. Who hits it, what breaks, how often. No stats you cannot source.

### Post 3: the Kane CLI moment

The most valuable post in the thread. Structure: what the test asserted, what failed, what the screenshot showed, what you changed, that it passed. Quote the actual objective string from the `kane-cli run` command in backticks if it fits. Attach the annotated screenshot of the failed step from the evidence pack (`steps/<n>-<id>/annotated.png`).

### Post 4: the build

What OpenAI piece did what. Model name, API surface, one tradeoff. Attach a screenshot of the app or the architecture slide from the deck.

### Post 5 (optional): the demo

A 15 to 30 second clip of the app in use, or three screenshots.

### Last post: credits

Teammate handles, repo link, the hashtag from the brief. If the hack day has a hashtag, it goes here, not in post 1.

### Things that lower reach on X

- Starting with `@` (becomes a reply-style post)
- More than two hashtags
- Links in every post (keep them to post 1 and the last post)
- Posting all six within a minute; space 20 to 40 seconds apart, or schedule as a thread in one go
- Quoting your own earlier post inside the thread

## LinkedIn post

Length: 1,100 to 1,600 characters. The first 210 characters show before "see more", so the hook must stand alone.

Structure:

1. Hook (one or two lines): what you built and the one surprising fact. No "excited to share".
2. Context (two to three lines): the hack day, the time limit, who you built with.
3. The build (three to four lines): the OpenAI piece in plain words.
4. The test loop (four to five lines): what Kane CLI ran, the fail, the fix, the pass. Mention the evidence pack and that the proof is public.
5. What you learned (two lines): one honest take.
6. Links (Ship Page, deck, repo) on their own lines.
7. Credits: teammates by name, TestMu AI and OpenAI named once each in text for tagging.
8. Up to three hashtags.

Formatting: blank line between paragraphs, no bullet lists, no bold, one emoji maximum. Put the links in the post body, not the first comment; LinkedIn no longer penalises in-post links the way it did, and a link in the comment gets lost.

Attach the showcase video natively (under 10 minutes, under 5 GB, MP4) or a carousel PDF export of the deck. A document post (PDF) of the deck performs well on LinkedIn for hackathon projects because people swipe through.

Tagging note to add to the handover: "LinkedIn tags are not carried in plain text. When you paste, type @ before TestMu AI, OpenAI and each teammate and select the page or profile from the dropdown."

## Teammate variants

Write one 500 to 800 character variant per teammate, each from a different angle (what they personally built, what surprised them, what they would do differently). Same links. These must not read as copies of the captain's post.

## Timing

- X: post within the event share window (eligibility). If the window allows, 9 to 11am US Pacific on a weekday for reach.
- LinkedIn: Tuesday to Thursday, 8 to 10am in the author's time zone. Teammates share 2 to 6 hours later, not at the same minute.
- Reply to every comment in the first two hours. Early replies lift distribution on both platforms.
