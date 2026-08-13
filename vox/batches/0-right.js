// Vernier — HUD, right-aligned. Yash picked the HUD variant and moved the
// anchor: "but right aligned centre nhi right m accha lgega".
//
// "Right aligned" has three honest readings and they look quite different on a
// 26:1 strip, so all three are here rather than me picking for him:
//
//   R1  the whole instrument shrinks into the right end, like a corner readout
//   R2  the origin moves to the right edge and the scale sweeps the full width
//       leftward from it — the centre design, re-anchored
//   R3  the readout sits right and drags a history trail off to the left
//
// All three keep what he liked about the HUD: angular brackets rather than
// boxes, a bracketed readout that opens with level, bold teeth, and scanlines
// over the top. All three are heavier than the original caliper, which is the
// other thing he asked for.
//
// Note these deliberately break the centre-origin rule that governs the other
// thirty — on his instruction. The rule existed because a strip that scrolls
// sideways reads as a chart recorder; an instrument anchored at one end and
// measuring inward does not have that problem.

const BATCH = [

{ id:'hud-right-corner', name:'R1', title:'HUD right — corner readout',
  blurb:'The whole instrument packed into the right end, like a gauge in the corner of a windscreen. The scale runs left out of it and the readout opens as you get louder; most of the strip stays empty.',
  draw(c,w,h,v,t,hist){
    const ox = w - 18, cy = h*0.54, lv = 0.05 + v*0.95;
    const SPAN = Math.min(w - 40, 420);          // the instrument's own width

    // Bracket, right end only. Two corners and air — never a closed box.
    c.lineWidth = 2.6; c.strokeStyle = col(0.6, 0.5 + 0.3*lv);
    c.beginPath();
    c.moveTo(ox-18, 7); c.lineTo(ox, 7); c.lineTo(ox, h-7); c.lineTo(ox-18, h-7);
    c.stroke();

    // Fixed scale marching LEFT from the origin. Fades out well before the
    // strip's left edge so the emptiness reads as deliberate, not as a bug.
    const N = 30, sp = SPAN/N;
    for (let i=1;i<=N;i++){
      const x = ox - 10 - i*sp;
      if (x < 6) break;
      const maj = i%5===0, u = i/N;
      c.lineWidth = maj ? 2.2 : 1.4;
      c.strokeStyle = col(0.45, (0.30 + 0.22*(1-u)) * (1-u*0.85) + 0.04);
      c.beginPath(); c.moveTo(x, cy-(maj?15:8)); c.lineTo(x, cy); c.stroke();
    }

    // Vernier comb rides leftward on the jaw; 29 against the fixed 30, which is
    // the ratio that makes the two combs beat against each other.
    const VN = 29, vsp = (sp*N)/VN, reach = lv*SPAN*0.9;
    for (let i=0;i<=VN;i++){
      const x = ox - 10 - reach + i*vsp;
      if (x > ox-10 || x < 6) continue;
      const maj = i%5===0, u = i/VN;
      c.lineWidth = maj ? 2.4 : 1.5;
      c.strokeStyle = col(lv, (maj?0.9:0.5) * lv * (1-u*0.6));
      c.beginPath(); c.moveTo(x, cy); c.lineTo(x, cy+(maj?14:7)); c.stroke();
    }

    // The readout itself: a bracketed field of blocks that fills with level.
    const bw = 34 + lv*120, bx = ox - 10 - bw;
    c.lineWidth = 2.2; c.strokeStyle = col(lv, 0.72 + 0.24*lv);
    c.beginPath();
    c.moveTo(bx+9, cy-15); c.lineTo(bx, cy-15); c.lineTo(bx, cy+15); c.lineTo(bx+9, cy+15);
    c.stroke();
    const cells = 14, cw = (bw-12)/cells, on = Math.round(lv*cells);
    for (let i=0;i<cells;i++){
      c.fillStyle = col(lv, i<on ? 0.35+0.5*lv : 0.09);
      c.fillRect(bx+7+i*cw, cy-4.5, Math.max(1.6, cw-2.4), 9);
    }

    // Jaw face at the origin, and the scanlines last.
    c.lineWidth = 3; c.strokeStyle = col(lv, 0.6+0.35*lv);
    c.beginPath(); c.moveTo(ox-10, cy-22); c.lineTo(ox-10, cy+21); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.20)';
    for (let y=(t*22)%3; y<h; y+=3) c.fillRect(0, y, w, 1);
  }},

{ id:'hud-right-sweep', name:'R2', title:'HUD right — full sweep',
  blurb:'The same HUD with its origin moved to the right edge: the scale now spans the whole strip and the measurement sweeps left across all of it. The loudest version — it uses every pixel.',
  draw(c,w,h,v,t,hist){
    const ox = w - 12, cy = h*0.54, lv = 0.05 + v*0.95, SPAN = w - 30;

    // Brackets at BOTH ends so the strip still reads as framed, but only the
    // right one is heavy — that is where the instrument is anchored.
    c.lineWidth = 2.6; c.strokeStyle = col(0.6, 0.5+0.3*lv);
    c.beginPath();
    c.moveTo(ox-18, 6); c.lineTo(ox, 6); c.lineTo(ox, h-6); c.lineTo(ox-18, h-6);
    c.stroke();
    c.lineWidth = 1.6; c.strokeStyle = col(0.5, 0.22);
    c.beginPath();
    c.moveTo(10+14, 6); c.lineTo(10, 6); c.lineTo(10, h-6); c.lineTo(10+14, h-6);
    c.stroke();

    const N = 56, sp = SPAN/N;
    for (let i=1;i<=N;i++){
      const x = ox - i*sp; if (x < 8) break;
      const maj = i%5===0, u = i/N;
      c.lineWidth = maj ? 2.2 : 1.4;
      c.strokeStyle = col(0.45, (0.26 + 0.24*(1-u)) * fade(u*0.92) + 0.05);
      c.beginPath(); c.moveTo(x, cy-(maj?15:8)); c.lineTo(x, cy); c.stroke();
    }

    const VN = 55, vsp = (sp*N)/VN, reach = lv*SPAN*0.92;
    for (let i=0;i<=VN;i++){
      const x = ox - reach + i*vsp;
      if (x > ox || x < 8) continue;
      const maj = i%5===0, u = i/VN;
      c.lineWidth = maj ? 2.4 : 1.5;
      c.strokeStyle = col(lv, (maj?0.9:0.5) * lv * fade(u*0.9));
      c.beginPath(); c.moveTo(x, cy); c.lineTo(x, cy+(maj?14:7)); c.stroke();
    }

    // The measuring bar: a bracket at the travelling jaw, blocks filling back to
    // the origin, so the eye reads a quantity and not just a pattern.
    const jx = ox - reach;
    c.lineWidth = 2.4; c.strokeStyle = col(lv, 0.75+0.22*lv);
    c.beginPath();
    c.moveTo(jx+10, cy-16); c.lineTo(jx, cy-16); c.lineTo(jx, cy+16); c.lineTo(jx+10, cy+16);
    c.stroke();
    const cells = 26, cw = reach/cells;
    for (let i=0;i<cells;i++){
      const a = 0.16 + 0.55*lv*(1 - i/cells*0.7);
      c.fillStyle = col(lv, a);
      c.fillRect(jx + 4 + i*cw, cy-4, Math.max(1.4, cw-2.6), 8);
    }

    c.lineWidth = 3; c.strokeStyle = col(lv, 0.62+0.34*lv);
    c.beginPath(); c.moveTo(ox, cy-24); c.lineTo(ox, cy+23); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.20)';
    for (let y=(t*22)%3; y<h; y+=3) c.fillRect(0, y, w, 1);
  }},

{ id:'hud-right-trail', name:'R3', title:'HUD right — data trail',
  blurb:'Readout locked at the right, and everything you have already said trailing off to the left as a ladder of samples. The instrument stays still; the record moves.',
  draw(c,w,h,v,t,hist){
    const ox = w - 16, cy = h*0.56, lv = 0.05 + v*0.95;

    // The rail the record runs along — present even in silence, so the strip is
    // never an empty rectangle.
    c.lineWidth = 1.8; c.strokeStyle = col(0.35, 0.16);
    c.beginPath(); c.moveTo(8, cy); c.lineTo(ox-56, cy); c.stroke();

    // Sample i is drawn i steps to the LEFT of the readout: distance from the
    // instrument is age, so the trail is a legible record of the last couple of
    // seconds rather than decoration.
    const step = 5.5, N = Math.floor((ox-70)/step);
    for (let i=0;i<N;i++){
      const x = ox - 62 - i*step; if (x < 6) break;
      const s0 = hist[i] || 0, u = i/N;
      const th = 2 + s0*26*(1-u*0.75);
      c.fillStyle = col(s0, (0.20 + 0.7*s0) * (1-u*0.9) + 0.03);
      c.fillRect(x-1.5, cy-th, 3, th);
      if (i%10===0){
        c.fillStyle = col(s0, 0.18*(1-u));
        c.fillRect(x-1.5, cy+3, 3, 5);
      }
    }

    // The instrument, locked at the right: bracket, jaw, and a block readout of
    // the level right now.
    c.lineWidth = 2.6; c.strokeStyle = col(0.6, 0.5+0.32*lv);
    c.beginPath();
    c.moveTo(ox-20, 7); c.lineTo(ox, 7); c.lineTo(ox, h-7); c.lineTo(ox-20, h-7);
    c.stroke();

    const bx = ox - 56, bw = 44;
    c.lineWidth = 2.2; c.strokeStyle = col(lv, 0.72+0.24*lv);
    c.beginPath();
    c.moveTo(bx+8, cy-16); c.lineTo(bx, cy-16); c.lineTo(bx, cy+16); c.lineTo(bx+8, cy+16);
    c.stroke();
    const rows = 7, on = Math.round(lv*rows);
    for (let i=0;i<rows;i++){
      const y = cy + 13 - i*(26/rows);
      c.fillStyle = col(lv, i<on ? 0.40+0.5*lv : 0.10);
      c.fillRect(bx+6, y, bw-12, 2.6);
    }

    // Scan head where new samples enter the record.
    c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(bx-26, 0, bx+4, 0);
    g.addColorStop(0, col(1,0));
    g.addColorStop(1, `rgba(255,255,255,${0.12+0.30*lv})`);
    c.fillStyle = g; c.fillRect(bx-26, cy-26, 30, 52);
    c.globalCompositeOperation = 'source-over';

    c.fillStyle = 'rgba(0,0,0,0.20)';
    for (let y=(t*22)%3; y<h; y+=3) c.fillRect(0, y, w, 1);
  }},

];
