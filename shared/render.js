// Bloom canvas renderer. Draws a Frame (array of {x,y,r,g,b}) onto a 1:1 canvas
// as an additive halo + hot core over a dark substrate, and bleeds the average
// lit color onto an optional device element via the CSS --glow var.
// Visual math is identical to the original site/index.html Panel.

export class Panel {
  constructor(canvas, { device } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.device = device || null;
    this.S = canvas.width;
    this.cell = this.S / 8;
    this.acc = 0;
    this.fi = 0;
    this.frames = null;   // Array<Frame>
    this.frameMs = 150;
    this.stepFn = null;   // () => Frame
    this.genFn = null;    // (now) => Frame
    this._cur = [];       // current Frame for stepper mode
    this._dirty = true;
  }

  _reset() {
    this.frames = null; this.stepFn = null; this.genFn = null;
    this.fi = 0; this.acc = 0; this._cur = []; this._dirty = true;
  }

  setFrames(frames, frameMs) {
    this._reset();
    this.frames = frames; this.frameMs = frameMs || 150;
    this.draw(0);
  }

  setStepper(stepFn, frameMs) {
    this._reset();
    this.stepFn = stepFn; this.frameMs = frameMs || 150;
    this._cur = stepFn();
    this.draw(0);
  }

  setGenerator(genFn) {
    this._reset();
    this.genFn = genFn;
    this.draw(0);
  }

  tick(dt, now) {
    if (this.genFn) { this.draw(now); return; }
    if (this.frames) {
      this.acc += dt;
      while (this.acc >= this.frameMs) {
        this.acc -= this.frameMs;
        this.fi = (this.fi + 1) % this.frames.length;
        this._dirty = true;
      }
    } else if (this.stepFn) {
      this.acc += dt;
      while (this.acc >= this.frameMs) {
        this.acc -= this.frameMs;
        this._cur = this.stepFn();
        this._dirty = true;
      }
    }
    if (this._dirty) { this._dirty = false; this.draw(now); }
  }

  pixels(now) {
    if (this.genFn) return this.genFn(now);
    if (this.stepFn) return this._cur;
    if (this.frames) return this.frames[this.fi] || [];
    return [];
  }

  draw(now) {
    const ctx = this.ctx, S = this.S, c = this.cell, px = this.pixels(now);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "#060608"; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "rgba(255,255,255,.022)";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      ctx.beginPath(); ctx.arc(x * c + c / 2, y * c + c / 2, c * 0.13, 0, 7); ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    let R = 0, G = 0, B = 0, n = 0;
    for (const p of px) {
      const cx = p.x * c + c / 2, cy = p.y * c + c / 2;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.92);
      halo.addColorStop(0, `rgba(${p.r},${p.g},${p.b},.85)`);
      halo.addColorStop(.45, `rgba(${p.r},${p.g},${p.b},.34)`);
      halo.addColorStop(1, `rgba(${p.r},${p.g},${p.b},0)`);
      ctx.fillStyle = halo; ctx.fillRect(cx - c, cy - c, c * 2, c * 2);
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, c * 0.34);
      core.addColorStop(0, `rgba(${Math.min(255, p.r + 90)},${Math.min(255, p.g + 90)},${Math.min(255, p.b + 90)},1)`);
      core.addColorStop(1, `rgba(${p.r},${p.g},${p.b},.15)`);
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, c * 0.34, 0, 7); ctx.fill();
      R += p.r; G += p.g; B += p.b; n++;
    }
    ctx.globalCompositeOperation = "source-over";
    if (this.device && n) {
      const k = 1.1;
      this.device.style.setProperty("--glow",
        `rgba(${Math.min(255, 0 | R / n * k)},${Math.min(255, 0 | G / n * k)},${Math.min(255, 0 | B / n * k)},.55)`);
    }
  }
}
