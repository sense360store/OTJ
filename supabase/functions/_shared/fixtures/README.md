# Parser test fixtures

Two real England Football Learning programme overview pages, fetched
unmodified and committed so the overview parser is pinned against the
live markup that broke it: the week links say "first week of the
programme here" (ordinal before the word week) and the page ends in a
"Related sessions" rail of twenty unrelated session cards whose text
("festival week 03", "games week 09") the old whole-document scan
misread as week numbers.

| File | Source | Fetched |
|---|---|---|
| `overview-2025-marking-and-intercepting-to-defend.html` | https://learn.englandfootball.com/sessions/resources/2025/Session-programme-marking-and-intercepting-to-defend | 2026-06-11 |
| `overview-2024-press-tackle-and-cover.html` | https://learn.englandfootball.com/sessions/resources/2024/Session-programme-press-tackle-and-cover | 2026-06-11 |

Content is England Football Learning's, held here solely as test input
for the club's import parser under the club's FA affiliation (see
CLAUDE.md, Third-party content). The underscore folder is not deployed;
these files ship nowhere.
