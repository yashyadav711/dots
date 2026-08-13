const BATCH = [

  {
    id: 'dispersion',
    name: 'A1',
    title: 'Beam Dispersion',
    blurb: 'A collimated beam splits at centre into fine spectral hairlines that fan outward — the number of lines and their spread track the level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // A real prism disperses parallel light into a fan of rays with slightly
      // different angles. Each ray is a hairline (1 px) and travels all the way
      // to both ends of the strip. The fan angle grows with level so at silence
      // the rays are nearly parallel (narrow fan, a single bright seam) and at
      // peak they splay to fill the height. Lightness varies between lines — the
      // outermost rays of the dispersed beam are the "farthest" wavelengths and
      // are rendered dimmer, giving depth without hue change. The beam is
      // symmetric left/right from x = w/2.

      const cx = w / 2;
      const cy = h / 2;

      // Eased level so changes feel optical, not digital.
      const lv = 0.08 + v * 0.92;   // floor keeps a quiet resting seam

      // Number of hairlines: 3 at silence, up to 18 at peak.
      const N = Math.round(3 + lv * 15);

      // Max spread angle in radians. At full level the outermost ray hits the
      // top/bottom edge well before the strip ends — that keeps all rays visible
      // inside h=74, while still clearly fanning.
      const maxAngle = Math.atan2(h * 0.45, cx * 0.1) * lv;

      c.save();
      c.globalCompositeOperation = 'lighter';

      for (let i = 0; i < N; i++) {
        // Normalised position of this ray in the fan: -1 (bottom) to +1 (top).
        const t_frac = N === 1 ? 0 : (i / (N - 1)) * 2 - 1;
        const angle = t_frac * maxAngle;

        // Lightness: brightest at centre ray (t_frac ≈ 0), dims toward edges.
        // This mirrors how a prism's centre wavelength carries more energy in
        // a near-white-light source.
        const brightness = 1 - Math.abs(t_frac) * 0.7;
        const alpha = brightness * (0.35 + lv * 0.55);

        // Ray goes from centre all the way to both edges (x = 0 and x = w).
        // We draw it as two half-rays so the gradient fades toward the tips.
        const grad = c.createLinearGradient(cx, cy, cx + Math.cos(angle) * cx, cy + Math.sin(angle) * cx);
        grad.addColorStop(0, col(brightness * lv, alpha));
        grad.addColorStop(0.55, col(brightness * lv, alpha * 0.6));
        grad.addColorStop(1,   col(brightness * lv, 0));

        // Right half
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + Math.cos(angle) * cx, cy + Math.sin(angle) * cx);
        c.strokeStyle = grad;
        c.lineWidth = 1;
        c.stroke();

        // Left half (mirror)
        const gradL = c.createLinearGradient(cx, cy, cx - Math.cos(angle) * cx, cy + Math.sin(angle) * cx);
        gradL.addColorStop(0, col(brightness * lv, alpha));
        gradL.addColorStop(0.55, col(brightness * lv, alpha * 0.6));
        gradL.addColorStop(1,   col(brightness * lv, 0));

        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx - Math.cos(angle) * cx, cy + Math.sin(angle) * cx);
        c.strokeStyle = gradL;
        c.lineWidth = 1;
        c.stroke();
      }

      // Hot core at centre: a small bright node where the beam enters the prism.
      // Only meaningful at non-zero level.
      if (v > 0.01) {
        c.globalCompositeOperation = 'lighter';
        const coreAlpha = Math.min(0.5, v * 0.6);
        c.beginPath();
        c.arc(cx, cy, 1.5, 0, Math.PI * 2);
        c.fillStyle = `rgba(255,255,255,${coreAlpha})`;
        c.fill();
      }

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },

  {
    id: 'anamorphic',
    name: 'A2',
    title: 'Anamorphic Streak',
    blurb: 'A horizontal lens flare — bright tight core at centre, with gossamer streak wings whose length and luminance track level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // Anamorphic lenses produce a characteristic horizontal streak (not a
      // starburst) because their cylindrical elements focus light differently
      // on one axis. The streak is thinnest and brightest at the source, then
      // falls off to near-zero over its full length. Here the "source" is always
      // at x = w/2; the wings reach outward to both ends. At silence there is
      // still a hairline seam — the lens always has some internal scatter. At
      // peak the streak blooms: the core fattens slightly and the wings extend
      // almost edge-to-edge. The classic look uses two or three stacked strokes
      // of falling width, giving the airy disc effect without a blur call.

      const cx = w / 2;
      const cy = h / 2;

      const lv = 0.04 + v * 0.96;

      // Streak half-length grows with level. Reaches 100% of cx at full level.
      const halfLen = cx * (0.2 + lv * 0.8);

      c.save();
      c.globalCompositeOperation = 'lighter';

      // Three layers: widest/dimmest → narrow/bright → hairline core.
      // Each is a horizontal gradient from the centre outward.
      const layers = [
        { width: 6, alphaScale: 0.15 },
        { width: 2.5, alphaScale: 0.35 },
        { width: 1,  alphaScale: 0.70 },
      ];

      for (const layer of layers) {
        const baseAlpha = layer.alphaScale * lv;

        // Build a gradient that is full-alpha at the centre and falls to 0 at
        // the tip of the streak. Linear falloff on alpha gives the diffuse wing.
        const gradR = c.createLinearGradient(cx, cy, cx + halfLen, cy);
        gradR.addColorStop(0,   col(lv, baseAlpha));
        gradR.addColorStop(0.3, col(lv, baseAlpha * 0.7));
        gradR.addColorStop(1,   col(lv, 0));

        const gradL = c.createLinearGradient(cx, cy, cx - halfLen, cy);
        gradL.addColorStop(0,   col(lv, baseAlpha));
        gradL.addColorStop(0.3, col(lv, baseAlpha * 0.7));
        gradL.addColorStop(1,   col(lv, 0));

        c.lineWidth = layer.width;
        c.lineCap = 'butt';

        // Right wing
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx + halfLen, cy);
        c.strokeStyle = gradR;
        c.stroke();

        // Left wing
        c.beginPath();
        c.moveTo(cx, cy);
        c.lineTo(cx - halfLen, cy);
        c.strokeStyle = gradL;
        c.stroke();
      }

      // Hot white core — the actual point source behind the flare.
      // Scales in brightness and radius with level but never gets large.
      if (v > 0.005) {
        const coreR = 1 + v * 2;
        const coreA = Math.min(0.55, v * 0.7);
        const coreGrad = c.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
        coreGrad.addColorStop(0,   `rgba(255,255,255,${coreA})`);
        coreGrad.addColorStop(0.4, col(lv, coreA * 0.6));
        coreGrad.addColorStop(1,   col(lv, 0));
        c.beginPath();
        c.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
        c.fillStyle = coreGrad;
        c.fill();
      }

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },

  {
    id: 'caustics',
    name: 'A3',
    title: 'Caustic Pool',
    blurb: 'Shimmering refracted-light caustic lines radiate from the centre — the ripple frequency, density, and brightness all track level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // Caustics are the bright filaments at the bottom of a pool — places where
      // refracted rays constructively interfere. Two incommensurate spatial
      // frequencies (ratio ≈ 1/φ²) beat against each other to produce a never-
      // repeating envelope, so the field is continuous rather than clustered.
      // Each wave is phased by |x-cx| minus a time term, so maxima travel outward
      // from the centre. Fine sampling (2 px) ensures no gaps survive the beat.
      // Level controls the contrast and brightness; at v=0 a calm dim field
      // remains so silence never looks broken.

      const cx = w / 2;

      c.save();
      c.globalCompositeOperation = 'lighter';

      // Floor keeps a quiet resting shimmer at silence.
      const lv = 0.07 + v * 0.93;

      // Two incommensurate spatial frequencies — ratio ≈ 0.618 (inverse golden
      // ratio squared) so their beat period never aligns into visible blocks.
      const k1 = 0.019;   // slower ripple
      const k2 = 0.0307;  // faster ripple  (k2/k1 ≈ 1.616 ≈ φ)

      // Outward travel speed: filaments move away from centre.
      const sp1 = 1.3;
      const sp2 = 0.85;

      // Sample every 2 px — fine enough that even a narrow beat minimum is
      // never wider than a single pixel gap.
      const step = 2;

      for (let x = 0; x <= w; x += step) {
        // Signed distance from centre — used in phase so motion is outward.
        const dx = Math.abs(x - cx);
        // Normalised position for envelope helpers.
        const u = (x - cx) / cx;   // -1..1

        // Phase: distance-from-centre minus time × speed → maxima travel outward.
        const wave1 = Math.sin(k1 * dx - t * sp1);
        const wave2 = Math.sin(k2 * dx - t * sp2);

        // Combine to [−1, 1]; shift to [0, 1].
        const raw = (wave1 + wave2) * 0.5;           // [-1, 1]
        const bright = (raw + 1) * 0.5;              // [0, 1]

        // Contrast: at silence the field is softly lit; at peak the filaments
        // sharpen and flare. Achieved by raising bright to a contrast power.
        const contrast = 1.5 + lv * 3.0;            // 1.5 quiet → 4.5 loud
        const intensity = Math.pow(bright, contrast); // emphasises peaks

        // Envelope: brighter near centre, still visible at edges.
        const envU = env(u) * 0.55 + 0.45;           // 0.45 floor at edges
        const fadeU = fade(u) * 0.6 + 0.4;

        const alpha = intensity * lv * fadeU * envU * 0.75;
        if (alpha < 0.005) continue;

        // Filament height follows intensity and envelope — tallest at hot spots.
        const fH = h * (0.15 + intensity * 0.70) * (0.5 + 0.5 * envU);

        const gy = h / 2;
        c.beginPath();
        c.moveTo(x, gy - fH / 2);
        c.lineTo(x, gy + fH / 2);
        c.strokeStyle = col(intensity * lv, alpha);
        c.lineWidth = 1;
        c.stroke();
      }

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },

  {
    id: 'interference',
    name: 'A4',
    title: 'Interference Fringes',
    blurb: 'Two wavefronts leave the centre and cross, producing moiré-like banding that breathes and sharpens with level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // Real double-slit interference (Young's experiment) produces bright
      // fringes at positions x_n = n·λ·L/d from the optical axis, where λ
      // is wavelength, L is screen distance, and d is slit separation. These
      // fringes are DISCRETE bright lines on a dark background — not a gradient
      // wash. We reproduce that: iterate over fringe order n, compute the
      // canonical fringe x-position (symmetric left/right from cx), and draw a
      // single 1.5 px hairline there. The cos² intensity formula gives each
      // fringe its brightness naturally (central maximum brightest). Empty
      // space between hairlines is the point — that emptiness is the
      // destructive-interference dark bands.
      //
      // Fringe spacing grows with level (λ·L/d term): at low level fringes
      // are far apart (only a few cross the strip); at high level they are
      // closer-packed and more numerous. This is inverted from the physical
      // slit-spacing relationship but matches the visual rule: louder → denser
      // activity across the full width.
      //
      // The fringe order formula naturally produces wider spacing near the
      // centre and tighter toward the edges — the opposite of a uniform comb —
      // so the outer thirds always have something visible.

      const cx = w / 2;
      const cy = h / 2;

      c.save();

      // Quiet floor keeps a single dim hairline at v=0 (not dead).
      const lv = v;

      // Fringe spacing at the centre (n=1 position from cx), in pixels.
      // At silence → ~80 px (only the zeroth fringe is on-screen at low v).
      // At full level → ~18 px (many fringes visible across the strip).
      const fringeSpacing = 80 - lv * 62;   // px for n=1 fringe position

      // The n-th order fringe is at ±n·fringeSpacing from centre.
      // We iterate outward until we've passed both edges.
      const maxN = Math.ceil(cx / fringeSpacing) + 1;

      c.globalCompositeOperation = 'lighter';
      c.lineWidth = 1.5;

      for (let n = 0; n <= maxN; n++) {
        // cos² intensity for this fringe order — falls off from centre.
        // Central max (n=0) has intensity 1; each successive fringe slightly
        // lower due to the single-slit envelope (approximated here as a
        // gentle 1/(1+n²·k) decay so outer fringes remain visible).
        const envelope = 1 / (1 + n * n * 0.08);
        const intensity = envelope;

        // Both sides of centre (n=0 drawn once).
        const sides = n === 0 ? [0] : [-1, 1];

        for (const side of sides) {
          const xFringe = cx + side * n * fringeSpacing;
          // Skip if off-canvas.
          if (xFringe < 0 || xFringe > w) continue;

          // Lateral position 0..1 from centre.
          const u = (xFringe - cx) / cx;
          const f = fade(u);                          // dissolves near edges

          // Alpha: cos² intensity × fade × level-driven master.
          // At v=0, only n=0 fringe fires (because fringeSpacing is large,
          // n=1 lands off-screen) and alpha is held to a small quiet floor.
          const quietFloor = n === 0 ? 0.12 : 0;
          const alpha = Math.max(quietFloor, intensity * f * (lv * 0.85 + 0.05));
          if (alpha < 0.015) continue;

          // Draw a vertical hairline spanning most of the strip height,
          // fading to transparent at top and bottom via gradient.
          const hairH = h * (0.7 + intensity * 0.28);
          const grad = c.createLinearGradient(xFringe, cy - hairH / 2, xFringe, cy + hairH / 2);
          grad.addColorStop(0,    col(lv, 0));
          grad.addColorStop(0.15, col(lv, alpha));
          grad.addColorStop(0.5,  col(lv, alpha * (n === 0 ? 1 : 0.9)));
          grad.addColorStop(0.85, col(lv, alpha));
          grad.addColorStop(1,    col(lv, 0));

          const path = new Path2D();
          path.moveTo(xFringe, cy - hairH / 2);
          path.lineTo(xFringe, cy + hairH / 2);

          c.strokeStyle = grad;
          c.stroke(path);
        }
      }

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },

  {
    id: 'godrays',
    name: 'A5',
    title: 'Volumetric Shafts',
    blurb: 'Thin light rays fan up and outward from the bottom-centre — the number, spread, and brightness track level.',
    draw(c, w, h, v, t, hist) {
      // WHY this geometry:
      // Volumetric god rays (crepuscular shafts) in a strip that is 74 px tall
      // and ~1100 px wide must be nearly HORIZONTAL — raking light from a source
      // at the centre-left/right, not a vertical torch. The fan angle is tiny
      // (±a few degrees from horizontal) so each ray travels most of the strip
      // width before it exits the canvas. At v=0.8 the outermost ray tips must
      // reach the left and right edges. Ray length = cx / cos(angle) so that
      // every ray's x-projection hits cx. Source is at the strip's visual centre
      // (cx, cy) to satisfy the centre-origin rule.
      //
      // We draw two mirrored half-fans — one going right, one going left —
      // symmetric about x = w/2.  Each ray is a gradient line: bright at the
      // source, transparent at the tip.

      const cx = w / 2;
      const cy = h / 2;

      c.save();
      c.globalCompositeOperation = 'lighter';

      // lv: floor at 0.05 so silence is not empty.
      const lv = 0.05 + v * 0.95;

      // Number of rays per side: 2 at silence, 9 at full level.
      const N = Math.round(2 + lv * 7);

      // Max fan angle from horizontal (in radians). We want the outermost ray
      // tip to land at y = 0 or y = h when x reaches the edge. That gives:
      //   tan(maxAngle) = (h/2) / cx => maxAngle = atan(h/2, cx)
      // We use ~85% of that at full level so tips stay inside the strip.
      const absMax = Math.atan2(h * 0.42, cx);
      // Scale by lv so spread grows with level.
      const maxAngle = absMax * lv;

      // Draw both left and right halves.
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < N; i++) {
          // Distribute rays from nearly-horizontal outward.
          // frac=0 → horizontal centre ray, frac=1 → outermost ray.
          const frac = N <= 1 ? 0 : i / (N - 1);
          // Signed angle from horizontal toward top (negative dy = up) or bottom.
          // Alternate above/below for each i to keep even spread.
          const vertSign = i % 2 === 0 ? 1 : -1;
          const ang = frac * maxAngle;

          // Direction: side * cos(ang) in x, vertSign * sin(ang) in y.
          const dx = side * Math.cos(ang);
          const dy = vertSign * Math.sin(ang);

          // Ray length: enough that the x-component reaches the edge.
          // length = cx / |cos(ang)|, with a floor for the centre ray.
          const rayLen = cx / (Math.cos(ang) + 0.001);

          const tipX = cx + dx * rayLen;
          const tipY = cy + dy * rayLen;

          // Brightness: central rays (small frac, small ang) are brightest.
          const centrality = 1 - frac;
          const alpha = (0.08 + centrality * 0.45) * lv;

          // Subtle per-ray flicker — crepuscular shafts breathe in real air.
          const flicker = 0.85 + 0.15 * Math.sin(t * 1.6 + i * 1.7 + side * 2.3);
          const finalAlpha = alpha * flicker;

          // Gradient: bright at origin, transparent at tip.
          const grad = c.createLinearGradient(cx, cy, tipX, tipY);
          grad.addColorStop(0,    col(lv, finalAlpha));
          grad.addColorStop(0.4,  col(lv * 0.85, finalAlpha * 0.6));
          grad.addColorStop(1,    col(lv * 0.6, 0));

          c.beginPath();
          c.moveTo(cx, cy);
          c.lineTo(tipX, tipY);
          c.strokeStyle = grad;
          c.lineWidth = 1;
          c.stroke();
        }
      }

      // Soft halo at the source — the diffuse glow of where the light originates.
      // Scales with level; the lv floor keeps it faintly visible at silence.
      const haloR = 3 + lv * 10;
      const haloGrad = c.createRadialGradient(cx, cy, 0, cx, cy, haloR);
      haloGrad.addColorStop(0, col(lv, 0.5 * lv));
      haloGrad.addColorStop(1, col(lv, 0));
      c.fillStyle = haloGrad;
      c.beginPath();
      c.arc(cx, cy, haloR, 0, Math.PI * 2);
      c.fill();

      c.globalCompositeOperation = 'source-over';
      c.restore();
    }
  },

];
