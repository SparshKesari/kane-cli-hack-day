# Show HN

Hacker News rewards plain description and punishes marketing language harder than any other channel. The post is a title plus a URL plus a first comment from the author. There is no body text on a link post.

## Rules (from the HN Show HN guidelines)

- Title starts with `Show HN:` and describes what the thing does. No superlatives, no "revolutionary", no exclamation marks, no emoji.
- The thing must be something people can try: a live demo, a repo they can run, or a video if neither exists. A landing page with a waitlist is not a Show HN.
- One submission. Do not resubmit under a different title the same week. Do not ask friends to upvote; HN detects voting rings and buries the post.
- The author must be present to answer for the first few hours.
- Link the project's showcase page on kaneclihack.sh (`https://kaneclihack.sh/ship/<team>`). It carries the demo video, the verified repo and submitted SHA, the team's Kane CLI runs and the deck in one place, so an HN reader can go from "what is it" to "show me the source" without hunting. Put the direct repo URL in the first comment for people who want to skip the page.

## Title

Under 80 characters. Pattern: `Show HN: <Name> – <what it does> (<built in a 6-hour hackathon>)`. HN converts a plain hyphen with spaces to an en dash; type a hyphen.

Good:
- `Show HN: Orbit - a release checklist that runs itself in a real browser before deploy`
- `Show HN: I built a Slack bot that files bugs with a Kane CLI evidence pack attached`

Bad:
- `Show HN: Orbit, the AI-powered future of release management`
- `Show HN: We built something cool at a hackathon`

## First comment (author)

Post it within a minute of submitting. 150 to 300 words. Plain text, short paragraphs. Cover:

1. Why you built it, in one personal sentence.
2. How it works, two or three sentences, name the OpenAI model/API and Kane CLI plainly.
3. What is rough or missing. HN trusts people who list their own bugs.
4. The one thing Kane CLI caught, concretely. HN readers like test stories with specifics.
5. What you want from the thread: feedback on X, whether anyone has solved Y.

Do not include hashtags, handles, or "please upvote". Do not paste the LinkedIn post.

Template:

```
Hi HN, I'm <name>, one of <n> people who built this at Kane CLI Hack Day in SF on <date>.

<Project> <does X>. We built it because <personal reason>. The link is our showcase page; the source is at <repo url> (submitted at <short SHA>).

Under the hood: <OpenAI model/API> does <role>. Kane CLI runs the browser checks: we describe the flow in plain English and it drives Chrome, then seals an evidence pack with screenshots and console logs per step. Our login flow failed <n> times before we found <cause>. The Ship Page lists the runs.

Rough edges: <two or three honest items>.

Would like to hear <specific question>.
```

The showcase page is the submitted URL because it is the public, repo-linked page for the project. If the page is slow or down at posting time, do not submit; HN readers bounce in seconds and the thread dies. If they want, check it first with a Kane run that the Kane CLI skill writes (open the Ship Page, confirm the project title and the GitHub link are visible).

## Timing

Weekday, 8 to 10am US Eastern. Avoid Friday afternoon and weekends. Have two teammates ready to answer for three hours. Reply to critical comments first and without defensiveness.

## If it does not take off

Most Show HNs get under ten upvotes. That is normal. Do not delete and repost. Link the HN thread from the blog so the discussion stays discoverable.
