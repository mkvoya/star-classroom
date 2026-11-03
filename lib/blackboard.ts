export const BLACKBOARD_LIMIT = 10000;
export type Blackboard = { markdown: string; version: number; updatedAt: string | null };
export const EMPTY_BLACKBOARD: Blackboard = { markdown: '', version: 0, updatedAt: null };
