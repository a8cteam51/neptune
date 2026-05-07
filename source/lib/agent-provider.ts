export type AgentProvider = 'claude' | 'codex';

export function normalizeAgentProvider(
	value: unknown,
	label = 'provider',
): AgentProvider {
	if (value === undefined) return 'claude';
	if (value === 'claude' || value === 'codex') return value;
	throw new Error(`${label} must be either "claude" or "codex".`);
}
