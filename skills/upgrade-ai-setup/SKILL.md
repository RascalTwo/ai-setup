---
name: upgrade-ai-setup
description: "Proposes new capabilities for the AI setup from what shipped in AI since the last run: changelogs, releases, news, blogs, Hacker News, YouTube. Use for \"upgrade my AI setup\", \"what's new that I should adopt\", or the scheduled Kelpie run."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    google-calendar: the recurring "Upgrade AI setup" event (work account), synced to Kelpie
  requires:
    commands: [gh, curl, jq, yt-dlp, ffmpeg]
---

# Upgrade AI setup

Finds what is new in AI since the last run and proposes what is worth adding to the setup (`~/Desktop/Desktop/Code/ai-setup` plus its overlays: `bun install.ts --list`). This skill is about **new functionality**: a capability the setup lacks, a release that unlocks something, a tool worth adopting. Keeping what already exists healthy is `ai-setup-audit`'s job.

**Propose, don't apply: the user decides.** Proposals go in the chat; nothing in the setup changes during a run.

Runs on any cadence (daily, weekly, ad hoc), because the run log sets the window.

## Run log

`~/.agents/state/upgrade-ai-setup/runs.jsonl`, one JSON object per completed run:

```json
{"at": "2026-11-01T08:00:00-05:00", "window": ["2026-10-25T08:00:00-05:00", "2026-11-01T08:00:00-05:00"], "sources": {"Claude Code": {"status": "read", "items": 3, "cursor": "2.1.317"}, "Two Minute Papers": {"status": "read", "items": 2, "cursor": "CWdTBLsbaQs"}}, "proposals": [{"title": "Adopt X", "url": "https://...", "decision": null}]}
```

- `status`: `read` (every item in the window consumed), `partial: <what was missed>`, or `failed: <reason and fallbacks tried>`.
- `cursor`: the newest item seen (version, video id, URL). For a source whose items carry no dates, the cursor is the window: everything newer than the last cursor is in it.
- `decision`: `"yes"`, `"no"` or `null` (not answered in that session).

A test run (one the user or another session asks for as a test) writes `runs.test-<n>-<date>.jsonl` instead; those files never set the window.

## Steps

1. **Set the window.** Start: `window[1]` of the last line in the run log; with no log, 7 days ago. End: now. Done when both ends are concrete timestamps and each source's last cursor is in hand.
2. **Consume every source** below: every item in the window, read in full, never only its headline. Save large payloads to `~/.agents/state/upgrade-ai-setup/<run date>/` and read slices. Fan out with subagents (one per source group, or per video) so raw pages and transcripts stay out of the main context; each returns, per item, its title, link, date and the concrete things it says shipped or became possible. Done when every source is `read`, or `partial`/`failed` after the global fallbacks (another view of the same data, then the browser, then desktop control) were tried.
3. **Filter to proposals.** Keep an item when it would add something the setup can use. Check the setup before proposing: `settings/claude-code/settings.json`, `AGENTS.md`, `skills/`, `tools/`, `external-skills.json`, and the MCP servers in `~/.claude.json`, so a proposal never suggests what is already there. Drop anything an earlier run already proposed, unless there is new information, which you then name. A past `"no"` stays declined unless the new information changes the case.
4. **Present the proposals in the chat**, ranked by how much each adds for the effort. Each one gets: what it is, its source link, what it would add to the setup and where (skill, rules, MCP server, tool), and rough effort. Mark any claim you could not verify. End with one line per source that had nothing, and every `partial` or `failed` source with what was missed. Zero proposals is a valid result: say so in one line.
5. **Append the run** to the run log (create the directory if missing), once the proposals are presented. If the user answers any proposal in the same session, update that run's `decision` fields.

## Sources

Each source names its best view first. When a view gives no dates, find a dated one for the same data before falling back on the cursor: for a file in a GitHub repo, `gh api 'repos/<o>/<r>/commits?path=<file>&since=<start>'` dates every change to it.

**Changelogs and releases**

- Claude Code: `gh api 'repos/anthropics/claude-code/releases?per_page=100'` (dated, one body per version). Undated fallback: `CHANGELOG.md` in the same repo, versions above the cursor.
- Codex: `gh api 'repos/openai/codex/releases?per_page=30'` (100 times out with 504) (skip `-alpha` tags), plus the product changelog https://learn.chatgpt.com/docs/changelog (4+ MB of HTML: save it and extract the dated entries).
- GitHub changelog, Copilot: https://github.blog/changelog/label/copilot/feed/ (RSS, 10 items a page: add `?paged=2`, `3`, … until entries predate the window; open each entry's link for the full post).
- Ollama: `gh api 'repos/ollama/ollama/releases?per_page=30'`.
- ADR practice: the command in `skills/r2-adr/PROVENANCE.md` (new commits to Vercel's vendored `adr-skill`), plus a search for a published ADR skill or standard better than it. Either one found is a proposal to re-copy or switch `skills/r2-adr/upstream/`.
- Upstream of everything I use: each repo in ai-setup's `external-skills.json` and in each overlay's own `external-skills.json` (overlay paths: `bun install.ts --list`), plus herdrdev/herdr (my fork: RascalTwo/herdr) and cjpais/Handy (my fork: RascalTwo/Handy). Releases, then `commits?since=<start>` for repos that don't tag.

**News and blogs**

- Anthropic news: no feed. The sitemap https://www.anthropic.com/sitemap.xml gives each `/news/` URL a `lastmod`, but bulk reindexes restamp old pages, so `lastmod` only shortlists: date each candidate from its own page and read those in the window.
- OpenAI news: https://openai.com/news/rss.xml (the article pages refuse curl with 403: read them in the browser).
- Simon Willison: https://simonwillison.net/atom/everything/
- Drew Breunig: https://www.dbreunig.com/feed.xml
- AI Hero: https://www.aihero.dev/rss.xml
- AI News (Latent Space, formerly news.smol.ai): https://latent.space/feeds/news.xml
- Hacker News: `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=points>200,created_at_i>=<start epoch>&hitsPerPage=200` (check the epoch with `date -r <epoch>`: it must print the window start), keep the AI stories, and read each linked article and the top of its thread.

**YouTube**: every long video and Short published in the window. The uploads feeds are dated: `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF<id>` (long videos) and `...?playlist_id=UUSH<id>` (Shorts), where `<id>` is the channel id after its `UC`. The feeds sometimes return 404 for a while (they did for every channel on 2026-11-07 and worked the next morning), so save each response and check it is XML, not an HTML error page. On a 404, retry once, then list the same playlist with `yt-dlp --flat-playlist --extractor-args 'youtubetab:approximate_date' --playlist-end 30 --print '%(id)s|%(upload_date)s|%(title)s' 'https://www.youtube.com/playlist?list=UULF<id>'` (and `UUSH<id>`). Those dates are only approximate, to the day, so a video dated on the window's first or last day gets its exact time from `yt-dlp --skip-download --print '%(timestamp)s' <url>`. Avoid `--write-info-json` just for dates: it is ~10 MB per video. A channel listed this way is still `read`; say which view was used. For each video:

1. Title and description from the feed.
2. Transcript: `yt-dlp --skip-download --write-auto-subs --sub-langs en-orig --sub-format vtt <url>`. Ask for `en-orig` alone: adding `en` (or `en.*`) also fetches the machine-translated track, which YouTube answers with HTTP 429, so yt-dlp exits 1 even though `en-orig` arrived (every video on 2026-11-07). Only when no `en-orig` file appears, retry with `--sub-langs en`; with no captions at all, download the audio and use the `transcribe-media` skill.
3. What is on screen: for a Short, and for each segment whose transcript points at something shown that bears on the setup (a coding-tool demo, a UI, code, benchmark charts), download only that segment (`yt-dlp -f 'bv*[height<=480]' --download-sections '*<start>-<end>'`) and use the `read-video-locally` skill. Whole long videos are too slow to read; a segment you skip goes in `partial` with its timestamp.

Channels:

- The AI Search, `UCIgnGlGkVRhd4qNFcEwLL4A`: https://www.youtube.com/@theaisearch
- Two Minute Papers, `UCbfYPyITQ-7l4upoX8nvctg`: https://www.youtube.com/@TwoMinutePapers
- WorldofAI, `UC2WmuBuFq6gL08QYG-JjXKw`: https://www.youtube.com/@intheworldofai
- Discover AI, `UCfOvNb3xj28SNqPQ_JIbumg`: https://www.youtube.com/@code4AI
