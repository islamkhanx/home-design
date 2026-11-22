/** Findings describe model evidence, never manufacturing or code compliance. */
export interface ReviewFinding {
  rule: string
  severity: 'error' | 'warning'
  entityIds: string[]
  message: string
  details?: Record<string, unknown>
}
