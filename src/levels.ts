import type { CivState } from './civilian';

export type EnemyKind = 'gunner' | 'rifleman' | 'brawler' | 'hostage';

export type Prop =
  | { t: 'room'; x0: number; z0: number; x1: number; z1: number; h: number }
  | { t: 'wall'; x0: number; z0: number; x1: number; z1: number; h: number; color?: number }
  | { t: 'window'; x0: number; x1: number; z: number; h: number }
  | { t: 'table'; x: number; z: number }
  | { t: 'tableSide'; x: number; z: number; rot: number }
  | { t: 'chair'; x: number; z: number; rot: number }
  | { t: 'booth'; x: number; z: number; w: number; rot: number }
  | { t: 'bar'; x0: number; x1: number; z: number }
  | { t: 'pillar'; x: number; z: number; s: number; h: number; color: number }
  | { t: 'block'; x: number; z: number; w: number; d: number; h: number; color: number }
  | { t: 'server'; x: number; z: number; w: number; d: number; h: number }
  | { t: 'sign'; text: string; x: number; y: number; z: number; rot: number; h: number; color: number }
  | { t: 'lamp'; x: number; z: number; y: number; color: number }
  | { t: 'door'; x: number; z: number; rot: number; color: number }
  | { t: 'dancefloor'; x: number; z: number; w: number; d: number }
  | { t: 'helipad'; x: number; z: number; r: number };

export interface LevelDef {
  name: string;
  theme: string;
  /** Walkable rectangle [x0, z0, x1, z1]. */
  bounds: [number, number, number, number];
  playerStart: [number, number];
  props: Prop[];
  spawns: [number, number][];
  exits: [number, number][];
  civilians: [number, number, number, CivState][];
  /** Feet position and heading of the boss lying on the floor. */
  vip?: [number, number, number];
  /** The boss's bodyguards kneeling over him: position and heading. */
  guards?: [number, number, number][];
  /** Where the first enemies come in, in order (then random spawns). */
  introSpawns?: [number, number][];
  /** One-line objective shown under the level name. */
  brief?: string;
  waves: EnemyKind[];
  maxAlive: number;
}

const G: EnemyKind = 'gunner';
const R: EnemyKind = 'rifleman';
const B: EnemyKind = 'brawler';
const H: EnemyKind = 'hostage';

const CYAN = 0x19f0ff;
const MAGENTA = 0xff2bd6;
const VIOLET = 0x8a5cff;
const AMBER = 0xffb020;
const GREEN = 0x39ff88;

/** A table with chairs on the given sides; returns props and the seat positions. */
function diningSet(x: number, z: number, sides: ('n' | 's' | 'e' | 'w')[]): { props: Prop[]; seats: [number, number, number][] } {
  const off = { n: [0, -0.62], s: [0, 0.62], e: [0.62, 0], w: [-0.62, 0] } as const;
  const props: Prop[] = [{ t: 'table', x, z }];
  const seats: [number, number, number][] = [];
  for (const s of sides) {
    const [dx, dz] = off[s];
    const cx = x + dx;
    const cz = z + dz;
    const rot = Math.atan2(x - cx, z - cz); // face the table
    props.push({ t: 'chair', x: cx, z: cz, rot });
    seats.push([cx, cz, rot]);
  }
  return { props, seats };
}

function restaurant(): LevelDef {
  const sets = [
    diningSet(-4.6, -4.0, ['n', 's']),
    diningSet(-4.9, 0.4, ['e', 'w']),
    diningSet(-1.6, -4.3, ['s', 'w']),
    diningSet(2.2, -4.5, ['n', 'e']),
    diningSet(5.2, -3.4, ['w', 's']),
    diningSet(4.8, 0.9, ['n', 'w']),
    diningSet(-2.8, 1.9, ['e']),
    diningSet(2.6, 1.9, ['w']),
  ];
  const seated: [number, number, number, CivState][] = [
    [...sets[0].seats[0], 'seated'],
    [...sets[0].seats[1], 'seated'],
    [...sets[1].seats[0], 'seated'],
    [...sets[2].seats[0], 'seated'],
    [...sets[3].seats[0], 'seated'],
    [...sets[3].seats[1], 'seated'],
    [...sets[4].seats[0], 'seated'],
    [...sets[5].seats[1], 'seated'],
  ];
  return {
    name: 'THE RESTAURANT',
    theme: 'restaurant',
    bounds: [-7.8, -7.8, 7.8, 2.8],
    playerStart: [0, 1.3],
    props: [
      { t: 'room', x0: -8, z0: -8, x1: 8, z1: 3, h: 3.2 },
      { t: 'wall', x0: -8, z0: -8, x1: 3.7, z1: -8, h: 3.2, color: MAGENTA },
      { t: 'wall', x0: 5.3, z0: -8, x1: 8, z1: -8, h: 3.2, color: MAGENTA },
      { t: 'wall', x0: -8, z0: -8, x1: -8, z1: -4.3, h: 3.2, color: CYAN },
      { t: 'wall', x0: -8, z0: -2.7, x1: -8, z1: 3, h: 3.2, color: CYAN },
      { t: 'wall', x0: 8, z0: -8, x1: 8, z1: -1.8, h: 3.2, color: VIOLET },
      { t: 'wall', x0: 8, z0: -0.2, x1: 8, z1: 3, h: 3.2, color: VIOLET },
      { t: 'window', x0: -8, x1: 8, z: 3, h: 3.2 },
      { t: 'bar', x0: -6.6, x1: 0.4, z: -6.2 },
      { t: 'pillar', x: -2.2, z: -1.4, s: 0.5, h: 3.2, color: CYAN },
      { t: 'pillar', x: 2.2, z: -1.4, s: 0.5, h: 3.2, color: MAGENTA },
      { t: 'tableSide', x: -1.15, z: -0.3, rot: 0.35 },
      { t: 'booth', x: -7.45, z: -6.6, w: 1.6, rot: Math.PI / 2 },
      { t: 'booth', x: 7.45, z: -5.6, w: 1.8, rot: -Math.PI / 2 },
      ...sets.flatMap((s) => s.props),
      { t: 'door', x: 4.5, z: -8, rot: 0, color: CYAN },
      { t: 'door', x: -8, z: -3.5, rot: Math.PI / 2, color: AMBER },
      { t: 'door', x: 8, z: -1, rot: -Math.PI / 2, color: GREEN },
      { t: 'sign', text: 'The Bar', x: -3.1, y: 2.55, z: -7.84, rot: 0, h: 0.42, color: MAGENTA },
      { t: 'sign', text: 'Kitchen', x: 4.5, y: 2.68, z: -7.84, rot: 0, h: 0.24, color: CYAN },
      { t: 'sign', text: 'Way Out', x: 7.84, y: 2.62, z: -1, rot: -Math.PI / 2, h: 0.24, color: GREEN },
      { t: 'sign', text: 'La Rosa · est. 1962', x: -7.84, y: 2.3, z: 0.2, rot: Math.PI / 2, h: 0.34, color: CYAN },
      ...[
        [-4.6, -4.0],
        [-4.9, 0.4],
        [-1.6, -4.3],
        [2.2, -4.5],
        [5.2, -3.4],
        [4.8, 0.9],
        [-2.8, 1.9],
        [2.6, 1.9],
      ].map(([x, z], i): Prop => ({ t: 'lamp', x, z, y: 2.5, color: i % 2 ? CYAN : MAGENTA })),
    ],
    spawns: [
      [4.5, -7.2],
      [-7.2, -3.5],
      [7.2, -1],
      [-3, -7.3],
      [-5.6, -7.3],
    ],
    exits: [
      [-7.6, -3.5],
      [4.5, -7.6],
      [7.6, -1],
    ],
    civilians: seated,
    vip: [0.9, 0.35, Math.PI / 2],
    guards: [
      [-0.15, -0.3, 0],
      [1.35, 0.95, Math.atan2(-1.1, -0.6)],
    ],
    // They burst in through the kitchen first, then the street door.
    introSpawns: [
      [4.5, -7.2],
      [4.5, -7.2],
      [-7.2, -3.5],
    ],
    brief: 'Protect the boss',
    waves: [G, H, R, G, H, R, G, R],
    maxAlive: 4,
  };
}

export const LEVELS: LevelDef[] = [
  restaurant(),
  {
    name: 'NEON ALLEY',
    theme: 'alley',
    bounds: [-2.2, -15, 2.2, 8],
    playerStart: [0, 0],
    props: [
      { t: 'wall', x0: -2.5, z0: -16, x1: -2.5, z1: 9, h: 5, color: CYAN },
      { t: 'wall', x0: 2.5, z0: -16, x1: 2.5, z1: 9, h: 5, color: MAGENTA },
      { t: 'block', x: -1.3, z: -7, w: 0.9, d: 0.9, h: 1.1, color: AMBER },
      { t: 'block', x: 1.2, z: -11, w: 0.9, d: 0.9, h: 1.1, color: CYAN },
      { t: 'block', x: 1.4, z: 4, w: 0.8, d: 1.4, h: 0.9, color: MAGENTA },
      { t: 'sign', text: 'SYNTH', x: -2.36, y: 3.2, z: -4, rot: Math.PI / 2, h: 0.7, color: MAGENTA },
      { t: 'sign', text: 'NO FUTURE', x: 2.36, y: 3.6, z: -9, rot: -Math.PI / 2, h: 0.5, color: CYAN },
      { t: 'sign', text: 'HOTEL', x: -2.36, y: 3.8, z: 3, rot: Math.PI / 2, h: 0.6, color: AMBER },
      { t: 'lamp', x: 0, z: -3, y: 3.4, color: CYAN },
      { t: 'lamp', x: 0, z: -10, y: 3.4, color: MAGENTA },
      { t: 'lamp', x: 0, z: 4, y: 3.4, color: VIOLET },
    ],
    spawns: [
      [0, -14],
      [-0.8, -14.5],
      [0.8, -14.5],
      [0, 7],
      [0.6, 7.5],
    ],
    exits: [
      [0, -14.8],
      [0, 7.8],
    ],
    civilians: [
      [-1.4, -4.5, 0.4, 'standing'],
      [1.5, -9.5, -0.3, 'standing'],
      [-1.2, 5, 2.8, 'standing'],
    ],
    waves: [G, R, G, H, B, R],
    maxAlive: 3,
  },
  {
    name: 'ROOFTOP',
    theme: 'rooftop',
    bounds: [-14, -14, 14, 14],
    playerStart: [0, 0],
    props: [
      { t: 'helipad', x: 0, z: 0, r: 3.2 },
      { t: 'block', x: -4, z: -4, w: 1.5, d: 1.5, h: 1.0, color: CYAN },
      { t: 'block', x: 4, z: -4, w: 1.5, d: 1.5, h: 1.0, color: MAGENTA },
      { t: 'block', x: 0, z: 5, w: 3, d: 0.5, h: 1.4, color: VIOLET },
      { t: 'block', x: -9, z: 7, w: 2.5, d: 2.5, h: 2.6, color: AMBER },
      { t: 'block', x: 9, z: -8, w: 2, d: 3, h: 2.2, color: CYAN },
      { t: 'wall', x0: -14.2, z0: -14.2, x1: 14.2, z1: -14.2, h: 1.1, color: MAGENTA },
      { t: 'wall', x0: -14.2, z0: 14.2, x1: 14.2, z1: 14.2, h: 1.1, color: MAGENTA },
      { t: 'wall', x0: -14.2, z0: -14.2, x1: -14.2, z1: 14.2, h: 1.1, color: CYAN },
      { t: 'wall', x0: 14.2, z0: -14.2, x1: 14.2, z1: 14.2, h: 1.1, color: CYAN },
    ],
    spawns: [
      [-8, -8],
      [8, -8],
      [-8, 6],
      [8, 6],
      [0, -12],
    ],
    exits: [],
    civilians: [],
    waves: [B, B, R, B, G, B, R, B],
    maxAlive: 4,
  },
  {
    name: 'DATA CENTER',
    theme: 'datacenter',
    bounds: [-12, -12, 12, 12],
    playerStart: [0, 0],
    props: [
      { t: 'room', x0: -12.2, z0: -12.2, x1: 12.2, z1: 12.2, h: 4 },
      { t: 'wall', x0: -12.2, z0: -12.2, x1: 12.2, z1: -12.2, h: 4, color: GREEN },
      { t: 'wall', x0: -12.2, z0: 12.2, x1: 12.2, z1: 12.2, h: 4, color: GREEN },
      { t: 'wall', x0: -12.2, z0: -12.2, x1: -12.2, z1: 12.2, h: 4, color: CYAN },
      { t: 'wall', x0: 12.2, z0: -12.2, x1: 12.2, z1: 12.2, h: 4, color: CYAN },
      { t: 'server', x: -5, z: 0, w: 0.8, d: 4.5, h: 2.3 },
      { t: 'server', x: 5, z: 0, w: 0.8, d: 4.5, h: 2.3 },
      { t: 'server', x: 0, z: -6, w: 4.5, d: 0.8, h: 2.3 },
      { t: 'server', x: 0, z: 6, w: 4.5, d: 0.8, h: 2.3 },
      { t: 'server', x: -8, z: -8, w: 1.2, d: 1.2, h: 2.8 },
      { t: 'server', x: 8, z: 8, w: 1.2, d: 1.2, h: 2.8 },
      { t: 'sign', text: 'CORE 07', x: 0, y: 3.2, z: -12.06, rot: 0, h: 0.5, color: GREEN },
    ],
    spawns: [
      [-10.5, 0],
      [10.5, 0],
      [0, -10.5],
      [0, 10.5],
      [-9, -9],
      [9, 9],
      [9, -9],
      [-9, 9],
    ],
    exits: [
      [-11.5, 0],
      [11.5, 0],
    ],
    civilians: [
      [-3, -3, 0.8, 'standing'],
      [3.2, 2.8, -2.4, 'standing'],
    ],
    waves: [G, R, G, H, B, R, G, R],
    maxAlive: 4,
  },
  {
    name: 'NIGHTCLUB',
    theme: 'club',
    bounds: [-13, -13, 13, 11],
    playerStart: [0, 2],
    props: [
      { t: 'room', x0: -13.2, z0: -13.2, x1: 13.2, z1: 11.2, h: 4.5 },
      { t: 'wall', x0: -13.2, z0: -13.2, x1: 13.2, z1: -13.2, h: 4.5, color: MAGENTA },
      { t: 'wall', x0: -13.2, z0: 11.2, x1: 13.2, z1: 11.2, h: 4.5, color: MAGENTA },
      { t: 'wall', x0: -13.2, z0: -13.2, x1: -13.2, z1: 11.2, h: 4.5, color: AMBER },
      { t: 'wall', x0: 13.2, z0: -13.2, x1: 13.2, z1: 11.2, h: 4.5, color: AMBER },
      { t: 'dancefloor', x: 0, z: -2, w: 8, d: 6 },
      { t: 'block', x: 0, z: -9, w: 5, d: 1.2, h: 1.2, color: CYAN },
      { t: 'pillar', x: -5, z: -2, s: 0.8, h: 4.5, color: MAGENTA },
      { t: 'pillar', x: 5, z: -2, s: 0.8, h: 4.5, color: MAGENTA },
      { t: 'pillar', x: -5, z: 4, s: 0.8, h: 4.5, color: CYAN },
      { t: 'pillar', x: 5, z: 4, s: 0.8, h: 4.5, color: CYAN },
      { t: 'bar', x0: 7, x1: 12, z: 8 },
      { t: 'block', x: -9, z: 7, w: 3, d: 0.6, h: 1.1, color: VIOLET },
      { t: 'sign', text: 'VOID CLUB', x: 0, y: 3.4, z: -13.06, rot: 0, h: 0.9, color: MAGENTA },
      { t: 'sign', text: 'VIP', x: -13.06, y: 3, z: 7, rot: Math.PI / 2, h: 0.5, color: AMBER },
      { t: 'lamp', x: -2, z: -2, y: 3.8, color: MAGENTA },
      { t: 'lamp', x: 2, z: -2, y: 3.8, color: CYAN },
    ],
    spawns: [
      [-12, -12],
      [12, -12],
      [-12, 10],
      [12, 10],
      [0, -12],
      [-12, 0],
      [12, 0],
    ],
    exits: [
      [-12.6, 0],
      [12.6, 0],
    ],
    civilians: [
      [-2, -3, 0.5, 'standing'],
      [1.5, -1, -2.5, 'standing'],
      [2.5, -4, 3.1, 'standing'],
      [-1, 0.5, 1.2, 'standing'],
      [-3, -1, -0.8, 'standing'],
      [0.5, -3.8, 2.2, 'standing'],
    ],
    waves: [H, R, G, B, R, H, G, R, B, G, R, G],
    maxAlive: 5,
  },
];
