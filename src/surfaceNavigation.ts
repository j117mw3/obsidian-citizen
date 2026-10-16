import type { SurfacePlayerState } from "./surfacePhysics";
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum,n,i)=>sum+n*b[i],0);
/** Bearings follow the tangent plane, not a fixed world up or graph center. */
export function surfacePoleGuides(state: SurfacePlayerState) {
  const length = Math.hypot(...state.position), up = state.position.map(n=>n/length);
  const forward = state.forward, right = [forward[1]*up[2]-forward[2]*up[1],forward[2]*up[0]-forward[0]*up[2],forward[0]*up[1]-forward[1]*up[0]];
  return ([1,-1] as const).map(sign => {
    const normal = [0,sign,0], cosine = Math.max(-1,Math.min(1,up[1]*sign));
    const tangent = normal.map((n,i)=>n-up[i]*cosine), magnitude = Math.hypot(...tangent);
    const distance = (state.radius ?? 27)*Math.acos(cosine);
    const bearing = magnitude < 1e-8 ? 0 : Math.atan2(dot(right,tangent),dot(forward,tangent));
    return { name: sign===1 ? "North" : "South", distance, bearing, atExit: distance<=3, ambiguous: magnitude<1e-8, behind: Math.abs(bearing)>Math.PI/2 };
  });
}
