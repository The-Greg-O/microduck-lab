# duck-viewer

Next.js + Three.js (react-three-fiber) web viewer for Microduck policies — watch
many training runs walk side by side in the browser instead of the native MuJoCo
viewer. The pattern is lifted from jenga-stacker's web viewer (mesh geometry
extracted straight from the compiled MuJoCo model, no asset pipeline), upgraded
from recorded replays to live WebSocket streaming.

```
┌──────────────────────────┐  GET /scene (meshes + colors, once)  ┌────────────┐
│ duck-lab (Python)       │ ───────────────────────────────────▶ │ Next.js    │
│ microduck_local          │   WS /ws ~25 Hz body poses + stats   │ duck-viewer│
│ one CPU-MuJoCo env per   │ ◀─────────────────────────────────── │ r3f canvas │
│ policy, real-time 50 Hz  │   {"cmd": [vx,vy,wz]} / {"reset"}    │ + HUD      │
└──────────────────────────┘                                      └────────────┘
```

## Run it

```bash
# 1. the lab (from microduck_local/) — each arg is one duck
uv run duck-lab --checkpoints runs/first-gait ../microduck/policies/alpha_walking.onnx

# 2. the viewer
cd duck-viewer && npm run dev     # then open the printed localhost URL
```

`?lab=host:port` on the page URL points it at a different lab (a scratch
server on another port, a scratch lab on another port — the lab binds loopback, so same machine); default `127.0.0.1:8788`.

Duck sources: a run dir (`runs/my-run`, uses/exports `policy.onnx`), any
`.onnx` file (shipped alphas work), or `--checkpoints <run>` to line up one
duck per training checkpoint — watching a policy learn across 500k-step
snapshots is the point of this thing.

**Ducks are driven only by their RL policies** — no teleop. Walking policies
follow the server's auto demo script (their velocity-command input, the same
interface the real robot's gamepad uses); trick policies (`teach-*`, 🎓, 🤝)
get zero commands and just do their trick. The **keyboard flies the camera**,
Maya/Blender-style: drag to orbit, scroll/two-finger-vertical to zoom,
**two-finger horizontal swipe** to slide laterally (natural-scrolling
direction; browser back-swipe is suppressed over the scene, and panels keep
native scrolling), **A/D** slide, **W/S·↑↓** dolly, **←/→** orbit, **Q/E**
rise/fall, **Shift+R** reset view — all held keys move smoothly (velocity × dt).
The one non-camera key is **R**, which **restarts the sim** (`{"reset": true}`
to the lab): every duck's episode drops back to step zero at the same moment,
which is what makes a side-by-side comparison legible. **Clicking a duck**
(or its HUD row) **selects it** — amber floor ring + highlighted row — and
**Delete/Backspace removes it** (same `remove_duck` message as the row's ✕);
**Esc** or an empty-floor click deselects. Selection uses the same projected
screen-radius hit test as policy assignment, not raycasting. Selecting a duck
that runs one of our trained runs also **loads that run into the 🎓 teach
panel** (`POST /teach/load` — recipe card + sliders in finished state, so
"✨ fine-tune" continues from that exact brain); shipped Pollen policies are
skipped quietly, and nothing is loaded while a job is actively training. HUD shows per-duck
episode time, fall count, reward-rate EMA (dimmed for trick ducks — it scores
the walking recipe), a system-stats strip (cpu/mem/training steps-per-second),
and collapses to a pill via its — button. Its 🏷 button toggles the floating
duck name labels (persisted; the selection ring stays either way). Labels
stack below every overlay panel (panels sit at z-index 20, labels top out
at 10), so a crowded farm can't scribble text over the HUD or chip lists. (Manual drive commands still exist
at the protocol level — `LabClient.sendCmd` — for a future gamepad page;
the UI deliberately doesn't expose them.)

## The panels

- **🧠 policies** (top-right): every assignable brain — shipped Pollen
  policies, local runs, checkpoints. Drag a chip onto a duck (or click to arm,
  then click a duck) to hot-swap its brain mid-stride; drag it to empty floor
  — or just **double-click the chip** — to spawn a fresh duck running that
  policy; drop it (or armed-click) **on the 🎓 teach panel** to load that
  run's recipe there for refinement instead. Auto-refreshes when a training
  run finishes. Hovering one of **our runs** reveals a ✕ that deletes that
  run's training data from disk — the exported policy, its checkpoints and
  its progress log; a curriculum chain deletes as one family, all stages at
  once. It always confirms first (naming the run dirs and the space it
  frees), and the lab refuses outright while that run's job is still
  training. Shipped Pollen policies have no ✕ — they aren't ours to delete.
- **🎓 teach the duck** (bottom-right): chat a trick ("stand on one leg"), see
  the reward recipe in plain English, watch the live score curve + per-term
  bars while the 🎓 trainee duck improves snapshot by snapshot. When a run
  ends, the recipe's **weight sliders unlock**: drag them and either
  "↻ retrain" (fresh) or "✨ fine-tune" (keep what it learned, adjust) —
  that's the reward-shaping loop with no Python involved.
- **🎬 animate** (bottom-center): keyframe editor for the robot — pose the
  translucent ghost duck (sliders, or drag body parts in the scene), key poses
  on the timeline, save the clip, ⚡ train a policy to track it. The **🎮 rig**
  section on top gives game-style macro controls over coupled joints — squat,
  lean, per-leg L/R swing (a stride, feet kept level), sway, stance, twist,
  toes, look — each a fixed coupling that keeps the
  feet flat (e.g. squat folds hip pitch + knee + ankle on both legs); the ⇕
  handle drags the selected rig control (squat when none is selected) and
  parks at that control's anchor on the duck — head for look, thigh for a
  swing — wearing the control's name. A
  🦴 joints / 🎮 rig toggle picks what clicking the duck edits: one servo, or
  the part's rig control (feet→toes, thigh→swing, shin→squat, trunk→lean,
  head→look, hip yaw→twist, hip roll→sway) — the whole coupling lights up and
  the drag is geared so the grabbed part tracks the cursor; selecting a rig
  slider highlights and arms that control the same way. Rig
  slider ranges are computed live from the MJCF servo limits: the slider ends
  exactly where the first servo runs out of travel, and the tooltip names it.
  Rig directions are mutually orthogonal in joint space, so controls never
  move each other's sliders, and asymmetric hand-tweaks survive a rig drag.
- **📷 shot** (top-center, always available): one click downloads a full-res
  PNG of the current view, named after the selected duck (or `duck-lab` for a
  crowd shot) — the selection ring is hidden for the capture render, and the
  whole render→read→download runs synchronously inside the click so Chrome
  never blocks it as an "automatic" download. The panel centers at the top
  but slides right of the duck-lab HUD when that panel is wide (long duck
  names) — the HUD publishes its right edge through the ui.ts store.
- **🎥 record** (same panel, appears when a duck is selected): one click films
  the selected duck for you — the camera glides to a ¾ front shot (chosen from
  the duck's heading, then held with a slow cinematic drift; OrbitControls and
  camera keys pause for the take) and MediaRecorder captures the WebGL canvas.
  Footage is automatically clean: DOM labels/panels aren't part of the canvas,
  and the amber selection ring hides itself while filming. ■ stop uploads the
  take to the lab (`POST /captures`), whose bundled ffmpeg writes a
  full-resolution h264 **mp4** and a 480 px palette **gif** into
  `microduck_local/captures/`; the panel then offers ⬇ downloads of both.
  Takes cap at 60 s. Frames are pushed per RENDERED frame
  (`captureStream(0)` + `requestFrame()` — automatic capture rides the
  compositor and records almost nothing in a throttled tab), so keep the tab
  visible while recording; a take where the scene never rendered is refused
  with a message instead of producing a 0.1 s "video".
- **helpers**: ＋ on the training row spawns a 🤝 helper duck — another
  viewer of the same live policy. Helpers do **not** add trainer workers
  (that *lowered* steps/s while the lab was open). ✕ removes it.

Panel states, chat history, and the camera persist in localStorage; the duck
roster itself persists server-side (`microduck_local/lab-state.json`) across
lab restarts.

## Grgworld pet camera

`/grgworld` is a separate, observation-only window into Mongo and Kiwi's shared
grgworld office. Start the browser-observer backend from the go-grgs project
(see that project's README), run this viewer with `PORT=63318 npm run dev`, and open
`http://localhost:63318/grgworld`. The backend defaults to `127.0.0.1:8789`;
`?world=host:port` overrides it. HTTPS viewer pages use HTTPS/WSS for the backend.
The existing `/` lab route and its `?lab=` address remain independent.

The **Room**, **Follow Mongo**, and **Follow Kiwi** buttons move only the browser
camera. Drag to orbit and scroll to zoom; Room also allows panning. The view,
per-camera position, and Maps panel preference persist under
`grgworld.petcam.*` localStorage keys. There are no reset, drive, training, or
policy controls on this route. Physics, activity, and battery come from the
server; the 1× label describes its real-time simulation pacing, and the elapsed
clock is server simulation time.

The client in `lib/grgworld.ts` speaks protocol 1:

- `GET /scene` supplies a `stream_id`, merged-mesh inputs, every global body,
  the named grgs' trunk-body indices, and the office bounds.
- Receive-only `WS /ws` supplies `stream_id`, monotonically increasing
  `sequence`, `sim_time`, all body poses, and activity/battery/fall telemetry.
- `GET /maps` is polled once per second only while Maps is open. It supplies
  `{protocol, stream_id, maps, diagnostics}`. Disabled mapping is displayed as
  off; empty maps and a missing first still window remain waiting states.

The **Live** indicator requires recent, advancing frames. After two seconds
without fresh advancing simulation time, the feed is marked paused. Disconnects
retain the final received pose with an explicit message and retry automatically.
The renderer applies received poses directly; it never extrapolates after a
stall. A changed `stream_id` discards all old scene, pose, and map data before
fetching the replacement scene. Reordered/duplicate frames do not refresh Live.

Maps show each grg's own estimate in its own map frame, not a fused map or office
ground truth. The grid's `origin` is its minimum X/Y corner; cell `(row, col)`
has center `(origin_x + (col + 0.5) * cell, origin_y + (row + 0.5) * cell)`.
Row-major fixed-point `log_odds` are displayed with +Y upward, using the mapping
foundation's evidence legend: zero is unknown, negative is free evidence,
1–150 is weak occupancy evidence, and values above 150 are occupied evidence.
These are evidence categories, not navigation clearance guarantees. The orange arrow is
`tracked_pose`, not simulator truth. Mapping capture age is measured against
the advancing simulation clock so repeatedly served old snapshots still show
as stale. `tracking: true` is not proof of a confirmed location: retained
`resumed_unverified` and `relocalized` notes remain distinct in the UI.

`components/grgworld/WorldView.tsx` reuses the existing exported
`buildBodyGeometries` from `Duck.tsx`: one merged mesh per body, the entire office
rendered once, MuJoCo Z-up converted by a -90° X group, no grid offsets, no shadow
maps, and DOM labels. It uses the streamed per-grg material colors. The upstream
[/sim implementation](https://github.com/jonathanhawkins/microduck-lab/tree/3f788f3/duck-viewer)
was checked at revision `3f788f3` when adding this route; it uses the same body
merging and axis conventions. Its Scenario stage and editable training-world
controls are separate from grgworld's streamed office.

Validate the protocol behavior and both frontend routes with:

```sh
node --test tests/grgworld.test.mjs
npm run build
```

The focused tests exercise stream replacement, stalled/reordered frames, bad
poses, disabled and pending maps, capture freshness, unverified localization,
and receive-only transport with map requests gated by the panel.

Also verify stream replacement in a real browser without reloading the page:
start an office feed, note the two world labels, stop the backend, and restart
it with a new stream. The clock must reset, Live must recover, and the scene must
contain exactly one office, one person and two grgs with two labels. There must
be one `canvas` and one `[data-world-stream]` element with the new stream ID.
Repeat while following a grg and with Maps open. The complete Canvas is keyed
by stream ID so its Three scene, controls and Html portal container are retired
together; office and camera children must never receive duplicate sibling keys.

## Notes for future work

- The scene payload is ~20 MB raw (gzipped over the wire, one-time). If it ever
  matters: quantize verts or move to binary/Draco.
- Poses stream as JSON at 25 Hz (~16 bodies × 7 floats per duck) — binary
  framing is the next lever, far from needed at this scale.
- Rendering stays deliberately light: geoms merged per body (~16 draw calls per
  duck), no shadow maps, DOM labels. The first version (560 shadow-casting
  meshes + drei `Text` GPU glyph atlases) lost the WebGL context in the
  embedded browser — keep an eye on `THREE.WebGLRenderer: Context Lost` if you
  add GPU-heavy effects back.
- Duck colors are the MJCF material rgba streamed per geom, carried through the
  per-body merge as a vertex-color channel (so per-part color costs zero extra
  draw calls). A few materials the OnShape export got wrong vs the printed
  robot (eye ring, soft mouth, shoes) are overridden by name in `Duck.tsx`
  (`MATERIAL_FIX`); against a lab too old to stream colors the viewer falls
  back to one guessed color per body.
- The lab loop is single-threaded Python: 8 ducks × 50 Hz ≈ 5% of one core.
  Dozens of ducks are fine; hundreds would want the envs in a worker pool.
