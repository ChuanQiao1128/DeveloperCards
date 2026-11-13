# Draw ceremony: material opening

The opening now centers on the user's tear and the card's arrival. It removes the repeated charge pulses and camera shake, overlaps the foil peel with card flight, and reserves a single focal flip for the highest rare card in a batch. Actual draw results and their identity remain the input to the scene.

This implementation applies Emil Kowalski's [animate-expo](https://github.com/emilkowalski/skills/blob/main/skills/animate-expo/SKILL.md) and [choreograph](https://github.com/emilkowalski/skills/blob/main/skills/choreograph/SKILL.md) skills, read on 13 November 2026. The existing Reanimated 4 / Skia stack and native guard are retained; no motion dependency was added.

## Motion timeline

Times below are authored offsets, not measured device performance. They describe a single Legendary card after the tear commits; other rarities have shorter tension and flip beats.

| Element | Role | Starts | Duration | Motion | Relationship |
| --- | --- | --- | --- | --- | --- |
| Pack | Lead | 0 ms | 180 ms | 4% grip scale and 12 pt lift | Responds to the committed tear |
| Cut edge | Support | 0 ms | 120 ms | Finishes the existing cut without closing it | Together with grip |
| Foil strip | Lead | 615 ms | 140 ms | Peels upward and sideways | Leads the emerging card |
| Card back | Lead | 685 ms | 175 ms | Rises from the pack as its cover fades | Overlaps the peel |
| Hero card | Lead | 860 ms | 260 ms | 48 pt arrival, 0.96 to true scale | Continues the card flight |
| Flip | Lead | 1,120 ms | 570 ms | Half-turn with a 90 ms edge pause | Reveals the actual card |
| Local light, foil sweep and rarity cue | Support | Flip midpoint | Bounded accent | Local lighting and one midpoint cue | Follow the flip, not an earlier trigger |

The screen and camera stay still, keeping attention on the pack and card. Common cards have a quiet flip. A batch opens together and spotlights at most one highest non-common card; every result remains available on the summary grid. “View all cards” ends that focal reveal immediately and silently.

## Input and accessibility

The tear follows the finger on the UI thread. React receives one notification when the drag begins, and a commit or reset at release. Distance or a sufficiently fast short flick can open the pack; an incomplete drag uses a velocity-aware spring. Existing accessible activation remains available.

Reduced Motion removes spatial movement from the reveal and foil sweep. The fixed banner, read-action and footer slots also keep the card's dimensions and position stable while controls appear. The reveal measures its actual container rather than assuming the full window is available.

## Checks and evidence

The change includes regression checks for grouped reveals, stable identity ordering, short-flick commit, cancellation, reduced motion, constant card dimensions and constant chrome layout slots. The preview renders the real ceremony component with sample data and never calls the wallet or commits a draw.

Local validation: 3,213 mobile tests passed; TypeScript passed; iOS and Android product Metro/Hermes exports completed. Counts refer to this delivery, not a permanent project total. Raw results and source snapshots are under `exports/draw-motion-20261113/`.

Native captures use an iPhone 17 Pro simulator on iOS 26.5, with the preview JavaScript embedded in a separate app identifier using the existing compatible 2.1.0 simulator shell. These captures are local design evidence, not a signed 2.1.1 release or physical-device performance acceptance. On hardware, check short flicks, interrupted flips, sound/haptic alignment, silent mode and Reduce Motion before release.

Code entry points: [timeline](../../mobile/src/components/ceremony/useCeremonyTimeline.ts), [pack](../../mobile/src/components/ceremony/PackTear.tsx), [spotlight](../../mobile/src/components/ceremony/RevealSpotlight.tsx), [batch focus](../../mobile/src/features/gacha/draw/spotlightQueue.ts), and [standalone preview](../../mobile/previews/drawMotion.tsx).
