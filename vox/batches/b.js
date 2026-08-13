const BATCH = [

  {
    id: 'ticker',
    name: 'B1',
    title: 'Calibrated Scale',
    blurb: 'A precision ruler radiates from the centre: fine tick marks at three scales light up progressively as level pushes further outward, like a backlit micrometer.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // A real calibrated instrument (micrometer, Vernier gauge) has tick marks at
      // three hierarchical densities: coarse (labelled), medium, and fine. The marks
      // nearest the centre are the quietest and always visible — that satisfies the
      // "silence must not look broken" rule. Marks further out only illuminate when
      // level is high enough to reach them. The lighting rule is purely positional:
      // a tick at fractional position u lights up when v > u, with a small soft
      // transition zone so the illumination front feels physical rather than binary.
      // Left/right symmetry is trivial: we loop once and draw at cx±offset.

      const cx = w / 2;
      // Baseline (horizontal spine): sits at cy because the strip is very short.
      // Ticks project upward (above cy) by default, with a fine mirror below.
      const cy = h / 2;

      // Eased level — tiny floor so the centremost ticks always glow at silence.
      const lv = 0.04 + v * 0.96;

      // ── Spine hairline ──────────────────────────────────────────────────────
      // Always present; dim at silence, bright at peak. Spans full width.
      c.save();
      c.lineWidth = 0.8;
      c.strokeStyle = col(lv * 0.6, 0.35 + lv * 0.3);
      c.beginPath();
      c.moveTo(0, cy);
      c.lineTo(w, cy);
      c.stroke();

      // ── Tick marks ─────────────────────────────────────────────────────────
      // Three tiers (coarse / medium / fine) placed at uniform fractions of cx.
      // We measure position as u = offset / cx ∈ [0,1], where 1 = the edge.
      // A tick at position u lights up when lv > u (with soft shoulder ~0.04).

      // coarse: every 1/10 of cx, 12 px tall (full, above+below), 1 px wide
      // medium: every 1/20, 7 px tall, 0.8 px wide
      // fine:   every 1/40, 4 px tall, 0.7 px wide
      const tiers = [
        { step: 1/10,  hUp: 14, hDn: 5,  lw: 1.0,  alphaBase: 0.9 },
        { step: 1/20,  hUp: 8,  hDn: 3,  lw: 0.8,  alphaBase: 0.7 },
        { step: 1/40,  hUp: 4,  hDn: 2,  lw: 0.65, alphaBase: 0.5 },
      ];

      // Transition softness — how many level-units the light-up ramp spans.
      const SOFT = 0.05;

      for (const tier of tiers) {
        const count = Math.round(1 / tier.step);   // ticks per half-strip
        for (let i = 1; i <= count; i++) {
          const u = i * tier.step;                  // 0..1 fractional position
          const offset = u * cx;                    // px from centre

          // Brightness: 0 when lv << u, 1 when lv >> u, smooth ramp in between.
          const lit = Math.max(0, Math.min(1, (lv - u + SOFT) / SOFT));
          if (lit < 0.01) continue;

          const alpha = tier.alphaBase * lit;
          c.lineWidth = tier.lw;
          c.strokeStyle = col(lv * lit, alpha);

          // Draw tick at cx+offset and cx-offset (symmetric)
          for (const sign of [-1, 1]) {
            const x = cx + sign * offset;
            c.beginPath();
            c.moveTo(x, cy - tier.hUp);
            c.lineTo(x, cy + tier.hDn);
            c.stroke();
          }
        }
      }

      // ── Hot centre node ─────────────────────────────────────────────────────
      // Small bright vertical bar at x=cx marking the instrument's origin.
      // Uses white core (contract allows white as hot core at peak).
      if (lv > 0.05) {
        const coreH = 16 + lv * 10;
        c.lineWidth = 1.2;
        c.strokeStyle = col(lv, 0.95);
        c.beginPath();
        c.moveTo(cx, cy - coreH / 2);
        c.lineTo(cx, cy + coreH / 2);
        c.stroke();

        if (v > 0.6) {
          // White hot core at true peak
          c.lineWidth = 0.8;
          c.strokeStyle = `rgba(255,255,255,${(v - 0.6) / 0.4 * 0.45})`;
          c.beginPath();
          c.moveTo(cx, cy - 8);
          c.lineTo(cx, cy + 8);
          c.stroke();
        }
      }

      c.restore();
      // globalCompositeOperation was never changed from source-over — safe.
    }
  },

  {
    id: 'hudsweep',
    name: 'B2',
    title: 'Radar Arc',
    blurb: 'Concentric arcs expand outward from the centre like a HUD range-finder, with faint graticule lines behind; the leading bright arc and filled zone track level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // A radar/rangefinder HUD shows concentric range rings. In a 74 px strip the
      // rings cannot be full circles — they are clipped to the strip height, so they
      // appear as shallow elliptic arcs (flattened horizontally to fill the width).
      // The strip is treated as a cross-section: x is range, y is the tiny vertical
      // slice. At silence a faint graticule grid is always visible. As level rises,
      // the "illuminated zone" expands outward from cx and the leading arc brightens.
      // The arcs are drawn as horizontal ellipses so they span the full width yet fit
      // in 74 px height — that is the only shape that works in this geometry.

      const cx = w / 2;
      const cy = h / 2;
      const lv = 0.05 + v * 0.95;

      c.save();

      // ── Graticule: horizontal scan lines ───────────────────────────────────
      // Fine horizontal lines at fixed y positions — the "reticle" behind the arcs.
      // Always present; very dim at silence.
      const graticuleAlpha = 0.08 + lv * 0.06;
      c.lineWidth = 0.5;
      for (let row = 0; row <= 6; row++) {
        const y = (row / 6) * h;
        c.strokeStyle = col(0.3, graticuleAlpha);
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(w, y);
        c.stroke();
      }

      // ── Range rings (concentric arcs) ───────────────────────────────────────
      // We draw NUM_RINGS concentric ellipses. The k-th ring has:
      //   rx = k/NUM_RINGS * cx   (horizontal radius, grows with index)
      //   ry = fixed small value  (vertical radius, fits in strip)
      // A ring "illuminates" when lv > k/NUM_RINGS (same logic as ticker).
      const NUM_RINGS = 12;
      const RY = h * 0.38;   // vertical semi-axis: nearly fills the strip height

      const SOFT = 0.07;
      for (let k = 1; k <= NUM_RINGS; k++) {
        const u = k / NUM_RINGS;
        const rx = u * cx;                          // horizontal semi-axis
        const lit = Math.max(0, Math.min(1, (lv - u + SOFT) / SOFT));
        if (lit < 0.005) continue;

        const isLeading = (k === Math.floor(lv * NUM_RINGS) + 1);
        const lineAlpha = isLeading ? 0.9 * lit : 0.25 * lit;
        const lineWidth = isLeading ? 1.2 : 0.7;

        c.lineWidth = lineWidth;
        c.strokeStyle = col(lv * (isLeading ? 1 : 0.5), lineAlpha);

        // Draw arc at cx (and mirrored: since an ellipse centred at cx is already
        // symmetric left/right, one ellipse covers both sides).
        c.beginPath();
        c.ellipse(cx, cy, rx, RY, 0, 0, Math.PI * 2);
        c.stroke();
      }

      // ── Illuminated zone fill ──────────────────────────────────��────────────
      // A very faint filled ellipse up to the current leading arc — gives the
      // impression of a "swept" radar zone without clobbering the graticule.
      if (lv > 0.06) {
        const fillRx = Math.min(lv, 1) * cx * 0.96;
        c.globalCompositeOperation = 'lighter';
        c.beginPath();
        c.ellipse(cx, cy, fillRx, RY, 0, 0, Math.PI * 2);
        // Radial fill from transparent centre to dim edge
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, fillRx);
        grad.addColorStop(0, col(lv, 0));
        grad.addColorStop(0.7, col(lv, 0));
        grad.addColorStop(1, col(lv, 0.07 * lv));
        c.fillStyle = grad;
        c.fill();
        c.globalCompositeOperation = 'source-over';
      }

      // ── Centre cross-hair ───────────────────────────────────────────────────
      // A small crosshair at origin — instrument provenance.
      const chSize = 5;
      c.lineWidth = 0.7;
      c.strokeStyle = col(lv, 0.7);
      c.beginPath();
      c.moveTo(cx - chSize, cy); c.lineTo(cx + chSize, cy);
      c.moveTo(cx, cy - chSize); c.lineTo(cx, cy + chSize);
      c.stroke();

      c.restore();
    }
  },

  {
    id: 'microbars',
    name: 'B3',
    title: 'Micro Spectrum',
    blurb: 'Around 200 hairline bars, 2 px wide, mirrored from the centre — a spectrum analyser at instrument density, each bar driven by the history buffer.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // A professional spectrum analyser shows many very narrow bars. The contract
      // asks for ~200 at 2 px each. We take the 200 most recent hist samples and
      // map sample index directly to horizontal distance from centre: hist[0] (newest)
      // lives nearest the centre, hist[199] lives at the outermost bar. Each bar's
      // height = hist[i] × h × envelope(u), where u is the fractional position.
      // Bars are mirrored: the left half is the mirror of the right half, enforcing
      // the centre-origin contract. A 2 px bar with a 0 px gap means bars are
      // contiguous, giving the appearance of a continuous spectral ribbon with fine
      // vertical structure rather than chunky blocks.

      const cx = w / 2;
      const BAR_W = 2;                 // exactly 2 px per bar as specified
      const N = Math.min(200, Math.floor(cx / BAR_W));  // bars per side
      const lv = 0.04 + v * 0.96;

      c.save();

      // ── Bars ────────────────────────────────────────────────────────────────
      for (let i = 0; i < N; i++) {
        const u = i / N;                             // 0 at centre, 1 at edge
        const x = i * BAR_W;                         // offset from centre (pixels)

        // hist[i] = recent signal; older samples get the envelope falloff
        // Envelope ensures outer bars still do something even for quiet signals
        const sample = hist[i] !== undefined ? hist[i] : 0;
        // Minimum bar height fraction: keeps a dim base bar visible at silence
        const minH = 0.03 + (1 - u) * 0.04;
        const barFrac = Math.max(minH, sample * (0.85 - u * 0.25));
        const barH = barFrac * h;

        // Brightness falls off toward edges — outer bars are "more distant"
        const brightness = lv * (0.5 + 0.5 * (1 - u));
        const alpha = 0.55 + (1 - u) * 0.35;

        c.fillStyle = col(brightness, alpha);

        // Centred vertical bar: drawn from the bottom up (barH from cy±)
        // We centre each bar vertically for a more balanced instrument look.
        const barTop = (h - barH) / 2;

        // Right side
        c.fillRect(cx + x, barTop, BAR_W - 0.5, barH);
        // Left side (mirror)
        c.fillRect(cx - x - BAR_W, barTop, BAR_W - 0.5, barH);
      }

      // ── Peak dot at outermost active bar ───────────────────────────────────
      // A single bright pixel at the furthest illuminated column — the "peak
      // hold" indicator common to real spectrum analysers.
      if (v > 0.05) {
        const peakIdx = Math.floor(lv * (N - 1));
        const peakX = peakIdx * BAR_W;
        const peakH = Math.max(0.15, hist[peakIdx] || lv) * h;
        const peakTop = (h - peakH) / 2;

        c.globalCompositeOperation = 'lighter';
        c.fillStyle = col(1, 0.8);
        c.fillRect(cx + peakX, peakTop, 1.5, 1.5);
        c.fillRect(cx - peakX - 1.5, peakTop, 1.5, 1.5);
        c.globalCompositeOperation = 'source-over';
      }

      c.restore();
    }
  },

  {
    id: 'pressurewire',
    name: 'B4',
    title: 'Pressure Grid',
    blurb: 'A flat wireframe of horizontal hairlines deforms as a pressure wave passes outward from the centre — the wave amplitude and reach track level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // A physical wave on a taut string deforms the string perpendicular to the
      // direction of propagation. Here the "strings" are horizontal hairlines at
      // several y-positions, and the pressure source is at x=cx. At any x, the
      // deformation is: dy = A(u) × sin(phase(x,t)) × envelope(u), where u = |x-cx|/cx.
      // The amplitude A grows with level. At silence the lines are flat (a neat
      // instrument grid at rest). As level rises, the wave bends the lines more
      // dramatically. The wave front travels outward: lines near the edge lead,
      // lines at centre are at the source (always zero deformation at cx itself).
      // Using sinusoidal phase-shifted by distance from centre makes the wave look
      // physically propagating rather than frozen or pumping in place.

      const cx = w / 2;
      const cy = h / 2;
      const lv = 0.05 + v * 0.95;

      c.save();

      // ── Wire lines ──────────────────────────────────────────────────────────
      // We draw NUM_LINES horizontal hairlines at evenly-spaced y positions.
      // Each line is subdivided into STEPS segments; each segment end point is
      // displaced vertically by the wave function.
      const NUM_LINES = 7;
      const STEPS = 180;                // sub-divisions per line (smooth curve)

      // Wave parameters:
      //   amplitude   = level-driven, capped so the wave stays in the strip
      //   frequency   = spatial frequency of the wave (cycles across cx)
      //   phase speed = how fast the wavefront moves outward over time
      const amp = lv * h * 0.28;       // max deformation height
      const freq = 2.8;                 // spatial cycles across the half-strip
      const phaseSpeed = 3.5;          // radians/second outward travel

      for (let row = 0; row < NUM_LINES; row++) {
        const y0 = (row / (NUM_LINES - 1)) * h;   // base y for this wire

        // Lines close to the centre row are brighter (the "hot" wires)
        const distFromMid = Math.abs(y0 - cy) / cy;
        const wireAlpha = 0.3 + (1 - distFromMid) * 0.5 * lv + 0.12;
        const wireWidth = 0.6 + (1 - distFromMid) * 0.4;

        c.lineWidth = wireWidth;
        c.strokeStyle = col(lv * (0.5 + (1 - distFromMid) * 0.5), wireAlpha);
        c.beginPath();

        for (let s = 0; s <= STEPS; s++) {
          const x = (s / STEPS) * w;
          const u = Math.abs(x - cx) / cx;   // 0 at centre, 1 at edge

          // Wave displacement: zero exactly at cx, grows outward, then the
          // envelope (env-like shape) tucks it back near the very edge.
          // This prevents the lines from leaving the strip entirely.
          // The sine argument encodes distance from origin (spatial) plus time
          // (temporal phase shift) to make the wave appear to travel outward.
          const envFactor = Math.sin(u * Math.PI) * (1 - u * 0.3);
          const phase = u * freq * Math.PI * 2 - t * phaseSpeed;
          const dy = amp * envFactor * Math.sin(phase) * lv;

          const y = y0 + dy;
          if (s === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.stroke();
      }

      // ── Vertical origin marker ──────────────────────────────────────────────
      // A faint vertical line at cx — the "source" of the pressure, always still.
      c.lineWidth = 0.7;
      c.strokeStyle = col(lv, 0.35);
      c.setLineDash([2, 4]);
      c.beginPath();
      c.moveTo(cx, 0);
      c.lineTo(cx, h);
      c.stroke();
      c.setLineDash([]);

      // ── Source pulse flash ──────────────────────────────────────────────────
      // At high levels a bright small node pulses at cx to mark the source.
      if (v > 0.35) {
        const pulse = (v - 0.35) / 0.65;
        c.globalCompositeOperation = 'lighter';
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, 12 * pulse);
        grad.addColorStop(0, col(1, 0.55 * pulse));
        grad.addColorStop(1, col(1, 0));
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, 14 * pulse, 0, Math.PI * 2);
        c.fill();
        c.globalCompositeOperation = 'source-over';
      }

      c.restore();
    }
  },

  {
    id: 'vernier',
    name: 'B5',
    title: 'Vernier Jaw',
    blurb: 'Two caliper jaws open symmetrically from the centre as level rises; Vernier-scale teeth interleave at the interface, giving the readout a precision-instrument geometry.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // A Vernier caliper has two parallel combs of fine teeth where the spacing
      // between one comb and the other encodes a fractional measurement. Here the
      // "main scale" teeth are fixed (their x-positions don't move), while the
      // "Vernier scale" teeth ride on the jaw that opens with level. The jaw
      // opening = lv × cx. At silence the jaws are almost closed and you see just
      // the two combs nearly touching at centre. As level rises the jaws open
      // wider, revealing more scale teeth as they pass the fixed reference line.
      // The geometry is entirely made of thin vertical lines — correct for a
      // precision-instrument aesthetic and trivially symmetric.

      const cx = w / 2;
      const cy = h / 2;
      const lv = 0.04 + v * 0.96;

      // Jaw opening: how far each jaw has moved from centre (in pixels).
      // At silence = 0, at peak = cx * 0.85 (leaves a small margin).
      const JAW_MAX = cx * 0.85;
      const jawOpen = lv * JAW_MAX;

      c.save();

      // ── Fixed main scale ────────────────────────────────────────────────────
      // 40 teeth per side, evenly spaced, extend from the jaw face to the strip edge.
      // These represent the fixed jaw — they do not move.
      const MAIN_TEETH = 40;
      const mainSpacing = JAW_MAX / MAIN_TEETH;
      // Heights: major tooth every 5, minor every 1
      for (let i = 0; i <= MAIN_TEETH; i++) {
        const offset = i * mainSpacing;   // distance from edge inward
        // Fixed scale reads from the outer edge inward — teeth start at strip edge.
        // A tooth at offset `offset` from the outer edge is at x = (cx ± (JAW_MAX - offset)).
        // But to keep it simple: fixed teeth at positions measured from edges.
        const xR = cx + (JAW_MAX - offset);  // right side: starts near edge, moves inward
        const xL = cx - (JAW_MAX - offset);  // mirrored

        const isMajor = (i % 5 === 0);
        const toothH = isMajor ? 14 : 7;
        const alpha = 0.2 + (1 - offset / JAW_MAX) * 0.25;  // dimmer toward centre
        c.lineWidth = isMajor ? 0.9 : 0.6;
        c.strokeStyle = col(0.4, alpha);

        // Each tooth: from cy-toothH/2 upward only (upper jaw convention)
        const toothTop = cy - toothH;
        for (const x of [xR, xL]) {
          c.beginPath();
          c.moveTo(x, toothTop);
          c.lineTo(x, cy);
          c.stroke();
        }
      }

      // ── Moving Vernier scale (rides on the jaw) ─────────────────────────────
      // 39 teeth per side (one fewer than main → that IS the Vernier principle).
      // Their zero-position is at cx; they ride outward by jawOpen.
      const VERNIER_TEETH = 39;
      // Vernier spacing is slightly different from main: 40 main gaps = 39 Vernier gaps.
      const vernierSpacing = (mainSpacing * MAIN_TEETH) / VERNIER_TEETH;

      for (let i = 0; i <= VERNIER_TEETH; i++) {
        const localOffset = i * vernierSpacing;        // local position along Vernier scale
        // In instrument coordinates, Vernier teeth sit just outside jawOpen.
        const xR = cx + jawOpen + localOffset;
        const xL = cx - jawOpen - localOffset;

        // Only draw if inside the visible half (don't go past cx for the gap).
        if (xR > w || xL < 0) continue;

        const isMajor = (i % 5 === 0);
        const toothH = isMajor ? 12 : 6;
        const lit = Math.min(1, lv * 1.2);
        const alpha = lit * (isMajor ? 0.85 : 0.5);
        c.lineWidth = isMajor ? 1.0 : 0.65;
        c.strokeStyle = col(lit, alpha);

        // Vernier teeth hang below the centre line (lower jaw convention).
        const toothBot = cy + toothH;
        for (const x of [xR, xL]) {
          if (x < 0 || x > w) continue;
          c.beginPath();
          c.moveTo(x, cy);
          c.lineTo(x, toothBot);
          c.stroke();
        }
      }

      // ── Jaw faces ───────────────────────────────────────────────────────────
      // A horizontal bar at cy showing the two jaw edges — the "measurement gap".
      // Left jaw face: from 0 to cx-jawOpen. Right jaw face: from cx+jawOpen to w.
      const jawAlpha = 0.5 + lv * 0.35;
      c.lineWidth = 1.2;
      c.strokeStyle = col(lv, jawAlpha);
      c.beginPath();
      c.moveTo(0, cy);
      c.lineTo(cx - jawOpen, cy);
      c.stroke();
      c.beginPath();
      c.moveTo(cx + jawOpen, cy);
      c.lineTo(w, cy);
      c.stroke();

      // ── Gap indicator ───────────────────────────────────────────────────────
      // The open gap between the jaws — two small facing arrows or vertical bars.
      // Simple: two vertical bright bars at each jaw face.
      if (jawOpen > 2) {
        c.lineWidth = 1.5;
        c.strokeStyle = col(lv, 0.9);
        const faceBarH = 18;
        for (const xFace of [cx - jawOpen, cx + jawOpen]) {
          c.beginPath();
          c.moveTo(xFace, cy - faceBarH / 2);
          c.lineTo(xFace, cy + faceBarH / 2);
          c.stroke();
        }

        // At high levels: white hot core on the face bars
        if (v > 0.5) {
          const wa = (v - 0.5) / 0.5 * 0.4;
          c.lineWidth = 0.8;
          c.strokeStyle = `rgba(255,255,255,${wa})`;
          for (const xFace of [cx - jawOpen, cx + jawOpen]) {
            c.beginPath();
            c.moveTo(xFace, cy - 5);
            c.lineTo(xFace, cy + 5);
            c.stroke();
          }
        }
      }

      // ── Zero mark ───────────────────────────────────────────────────────────
      // A dim tick at exact centre — the datum, always present.
      c.lineWidth = 0.7;
      c.strokeStyle = col(0.35, 0.3);
      c.beginPath();
      c.moveTo(cx, cy - 10);
      c.lineTo(cx, cy + 10);
      c.stroke();

      c.restore();
      // No globalCompositeOperation change left over; restore() is safe.
    }
  },

];
