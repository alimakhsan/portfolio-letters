import * as THREE from 'three';

function make(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function noise(ctx, w, h, amount) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

export function woodTexture({ base = '#6e4a2a', dark = '#452a14', light = '#8f6538', planks = 1, seams = true } = {}) {
  return make(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 320; i++) {
      ctx.strokeStyle = Math.random() < 0.5 ? dark : light;
      ctx.globalAlpha = 0.04 + Math.random() * 0.12;
      ctx.lineWidth = 0.8 + Math.random() * 3;
      ctx.beginPath();
      const y0 = Math.random() * h;
      const f = 0.004 + Math.random() * 0.01;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y0 + Math.sin(x * f + i) * 9 + (Math.random() - 0.5) * 3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    noise(ctx, w, h, 14);
    if (seams && planks > 1) {
      for (let k = 0; k < planks; k++) {
        const y = k * (h / planks);
        ctx.fillStyle = 'rgba(15,8,2,0.7)';
        ctx.fillRect(0, y, w, 3);
        ctx.fillStyle = 'rgba(255,230,190,0.08)';
        ctx.fillRect(0, y + 3, w, 2);
      }
    }
  });
}

export function paperEdgeTexture() {
  return make(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#efe5cc';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      ctx.fillStyle = `rgba(120,90,50,${0.12 + Math.random() * 0.25})`;
      ctx.fillRect(0, y, w, 1);
    }
  });
}
