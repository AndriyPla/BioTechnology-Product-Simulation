Cancer Simulator

Open `index.html` in your browser (double-click or use a live-server) to run the simulator.

Files:
- `index.html` — main page linking CSS/JS
- `styles.css` — layout and styles
- `script.js` — simulation logic (canvas, cells, drug particles)

Controls:
- Slider "Cancer start radius" — controls the initial tumor cluster radius (single connected seed cluster)
- Slider "Cancer growth rate (slower)" — controls neighbor-driven growth; mapped to a much slower per-tick probability
- Slider "Cancer drug" — amount of drug particles flowing through the curved blood vessel
- Run / Stop buttons — start and stop simulation

Notes:
- The vessel is now drawn as a diagonal/curved band rather than a perfect rectangle; its boundary is a sinusoidal/tilted curve and drug particles are spawned inside that curved region.
- Drug particles now flow faster and follow the vessel's local tangent direction. When a particle crosses the vessel boundary into muscle tissue, it "leeches" into the muscle and moves roughly perpendicular to the vessel flow.
- Leached drug particles travel through muscle tissue and will attempt to kill nearby cancer cells as they pass (chance depends on the "Cancer drug" slider).
- Cancer is seeded as a single connected tumor cluster (radius controlled by the "Cancer start radius" slider). All growth is neighbor-driven so the tumor remains connected as it grows. Cells inside the vessel region will not become cancer.
- Growth has been tuned to be drastically slower (the growth slider maps to a small per-neighbor probability to better reflect slow expansion).
