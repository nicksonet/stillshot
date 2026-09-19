import * as THREE from 'three';

export type Style = 'neon' | 'pastel';

export interface Theme {
  /** neon: cyberpunk glow; pastel: soft, warm, period interior. */
  style: Style;
  background: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  floorBase: string;
  floorLine: string;
  floorGlow: string;
  /** Outdoor levels get a skyline ring; indoor ones only through windows. */
  skyline: boolean;
}

export const NEON = {
  cyan: 0x19f0ff,
  magenta: 0xff2bd6,
  violet: 0x8a5cff,
  amber: 0xffb020,
  green: 0x39ff88,
  red: 0xff3344,
  white: 0xe8f4ff,
};

/** Soft period palette for the restaurant (Guy Ritchie-style pastels). */
export const PASTEL = {
  cream: 0xf3e7d3,
  mint: 0xa9d6c4,
  sage: 0x8fb8a2,
  pink: 0xf2b8c0,
  salmon: 0xeb9f8c,
  butter: 0xf5e2a0,
  powder: 0xb5cfe6,
  lavender: 0xcdbfe3,
  wood: 0x6e4a36,
  woodDark: 0x4a2f22,
  brass: 0xc9a456,
  linen: 0xfbf7ef,
};

export const THEMES: Record<string, Theme> = {
  restaurant: {
    style: 'pastel',
    background: 0xefe4d4,
    fogNear: 14,
    fogFar: 45,
    hemiSky: 0xfff6ea,
    hemiGround: 0xb8a590,
    hemiIntensity: 1.9,
    sunColor: 0xffe6c8,
    sunIntensity: 1.3,
    floorBase: '#efe6d6',
    floorLine: '#9fc4b2',
    floorGlow: '',
    skyline: false,
  },
  alley: {
    style: 'neon',
    background: 0x07101c,
    fogNear: 8,
    fogFar: 34,
    hemiSky: 0x7fdcff,
    hemiGround: 0x201030,
    hemiIntensity: 1.4,
    sunColor: 0x9fe8ff,
    sunIntensity: 1.0,
    floorBase: '#101722',
    floorLine: '#23344a',
    floorGlow: 'rgba(25,240,255,0.35)',
    skyline: true,
  },
  rooftop: {
    style: 'neon',
    background: 0x140a24,
    fogNear: 14,
    fogFar: 55,
    hemiSky: 0xff9ad8,
    hemiGround: 0x1a1030,
    hemiIntensity: 1.5,
    sunColor: 0xffb0e0,
    sunIntensity: 1.2,
    floorBase: '#1c1428',
    floorLine: '#3c2850',
    floorGlow: 'rgba(138,92,255,0.4)',
    skyline: true,
  },
  datacenter: {
    style: 'neon',
    background: 0x050d12,
    fogNear: 8,
    fogFar: 36,
    hemiSky: 0x8affc8,
    hemiGround: 0x0c2020,
    hemiIntensity: 1.3,
    sunColor: 0xb0ffe0,
    sunIntensity: 0.9,
    floorBase: '#0c1618',
    floorLine: '#1c3a3a',
    floorGlow: 'rgba(57,255,136,0.35)',
    skyline: false,
  },
  club: {
    style: 'neon',
    background: 0x12041a,
    fogNear: 9,
    fogFar: 38,
    hemiSky: 0xff7ae0,
    hemiGround: 0x200830,
    hemiIntensity: 1.5,
    sunColor: 0xffa0ff,
    sunIntensity: 1.0,
    floorBase: '#180c22',
    floorLine: '#40205a',
    floorGlow: 'rgba(255,176,32,0.35)',
    skyline: true,
  },
};

const neonCache = new Map<number, THREE.MeshBasicMaterial>();

/** Unlit, fog-free material: reads as light through the haze. */
export function neonMat(color: number): THREE.MeshBasicMaterial {
  let m = neonCache.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, fog: false });
    neonCache.set(color, m);
  }
  return m;
}

let haloTex: THREE.CanvasTexture | null = null;

function haloTexture(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

const haloCache = new Map<number, THREE.MeshBasicMaterial>();

/** Additive glow card: fakes bloom around neon without post-processing. */
export function haloMat(color: number, opacity = 0.55): THREE.MeshBasicMaterial {
  const key = color * 100 + Math.round(opacity * 99);
  let m = haloCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      map: haloTexture(),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    haloCache.set(key, m);
  }
  return m;
}

const planeGeo = new THREE.PlaneGeometry(1, 1);

export function halo(color: number, w: number, h: number, opacity = 0.55): THREE.Mesh {
  const m = new THREE.Mesh(planeGeo, haloMat(color, opacity));
  m.scale.set(w, h, 1);
  m.renderOrder = 5;
  return m;
}

export function floorTexture(t: Theme, repeat: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  if (t.style === 'pastel') {
    // Checkerboard tiles with thin grout, like an old cafe floor.
    for (let i = 0; i < 4; i++) {
      g.fillStyle = (i + (i >> 1)) % 2 ? t.floorLine : t.floorBase;
      g.fillRect((i % 2) * 128, (i >> 1) * 128, 128, 128);
    }
    g.strokeStyle = 'rgba(90,70,60,0.25)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, 256, 256);
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 256);
    g.moveTo(0, 128);
    g.lineTo(256, 128);
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat / 2, repeat / 2);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  g.fillStyle = t.floorBase;
  g.fillRect(0, 0, 256, 256);
  // Glossy tile gradient.
  const grad = g.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.04)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = t.floorLine;
  g.lineWidth = 4;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = t.floorGlow;
  g.lineWidth = 1.5;
  g.strokeRect(3, 3, 250, 250);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dark facade with lit windows, for distant skyscrapers. */
export function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0814';
  g.fillRect(0, 0, 128, 256);
  const colors = ['#19f0ff', '#ff2bd6', '#ffd27a', '#8a5cff', '#e8f4ff'];
  for (let y = 4; y < 256; y += 10) {
    for (let x = 4; x < 128; x += 9) {
      if (Math.random() < 0.38) {
        g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        g.globalAlpha = 0.35 + Math.random() * 0.6;
        g.fillRect(x, y, 5, 6);
      }
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Canvas-drawn lettering: neon tubes, or (painted) gilded serif sign-writing. */
export function signTexture(text: string, color: string, painted = false): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = painted ? '700 92px Georgia, "Times New Roman", serif' : 'italic 800 96px "Arial Black", Arial, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 80;
  c.width = w;
  c.height = 160;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (painted) {
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(60,40,25,0.8)';
    g.strokeText(text, w / 2, 84);
    g.fillStyle = color;
    g.fillText(text, w / 2, 84);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, aspect: w / 160 };
  }
  g.shadowColor = color;
  g.shadowBlur = 28;
  g.lineWidth = 6;
  g.strokeStyle = color;
  g.strokeText(text, w / 2, 82);
  g.shadowBlur = 12;
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 160 };
}
