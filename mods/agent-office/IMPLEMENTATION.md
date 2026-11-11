# Project offices implementation DAG

Backup: backups/before-office-redesign-2026-11-04T15-33-17-410Z.tar.gz.

Visible pane agents have one full desk each; descendants without a visible desk appear as interns at their parent's desk. Desks belonging to the same Tab are adjacent and share a tabletop color; root agents precede workers and partitions mark Tab boundaries.

## Implementation Units

### U1 — Shared contracts
Depends-on: none
Files: mods/agent-office/projects.js
Affects: mods/agent-columns-spaces/main.js, mods/agent-office/main.js
Canonical rooms match existing Spaces repository groups. Workspace publisher provides id/name/folder/machine and members {pane,terminal,tab,space}; agent Office enriches with agents, theme and last target. Shared overview snapshot key agent-office.projects; navigation request key agent-office.requested-project.

### U2 — Themed interiors (native session office-theme)
Depends-on: U1
Files: mods/agent-office/themes.js
Affects: mods/agent-office/main.js
Exports themeFor(project), officeGeometry(W,H,count,project), roomBackdrop(W,H,g,project,sky,weather). Theme families are dispatch/workshop/loft. Every desk shares floorY; overflow expands contentWidth. Windows reuse decor.windowPane so time-of-day skies, stars, moon and the existing optional weather path remain available.

### U3 — Building cutaway overview (native session office-building)
Depends-on: U1
Files: mods/office-building/main.js, mods/office-building/mod.json
Affects: mods/agent-office/main.js
Reads agent-office.projects and renders a persistent miniature building at the right of the office row in layouts/office.json (228 px). Room rows show project names and agent status monitors, highlight the selected project, scroll when needed, and navigate the remembered space/tab/pane target. The block does not take keyboard focus when mounted.

### U4 — Project selection and per-room animation state (integration owner)
Depends-on: U1
Files: mods/agent-office/projects.js, mods/agent-office/main.js, mods/agent-columns-spaces/main.js
Affects: mods/agent-office/self-check.cjs
Visible project group maps one office, proxy session one employee, tab-adjacent workstations. Focus changes screen/light only, not employee work/idle behavior. Per-room state prevents fake departures/arrivals on room switches.
- A Space with no session panes awards the employee portrait to Office Cat, using the existing cat sprite. A Space with a non-agent session keeps the existing vacant-portrait behavior.

### U5 — Integration and verification
Depends-on: U2, U3, U4
Files: layouts/office.json, mods/agent-office/main.js, mods/agent-office/self-check.cjs, mods/agent-office/IMPLEMENTATION.md
Verify project isolation/navigation, room state restoration, focused idle lighting and local 20:00–06:00 night boundary; check changed native mods and observe actual themed rooms and the persistent miniature building. No commits/pushes. Workers skip checks mid-flight; integration owner runs aggregate checks after outputs arrive.

## Final verification — 2026-11-05

- Both agent-office and office-building pass herdr-app check; the running window reports no errors.
- self-check.cjs passes single-floor, non-overlapping desk geometry for 0/3/12/50 occupants across all themes, sky/star rendering, embedded room selection, project isolation, target restoration, timer isolation and lighting boundaries.
- A throwaway smoke invocation exercises retained overtime visuals: no sweat at 29 minutes and sweat at 31; no upper coffee cup at 59 minutes and a rendered coffee pile at 61. No clock changes or real-time waiting.
- Native screenshots confirm grounded desks, the right-side miniature, night sky/moon, room dimming and focused desk illumination. Native target focus changes were exercised and the original pane restored.
- Artifacts: /tmp/herdr-grounded-office-mini.png and /tmp/herdr-grounded-office-compound.png. Physical pointer activation was not exercised because the computer-use pipe was unavailable; the miniature click handler and resulting room selection were exercised in the regression check.

## Project binding and restored features — 2026-11-05

- Office and agent-columns now consume the sidebar's persistent machine/repository binding. Worktrees stay within their project Space; `cd` does not change membership. Existing duplicate Spaces retain their native topology and are identified in metadata and the miniature tooltip.
- Visible project/Tab/split/context-menu creation uses personal adapters and the shared request queue. Global Herdr built-in commands remain outside those adapters. See `../agent-columns-spaces/README.md` for the binding file and ownership rules.
- Network weather is enabled: IP-based approximate location from ipwho.is, rounded to 0.1° before Open-Meteo requests; refresh every 30 minutes, retaining the last weather on invalid/failed responses. The native window shows rain. This is network-exit location, not GPS.
- Restored wall fixtures include the incident board, employee portrait, poster, tool rack, live whiteboard, seasonal and remote-worker details. Geometry checks cover 0/3/12/50 occupants across all themes; the final Office screenshot shows the wall fixtures and windows inside the room.
- Both self-check scripts pass. All nine affected mods pass `herdr-app check`. Recorded native acceptance passes all seven scenarios: stable binding after `cd`, existing-project reuse, worktree Tab membership, original-Tab split, requested command startup, externally added worktree discovery, and preserved original topology. Structured evidence: `/tmp/herdr-native-project-policy-result.json`.
- Final screenshots: `/tmp/herdr-project-office-final.png`, `/tmp/herdr-project-columns-final.png` and `/tmp/herdr-project-new-menu-final.png`. The live menu displays the bound project's worktrees and installed agents. Office and the original focused pane were restored; final status has no overlays or errors. Physical pointer activation remains unverified; native rendering and programmatic creation were exercised.

## Room variations and one celestial body — 2026-11-05

- Dispatch uses aligned wall panels and counter/cooler/couch order; workshop uses vertical battens, staggered wall fixtures and cooler/counter/couch order; loft uses wooden wainscoting and couch/cooler/counter order. Stable room IDs rotate the central wall fixtures so rooms retain their arrangement across redraws. Desks stay grounded in their original single-floor geometry.
- Only the first window renders a sun or moon. Both windows retain their sky, stars and weather effects. The same rule applies when the second window is replaced by a remote-worker video wall.
- `node mods/agent-office/self-check.cjs` passes the three theme layouts, 0/3/12/50 occupant clearance, furniture separation, fixture bounds, one celestial body by day/night and with/without remote workers, and no daytime sun in rain. `herdr-app check mods/agent-office` passes. Live dispatch and workshop screenshots show different walls/furniture and a single sun: `/tmp/herdr-office-dispatch-varied.png`, `/tmp/herdr-office-workshop-varied.png`, `/tmp/herdr-office-dispatch-second-varied.png`.
- Night-time moon uniqueness was verified by the regression check; system time was not changed for a night screenshot.

- Active rooms in the miniature now have a gold row border, gold title bar, a `当前` badge and a highlighted door frame. Inactive rooms keep their original palette. Native rendering and the existing miniature navigation regression pass; `/tmp/herdr-active-office-highlight.png` confirms the selected row in the live window.
