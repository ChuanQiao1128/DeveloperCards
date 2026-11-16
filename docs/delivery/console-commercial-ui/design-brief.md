# Console commercial layout

Mode: Operate. User direction: a real management console with a permanent left column of management categories. This is a shell redesign within the existing DeveloperCards indigo/slate identity, preserving route destinations, factual page copy and API authorization.

Desktop uses a 248px full-height light sidebar, independent navigation scroll, grouped headings, consistent outline icons and a clear indigo current item. A compact white topbar carries section context and the actual session identity/sign-out action. The workspace uses a quiet slate surface with a consistent maximum content width and room for tables and forms. Page children retain their own h1.

Groups: Workbench (Overview), Content (Decks, Review queue, AI QA, Reports), Learners (Learners), Automation (Automation, Automation ledger), Analytics (Usage), System (Operations, Webhooks, Admin Management). Empty or unauthorized groups disappear. Links retain href semantics and page-specific overrides. Privileged links remain dependent on the current session, never a stale caller prop.

Below the desktop breakpoint navigation becomes a full-height native modal dialog. Browser modal behavior provides focus containment and background inertness. Escape, explicit close, backdrop and route changes close the drawer; focus returns to its trigger. Targets are at least 44px, focus rings are visible, long account labels truncate with their full accessible text, and motion respects reduced motion. No fabricated search, totals, counters, billing or health states.

Existing primitives and browser behavior suffice; no package addition. Auth, APIs, page data and operational scripts are outside this change. Design search supported accessible minimal B2B blue/neutral interfaces; its education marketing composition was rejected as unsuitable for an authenticated task surface. The brief pins the commercial sidebar topology, so no speculative direction tournament or new visual identity was introduced.

Verification: targeted shell/navigation/current-session tests, lint, production build, one mechanical design detector pass; rendered desktop/mobile checks are performed by the integrating parent task. This document does not claim production deployment or learner/card acceptance.

Integrated repair: group accessible names end in “navigation” so form labels remain unambiguous. The home page deliberately stops suppressing its Decks link, making the full category list and current page visible. Other callers retain the undefined-href hide contract. Old/new captures verify all page content inside main is byte-identical; only shell chrome changes, with exact DOM/census baselines remeasured and Profiler/memo gates preserved. Bundle budgets follow measured next-1,000-B rounding; no dependency or lazy-boundary change. See verification.json for raw and gzip closures.
