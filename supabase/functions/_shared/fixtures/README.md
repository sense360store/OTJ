# Parser test fixtures

Real England Football Learning pages, fetched unmodified and committed
so the parsers and the page kind detection are pinned against live
markup. The two overviews carry the markup that broke the week parser:
week links saying "first week of the programme here" (ordinal before
the word week) and a "Related sessions" rail of twenty unrelated
session cards whose text ("festival week 03", "games week 09") the old
whole-document scan misread as week numbers. The two session pages pin
the other side of detection: a plain single session, and a two week
session that is titled "sessions" and links its programme overview.

| File | Source | Fetched |
|---|---|---|
| `overview-2025-marking-and-intercepting-to-defend.html` | https://learn.englandfootball.com/sessions/resources/2025/Session-programme-marking-and-intercepting-to-defend | 2026-06-11 |
| `overview-2024-press-tackle-and-cover.html` | https://learn.englandfootball.com/sessions/resources/2024/Session-programme-press-tackle-and-cover | 2026-06-11 |
| `session-2026-receiving-and-finishing-festival-week.html` | https://learn.englandfootball.com/sessions/resources/2026/Receiving-and-finishing-session-festival-week | 2026-06-11 |
| `session-2026-marking-and-intercepting-dynamic-defending.html` | https://learn.englandfootball.com/sessions/resources/2026/Marking-and-intercepting-sessions-dynamic-defending | 2026-06-11 |

Content is England Football Learning's, held here solely as test input
for the club's import parser under the club's FA affiliation (see
CLAUDE.md, Third-party content). The underscore folder is not deployed;
these files ship nowhere.
