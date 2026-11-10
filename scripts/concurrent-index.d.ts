export interface IndexSession {
  pid: number;
  application_name?: string;
  state?: string;
  query_age?: string;
  query?: string;
}

export function concurrentIndexNames(sqlText: string): string[];
export function assertIndexName(name: string): string;
export function sessionsBlockingIndexBuild(activity: IndexSession[], indexName: string): IndexSession[];
export function formatBlockingSessions(indexName: string, sessions: IndexSession[]): string;
