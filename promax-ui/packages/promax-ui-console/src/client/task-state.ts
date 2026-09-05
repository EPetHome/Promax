export const INFORMATION_KEYS = [
  'goal', 'target_user', 'scenario', 'pain_point', 'scope', 'constraint',
  'success_criteria', 'competitive_difference', 'requirements_priority',
] as const

export type InformationKey = typeof INFORMATION_KEYS[number]
