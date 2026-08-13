// Vernier Jaw — five variants. Yash picked the caliper out of the twenty-five:
// "mast h isse thoda jo lines h wo bold krdo aur thoda aur cyberpunk 2077 type".
//
// So every one of these is heavier than the original — the first pass drew at
// 0.6–1.0 px, which is correct for a real instrument and far too polite on a
// desktop at arm's length. Base weights here are 1.6–3 px.
//
// What "Cyberpunk 2077" is taken to mean, concretely, rather than as a mood:
//   · hard angular chrome — corner brackets, bracket ticks, nothing rounded
//   · chromatic aberration — the same figure drawn twice, offset a pixel or two,
//     additively, so edges fringe and the core goes hot
//   · scanlines and tears — a CRT that is being driven slightly too hard
//   · discrete steps over smooth motion — machinery, detents, snapping
//   · readouts: things that look like they are measuring and reporting
// The state colour still rules everything; nothing here invents a hue. The
// aberration is the SAME colour offset from itself, which is what keeps the
// green/amber/red signal legible while still fringing.

const BATCH = [

{ id:'vernier-heavy', name:'V1', title:'Vernier — Heavy',
  blurb:'The caliper you picked, drawn with weight: thicker teeth, taller majors, solid jaw faces. Same geometry, no glitch — just legible from across the room.',
  draw(c,w,h,v,t,hist){
    const cx=w/2, cy=h*0.52, lv=0.05+v*0.95, JAW=cx*0.88, open=lv*JAW;

    // Fixed outer scale: reads from each edge inward, so the ends always carry
    // something even in silence.
    const MAIN=40, sp=JAW/MAIN;
    for (let i=0;i<=MAIN;i++){
      const off=i*sp, d=JAW-off, u=d/cx;
      const maj=i%5===0, th=maj?18:9;
      c.lineWidth=maj?2.2:1.4;
      c.strokeStyle=col(0.45, (0.22+0.30*(1-off/JAW))*fade(u)+0.06);
      for (const x of [cx+d, cx-d]){
        c.beginPath(); c.moveTo(x, cy-th); c.lineTo(x, cy); c.stroke();
      }
    }

    // Moving vernier comb: 39 teeth against the main scale's 40 — that ratio IS
    // the vernier principle, and it is why the two combs drift in and out of
    // alignment as the jaw travels.
    const VN=39, vsp=(sp*MAIN)/VN, lit=Math.min(1,lv*1.15);
    for (let i=0;i<=VN;i++){
      const lo=i*vsp;
      for (const s of [1,-1]){
        const x=cx+s*(open+lo); if (x<0||x>w) continue;
        const maj=i%5===0, th=maj?16:8, u=(x-cx)/cx;
        c.lineWidth=maj?2.4:1.5;
        c.strokeStyle=col(lit, (maj?0.92:0.55)*lit*fade(u));
        c.beginPath(); c.moveTo(x, cy); c.lineTo(x, cy+th); c.stroke();
      }
    }

    // The jaw faces and the gap between them — the measurement itself.
    c.lineWidth=2.6; c.strokeStyle=col(lit, 0.30+0.45*lv);
    c.beginPath(); c.moveTo(0,cy); c.lineTo(cx-open,cy);
    c.moveTo(cx+open,cy); c.lineTo(w,cy); c.stroke();
    for (const s of [1,-1]){
      const x=cx+s*open;
      c.lineWidth=3; c.strokeStyle=col(lit, 0.55+0.40*lv);
      c.beginPath(); c.moveTo(x, cy-22); c.lineTo(x, cy+20); c.stroke();
    }
    // Origin mark, so the eye knows where this is measured from.
    c.globalCompositeOperation='lighter';
    c.lineWidth=1.6; c.strokeStyle=col(lv, 0.25+0.5*lv);
    c.beginPath(); c.moveTo(cx, cy-26); c.lineTo(cx, cy+24); c.stroke();
    c.globalCompositeOperation='source-over';
  }},

{ id:'vernier-glitch', name:'V2', title:'Vernier — Glitch',
  blurb:'The same caliper through a failing display: the scale is drawn three times a pixel apart so edges fringe, and loud syllables tear horizontal slices out of it.',
  draw(c,w,h,v,t,hist){
    const cx=w/2, cy=h*0.52, lv=0.05+v*0.95, JAW=cx*0.88, open=lv*JAW;

    // The whole comb goes in a function so it can be stamped three times at
    // different offsets. That triple-stamp IS the aberration — one figure, split
    // from itself, rather than three colours invented for the look.
    const comb=(dx, a, lw)=>{
      c.lineWidth=lw;
      const MAIN=40, sp=JAW/MAIN;
      for (let i=0;i<=MAIN;i++){
        const d=JAW-i*sp, u=d/cx, maj=i%5===0;
        c.strokeStyle=col(0.5, a*(maj?1:0.55)*fade(u));
        for (const x of [cx+d+dx, cx-d+dx]){
          c.beginPath(); c.moveTo(x, cy-(maj?18:9)); c.lineTo(x, cy); c.stroke();
        }
      }
      const VN=39, vsp=(sp*MAIN)/VN;
      for (let i=0;i<=VN;i++){
        for (const s of [1,-1]){
          const x=cx+s*(open+i*vsp)+dx; if (x<0||x>w) continue;
          const maj=i%5===0, u=(x-cx)/cx;
          c.strokeStyle=col(lv, a*(maj?1:0.6)*lv*fade(u));
          c.beginPath(); c.moveTo(x, cy); c.lineTo(x, cy+(maj?16:8)); c.stroke();
        }
      }
    };

    c.globalCompositeOperation='lighter';
    const spread=1.2+2.2*v;            // aberration widens when it is driven hard
    comb(-spread, 0.30, 2.0);
    comb( spread, 0.30, 2.0);
    comb( 0,      0.85, 2.2);
    c.globalCompositeOperation='source-over';

    // Tears. Deterministic from a quantised clock so they land as discrete
    // events rather than shimmering every frame — a glitch you can see is a
    // glitch that happened, not noise.
    const seed=Math.floor(t*9);
    const rndFor=n=>{ const s=Math.sin(seed*127.1+n*311.7)*43758.5453; return s-Math.floor(s); };
    const tears=v>0.45?Math.floor(v*3.5):0;
    for (let k=0;k<tears;k++){
      const r=rndFor(k);
      const y=r*h, hh=2+r*6, shift=(rndFor(k+9)-0.5)*46*v;
      const slice=c.getImageData(0, Math.max(0,y|0), w, Math.min(h-(y|0), hh|0));
      c.clearRect(0, y, w, hh);
      c.putImageData(slice, shift|0, y|0);
    }

    // Hot core at the origin — the one place white is allowed.
    const g=c.createRadialGradient(cx,cy,0,cx,cy,10+34*v);
    g.addColorStop(0,`rgba(255,255,255,${0.10+0.34*v})`);
    g.addColorStop(0.4, col(1, 0.28*v)); g.addColorStop(1, col(1,0));
    c.globalCompositeOperation='lighter'; c.fillStyle=g; c.fillRect(0,0,w,h);
    c.globalCompositeOperation='source-over';
  }},

{ id:'vernier-hud', name:'V3', title:'Vernier — HUD',
  blurb:'The caliper mounted in a heads-up display: angular brackets at both ends, a readout frame at the centre that opens with the jaws, and scanlines over the whole thing.',
  draw(c,w,h,v,t,hist){
    const cx=w/2, cy=h*0.54, lv=0.05+v*0.95, JAW=cx*0.86, open=lv*JAW;

    // Corner brackets. Nothing is a full rectangle — CP2077 chrome is always an
    // implied frame, four corners and air in between.
    const brk=(x,dir)=>{
      c.lineWidth=2.4; c.strokeStyle=col(0.6, 0.45+0.3*lv);
      c.beginPath();
      c.moveTo(x+dir*16, 6); c.lineTo(x, 6); c.lineTo(x, 22);
      c.moveTo(x+dir*16, h-6); c.lineTo(x, h-6); c.lineTo(x, h-22);
      c.stroke();
    };
    brk(10,1); brk(w-10,-1);

    // The scale, weighted.
    const MAIN=34, sp=JAW/MAIN;
    for (let i=0;i<=MAIN;i++){
      const d=JAW-i*sp, u=d/cx, maj=i%5===0;
      c.lineWidth=maj?2.2:1.4;
      c.strokeStyle=col(0.45, (0.18+0.28*(1-i/MAIN))*fade(u)+0.05);
      for (const x of [cx+d, cx-d]){
        c.beginPath(); c.moveTo(x, cy-(maj?15:8)); c.lineTo(x, cy); c.stroke();
      }
    }
    const VN=33, vsp=(sp*MAIN)/VN, lit=Math.min(1,lv*1.15);
    for (let i=0;i<=VN;i++){
      for (const s of [1,-1]){
        const x=cx+s*(open+i*vsp); if (x<0||x>w) continue;
        const maj=i%5===0, u=(x-cx)/cx;
        c.lineWidth=maj?2.4:1.5;
        c.strokeStyle=col(lit, (maj?0.9:0.5)*lit*fade(u));
        c.beginPath(); c.moveTo(x, cy); c.lineTo(x, cy+(maj?14:7)); c.stroke();
      }
    }

    // The readout: a bracketed box that IS the measurement, widening with level,
    // with a block bar inside it standing in for a numeric value.
    const bw=Math.max(26, open*0.85), bh=15;
    c.lineWidth=2.2; c.strokeStyle=col(lit, 0.7+0.25*lv);
    for (const s of [1,-1]){
      const ex=cx+s*bw;
      c.beginPath();
      c.moveTo(ex-s*9, cy-bh); c.lineTo(ex, cy-bh); c.lineTo(ex, cy+bh); c.lineTo(ex-s*9, cy+bh);
      c.stroke();
    }
    const blocks=Math.round(2+lv*13);
    for (let i=0;i<blocks;i++){
      const bwid=(bw*2-14)/16;
      c.fillStyle=col(lit, 0.30+0.55*lv);
      c.fillRect(cx-bw+7+i*bwid, cy-4.5, Math.max(1.6,bwid-2.2), 9);
    }

    // Scanlines last, over everything, dark not light — a screen, not a glow.
    c.fillStyle='rgba(0,0,0,0.20)';
    for (let y=(t*22)%3; y<h; y+=3) c.fillRect(0, y, w, 1);
  }},

{ id:'vernier-ratchet', name:'V4', title:'Vernier — Ratchet',
  blurb:'The jaws no longer glide, they click. Level is quantised into detents, so the scale advances in hard steps and a block of teeth locks solid behind it.',
  draw(c,w,h,v,t,hist){
    const cx=w/2, cy=h*0.54, DET=16;                 // sixteen detents per side
    // Quantising the level is the whole idea: machinery does not interpolate.
    const step=Math.round((0.04+v*0.96)*DET)/DET;
    const JAW=cx*0.9, open=step*JAW, sp=JAW/DET;

    // The track the jaw runs in — always present, so silence is a machine at
    // rest rather than an empty strip.
    c.lineWidth=2; c.strokeStyle=col(0.3, 0.16);
    c.beginPath(); c.moveTo(8,cy); c.lineTo(w-8,cy); c.stroke();

    for (let i=0;i<=DET;i++){
      const d=i*sp, u=d/cx, engaged=d<=open+0.5;
      for (const s of [1,-1]){
        const x=cx+s*d; if (x<4||x>w-4) continue;
        // Engaged detents are solid blocks; the ones ahead of the jaw are just
        // the empty notches waiting for it.
        if (engaged){
          const bh=9+13*fade(u)*step;
          c.fillStyle=col(step, (0.42+0.5*step)*fade(u));
          c.fillRect(x-3, cy-bh, 6, bh*2);
          c.fillStyle=col(1, 0.5*step*fade(u));
          c.fillRect(x-3, cy-1.5, 6, 3);
        } else {
          c.lineWidth=1.8; c.strokeStyle=col(0.3, 0.20*fade(u));
          c.beginPath(); c.moveTo(x, cy-8); c.lineTo(x, cy+8); c.stroke();
        }
      }
    }

    // The pawl: a hard bracket sitting exactly on the last engaged detent.
    for (const s of [1,-1]){
      const x=cx+s*open;
      c.lineWidth=3; c.strokeStyle=col(1, 0.75+0.25*step);
      c.beginPath();
      c.moveTo(x-s*7, cy-24); c.lineTo(x, cy-24); c.lineTo(x, cy+24); c.lineTo(x-s*7, cy+24);
      c.stroke();
    }
    c.globalCompositeOperation='lighter';
    const g=c.createRadialGradient(cx,cy,0,cx,cy,12+30*step);
    g.addColorStop(0, col(1, 0.34*step)); g.addColorStop(1, col(1,0));
    c.fillStyle=g; c.fillRect(0,0,w,h);
    c.globalCompositeOperation='source-over';
  }},

{ id:'vernier-netrunner', name:'V5', title:'Vernier — Netrunner',
  blurb:'The scale turned into a data ladder: every tooth is one sample of what you just said, and a bright scan head rides each jaw face outward leaving a decaying trail.',
  draw(c,w,h,v,t,hist){
    const cx=w/2, cy=h*0.56, lv=0.05+v*0.95, JAW=cx*0.9, open=lv*JAW;
    const N=54, sp=JAW/N;

    // Baseline rail, always lit — a bus with nothing on it still has a bus.
    c.lineWidth=1.8; c.strokeStyle=col(0.35, 0.18);
    c.beginPath(); c.moveTo(6,cy); c.lineTo(w-6,cy); c.stroke();

    // Tooth i carries hist[i]: distance from the centre is age, so the ladder is
    // a readable record of the last couple of seconds rather than decoration.
    for (let i=0;i<=N;i++){
      const d=i*sp, u=d/cx, s0=hist[i*2]||0;
      const past=d<=open;
      const th=3+ s0*24*fade(u);
      for (const s of [1,-1]){
        const x=cx+s*d; if (x<3||x>w-3) continue;
        c.fillStyle=col(s0, (past?0.85:0.22)*(0.25+0.75*fade(u)));
        c.fillRect(x-1.6, cy-th, 3.2, th);
        // Every eighth tooth gets a foot, so the ladder has rhythm and you can
        // count along it instead of reading a blur.
        if (i%8===0){
          c.fillStyle=col(s0, (past?0.6:0.18)*fade(u));
          c.fillRect(x-1.6, cy+2, 3.2, 6);
        }
      }
    }

    // Scan heads on the jaw faces, with a short decaying trail behind each.
    c.globalCompositeOperation='lighter';
    for (const s of [1,-1]){
      for (let k=0;k<7;k++){
        const x=cx+s*(open - k*sp*1.6); if (x<0||x>w) continue;
        const a=(1-k/7)**2 * (0.20+0.75*lv);
        c.fillStyle=col(1, a*0.55);
        c.fillRect(x-2, cy-26, 4, 52);
      }
      const x=cx+s*open;
      const g=c.createLinearGradient(x-14,0,x+14,0);
      g.addColorStop(0, col(1,0)); g.addColorStop(.5, `rgba(255,255,255,${0.16+0.30*lv})`); g.addColorStop(1, col(1,0));
      c.fillStyle=g; c.fillRect(x-14, cy-28, 28, 56);
    }
    c.globalCompositeOperation='source-over';
  }},

];
