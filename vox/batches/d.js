const BATCH = [

  // ─── D1 · SPECTROGRAM ────────────────────────────────────────────────────
  // WHY this geometry:
  // A real spectrogram maps time on one axis and frequency on the other, with
  // intensity as brightness.  Here time = horizontal distance from centre (hist
  // index doubles as age AND x-position as the contract says).  Frequency is
  // mapped vertically across the 74 px strip — low bins near the centre of the
  // strip, high bins at top and bottom.  The newest column of "spectrum" paints
  // at x = w/2 and older columns paint further out toward the edges, so motion
  // propagates outward naturally.  Each pixel column is a tiny slice of a FFT
  // surrogate: we synthesise pseudo-spectrum from `v` and `t` rather than doing
  // real FFT (no audio buffer available), but the visual read is unambiguous —
  // bright bands cluster where energy is, dark gaps are silence.  At v = 0 a
  // faint residual pattern shows the "noise floor", which is the correct
  // resting state for a spectrogram.
  (() => {
    // Pre-allocate frequency-band descriptors once (closure, not per-frame).
    // 18 bands spanning the strip height.  Each band has a centre frequency
    // ratio and a resonant peak that determines how much energy it shows.
    const BANDS = 18;
    const bands = Array.from({ length: BANDS }, (_, i) => {
      const norm = i / (BANDS - 1);          // 0 = lowest band, 1 = highest
      // Higher bands need more level to light up — mimics how voice energy
      // concentrates in low/mid frequencies.
      const threshold = 0.12 + norm * 0.55;
      // Slight random offset per band so they don't all pulse identically.
      const phase = norm * Math.PI * 3.7 + i * 0.31;
      return { norm, threshold, phase };
    });

    return {
      id: 'spectrogram',
      name: 'D1',
      title: 'Spectrogram Flow',
      blurb: 'A spectrogram growing outward from centre — frequency runs vertically, time runs left and right, intensity tracks level.',
      draw(c, w, h, v, t, hist) {
        // WHY additive here: the columns overlap at low opacity and the
        // additive blend makes the brightest (newest) column naturally dominant
        // without an explicit z-order.
        const cx = w / 2;
        const bandH = h / BANDS;

        c.save();
        c.globalCompositeOperation = 'lighter';

        // Each hist sample is one column of the spectrogram.
        // hist[0] = newest → paints at cx.  hist[i] → paints at cx ± i * colW.
        // colW is chosen so hist[~200] reaches the strip ends.
        const colW = cx / 200;   // 200 samples fill half-width to the edge

        for (let age = 0; age < Math.min(hist.length, 200); age++) {
          const sample = hist[age];                // level at this age
          const xOff = age * colW;                 // distance from centre

          for (let b = 0; b < BANDS; b++) {
            const { norm, threshold, phase } = bands[b];

            // Frequency energy: band responds to level above its threshold,
            // modulated by a slow oscillation to mimic formant wobble.
            const formant = 0.5 + 0.5 * Math.sin(t * (1.2 + norm * 2.4) + phase);
            const energy = Math.max(0, (sample - threshold) / (1 - threshold)) * formant;

            if (energy < 0.005) continue;   // skip dark cells — performance

            // Vertical position: bands run top to bottom, with the lowest
            // frequency band nearest the centre of the strip (cy) and the
            // highest at the top and bottom edges.  We mirror so the strip
            // reads symmetrically in y as well as x.
            const distFromMid = Math.abs(norm - 0.5) * 2;   // 0 at mid, 1 at edge
            const yTop = (h / 2) - (distFromMid * h / 2) - bandH / 2;
            const yH   = bandH * 0.85;

            const alpha = energy * (1 - age / 210);   // fade with age
            c.fillStyle = col(energy * 0.9 + 0.1, alpha);

            // Paint symmetric columns (left and right of centre).
            c.fillRect(cx + xOff, yTop, colW, yH);
            if (age > 0) c.fillRect(cx - xOff - colW, yTop, colW, yH);
          }
        }

        // Bright centre seam — the "scanner line" that marks the present moment.
        const seam = c.createLinearGradient(cx - 1, 0, cx + 1, 0);
        seam.addColorStop(0, col(v * 0.7 + 0.3, 0));
        seam.addColorStop(0.5, col(v * 0.7 + 0.3, 0.55 + v * 0.4));
        seam.addColorStop(1, col(v * 0.7 + 0.3, 0));
        c.fillStyle = seam;
        c.fillRect(cx - 1, 0, 2, h);

        c.globalCompositeOperation = 'source-over';
        c.restore();
      }
    };
  })(),

  // ─── D2 · DOUBLE HELIX ───────────────────────────────────────────────────
  // WHY this geometry:
  // DNA's double helix is the canonical data/signal metaphor — information
  // stored in intertwined strands.  The two strands are sinusoids 180° out of
  // phase with each other, so they cross exactly twice per wavelength.  They
  // sweep from the centre outward in both directions: the phase argument is
  // (x - cx) so both halves mirror correctly.  The amplitude of the sine
  // (vertical excursion of each strand) scales with `v`, so at silence the
  // helix is nearly flat (a hairline pair close together) and at peak the
  // strands sweep the full 74 px height.  The twist rate is fixed — a real
  // helix has a fixed pitch — but `t` advances the phase, giving the sense
  // of the helix slowly rotating about its axis.  The crossing points are
  // the most energy-dense moments and get a tiny hot flare there via additive
  // compositing, which reads as the bonds between strands.
  (() => {
    const STRAND_DOTS = 300;   // sample points per half (left + right mirrors)
    return {
      id: 'helix',
      name: 'D2',
      title: 'Double Helix',
      blurb: 'Two sinusoidal strands intertwine outward from centre — amplitude is level, slow rotation is time, crossings flare.',
      draw(c, w, h, v, t, hist) {
        const cx = w / 2;
        const cy = h / 2;

        // Amplitude: even at v=0 keep a floor so the helix is visible.
        const amp   = (0.08 + v * 0.92) * (h * 0.44);
        // Spatial frequency of the helix: one full twist per ~120 px.
        const freq  = (2 * Math.PI) / 120;
        // Slow rotation: t advances phase at ~0.4 rad/s.
        const rot   = t * 0.4;

        c.save();

        // Draw strands as polyline paths.  Two passes: dim background strand
        // first (source-over), then bright foreground strand, then crossings
        // via additive.
        const drawStrand = (phaseOffset, alpha, lw) => {
          c.beginPath();
          let first = true;
          for (let i = 0; i <= STRAND_DOTS; i++) {
            // x runs from centre outward in both directions.  We parameterise
            // 0..1 where 0 = centre, 1 = right edge; then mirror for left.
            const u = i / STRAND_DOTS;            // 0..1
            const xR = cx + u * cx;              // right half x
            const phase = u * cx * freq + rot + phaseOffset;
            const y = cy + Math.sin(phase) * amp;
            // Fade alpha toward edges using env-like falloff.
            const edgeFade = 1 - u * u * 0.3;

            // Right strand segment.
            if (first) { c.moveTo(xR, y); first = false; }
            else c.lineTo(xR, y);
          }
          // Left half — mirror phase sign so it's truly symmetric.
          for (let i = STRAND_DOTS; i >= 0; i--) {
            const u = i / STRAND_DOTS;
            const xL = cx - u * cx;
            const phase = u * cx * freq + rot + phaseOffset;
            const y = cy + Math.sin(phase) * amp;
            c.lineTo(xL, y);
          }
          c.strokeStyle = col(0.3 + v * 0.7, alpha);
          c.lineWidth = lw;
          c.stroke();
        };

        // Strand A (phase 0) — slightly brighter as the "sense" strand.
        drawStrand(0, 0.75, 1.5);
        // Strand B (phase π) — complementary strand.
        drawStrand(Math.PI, 0.55, 1.2);

        // Crossing points: where sin(phase) ≈ 0 for both strands simultaneously,
        // i.e. at integer half-wavelengths.  Mark them with a small hot node.
        c.globalCompositeOperation = 'lighter';
        const halfWave = Math.PI / freq;    // px between crossings
        const nCrossings = Math.ceil(cx / halfWave) + 1;
        for (let k = 0; k < nCrossings; k++) {
          const xOff = k * halfWave - (rot / freq % halfWave);
          // Both left and right crossings.
          for (const sign of [1, -1]) {
            const xc = cx + sign * (xOff % cx);
            if (xc < 0 || xc > w) continue;
            const r = 2 + v * 3;
            const grd = c.createRadialGradient(xc, cy, 0, xc, cy, r);
            grd.addColorStop(0, `rgba(255,255,255,${0.3 + v * 0.4})`);
            grd.addColorStop(1, col(v, 0));
            c.fillStyle = grd;
            c.beginPath();
            c.arc(xc, cy, r, 0, Math.PI * 2);
            c.fill();
          }
        }
        c.globalCompositeOperation = 'source-over';
        c.restore();
      }
    };
  })(),

  // ─── D3 · PHASE-SHIFTED MOIRÉ ────────────────────────────────────────────
  // WHY this geometry:
  // Two combs of hairlines with slightly different spatial frequencies produce
  // a moiré interference pattern.  The KEY is to make the *beat envelope*
  // (the slow bright/dark banding) the subject, not the individual lines.
  // We compute the envelope analytically: at distance d from centre the two
  // combs have accumulated (1/pA - 1/pB)*d full cycles of relative phase,
  // so the envelope is cos²(π·d·Δf + φ_drift).  Each line's alpha is scaled
  // by the local envelope value, so bands of lines light up and fade.
  // t drives φ_drift, making the bands slide outward from the centre.
  // v controls Δf (line-count contrast) and the drift speed — at v=0 the
  // two combs are nearly identical (Δf≈0), the beat wavelength is enormous,
  // and the whole field is calm and dim.  At v=1 the beat wavelength is ~60 px
  // and bands travel visibly outward.  Spacing is wide (≈20 px) so individual
  // lines are resolvable and negative space remains.
  {
    id: 'moire',
    name: 'D3',
    title: 'Phase Moiré',
    blurb: 'Two sparse grids interfere — the moiré beat bands travel outward from the centre at a speed set by level.',
    draw(c, w, h, v, t, hist) {
      const cx = w / 2;

      // Wide base period — enough space between lines for the eye to resolve
      // each one individually.  ~20 px gives ≈55 lines per side at w=1100.
      const pA = 20;
      // Level drives the frequency difference between the two combs.
      // At v=0: Δf ≈ 0.003/px → beat wavelength ≈ 330 px (calm, near uniform).
      // At v=1: Δf ≈ 0.030/px → beat wavelength ≈  33 px (tight, vivid bands).
      const deltaF = 0.003 + v * 0.027;   // cycles per pixel
      const pB = 1 / (1 / pA + deltaF);   // B slightly denser than A

      // The beat envelope at distance d from centre:
      //   phase = π * d * deltaF + drift
      // cos²(phase) → 0 at a dark band, 1 at a bright band.
      // Drift sweeps outward: NEGATIVE drift because d grows rightward, so
      // subtracting drift from the phase means the constant-phase surface moves
      // further from the centre as t grows → bands travel outward.
      const driftSpeed = 8 + v * 40;       // px-equivalent/s
      const drift = -t * driftSpeed * deltaF * Math.PI;

      // Base alpha of individual lines — intentionally restrained so that the
      // darkest band truly disappears and the brightest is still not garish.
      const baseAlpha = 0.08 + v * 0.30;

      c.save();
      c.globalCompositeOperation = 'lighter';
      c.lineWidth = 0.9;

      // Draw one comb of vertical hairlines, with alpha modulated by the moiré
      // envelope so that bright bands and dark gaps are clearly visible.
      const drawComb = (period, phaseOffset) => {
        let offset = phaseOffset % period;
        // Ensure we start from ≥0
        if (offset < 0) offset += period;

        while (offset <= cx + period) {
          // Envelope value at this distance from centre.
          const envVal = Math.cos(Math.PI * offset * deltaF + drift) ** 2;
          // Scale alpha by envelope — dark bands genuinely dark, bright vivid.
          const alpha = baseAlpha * envVal;
          if (alpha > 0.005) {
            c.strokeStyle = col(0.35 + v * 0.65, alpha);
            // Right side
            if (offset > 0) {
              c.beginPath();
              c.moveTo(cx + offset, 0);
              c.lineTo(cx + offset, h);
              c.stroke();
            }
            // Left mirror
            c.beginPath();
            c.moveTo(cx - offset, 0);
            c.lineTo(cx - offset, h);
            c.stroke();
          }
          offset += period;
        }
      };

      // Comb A — reference, no phase shift.
      drawComb(pA, 0);
      // Comb B — slightly denser, phase-shifted to track time, creating the
      // sliding beat.  The small constant (pA/4) separates the two combs'
      // starting positions so they don't collapse to one at silence.
      drawComb(pB, pA / 4);

      // Centre anchor — a soft vertical glow to pin the origin.
      c.globalCompositeOperation = 'source-over';
      const anchorAlpha = 0.10 + v * 0.20;
      const grd = c.createLinearGradient(cx - 8, 0, cx + 8, 0);
      grd.addColorStop(0,   col(0.5 + v * 0.5, 0));
      grd.addColorStop(0.5, col(0.5 + v * 0.5, anchorAlpha));
      grd.addColorStop(1,   col(0.5 + v * 0.5, 0));
      c.fillStyle = grd;
      c.fillRect(cx - 8, 0, 16, h);

      c.restore();
    }
  },

  // ─── D4 · OSCILLOSCOPE WITH PERSISTENCE ──────────────────────────────────
  // WHY this geometry:
  // An analog oscilloscope's phosphor screen has persistence: the beam's
  // current position is brightly lit, and the trace decays exponentially as
  // it ages.  Here `hist[0]` (newest) becomes the centre of the strip and
  // `hist[i]` maps to x = cx ± i*(cx/200) — sweeping outward symmetrically.
  // The y position of each sample is cy ± hist[i]*amp (a standard time-domain
  // trace).  We render the trace with two overlapping passes: a wide, very dim
  // "afterglow" (the phosphor tail) and a 1 px sharp bright line (the beam
  // head).  The tail fades using a linear alpha falloff with age.  At v = 0
  // the trace is a flat dim line — the classic oscilloscope "no signal" state,
  // which is the correct quiet resting look.  The additive blend on the bright
  // head makes it punch through the tail naturally.
  {
    id: 'phosphor',
    name: 'D4',
    title: 'Phosphor Trace',
    blurb: 'An oscilloscope trace sweeping outward from centre — bright beam head, decaying phosphor tail, amplitude is level.',
    draw(c, w, h, v, t, hist) {
      const cx   = w / 2;
      const cy   = h / 2;
      // Amplitude: hist values are already 0..1; scale to use most of h.
      const amp  = h * 0.42;
      // Number of samples to show — fills to the strip edges.
      const N    = Math.min(hist.length, 200);
      // Pixel step per sample: N samples must reach cx.
      const step = cx / N;

      c.save();

      // ── Pass 1: phosphor afterglow (source-over, wide, dim) ──
      // Draw the tail as a series of short line segments, with alpha decaying
      // with age.  The wide stroke is the glowing phosphor haze.
      c.lineWidth = 3.5;
      c.lineCap   = 'round';
      c.lineJoin  = 'round';

      for (let i = 1; i < N; i++) {
        const age0 = (i - 1) / N;   // relative age 0..1
        const age1 = i / N;
        // Phosphor alpha decays as ~(1-age)^2 — bright near head, dark at tail.
        const alpha = Math.pow(1 - age1, 2.2) * 0.28 * (0.2 + v * 0.8);

        if (alpha < 0.008) break;

        const y0  = cy - hist[i - 1] * amp;
        const y1  = cy - hist[i] * amp;
        const xR0 = cx + (i - 1) * step;
        const xR1 = cx + i * step;
        const xL0 = cx - (i - 1) * step;
        const xL1 = cx - i * step;

        c.strokeStyle = col(0.5 + hist[i] * 0.5, alpha);
        // Right segment.
        c.beginPath();
        c.moveTo(xR0, y0);
        c.lineTo(xR1, y1);
        c.stroke();
        // Left segment (mirror x, same y — the trace is symmetric about cx).
        c.beginPath();
        c.moveTo(xL0, y0);
        c.lineTo(xL1, y1);
        c.stroke();
      }

      // ── Pass 2: sharp beam trace (additive, 1 px) ──
      // This is the actual electron beam — always 1 px, full brightness.
      c.globalCompositeOperation = 'lighter';
      c.lineWidth  = 1;
      c.strokeStyle = col(0.6 + v * 0.4, 0.85);

      c.beginPath();
      let firstRight = true;
      for (let i = 0; i < N; i++) {
        const x = cx + i * step;
        const y = cy - hist[i] * amp;
        if (firstRight) { c.moveTo(x, y); firstRight = false; }
        else c.lineTo(x, y);
      }
      c.stroke();

      // Left mirror of the beam trace.
      c.beginPath();
      let firstLeft = true;
      for (let i = 0; i < N; i++) {
        const x = cx - i * step;
        const y = cy - hist[i] * amp;
        if (firstLeft) { c.moveTo(x, y); firstLeft = false; }
        else c.lineTo(x, y);
      }
      c.stroke();

      // ── Pass 3: hot beam head at centre ──
      // The very newest point (hist[0]) at cx is the brightest point of the
      // beam — the CRT electron gun at the present moment.
      const headY = cy - hist[0] * amp;
      const headR = 2.5 + v * 3;
      const hgrd  = c.createRadialGradient(cx, headY, 0, cx, headY, headR);
      hgrd.addColorStop(0, `rgba(255,255,255,${0.4 + v * 0.45})`);
      hgrd.addColorStop(0.4, col(0.8 + v * 0.2, 0.6));
      hgrd.addColorStop(1, col(v, 0));
      c.fillStyle = hgrd;
      c.beginPath();
      c.arc(cx, headY, headR, 0, Math.PI * 2);
      c.fill();

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },

  // ─── D5 · PULSE TRAIN ────────────────────────────────────────────────────
  // WHY this geometry:
  // A pulse train is how digital data looks on an oscilloscope — rectangular
  // pulses whose width and amplitude carry information.  The key insight is
  // that each packet is BORN at the centre (youngest = index 0 of hist) and
  // physically travels outward over time.  hist[i] is the level *at the moment
  // that packet was emitted*, so its width and height directly encode what was
  // said when the packet left the transmitter.  Packets near centre (young) are
  // tight, sharp and bright; packets at the edges (old) are wider, dimmer and
  // dissolve using fade(u) — the textbook behaviour of a transmitted burst.
  // A faint carrier line at cy keeps the strip alive at v = 0.
  {
    id: 'pulsetrain',
    name: 'D5',
    title: 'Pulse Train',
    blurb: 'Discrete data packets burst outward from centre — each one\'s width and brightness record the level at the moment it was born.',
    draw(c, w, h, v, t, hist) {
      const cx = w / 2;
      const cy = h / 2;

      c.save();

      // ── Carrier line — always present, 1 px dim hairline ──
      c.strokeStyle = col(0.18, 0.22);
      c.lineWidth   = 1;
      c.beginPath();
      c.moveTo(0, cy);
      c.lineTo(w, cy);
      c.stroke();

      // ── Packets driven directly from hist[] ──
      // hist[i] is the smoothed level when that packet was i frames old.
      // We space them by a fixed "cell" width so the train has a pulse-train
      // rhythm; within each cell the actual pulse width is birth-level × cell.
      // The packet at index i lives at distance i * CELL pixels from centre.
      // CELL is chosen so ~200 packets span the half-width at 1100 px.
      const CELL    = Math.max(1, cx / 200);   // px per hist slot
      const maxIdx  = Math.min(hist.length, Math.ceil(cx / CELL));

      c.globalCompositeOperation = 'lighter';

      for (let i = 0; i < maxIdx; i++) {
        const birthV = hist[i] ?? 0;           // level when this packet was born
        if (birthV < 0.03) continue;           // silence — no packet to draw

        // Fractional distance from centre (0 = centre, 1 = edge).
        // fade() and env() both expect 0 at their "hot" end and 1 at their
        // "zero" end — pass dist directly so the centre is brightest.
        const dist = i * CELL / cx;            // 0..1

        // fade(dist) → ~1 at centre (i=0, dist=0), 0 at edge — dissolves outward
        const fadeA = fade(dist);
        const alpha = birthV * fadeA * (0.6 + v * 0.35);
        if (alpha < 0.01) continue;

        // Packet width: narrow at birth (new = precise), widens as it ages
        // (diffusion metaphor).  Clamped so it never exceeds the cell.
        const ageSpreading = 1 + dist * 1.8;
        const pulseW = Math.min(CELL * 0.9, birthV * CELL * 2.2 * ageSpreading);

        // Pulse height: tallest at centre for young strong packets.
        // env(dist) → ~1 at centre, 0 at edge, flat shoulder in between.
        const envA   = env(dist);
        const pulseH = Math.max(2, birthV * h * 0.82 * (0.4 + envA * 0.6));
        const pulseY = cy - pulseH / 2;

        // Brightness: fresh packets at centre are hottest; far ones are dim.
        const brightness = 0.3 + birthV * 0.7;

        // Draw the packet on BOTH sides (left mirror = -i)
        for (const side of [1, -1]) {
          const px = cx + side * (i * CELL + (CELL - pulseW) * 0.5);
          c.fillStyle = col(brightness, alpha);
          c.fillRect(px, pulseY, side * pulseW || pulseW, pulseH);

          // Sharp bright top/bottom edges — the rise/fall of a real pulse.
          // Only for packets close enough to be legible.
          if (pulseW >= 1.5 && fadeA > 0.25) {
            c.fillStyle = col(Math.min(1, brightness + 0.25), alpha * 0.8);
            c.fillRect(px, pulseY, side * pulseW || pulseW, 1.2);
            c.fillRect(px, pulseY + pulseH - 1.2, side * pulseW || pulseW, 1.2);
          }
        }
      }

      // ── Hot origin node — the transmitter; bright only when sending ──
      // At v = 0 it collapses to nothing so silence stays quiet.
      if (v > 0.02) {
        const nodeR = 1.5 + v * 6;
        const ngrd  = c.createRadialGradient(cx, cy, 0, cx, cy, nodeR + 6);
        ngrd.addColorStop(0,   `rgba(255,255,255,${Math.min(0.55, v * 0.7)})`);
        ngrd.addColorStop(0.4, col(0.85 + v * 0.15, v * 0.65));
        ngrd.addColorStop(1,   col(v, 0));
        c.fillStyle = ngrd;
        c.beginPath();
        c.arc(cx, cy, nodeR + 6, 0, Math.PI * 2);
        c.fill();
      }

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },


];
