import type { SurfaceVector } from "./surface";

/** Immutable-arena broad phase; cells store identities, not copies of geometry. */
export class SurfaceSpatialGrid<T> {
  private readonly cells = new Map<string, Set<T>>();
  constructor(private readonly size = 8) {}
  add(value: T, center: SurfaceVector, extent = 0): void {
    this.visit(center.map(v => v - extent), center.map(v => v + extent), key => {
      let cell = this.cells.get(key); if (!cell) this.cells.set(key, cell = new Set());
      cell.add(value);
    });
  }
  remove(value: T, center: SurfaceVector, extent = 0): void {
    this.visit(center.map(v => v - extent), center.map(v => v + extent), key => {
      const cell = this.cells.get(key); cell?.delete(value); if (cell?.size === 0) this.cells.delete(key);
    });
  }
  query(low: readonly number[], high: readonly number[]): T[] {
    const found = new Set<T>(); this.visit(low, high, key => this.cells.get(key)?.forEach(value => found.add(value)));
    return [...found];
  }
  near(center: SurfaceVector, radius: number): T[] { return this.query(center.map(v => v - radius), center.map(v => v + radius)); }
  private visit(low: readonly number[], high: readonly number[], callback: (key: string) => void): void {
    for (let x = Math.floor(low[0] / this.size); x <= Math.floor(high[0] / this.size); x++)
      for (let y = Math.floor(low[1] / this.size); y <= Math.floor(high[1] / this.size); y++)
        for (let z = Math.floor(low[2] / this.size); z <= Math.floor(high[2] / this.size); z++) callback(`${x},${y},${z}`);
  }
}

interface PointNode { point: SurfaceVector; id: number; active: boolean; count: number; low: number[]; high: number[]; parent?: PointNode; left?: PointNode; right?: PointNode }
const distanceSq = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, axis) => sum + (value - b[axis]) ** 2, 0);

/** Deletable deterministic nearest-point tree for direction-preserving free slots. */
export class SurfacePointSlots {
  private readonly root?: PointNode;
  constructor(points: SurfaceVector[]) {
    const build = (items: Array<{ point: SurfaceVector; id: number }>, depth: number, parent?: PointNode): PointNode | undefined => {
      if (!items.length) return undefined;
      const axis = depth % 3; items.sort((a, b) => a.point[axis] - b.point[axis] || a.id - b.id);
      const middle = items.length >> 1, item = items[middle];
      const node: PointNode = { ...item, active: true, count: items.length, low: [...item.point], high: [...item.point], parent };
      node.left = build(items.slice(0, middle), depth + 1, node); node.right = build(items.slice(middle + 1), depth + 1, node);
      for (const child of [node.left, node.right]) if (child) for (let k = 0; k < 3; k++) { node.low[k] = Math.min(node.low[k], child.low[k]); node.high[k] = Math.max(node.high[k], child.high[k]); }
      return node;
    };
    this.root = build(points.map((point, id) => ({ point, id })), 0);
  }
  takeNearest(point: SurfaceVector): SurfaceVector | null {
    let best: PointNode | undefined, distance = Infinity;
    const bound = (node: PointNode) => distanceSq(point, point.map((v, k) => Math.max(node.low[k], Math.min(node.high[k], v))));
    const visit = (node?: PointNode): void => {
      if (!node?.count || bound(node) > distance) return;
      const d = distanceSq(point, node.point);
      if (node.active && (d < distance || d === distance && node.id < (best?.id ?? Infinity))) { best = node; distance = d; }
      const children = [node.left, node.right].filter((child): child is PointNode => !!child);
      children.sort((a, b) => bound(a) - bound(b) || a.id - b.id); children.forEach(visit);
    };
    visit(this.root);
    if (!best) return null;
    const selected = best as PointNode; selected.active = false;
    for (let node: PointNode | undefined = selected; node; node = node.parent) node.count--;
    return selected.point;
  }
}
