import * as THREE from 'three';

/** A floating 3D text panel drawn on a canvas; follows the player's gaze. */
export class TextPanel {
  readonly mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private current = '';
  private target = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), mat);
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  get text(): string {
    return this.mesh.visible ? this.current : '';
  }

  /** Big title line plus an optional small subtitle. */
  show(title: string, sub = '', color = '#ff2bd6'): void {
    const key = `${title}|${sub}|${color}`;
    this.mesh.visible = true;
    if (key === this.current) return;
    this.current = key;
    const g = this.ctx;
    g.clearRect(0, 0, 1024, 384);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 170;
    g.font = `italic 900 ${size}px "Arial Black", Arial, sans-serif`;
    while (g.measureText(title).width > 980 && size > 40) {
      size -= 10;
      g.font = `italic 900 ${size}px "Arial Black", Arial, sans-serif`;
    }
    // Neon tube: coloured glow and outline around a white-hot core.
    const y = sub ? 150 : 192;
    g.shadowColor = color;
    g.shadowBlur = 36;
    g.lineWidth = 10;
    g.strokeStyle = color;
    g.strokeText(title, 512, y);
    g.shadowBlur = 14;
    g.fillStyle = '#ffffff';
    g.fillText(title, 512, y);
    if (sub) {
      g.font = '600 44px Arial, sans-serif';
      g.shadowColor = '#19f0ff';
      g.shadowBlur = 16;
      g.fillStyle = '#d8faff';
      g.fillText(sub, 512, 300);
    }
    g.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /** Float ~2.3 m in front of the head, easing so it doesn't glue to the view. */
  follow(head: THREE.Vector3, forward: THREE.Vector3, realDt: number, snap = false): void {
    const f = _f.set(forward.x, 0, forward.z);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    this.target.copy(head).addScaledVector(f, 2.3);
    this.target.y = head.y + 0.1;
    if (snap) this.mesh.position.copy(this.target);
    else this.mesh.position.lerp(this.target, Math.min(1, realDt * 3));
    this.mesh.lookAt(head);
  }
}

const _f = new THREE.Vector3();
