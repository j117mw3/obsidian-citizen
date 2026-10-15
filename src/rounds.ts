export type RoundPhase = "combat" | "supernova" | "waiting" | "countdown";

export interface RoundScore { playerId: string; kills: number; deaths: number }
export interface LayoutRequirement { playerId: string; revision: number }
export interface EliminationEvent {
  id: string;
  roundId: number;
  attackerId: string;
  victimId: string;
  attackerScore: number;
  at: number;
}
export interface RoundSnapshot {
  epoch: number;
  roundId: number;
  phase: RoundPhase;
  phaseRemainingMs: number;
  winnerId: string;
  scores: RoundScore[];
  layoutRequirements: LayoutRequirement[];
}
