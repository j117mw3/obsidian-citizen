import { isRecord, isFiniteNumber } from "./validation";

/** Browser statistics are not typed by lib.dom; validate only the fields we consume. */
export interface ConnectionStat {
  type: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  address?: string;
  state?: string;
  nominated?: boolean;
  currentRoundTripTime?: number;
  bytesSent?: number;
}
function connectionStat(value: unknown): ConnectionStat | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  for (const key of ["selectedCandidatePairId", "localCandidateId", "remoteCandidateId", "candidateType", "address", "state"])
    if (value[key] !== undefined && typeof value[key] !== "string") return undefined;
  for (const key of ["currentRoundTripTime", "bytesSent"])
    if (value[key] !== undefined && !isFiniteNumber(value[key])) return undefined;
  if (value.nominated !== undefined && typeof value.nominated !== "boolean") return undefined;
  return value as unknown as ConnectionStat;
}
export function connectionStats(report: RTCStatsReport): ConnectionStat[] {
  const values: unknown[] = [...report.values()];
  return values.map(connectionStat).filter((value): value is ConnectionStat => value !== undefined);
}
export function connectionStatById(report: RTCStatsReport, id: string | undefined): ConnectionStat | undefined {
  return id === undefined ? undefined : connectionStat(report.get(id));
}
