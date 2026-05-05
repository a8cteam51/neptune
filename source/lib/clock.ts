// Time source for ISO timestamps in persisted records (config.updatedAt,
// PullMeta.pulledAt, etc.). Tests pass a deterministic clock to assert
// exact written values without freezing process time.
export type Clock = () => string;

export const realClock: Clock = () => new Date().toISOString();
