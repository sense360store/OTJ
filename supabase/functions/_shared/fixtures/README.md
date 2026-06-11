# Parser test fixtures

Real England Football Learning pages, fetched unmodified and committed so
the parser is pinned against the live markup.

The two overview pages pin the overview parser against the markup that
broke it: the week links say "first week of the programme here" (ordinal
before the word week) and the page ends in a "Related sessions" rail of
twenty unrelated session cards whose text ("festival week 03", "games
week 09") the old whole-document scan misread as week numbers.

The two session pages pin the session parser. The goalkeeping basics
page carries no diagrams, setup strip or coaching points, only the FA
large video player (data-video-type and data-video-id), so the import
reads its player.vimeo.com embed and makes a video drill rather than an
empty template. The marking page is an ordinary diagram session that also
carries the video player, proving a normal session is not mistaken for a
video one.

| File | Source | Fetched |
|---|---|---|
| `overview-2025-marking-and-intercepting-to-defend.html` | https://learn.englandfootball.com/sessions/resources/2025/Session-programme-marking-and-intercepting-to-defend | 2026-06-11 |
| `overview-2024-press-tackle-and-cover.html` | https://learn.englandfootball.com/sessions/resources/2024/Session-programme-press-tackle-and-cover | 2026-06-11 |
| `session-2022-goalkeeping-the-basics.html` | https://learn.englandfootball.com/sessions/resources/2022/Goalkeeping-session-the-basics | 2026-06-11 |
| `session-2025-marking-defend-as-friends.html` | https://learn.englandfootball.com/sessions/resources/2025/Marking-and-intercepting-session-defend-as-friends | 2026-06-11 |

Content is England Football Learning's, held here solely as test input
for the club's import parser under the club's FA affiliation (see
CLAUDE.md, Third-party content). The underscore folder is not deployed;
these files ship nowhere.
