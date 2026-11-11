/* A-HOUSE HQ avatar kit: stacks the pre-rendered avatar layers (avatar/<build>/<anim>/<part>.png) into one
   sprite sheet, recolours them and draws the 1 px black outline round the finished figure.

   const kit = await AvatarKit.load('avatar/');
   const sheet = await kit.compose({build:'female', anim:'walk',
       parts:['body','hair_back.bob','hair_front.blunt','top.tee','bottom.jeans','shoes.sneakers'],
       colors:{skin:'#f2c29a', hair:'#5a3420', 'top.tee#a':'#d6403a'}});
   // sheet = {canvas, frameWidth, frameHeight, frames, fps, rows:['down','left','up','right'], anchor:{x,y}}

   Colours: 'skin', 'hair', 'blanket' are shared; anything else is per part: '<part>#a' (main) and '<part>#b'
   (accent). A layer's grey keys (manifest.keys) are swapped for the chosen colour's light/mid/dark ramp. */
(function () {
  const KA = [[224, 224, 224], [160, 160, 160], [96, 96, 96]], KB = [[208, 208, 208], [144, 144, 144], [80, 80, 80]], KM = [120, 120, 120];
  const hex = h => { h = String(h || '808080').replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) };
  function rgb2hls(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, l, 0];
    const d = mx - mn, s = l <= .5 ? d / (mx + mn) : d / (2 - mx - mn);
    let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d;
    return [((h / 6) % 1 + 1) % 1, l, s];
  }
  function hls2rgb(h, l, s) {
    if (!s) return [l, l, l];
    const m2 = l <= .5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
    const v = hh => { hh = ((hh % 1) + 1) % 1; return hh < 1 / 6 ? m1 + (m2 - m1) * hh * 6 : hh < .5 ? m2 : hh < 2 / 3 ? m1 + (m2 - m1) * (2 / 3 - hh) * 6 : m1 };
    return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
  }
  const shiftHue = (h, t, f) => { const d = ((t - h + .5) % 1 + 1) % 1 - .5; return ((h + d * f) % 1 + 1) % 1 };
  function autoRamp(c) {                       // same as npc_render.auto_ramp: warm lights, muted purple-ish shadows
    const [h, l, s] = rgb2hls(...c);
    return [hls2rgb(shiftHue(h, 55 / 360, .08), Math.min(.94, l + .08), s * .92), c,
            hls2rgb(shiftHue(h, 300 / 360, .06), Math.max(.05, l - .19), Math.min(1, s * .62))];
  }
  const scale = (c, f) => c.map(v => Math.min(1, Math.floor(v * 255 * f) / 255));
  function rampFor(channel, part, key, colors, defaults) {
    const skin = hex(colors.skin || '#f2c29a');
    if (channel === 'skin_limb') return [scale(skin, .9), scale(skin, .78), scale(skin, .62)];
    if (channel === 'skin_mouth') return [scale(skin, .75)];
    if (channel === 'skin') return autoRamp(skin);
    if (channel === 'hair' || channel === 'blanket') return autoRamp(hex(colors[channel] || (channel === 'hair' ? '#4a2e1e' : '#4a72c0')));
    return autoRamp(hex(colors[part + '#' + key] || (defaults || {})[channel]));
  }
  const imgCache = {};
  const loadImg = src => imgCache[src] || (imgCache[src] = new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src }));

  class Kit {
    constructor(base, man) { this.base = base; this.man = man }
    static async load(base = 'avatar/') {
      const man = await (await fetch(base + 'manifest.json')).json();
      return new Kit(base, man);
    }
    has(build, anim, part) { return ((this.man.builds[build] || {})[anim] || []).includes(part) }
    orderIndex(order, part) { for (let i = 0; i < order.length; i++) if (part === order[i] || part.startsWith(order[i] + '.')) return i; return order.length }
    async compose({ build, anim, parts, colors = {} }) {
      const A = this.man.anims[anim], W = A.frameWidth, H0 = A.frameHeight, F = A.frames, rows = A.rows;
      const PAD = anim === 'sleep' ? 9 : 0, H = H0 + PAD;   // headroom for the sleeping "z"
      const list = parts.filter(p => this.has(build, anim, p));
      const imgs = await Promise.all(list.map(p => loadImg(`${this.base}${build}/${anim}/${p}.png`)));
      const cv = document.createElement('canvas'); cv.width = W * F; cv.height = H * rows.length;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const out = cx.createImageData(cv.width, cv.height), o = out.data;
      const tmp = document.createElement('canvas'); tmp.width = cv.width; tmp.height = cv.height;
      const tx = tmp.getContext('2d', { willReadFrequently: true });
      const layers = list.map((p, i) => {
        if (!imgs[i]) return null;
        tx.clearRect(0, 0, tmp.width, tmp.height);
        for (let r = 0; r < rows.length; r++)          // each row moves down by its share of the headroom
          tx.drawImage(imgs[i], 0, r * H0, W * F, H0, 0, r * H + PAD, W * F, H0);
        const d = tx.getImageData(0, 0, tmp.width, tmp.height).data.slice();
        const info = this.man.parts[p] || {}, ch = info.channels || {}, defs = ch.defaults || {};
        const maps = [];                        // [grey rgb, new rgb] pairs
        for (const [key, keys] of [['a', KA], ['b', KB], ['m', [KM, KM, KM]]]) {
          if (!ch[key]) continue;
          const ramp = rampFor(ch[key], p, key, colors, defs);
          keys.forEach((k, t) => maps.push([k, (ramp[t] || ramp[0]).map(v => Math.round(v * 255))]));
        }
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue;
          for (const [k, c] of maps) if (d[i] === k[0] && d[i + 1] === k[1] && d[i + 2] === k[2]) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; break }
        }
        return { p, d };
      }).filter(Boolean);
      for (let r = 0; r < rows.length; r++) {     // stack per row: back views use the 'back' order
        const order = this.man.order[rows[r] === 'up' ? 'back' : 'front'];
        const sorted = layers.slice().sort((a, b) => this.orderIndex(order, a.p) - this.orderIndex(order, b.p));
        for (const { d } of sorted)
          for (let y = r * H; y < (r + 1) * H; y++) for (let x = 0; x < cv.width; x++) {
            const i = (y * cv.width + x) * 4; if (d[i + 3]) { o[i] = d[i]; o[i + 1] = d[i + 1]; o[i + 2] = d[i + 2]; o[i + 3] = 255 }
          }
      }
      const a = new Uint8Array(cv.width * cv.height);           // outline each frame (never across frames)
      for (let i = 0; i < a.length; i++) a[i] = o[i * 4 + 3] ? 1 : 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const i = y * cv.width + x; if (a[i]) continue;
        const fx = x % W, fy = y % H;
        if ((fx > 0 && a[i - 1]) || (fx < W - 1 && a[i + 1]) || (fy > 0 && a[i - cv.width]) || (fy < H - 1 && a[i + cv.width])) {
          o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = 0; o[i * 4 + 3] = 255 }
      }
      if (anim === 'sleep') this.drawZ(o, cv.width, W, H, F, rows.length);
      cx.putImageData(out, 0, 0);
      return { canvas: cv, frameWidth: W, frameHeight: H, frames: F, fps: A.fps, rows, anchor: { x: A.anchor.x, y: A.anchor.y + PAD } };
    }
    drawZ(o, CW, W, H, F, R) {                  // the floating "z" above a sleeper's head
      const Z = ['#####', '...#.', '..#..', '.#...', '#####'], path = [null, [0, 0], [0, -1], [1, -2], [1, -3], [2, -4], [2, -5], null];
      for (let r = 0; r < R; r++) for (let f = 0; f < F; f++) {
        const st = path[f % path.length]; if (!st) continue;
        let top = H, hx = W / 2;
        for (let y = 0; y < H && top === H; y++) for (let x = 0; x < W; x++) if (o[((r * H + y) * CW + f * W + x) * 4 + 3]) { top = y; hx = x; break }
        const side = r === 1 ? -1 : 1, zx = hx + side * 5 + st[0] * side - (side < 0 ? 4 : 0), zy = Math.max(0, top - 6 + st[1]);
        Z.forEach((line, j) => [...line].forEach((ch, i) => {
          const x = zx + i, y = zy + j; if (ch !== '#' || x < 0 || x >= W || y < 0 || y >= H) return;
          const k = ((r * H + y) * CW + f * W + x) * 4; if (!o[k + 3]) { o[k] = 58; o[k + 1] = 54; o[k + 2] = 86; o[k + 3] = 255 }
        }));
      }
    }
  }
  /* play one row of a composed sheet on a <canvas>, scaled up crisply */
  function play(sheet, canvas, row = 0, scaleBy = 4) {
    const W = sheet.frameWidth, H = sheet.frameHeight; canvas.width = W * scaleBy; canvas.height = H * scaleBy;
    const cx = canvas.getContext('2d'); cx.imageSmoothingEnabled = false;
    let f = 0, alive = true;
    const tick = () => { if (!alive) return; cx.clearRect(0, 0, canvas.width, canvas.height);
      cx.drawImage(sheet.canvas, f * W, row * H, W, H, 0, 0, W * scaleBy, H * scaleBy); f = (f + 1) % sheet.frames;
      setTimeout(tick, 1000 / (sheet.fps || 6)) };
    tick(); return () => { alive = false };
  }
  window.AvatarKit = { load: Kit.load, play, autoRamp };
})();
