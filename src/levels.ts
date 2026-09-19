export type EnemyKind = 'gunner' | 'brawler';

/** Obstacle: centre x, centre z, width (x), depth (z), height. */
export type Obstacle = [number, number, number, number, number];

export interface LevelDef {
  name: string;
  obstacles: Obstacle[];
  spawns: [number, number][];
  waves: EnemyKind[];
  maxAlive: number;
}

const G: EnemyKind = 'gunner';
const B: EnemyKind = 'brawler';

// The player always starts at the origin looking towards -Z.
export const LEVELS: LevelDef[] = [
  {
    name: 'ВЕСТИБЮЛЬ',
    obstacles: [
      [-3, -5, 0.8, 0.8, 3],
      [3, -5, 0.8, 0.8, 3],
      [-3, 3, 0.8, 0.8, 3],
      [3, 3, 0.8, 0.8, 3],
      [0, -9, 4, 0.6, 1.1],
    ],
    spawns: [[-6, -12], [6, -12], [0, -14], [-9, -6], [9, -6]],
    waves: [G, G, G],
    maxAlive: 2,
  },
  {
    name: 'КОРИДОР',
    obstacles: [
      [-2.5, -4, 0.4, 18, 3.5],
      [2.5, -4, 0.4, 18, 3.5],
      [-1.2, -7, 0.9, 0.9, 1.1],
      [1.1, -11, 0.9, 0.9, 1.1],
    ],
    spawns: [[0, -14], [-0.8, -15], [0.8, -15], [0, 7], [0, 8]],
    waves: [G, G, G, B, G],
    maxAlive: 3,
  },
  {
    name: 'ДРАКА',
    obstacles: [
      [-4, -4, 1.5, 1.5, 1.0],
      [4, -4, 1.5, 1.5, 1.0],
      [0, 5, 3, 0.5, 1.4],
    ],
    spawns: [[-8, -8], [8, -8], [-8, 6], [8, 6], [0, -12]],
    waves: [B, B, G, B, B, G, B, B],
    maxAlive: 4,
  },
  {
    name: 'ПЕРЕКРЁСТНЫЙ ОГОНЬ',
    obstacles: [
      [-5, 0, 0.6, 4, 2.5],
      [5, 0, 0.6, 4, 2.5],
      [0, -6, 4, 0.6, 2.5],
      [0, 6, 4, 0.6, 2.5],
      [-7, -7, 1, 1, 3],
      [7, 7, 1, 1, 3],
    ],
    spawns: [[-11, 0], [11, 0], [0, -11], [0, 11], [-9, -9], [9, 9], [9, -9], [-9, 9]],
    waves: [G, G, B, G, G, B, G, G],
    maxAlive: 4,
  },
  {
    name: 'ФИНАЛ',
    obstacles: [
      [-3, -3, 1, 1, 3],
      [3, -3, 1, 1, 3],
      [-3, 3, 1, 1, 3],
      [3, 3, 1, 1, 3],
      [-8, 0, 0.5, 6, 1.2],
      [8, 0, 0.5, 6, 1.2],
      [0, -9, 6, 0.5, 1.2],
    ],
    spawns: [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, -14], [0, 14], [-14, 0], [14, 0]],
    waves: [G, B, G, G, B, G, B, G, G, B, G, G],
    maxAlive: 5,
  },
];
