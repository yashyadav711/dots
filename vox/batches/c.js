// WHY the file is structured this way:
// Each draw() closes over its own state object so the particle system is
// initialised once and mutated each frame — no per-frame heap allocation.
// State is captured by the IIFE that returns the draw function.

const BATCH = [

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'particle-stream',
    name: 'C1',
    title: 'Particle Stream',
    blurb: 'A continuous stream of motes erupts from the centre and drifts outward — emission rate, velocity, and brightness all track the microphone level.',

    draw: (() => {
      // WHY a fixed pool of 120 particles:
      // We pre-allocate exactly as many particles as can be visible at peak level.
      // Each particle carries its own phase seed so their spread looks organic
      // without being random each frame. Pool size = emitting 4/frame × 30 frames
      // of visible lifetime = 120. Index cycles with a head pointer.
      const N   = 120;
      const px  = new Float32Array(N);   // x offset from centre (signed)
      const py  = new Float32Array(N);   // y offset from strip centre
      const pvx = new Float32Array(N);   // x velocity (px/s)
      const pvy = new Float32Array(N);   // y velocity (px/s)
      const page= new Float32Array(N);   // age in seconds; -1 = inactive
      const plife = new Float32Array(N); // max lifetime for this particle (s)
      const pseed= new Float32Array(N);  // per-particle deterministic seed
      for (let i = 0; i < N; i++) { page[i] = -1; pseed[i] = (i * 1.6180339 % 1); }
      let head = 0;
      let lastT = -1;

      return function draw(c, w, h, v, t, hist) {
        const cx   = w / 2;
        const cy   = h / 2;
        const dt   = lastT < 0 ? 0.016 : Math.min(t - lastT, 0.1);
        lastT = t;

        // WHY emission rate scales quadratically:
        // At low v a trickle (1 particle/frame) keeps silence alive.
        // At peak, 6/frame fills the stream visibly. Quadratic gives a more
        // perceptible difference than linear.
        const emit = Math.round(1 + v * v * 5);
        const speed = 60 + v * 320;   // px/s — faster when louder
        const life  = 0.8 + (1 - v) * 0.6;  // quieter = longer lived, slower drift

        // Emit new particles
        for (let e = 0; e < emit; e++) {
          // Deterministic seed using head and frame-count approximation
          const seed = ((head * 7.3 + t * 3.7) % 1 + 1) % 1;
          px[head]   = 0;
          py[head]   = (seed - 0.5) * h * 0.55;
          // Direction: left half of pool goes left, right half goes right —
          // symmetric about centre as required
          const dir  = (head % 2 === 0) ? 1 : -1;
          pvx[head]  = dir * (speed * (0.7 + seed * 0.3));
          pvy[head]  = (seed - 0.5) * 20;
          page[head] = 0;
          plife[head]= life * (0.7 + seed * 0.3);
          pseed[head]= seed;
          head = (head + 1) % N;
        }

        // Integrate and draw
        c.save();
        c.globalCompositeOperation = 'lighter';

        for (let i = 0; i < N; i++) {
          if (page[i] < 0) continue;
          page[i] += dt;
          if (page[i] > plife[i]) { page[i] = -1; continue; }

          px[i] += pvx[i] * dt;
          py[i] += pvy[i] * dt;

          // WHY fade uses square of remaining life fraction:
          // Tail-end fade should look like dissipation, not a hard cutoff.
          // Squaring the fraction means the last 30% of life drops quickly —
          // the mote seems to evaporate rather than blinking out.
          const frac = 1 - page[i] / plife[i];
          const alpha = frac * frac * (0.15 + v * 0.6);

          // Distance from centre in [0,1] — use env() to attenuate alpha
          // at the ends so motes near the edge are naturally dimmer.
          const u = px[i] / cx;  // ∈ [-1,1] roughly
          const envA = Math.max(0, 1 - Math.abs(u) * 0.4);

          const brightness = 0.3 + frac * 0.7 * v;
          c.fillStyle = col(brightness, alpha * envA);
          const r = 1.2 + pseed[i] * 0.8;
          c.beginPath();
          c.arc(cx + px[i], cy + py[i], r, 0, Math.PI * 2);
          c.fill();
        }

        // Hot core at centre — the emission point
        if (v > 0.02) {
          const coreA = Math.min(0.5, v * 0.7);
          c.fillStyle = `rgba(255,255,255,${coreA})`;
          c.beginPath();
          c.arc(cx, cy, 2, 0, Math.PI * 2);
          c.fill();
        }

        c.globalCompositeOperation = 'source-over';
        c.restore();
      };
    })()
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ferrofluid',
    name: 'C2',
    title: 'Ferrofluid Spikes',
    blurb: 'Magnetic spikes rise from a liquid baseline, tallest and densest at the centre — spike height and count grow with level.',

    draw: (() => {
      // WHY 48 spikes at fixed x positions:
      // Ferrofluid spikes under a magnet form at quasi-periodic intervals
      // determined by surface tension vs. magnetic force. We compute 48 spike
      // positions once and keep them fixed — only the HEIGHT changes with v and
      // position. Moving spikes laterally would look like a bar chart, not a fluid.
      const NSPIKES = 48;
      const spikes = new Float32Array(NSPIKES);  // normalised x in [0,1]
      for (let i = 0; i < NSPIKES; i++) {
        // Golden-ratio spacing gives quasi-periodic, non-uniform gaps
        spikes[i] = (i / NSPIKES + (i * 0.6180339) % 1) % 1;
      }
      // Sort so we can draw left to right (not required but cleaner)
      spikes.sort();
      // Precompute distances from centre in [-1,1]
      const sdist = new Float32Array(NSPIKES);
      for (let i = 0; i < NSPIKES; i++) sdist[i] = spikes[i] * 2 - 1;

      return function draw(c, w, h, v, t, hist) {
        const cx = w / 2;
        // WHY baseline sits at 0.78*h (lower ¾):
        // The strip is 74 px. Spikes rise upward. A baseline at ~57 px from top
        // (0.78*h) leaves room for tall spikes at peak while the liquid meniscus
        // at silence sits convincingly low. The bottom 16 px is the "pool".
        const base = h * 0.78;
        const lv = 0.06 + v * 0.94;  // floor keeps the resting meniscus alive

        c.save();

        // Draw the liquid base first — a thin filled region
        c.fillStyle = col(lv * 0.4, 0.18 + v * 0.12);
        c.fillRect(0, base, w, h - base);

        // Draw surface meniscus as a smooth curve
        c.beginPath();
        c.moveTo(0, base);
        for (let i = 0; i <= 80; i++) {
          const xn = i / 80;          // 0..1
          const xu = xn * 2 - 1;     // -1..1
          // WHY env() here: the magnetic field is centred, so surface tension
          // distortion (meniscus rise) is strongest near centre and falls off.
          const ripple = Math.sin(xn * Math.PI * 12 + t * 3) * 0.8 * lv * env(xu);
          c.lineTo(xn * w, base - ripple);
        }
        c.lineTo(w, h);
        c.lineTo(0, h);
        c.closePath();
        c.fillStyle = col(lv * 0.5, 0.12);
        c.fill();

        c.globalCompositeOperation = 'lighter';

        // Draw spikes
        for (let i = 0; i < NSPIKES; i++) {
          const xn = spikes[i];
          const xu = sdist[i];         // -1..1 from centre
          const sx = xn * w;

          // WHY env(xu) drives spike height:
          // The magnetic field from a point source above the centre attenuates as
          // ~1/r^2. env() approximates this falloff — central spikes are tall and
          // the outer edge spikes are small, matching the real physics.
          const envelope = env(xu);
          const maxH = h * 0.72;      // maximum spike height = almost full strip
          const spikeH = maxH * lv * envelope;

          if (spikeH < 1) continue;

          // WHY tapered triangle: a ferrofluid spike is sharp at the tip and
          // widens at the base. A triangle of base 2–4 px nails this silhouette
          // in 74 px without any arc primitives.
          const baseW = 1.5 + envelope * lv * 2;
          const alpha = 0.25 + envelope * lv * 0.65;

          c.fillStyle = col(0.4 + envelope * lv * 0.6, alpha);
          c.beginPath();
          c.moveTo(sx, base - spikeH);          // tip
          c.lineTo(sx - baseW, base);
          c.lineTo(sx + baseW, base);
          c.closePath();
          c.fill();

          // Tip highlight — a tiny bright node at the spike apex
          if (spikeH > 4 && v > 0.1) {
            c.fillStyle = col(1, alpha * 0.6);
            c.beginPath();
            c.arc(sx, base - spikeH, 0.8, 0, Math.PI * 2);
            c.fill();
          }
        }

        c.globalCompositeOperation = 'source-over';
        c.restore();
      };
    })()
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'vapour-plume',
    name: 'C3',
    title: 'Vapour Plume',
    blurb: 'A soft plume of condensing vapour rises from the centre, spreading and thinning as it climbs — density, height, and spread track the level.',

    draw: (() => {
      // WHY 10 layered ellipses stacked vertically:
      // A real vapour column is not uniform — it is a stack of mushrooming
      // pockets of gas that spread as they cool. We model this with N ellipses
      // that each represent a different altitude slice. Lower slices are narrow
      // and bright (hot, dense); upper slices are wide and transparent (dispersed).
      // The height of the stack and opacity both scale with v so at silence
      // only a faint basal wisp is visible.
      const NL = 10;

      return function draw(c, w, h, v, t, hist) {
        const cx = w / 2;
        const lv = 0.05 + v * 0.95;

        c.save();
        // No composite trick needed — soft alpha layering reads naturally here.

        for (let i = 0; i < NL; i++) {
          // WHY layer index drives both vertical position and spread:
          // Layer 0 is at the bottom (emission point), layer NL-1 is the top.
          // The strip has y=0 at top and h at bottom — so layer 0 sits near h
          // and layers rise upward as i increases.
          const frac = i / (NL - 1);     // 0 = base, 1 = top

          // WHY slow sinusoidal drift offset per layer:
          // Real vapour billows — pockets shear and wander. A sin wave with
          // different phase per layer at low amplitude (3 px max) prevents the
          // stack from looking like a rigid pillar while still reading as one plume.
          const drift = Math.sin(t * 0.8 + frac * Math.PI * 1.5) * 3 * lv;

          // Stack height: at v=0 top layer barely clears h*0.4;
          // at v=1 it reaches h*0.05 (near top of strip).
          const topY  = h * (0.95 - lv * 0.85);
          const y     = h - (h - topY) * frac;   // layer's centre y

          // WHY width widens as frac increases:
          // Vapour expands as pressure drops with altitude. Base width ~8 px,
          // top width ~w*0.45 at full level so the plume reaches the outer thirds.
          const baseW = 8;
          const topW  = w * 0.46 * lv;
          const rx    = baseW + (topW - baseW) * Math.pow(frac, 0.7);

          // Height of each ellipse slice is proportional to its width (cigar shape)
          const ry = Math.max(2, rx * 0.18);

          // WHY alpha falls off both at the top (dispersed) and base (thin source):
          // True plume density peaks in the lower middle. We model this with a
          // bell-ish curve: highest alpha at frac~0.25, falling to near-zero at tips.
          const densityCurve = Math.sin(frac * Math.PI) * (0.3 + frac * 0.3);
          const alpha = densityCurve * lv * 0.55;

          const brightness = 0.3 + (1 - frac) * 0.5 * lv;
          c.fillStyle = col(brightness, alpha);

          c.beginPath();
          c.ellipse(cx + drift, y, rx, ry, 0, 0, Math.PI * 2);
          c.fill();
        }

        // Basal hot core — a small bright point where the plume originates
        if (v > 0.01) {
          const cA = Math.min(0.45, v * 0.55);
          c.fillStyle = `rgba(255,255,255,${cA * 0.6})`;
          c.fillStyle = col(0.9, cA);
          c.beginPath();
          c.arc(cx, h - 2, 2.5, 0, Math.PI * 2);
          c.fill();
        }

        c.restore();
      };
    })()
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'mercury-bead',
    name: 'C4',
    title: 'Mercury Bead',
    blurb: 'A bead of liquid metal at the centre stretches into a thread and sheds satellite droplets that travel outward — the stretch and count grow with level.',

    draw: (() => {
      // WHY a fixed array of 8 satellite beads per side:
      // At peak level mercury breaks into multiple droplets — a real Plateau–
      // Rayleigh instability. We pre-allocate 8 bead slots per side (16 total)
      // so no allocation occurs per frame. Only beads whose threshold ≤ v are
      // drawn, giving a natural progression: 1 bead at v=0.2, up to 8 at v=1.
      const NBEADS = 8;
      // Precompute each bead's activation threshold, x-fraction, and size factor
      const bThresh = new Float32Array(NBEADS);
      const bXfrac  = new Float32Array(NBEADS);
      const bSize   = new Float32Array(NBEADS);
      for (let i = 0; i < NBEADS; i++) {
        bThresh[i] = 0.15 + (i / NBEADS) * 0.7;  // appear progressively
        // WHY bead positions use sqrt spacing:
        // Mercury droplets travel at ~v^2 (surface tension wins at low v,
        // then kinetic energy dominates). sqrt gives tighter packing near
        // centre and wider spacing at the ends — matching real fluid dynamics.
        bXfrac[i] = Math.sqrt((i + 1) / NBEADS);
        bSize[i]  = Math.max(1.5, 5 - i * 0.4);   // inner beads larger
      }

      return function draw(c, w, h, v, t, hist) {
        const cx = w / 2;
        const cy = h / 2;
        const lv = Math.max(0.02, v);

        c.save();
        c.globalCompositeOperation = 'lighter';

        // WHY the central bead squashes horizontally as level rises:
        // A mercury bead under pressure stretches along the axis of force.
        // At silence it is a circle; at peak it is flattened into an oblate
        // sphere (ellipse) before the thread snaps and feeds the satellite beads.
        // In 74 px we render this as an ellipse whose x-radius grows with v.
        const coreRx = 4 + lv * lv * 18;   // up to ~22 px horizontal radius
        const coreRy = Math.max(2, 8 - lv * 5);  // squashes vertically
        const coreAlpha = 0.6 + lv * 0.3;

        // Central bead fill
        const grd = c.createLinearGradient(cx - coreRx, cy, cx + coreRx, cy);
        grd.addColorStop(0, col(0.3, coreAlpha * 0.3));
        grd.addColorStop(0.5, col(1, coreAlpha));
        grd.addColorStop(1, col(0.3, coreAlpha * 0.3));
        c.fillStyle = grd;
        c.beginPath();
        c.ellipse(cx, cy, coreRx, coreRy, 0, 0, Math.PI * 2);
        c.fill();

        // Hot specular highlight on bead (liquid metal reads flat without it)
        if (lv > 0.05) {
          c.fillStyle = `rgba(255,255,255,${Math.min(0.5, lv * 0.5)})`;
          c.beginPath();
          c.ellipse(cx - coreRx * 0.2, cy - coreRy * 0.25,
                    coreRx * 0.22, coreRy * 0.28, -0.3, 0, Math.PI * 2);
          c.fill();
        }

        // WHY the thread is a hairline connecting core to outermost active bead:
        // The Plateau–Rayleigh thread is thin (surface tension holds it) and
        // only exists where beads have pinched off. We draw it as a 1 px line
        // whose opacity scales with v — it appears as level rises then fades as
        // beads spread further apart and the thread breaks.
        const outermost = bXfrac[Math.round((lv - 0.15) / 0.7 * (NBEADS - 1))] || 0;
        const threadEnd = cx + outermost * (w / 2 - 10) * lv;
        if (lv > 0.18) {
          const ta = Math.min(0.4, (lv - 0.15) * 1.2);
          c.strokeStyle = col(0.7, ta);
          c.lineWidth = 0.8;
          c.beginPath();
          c.moveTo(cx + coreRx, cy);
          c.lineTo(threadEnd, cy);
          c.stroke();
          c.beginPath();
          c.moveTo(cx - coreRx, cy);
          c.lineTo(w - threadEnd, cy);
          c.stroke();
        }

        // Satellite beads — symmetric left/right
        for (let i = 0; i < NBEADS; i++) {
          if (lv < bThresh[i]) continue;

          // WHY bead x uses the full half-width scaled by v:
          // At low v beads cluster near centre; at high v they travel toward
          // the strip ends. bXfrac[i] distributes them along that range.
          const bx = bXfrac[i] * (w / 2 - 8) * Math.pow(lv, 0.6);
          const br = bSize[i] * (0.4 + lv * 0.6);
          // Tiny oscillation — mercury beads wobble as they slide
          const wobble = Math.sin(t * 4 + i * 1.2) * 0.8 * lv;
          const alpha = 0.35 + (lv - bThresh[i]) * 0.8;

          c.fillStyle = col(0.7 + (1 - bXfrac[i]) * 0.3, Math.min(0.95, alpha));
          // Right bead
          c.beginPath();
          c.ellipse(cx + bx, cy + wobble, br, Math.max(1, br * 0.7), 0, 0, Math.PI * 2);
          c.fill();
          // Left bead (mirrored)
          c.beginPath();
          c.ellipse(cx - bx, cy - wobble, br, Math.max(1, br * 0.7), 0, 0, Math.PI * 2);
          c.fill();

          // Specular on each satellite
          if (br > 2.5 && lv > 0.3) {
            c.fillStyle = `rgba(255,255,255,${Math.min(0.4, lv * 0.35)})`;
            c.beginPath();
            c.arc(cx + bx - br * 0.2, cy + wobble - br * 0.2, br * 0.25, 0, Math.PI * 2);
            c.fill();
            c.beginPath();
            c.arc(cx - bx - br * 0.2, cy - wobble - br * 0.2, br * 0.25, 0, Math.PI * 2);
            c.fill();
          }
        }

        c.globalCompositeOperation = 'source-over';
        c.restore();
      };
    })()
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'dust-motes',
    name: 'C5',
    title: 'Dust Motes',
    blurb: 'Suspended motes drift in a column of light at the centre; each syllable disturbs them outward, the cloud thinning with distance.',

    draw: (() => {
      // WHY 80 motes in a fixed pool:
      // A visible shaft of light might contain thousands of particles, but
      // in 74 px we need each mote large enough to see (~2 px) so ≤ 100 is
      // readable without becoming a solid fill. 80 fills the shaft convincingly.
      // Positions are stored as normalised [0,1] and mapped to canvas each frame
      // so the design works at any w without changing the pool.
      const N     = 80;
      const mx    = new Float32Array(N);   // x in [0,1]
      const my    = new Float32Array(N);   // y in [0,1]
      const mvx   = new Float32Array(N);  // x velocity in canvas-normalised units/s
      const mvy   = new Float32Array(N);  // y velocity
      const msize = new Float32Array(N);  // base radius [0.6..1.8]
      let lastT = -1;
      // Initialise motes clustered in the central shaft (x ∈ [0.3,0.7])
      for (let i = 0; i < N; i++) {
        const seed = (i * 0.6180339) % 1;
        mx[i]    = 0.35 + seed * 0.30;        // start in shaft
        my[i]    = (i / N);                    // spread vertically across strip
        mvx[i]   = 0;
        mvy[i]   = (seed - 0.5) * 0.005;      // gentle float up/down
        msize[i] = 0.6 + seed * 1.2;
      }

      return function draw(c, w, h, v, t, hist) {
        const cx = w / 2;
        const lv = Math.max(0, v);
        const dt = lastT < 0 ? 0.016 : Math.min(t - lastT, 0.1);
        lastT = t;

        c.save();

        // WHY the light shaft is drawn first, behind the motes:
        // A real light beam is visible because it illuminates the particles
        // within it. We render the beam as a tall, narrow gradient ellipse
        // centred at x=cx with soft edges — the motes are then drawn inside and
        // outside it. The shaft narrows slightly at silence (fewer motes lit)
        // and broadens at loud as disturbed motes carry light with them.
        const shaftW = 38 + lv * 22;
        const shaftGrd = c.createLinearGradient(cx - shaftW, 0, cx + shaftW, 0);
        shaftGrd.addColorStop(0,   col(0.2, 0));
        shaftGrd.addColorStop(0.3, col(0.5, 0.06 + lv * 0.07));
        shaftGrd.addColorStop(0.5, col(0.8, 0.10 + lv * 0.10));
        shaftGrd.addColorStop(0.7, col(0.5, 0.06 + lv * 0.07));
        shaftGrd.addColorStop(1,   col(0.2, 0));
        c.fillStyle = shaftGrd;
        c.fillRect(cx - shaftW, 0, shaftW * 2, h);

        c.globalCompositeOperation = 'lighter';

        // WHY outward impulse grows with v:
        // When sound hits a shaft of light the air pressure pushes motes
        // outward from the disturbance source (centre). We apply a lateral
        // acceleration proportional to v * displacement from centre each frame.
        // Motes eventually drift back toward centre (soft restoring force) so
        // at silence they re-cluster in the shaft over ~2 seconds.
        const impulse   = lv * lv * 0.6;   // outward push strength
        const restore   = 0.12;            // gentle return force
        const damping   = 0.92;            // velocity decay per frame

        for (let i = 0; i < N; i++) {
          const dx = mx[i] - 0.5;  // signed distance from centre (normalised)

          // Outward impulse: push away from centre proportional to v
          mvx[i] += Math.sign(dx) * impulse * dt;
          // Restoring force: mild pull back toward shaft
          mvx[i] -= dx * restore * dt;
          mvx[i] *= damping;
          mvy[i] += (((i * 3.7) % 1 - 0.5) * 0.003) * Math.sin(t * 0.4 + i);
          mvy[i] *= 0.98;

          mx[i] += mvx[i] * dt;
          my[i] += mvy[i] * dt;

          // Wrap y so motes that drift off top/bottom reappear on the other side
          if (my[i] < 0) my[i] += 1;
          if (my[i] > 1) my[i] -= 1;
          // Clamp x to strip — motes should not escape the canvas
          mx[i] = Math.max(0.01, Math.min(0.99, mx[i]));

          const sx = mx[i] * w;
          const sy = my[i] * h;

          // WHY brightness depends on proximity to shaft centreline:
          // Motes in the beam are illuminated; motes outside it are in shadow.
          // We measure normalised distance from cx and multiply alpha.
          const distFromCentre = Math.abs(mx[i] - 0.5) * 2;  // 0..1
          const inShaft = Math.max(0, 1 - distFromCentre * 2.2);
          const brightness = 0.4 + inShaft * 0.5 + lv * 0.1;
          const alpha = (0.08 + inShaft * 0.5 + lv * 0.25) * (0.5 + Math.random() * 0.5);

          c.fillStyle = col(brightness, Math.min(0.9, alpha));
          c.beginPath();
          c.arc(sx, sy, msize[i], 0, Math.PI * 2);
          c.fill();
        }

        c.globalCompositeOperation = 'source-over';
        c.restore();
      };
    })()
  },

];
