# Pending work

Tracks all outstanding tasks as of 2026-08-05. Items are grouped by theme.
Check items off as they are completed.

---

## 1. Login & shared-plan UX

### 1a. Default access tab should be "Sign in", not "I'm new here"
**Status:** Done.
`SharedPlanPanel.tsx` line 56 initialises `accessMode` to `'join'`, and line 122
picks `join` as the default when a plan has joining enabled. Most returning
visitors land on a plan link already knowing who they are — the default tab
should be `login`, with `join` and `claim` still available. Change the fallback
order so `login` is always tried first unless a claim token is present.

### 1b. "Who are you?" chip picker only appears on the Sign-in tab
**Status:** Done.
The participant chip picker (`group-participant-chips`) was added for `accessMode === 'login'`
only. The same quick-select chips would also help on the `claim` tab, where the
person needs to identify which listed route is theirs.

### 1c. Name field should auto-fill when a chip is tapped (already done for login)
**Status:** Done for the `login` and `claim` tabs. Both use the same chip click
handler and move focus to the password field after filling the selected name.

### 1d. "Your route" badge visual styling
**Status:** Done. The assigned participant has a themed card outline, a readable
`Your route` badge, and an accessible `(You)` card label.

### 1e. Login dialog: no way to see who's currently signed in at-a-glance
**Status:** Done.
The button label cycles through "Share / Manage / My route / Join" but the user
cannot see their own name until they open the dialog. The button (or a small
tooltip/sub-label) should surface the signed-in participant name, e.g.
`My route · Alice`.

---

## 2. Fairness / method selector

### 2a. Default objective ordering
**Status:** Done — `average` is first in `RAIL_OBJECTIVE_OPTIONS` and is the
saved default in `loadSavedState`.

### 2b. `<details>` disclosure hides the three-option picker
**Status:** Done — the radio picker is inside a `<details>` element in
`App.tsx` ~line 925.

### 2c. Distance mode has no equivalent objective disclosure
**Status:** Not started.  
When `mode === 'distance'` the geometric-median / arithmetic-mean distinction is
invisible to the user. A one-line summary should appear (e.g. "Uses geographic
midpoint — straight-line distance") so users know what they are getting. The
advanced toggle can remain hidden; just surface the active algorithm name.

### 2d. Method panel copy is generic
**Status:** Not started.  
"Pick the fairness approach for this meetup." is vague. UX writer pass needed —
see §5.

### 2e. Let shared-plan participants experiment with calculation settings
**Status:** Planned; awaiting approval before implementation.  
Logged-in participants currently cannot change the meeting mode or rail fairness
goal because those controls use the owner-only `canManagePlan` permission. The
lock should apply to people and plan administration, not to calculation tools:
participants must remain restricted to editing their own route, while anyone
viewing the plan should be able to try MRT/LRT vs direct distance, switch between
the three rail objectives, calculate results, and explore alternative stations.

Use local calculation overrides rather than allowing contributors to persist
owner-only plan mutations. The owner's saved `mode` and `railObjective` remain
the defaults for newly opened views; owner changes may continue to update those
shared defaults. Contributor and visitor changes should affect only their own
view and must not call `setMode` or `setRailObjective`. Once a viewer overrides a
calculation setting, background plan polling must continue syncing participant
routes without replacing that local choice. Reset the override when switching,
leaving, or reopening a plan, and show non-owners a short cue such as "Changes
here affect only your view."

Keep backend authorization unchanged as defense in depth. Add coverage proving
that contributors can use all calculation controls locally without issuing plan
mutations, remote participant updates preserve local calculation choices, and
person/admin permissions remain locked to the appropriate member or owner.
`src/App.tsx` currently has overlapping in-progress edits from another agent, so
coordinate or wait for that work to settle before implementing this item.

---

## 3. Station names & codes (separate agent work in progress)

### 3a. Full station label with line code (e.g. "EW7 Eunos")
**Status:** In progress by a separate agent.  
`formatStationLabel` in `src/lib/stations.ts` already prefixes line codes, and
`railGraph.ts` test 53-55 confirms code search. Verify the updated station data
(including codes like EW7, NS4, etc.) is wired through to:
- `LocationInput` autocomplete suggestions
- `ResultPanel` station name display
- `MapPanel` marker tooltip labels

### 3b. Station search should match partial code ("EW" to all East-West stations)
**Status:** Tests 54-55 pass for exact codes and acronyms. Confirm partial-prefix
matching (e.g. "EW" returning EW1-EW33) works in the live autocomplete without
flooding results.

---

## 4. UI polish (UI Engineer pass)

### 4a. Participant card — colour picker UX
**Status:** Done.
The colour picker opens inline with no animation and no close-on-outside-click
behaviour. It should close when the user clicks anywhere outside the picker panel.
Add a subtle fade/slide-in animation.

### 4b. Participant card — "Different place after the meetup?" checkbox
**Status:** Done.
The checkbox is functional but visually plain. Consider a styled toggle switch
that is more obviously interactive and less likely to be overlooked.

### 4c. Add-person button spacing
**Status:** Not started.  
`.add-person-button` sits flush below the last card with no visual breathing
room. Add adequate margin and a subtle dashed-border affordance to hint it is an
action rather than a result row.

### 4d. Calculate button prominence
**Status:** Not started.  
The `.calculate-button` should be the most visually dominant element on the
planner panel. Verify it uses the primary brand colour with a clear hover/active
state, adequate padding, and a smooth loading spinner transition.

### 4e. `<details>` fairness disclosure — open/close animation
**Status:** Not started.  
The native `<details>` element has no animation. Add a CSS transition for the
content expanding (height or clip-path animation) so it does not jank open.

### 4f. Result panel — top-ranked station card hierarchy
**Status:** Not started.  
The recommended station should have clear visual hierarchy over the alternatives
list — larger type, stronger background, prominent action buttons. Review
`ResultPanel.tsx` for consistent use of spacing, font sizes, and colour tokens.

### 4g. Mobile / responsive layout
**Status:** Not audited.  
The two-column `planner-layout` / `results-column` layout needs a responsive
breakpoint audit. On narrow screens the planner panel and results aside should
stack vertically, and the fairness disclosure and participant cards should not
overflow horizontally.

### 4h. Dark-mode consistency
**Status:** Not audited.  
`ThemeToggle` is present but a full dark-mode pass has not been done for the
new elements added in the last session: `.current-user-badge`, `.group-participant-chips`,
`.group-participant-chip`, `.rail-objective-disclosure`, `.rail-objective-guidance`.

### 4i. Focus-visible ring
**Status:** Not audited.  
Verify all interactive elements (buttons, inputs, links, `<details>/<summary>`)
have a visible focus ring that meets WCAG 2.4.11 (at least 2 px, contrasting
colour) in both light and dark modes.

---

## 5. Copy & UX writing pass (UX Writer pass)

### 5a. Planner intro copy
**Status:** Not started.  
Current: "Add where everyone is coming from. We'll find a fair, practical spot."
Needs a UX-writer pass for clarity, warmth, and Singapore-appropriate voice.

### 5b. Fairness selector labels and summaries
**Status:** Not started.  
The three rail objective labels ("Quickest overall", "Cap longest journey",
"Equal travel time") and their `summary` strings should be reviewed for plain-
language clarity. Avoid jargon like "minimax" leaking through.

### 5c. Shared-plan dialog copy
**Status:** Not started.  
All strings inside `SharedPlanPanel` — kicker lines, button labels, hint
paragraphs, error messages — need a UX-writer review pass for consistency of
tone and brevity.

### 5d. Empty/loading states
**Status:** Not started.  
The result aside shows nothing until a calculation runs. An empty-state
illustration or short prompt (e.g. "Add at least two locations and tap Find") 
would reduce confusion for first-time users.

### 5e. Error messages
**Status:** Not started.  
Current error strings (e.g. in `resolveField`) are functional but terse. Review
all user-facing error messages for actionability: tell the user what to do, not
just what went wrong.

### 5f. "Use sample" button discoverability
**Status:** Not started.  
New users may not notice "Use sample" — it is small and sits beside a less
prominent label. Consider moving it into the empty participant state or adding
a first-use prompt.

---

## 6. CSS / design tokens

### 6a. New CSS classes from last session need full styles
**Status:** Incomplete. The following classes were added to JSX but their CSS
rules may be missing or minimal — verify in `main.css` / component CSS files:
- `.current-user-badge` (ParticipantCard)
- `.is-current-user` modifier on `.participant-card`
- `.group-participant-picker`, `.group-participant-chips`, `.group-participant-chip`,
  `.group-chip-initial`, `.group-chip-name`, `.group-chip-check` (SharedPlanPanel)
- `.rail-objective-disclosure`, `.rail-objective-disclosure-trigger`,
  `.rail-objective-guidance` (App.tsx)

### 6b. `SharedPlanPanel.css` is nearly empty (989 bytes)
**Status:** Done.
Nearly all shared-plan panel styles live in `GroupPlanPanel.css`. The new chip
and badge styles should be added in a coherent, organised way — either to
`GroupPlanPanel.css` or a dedicated section in `SharedPlanPanel.css`.

---

## 7. Accessibility

### 7a. `<dialog>` element usage
**Status:** Not started.  
`SharedPlanPanel` uses a `<section role="dialog">` inside a backdrop div rather
than the native `<dialog>` element. Native `<dialog>` provides built-in focus
management, `::backdrop`, and Escape handling. Consider migrating to native
`<dialog>` once browser support requirements are confirmed.

### 7b. Announce live results to screen readers
**Status:** Not started.  
When calculation completes, the result panel updates but there is no `aria-live`
announcement. Add a visually-hidden live region that announces e.g. "Result
ready: Dhoby Ghaut is the recommended meeting station."

---

## 8. Tests

### 8a. SharedPlanPanel login chip test
**Status:** Done.
`shared-plan-presentation.test.js` covers access-mode priority, the canonical
participant choices used by chip selection, and signed-in trigger labels.

### 8b. `isCurrentUser` badge test
**Status:** Done. `participant-presentation.test.js` covers the badge, card
modifier, and accessible label for assigned and unassigned participants.

---

## 9. Infrastructure / deferred (from `docs/FUTURE.md`)

These are intentionally out of scope for the current sprint but tracked here
for completeness.

- Time-aware routing (departure/arrival time, bus+MRT multimodal)
- Live disruption comparison vs. local estimate
- Venue recommendations from a places provider (shortlist, hours, price,
  accessibility, group vote)

---

*Last updated: 2026-08-05. Run `npm run check && npm test && npm run build`
before marking any item done.*
