# Local draw-motion preview

`drawMotion.tsx` is a separate Expo entry that renders the production ceremony component with sample cards. It has Common, Rare, Legendary and five-card scenarios. It never opens the wallet, signs in or commits a draw, and the normal `index.ts` does not import it.

The recorded preview uses a separate simulator app identifier, `com.timeawake.recallsmith.motionpreview`, with updates disabled. Its native shell is the existing compatible 2.1.0 simulator app; the preview JavaScript is built from this worktree. This is local design evidence and must not be submitted as a signed production build.

After installing a compatible preview shell with this entry, run the local flow against the intended simulator:

```sh
maestro --device <simulator-udid> test --test-output-dir exports/draw-motion-20261113/maestro mobile/previews/draw-motion.yaml
```

The flow records a single Legendary, a single Common, and a five-card batch including the immediate “View all cards” summary. The captured media and exact source hashes are under `exports/draw-motion-20261113/`; [the design note](../../docs/design/draw-motion-20261113.md) explains choreography and validation limits.
