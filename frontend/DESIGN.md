# Existing console design

The visual authority is `src/components/console/ConsoleShell.tsx` and the existing UI components. This extension preserves that identity: a light slate page, white header and bordered white content sections, system sans typography, slate text and indigo links, active states and focus rings. It reuses Button and Callout.

The console is an Operate surface. Show the page title, scope and source context before evidence. Group global navigation into operations/learners, content/automation and administration, keeping existing destinations. Wrap navigation on narrow screens. Use labeled fields and stacked record lists to keep long identifiers and UTC times readable without horizontal scrolling.

Use text for fresh, stale, unknown, failure and empty states. Absolute timestamps include UTC. Errors retain only safe support references; prior successful operational results become explicitly historical after refresh failure. Learner deletion or authorization loss removes sensitive results. Search has a visible label, inline validation and keyboard submission. External configured HTTPS tools identify their new-tab behavior.

Source: the approved read-only W1 brief and incumbent implementation; no redesign or new font, color system, dependency or animation system is introduced.
