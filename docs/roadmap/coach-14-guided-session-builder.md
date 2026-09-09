# COACH-14 — Guided Session Builder & Quick Drill Creation

Status: **In progress** (COACH-14A, the foundation, is built; 14B Quick drill, 14C the review step and 14D the PDF and share actions follow)
Priority: **P1 — priority product work**
Workstream: Coaching workflow / Planning
Added: 9 September 2026

## Outcome

A coach starts from **Plan a session** and can build a complete, usable training session without first understanding where OTJ stores Drills, Drill Maker content, Week Plans, Programmes, Templates or sharing.

The Session Planner becomes the obvious entry point. OTJ brings the relevant content sources into that flow instead of forcing the coach to navigate between separate product areas.

This is a guided path over the existing session model, not a second kind of session and not a replacement for the full planner. Experienced users can still open the advanced/manual planner directly.

## Problem

The current planner exposes a powerful form and activity editor, but the user has to understand OTJ's content structure before OTJ helps them plan:

- drills may need to exist or be imported before they are useful in a session;
- Drill Maker is a separate destination;
- Week Plans / templates and Programmes are separate sources;
- session details and activity composition are presented together without a guided sequence;
- a coach planning ordinary grassroots training can reasonably ask, "What do I press first?";
- sharing exists, but a finished plan also needs to be easy to put into WhatsApp or hand to someone who will not log in.

The product principle is **session-first creation**: a coach commonly creates or adapts a drill because the session being planned needs it now. The interface should reflect that principle.

## Target journey

### 1. Start the session

Ask only for information needed to establish the draft and prefill anything OTJ already knows.

Typical first-step information:

- team(s);
- age group;
- date / time where relevant;
- approximate session length.

Generate a sensible session name by default, while allowing it to be edited.

Also offer clear starting shortcuts without leaving the flow:

- Start from scratch;
- Reuse a recent session;
- Start from a Week Plan;
- Start from a Programme.

Do not make the coach decide which OTJ product area they should navigate to before planning.

### 2. Define the coaching outcome

Ask the coach what they want the players to improve or experience in the session.

Support both simple choices and free text. Examples include passing, receiving, finishing, 1v1 attacking, 1v1 defending, pressing and playing out.

The outcome guides the plan but does not lock the coach into a prescribed coaching methodology.

### 3. Choose the session shape

Offer a small number of understandable structures rather than an empty timeline only.

Examples:

- Simple session;
- Four-station session;
- Five-station session.

The four/five-station choices reuse the existing coaching workflow rules and remain coach-overridable. Suggestions are guidance, not hard constraints.

The screen should show the target total duration and how the suggested structure divides it.

### 4. Build the activities

This is the main composing step and stays visible as one session timeline rather than turning every activity into another wizard page.

For each activity position the coach can:

- choose from Recently Used;
- search the Drill Library;
- use a drill from the selected Week Plan / Programme;
- create a **Quick drill** without leaving the session;
- open the full Drill Maker when a visual needs drawing;
- reorder activities;
- edit duration;
- mark stations / games phase using the existing activity-role model;
- remove or stand down an activity without affecting the reusable source.

### Quick drill

A Quick drill must be fast enough to create while planning the session.

Minimum useful path:

- drill name;
- duration;
- short "how it works" description;
- optional coaching points;
- optional equipment / space;
- optional easier / harder adaptation;
- optional **Draw diagram**.

The coach can save the new drill as reusable. Opening the full Drill Maker must preserve the complete unsaved session draft and return to the same place, building on the COACH-11 authoring seam.

A coach should not be forced to visit the Library first just to make the current session valid.

## 5. Review

Before saving, show the complete session as one coherent plan:

- session title and outcome;
- teams / age group;
- activity order;
- duration per activity;
- total planned minutes;
- drill diagrams where available;
- session structure / station roles;
- useful warnings for obvious gaps or inconsistencies.

Advanced or less-common metadata such as source link, tactics board and similar fields should remain available under a clear **More details** path rather than blocking the basic creation flow.

The coach can edit from the review without losing work or being forced to restart the wizard.

## 6. Save and share

A completed session must offer clear next actions:

- **Save session**;
- **Share link**;
- **Share…** using the platform/native share sheet where available;
- **Download PDF**;
- **Add to calendar**.

The WhatsApp use case is first-class: a coach should be able to share either the link or the PDF with a few taps.

### PDF requirement

The session must be exportable as a real PDF suitable for WhatsApp, email, printing or offline use.

The PDF should be generated from the same safe session projection used for sharing rather than creating a second, broader export contract.

Expected plan content includes, where permitted by the sharing boundary:

- session title / focus;
- total duration;
- ordered activities;
- duration per activity;
- drill descriptions / coaching points where included in the safe projection;
- drill diagrams;
- a QR code or link back to the current shared session.

Do **not** include player names, attendance, bib/group assignments, Spond information or other private operational data in a no-login PDF/share.

Date, time and venue remain subject to the existing public-sharing security boundary. They must not be widened into a public PDF merely for convenience; any widening requires its own explicit security/product decision.

## HCI / interaction requirements

- Use progressive disclosure: ask for the minimum needed now and reveal detail when it becomes relevant.
- Prefer one meaningful decision per wizard step.
- Never ask twice for information OTJ already knows or the coach already entered.
- Back and forward navigation must preserve the draft exactly.
- A coach must always be able to see where they are in the process and how to finish.
- The activity-composition step remains a visual composer rather than splitting interdependent activities across many wizard pages.
- Mobile / touch is a primary path: 44px controls, readable hierarchy, no horizontal dependency and no hover-only actions.
- Errors must retain the draft and provide a clear retry/recovery path.
- The manual/advanced planner remains available; the wizard is an easier path over the same underlying model.

## Reuse existing product seams

Prefer composition over new parallel systems:

- existing Session / Planner model and save semantics;
- COACH-10 shared activity authoring seam;
- COACH-11 create/draw-a-drill round trip and draft preservation;
- PLAN-01 recent/library behaviour;
- Week Plans and Programmes as sources, not separate required journeys;
- existing session sharing and public snapshot boundary;
- existing calendar export;
- VISUAL-03 for the final Planner / evolving-feature visual treatment.

Do not introduce a second session schema, a second drill library, wizard-only activity semantics or a separate unsafe PDF payload.

## Acceptance criteria

COACH-14 is complete when all of the following are true:

1. From **Plan a session**, a coach can choose a guided builder and finish a usable session without navigating to Library, Drill Maker, Week Plans or Programmes first.
2. A coach with no suitable existing drill can create a Quick drill inside the session and continue planning immediately.
3. A coach can optionally open the full Drill Maker and return with the unsaved session intact.
4. Existing drills, Recently Used, Week Plans and Programmes are available as sources inside the builder.
5. The coach sees activity order, durations and total minutes while composing and on review.
6. The guided flow writes the same canonical Session model used by the existing Planner.
7. Leaving a step, going Back, validation errors or a failed save does not silently discard draft work.
8. A finished saved session can be shared by canonical link and exported as a downloadable PDF suitable for WhatsApp / email / print.
9. The no-login link and PDF respect the existing content-sharing security boundary and expose no player, attendance, Spond or private operational data.
10. The flow is tested on narrow phone and desktop, keyboard and touch, with loading, empty, failure and long-content states.
11. The advanced/manual planner remains available for experienced users and edits the same underlying session.

## Relationship to current roadmap

This is a **priority planning UX item** and should be treated as the next major usability slice once current production-release gates are clear.

It should be considered before deeper operational coaching work such as COACH-6 / COACH-7 / COACH-8 unless production evidence changes the order, because it fixes the entry point into planning itself.

VISUAL-03 should adopt the Guided Session Builder as part of the evolving Planner surface rather than styling it later as a separate pass.
