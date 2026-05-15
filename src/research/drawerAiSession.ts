/** Session-only AI endpoint prefs (research drawer). Mirrors `snapshot.aiConfig`; API key never exits session. */

export type DrawerAiSessionState = {
  baseUrl: string
  /** Fallback when role-specific models are blank. */
  modelName: string
  /** Seed / expand / refine — optional override. */
  outlineModel: string
  /** Workspace notes assistant (Ctrl+Enter) — optional override. */
  workspaceModel: string
  apiKey: string
  linked: boolean
}

export const DRAWER_AI_SESSION_KEY = 'overview-drawer-ai-config'

export function readDrawerAiFromSession(): DrawerAiSessionState {
  try {
    const raw = sessionStorage.getItem(DRAWER_AI_SESSION_KEY)
    if (!raw) {
      return { baseUrl: '', modelName: '', outlineModel: '', workspaceModel: '', apiKey: '', linked: false }
    }
    const o = JSON.parse(raw) as Record<string, unknown>
    const modelName = typeof o.modelName === 'string' ? o.modelName : ''
    return {
      baseUrl: typeof o.baseUrl === 'string' ? o.baseUrl : '',
      modelName,
      outlineModel: typeof o.outlineModel === 'string' ? o.outlineModel : '',
      workspaceModel: typeof o.workspaceModel === 'string' ? o.workspaceModel : '',
      apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
      linked: true,
    }
  } catch {
    return { baseUrl: '', modelName: '', outlineModel: '', workspaceModel: '', apiKey: '', linked: false }
  }
}
