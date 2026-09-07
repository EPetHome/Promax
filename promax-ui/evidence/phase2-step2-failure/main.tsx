import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { applyStandaloneTheme } from '../../packages/promax-ui-brand/src/index.ts'
import { PromaxTeamSessionHeader, PromaxWorkspaceOverlay, type WorkspaceShellActions } from '../../packages/promax-ui-console/src/client/PromaxWorkspaceShell.tsx'
import { PRODUCT_PRESET_ID, PRODUCT_TEAM_ID, bindTeamSession, selectTeamSession, syncProductTeamRuntimeRoster } from '../../packages/promax-ui-console/src/client/team-state.ts'

applyStandaloneTheme()
const roster = ['customer_research', 'product_discovery', 'requirement_management', 'solution_design', 'requirement_review', 'user_analysis', 'quality_judge']
syncProductTeamRuntimeRoster({ presetId: PRODUCT_PRESET_ID, revision: 1, members: roster.map(memberId => ({ memberId, displayName: memberId, objective: '失败分支验收', role: 'worker', enabled: true, provides: [], requires: [] })), artifacts: roster.map(producedBy => ({ relativePath: `deliverables/{task_key}/${producedBy}.md`, producedBy, required: true })) })
bindTeamSession({ sessionId: 'failure-test', teamId: PRODUCT_TEAM_ID, revision: 1, presetId: PRODUCT_PRESET_ID, workspaceId: 'product', sessionName: '计划失败界面验收（故障注入）', taskKey: '计划失败界面验收', dispatchPlanId: 'failure-plan', dispatchState: 'planning', dispatchDemand: '验证模型没有返回完整结构化计划时，页面保留重新判断入口，不会自动开跑。', dispatchAttachmentPaths: [] })
selectTeamSession(PRODUCT_TEAM_ID, 'failure-test', 'product')
const workspaces = { items: [{ workspaceId: 'product', path: '/tmp/dispatch-failure-ui-test', title: '产品', sessionIds: ['failure-test'] }], archivedSessionIds: [], state: 'idle' as const, error: null }
const sessions = { ids: ['failure-test'], byId: { 'failure-test': { id: 'failure-test', displayTitle: '计划失败界面验收（故障注入）', running: false, blank: false, updatedAt: 1, agentPreset: PRODUCT_PRESET_ID } }, current: 'failure-test', phase: 'ready' }
const forbidden = async (): Promise<never> => { throw new Error('故障夹具禁止业务执行') }

function FailureCase() {
  const [retried, setRetried] = useState(false)
  const snapshot = { nodes: [{ kind: 'assistant', turn: 1, messageId: 'invalid-plan', blocks: [{ kind: 'text', text: '本次无法生成计划' }] }], turnTimings: new Map([[1, { startTime: 1, endTime: 2 }]]), running: retried }
  const actions: WorkspaceShellActions = {
    startSession: forbidden, openSession() {}, clearSession() {}, archiveSession: forbidden, renameSession: forbidden,
    saveTaskAttachments: forbidden, beginDispatchPlan: forbidden, confirmDispatchPlan: forbidden,
    readTaskRunFiles: forbidden, readTaskHistory: async () => [], openTaskFolder: forbidden, stopTeamTask: forbidden,
    teamRoutingAvailable: true,
    sendSessionMessage: async (_sessionId, text) => {
      if (!text.includes('PROMAX_DISPATCH_PLAN_V1_START')) throw new Error('未收到真实重新规划请求')
      setRetried(true)
    },
  }
  return <div className="app-shell" style={{ height: '100vh' }}>
    <PromaxTeamSessionHeader sessionId="failure-test" useSession={selector => selector(snapshot)} />
    <PromaxWorkspaceOverlay useWorkspaces={selector => selector(workspaces)} useSessions={selector => selector(sessions)} {...actions} layout={{ toggleSidebar() {}, openDetails() {}, closeDetails() {} }} />
  </div>
}
createRoot(document.getElementById('root')!).render(<FailureCase />)
