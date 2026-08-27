const STYLE_ID = 'promax-ui-console-styles'
let consumers = 0

export function installPromaxConsoleStyles(): () => void {
  consumers += 1
  const existing = document.getElementById(STYLE_ID)
  if (existing === null) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = PROMAX_CONSOLE_CSS
    document.head.append(style)
  }
  return () => {
    consumers = Math.max(0, consumers - 1)
    if (consumers === 0) document.getElementById(STYLE_ID)?.remove()
  }
}

export const PROMAX_CONSOLE_CSS = String.raw`
* { box-sizing: border-box; }
.promax-app, .promax-sidebar, .promax-console, .promax-dialog { font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
button, input, select { font: inherit; }
.promax-icon-button, .promax-nav-button, .promax-sidebar-button, .promax-button { color: var(--dsw-alias-label-primary); }
.promax-icon-button:focus-visible, .promax-nav-button:focus-visible, .promax-sidebar-button:focus-visible, .promax-button:focus-visible, .promax-input:focus-visible, .promax-select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

.promax-app { min-height: 100vh; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.promax-console { display: grid; grid-template-columns: 216px minmax(0, 1fr); min-height: 100%; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.promax-console--standalone { min-height: 100vh; }
.promax-console-rail { display: flex; min-height: 100%; flex-direction: column; gap: 20px; padding: 18px 12px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-sidebar-fill); }
.promax-console-brand { display: flex; align-items: center; gap: 9px; min-height: 34px; padding: 0 8px; font-size: 15px; font-weight: 650; }
.promax-console-brand-mark { display: grid; width: 25px; height: 25px; place-items: center; border-radius: 7px; background: var(--dsw-alias-brand-primary); color: var(--dsw-promax-on-accent); }
.promax-console-nav { display: grid; gap: 3px; }
.promax-nav-button { display: flex; width: 100%; align-items: center; gap: 10px; min-height: 38px; padding: 0 10px; border: 0; border-radius: 8px; background: var(--dsw-specific-sidebar-fill); cursor: pointer; text-align: left; }
.promax-nav-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-nav-button[aria-current="page"] { background: var(--dsw-alias-interactive-bg-active); font-weight: 620; }
.promax-console-account { margin-top: auto; padding: 12px 8px 2px; border-top: 1px solid var(--dsw-alias-border-l1); }
.promax-account-name { overflow: hidden; font-size: 13px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }
.promax-account-meta { overflow: hidden; margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.promax-console-content { min-width: 0; overflow: auto; }
.promax-console-header { position: sticky; top: 0; z-index: 2; display: flex; min-height: 70px; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 28px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.promax-console-heading h1 { margin: 0; font-size: 20px; line-height: 1.25; letter-spacing: -0.02em; }
.promax-console-heading p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.promax-header-actions { display: flex; align-items: center; gap: 8px; }
.promax-page { width: min(1120px, 100%); margin: 0 auto; padding: 28px; }
.promax-section { margin-top: 28px; }
.promax-section-heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.promax-section-heading h2 { margin: 0; font-size: 15px; }
.promax-section-heading p { margin: 3px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }

.promax-button, .promax-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 34px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); cursor: pointer; font-size: 13px; }
.promax-button { padding: 0 12px; }
.promax-icon-button { width: 34px; padding: 0; }
.promax-button:hover, .promax-icon-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-button--primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-promax-on-accent); }
.promax-button--primary:hover { background: var(--dsw-alias-button-primary-hover); color: var(--dsw-promax-on-accent); }
.promax-button:disabled, .promax-icon-button:disabled { cursor: not-allowed; opacity: .52; }
.promax-input, .promax-select { width: 100%; height: 36px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); padding: 0 10px; }
.promax-field { display: grid; gap: 6px; min-width: 0; }
.promax-field > span { color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 560; }

.promax-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
.promax-metric { min-width: 0; padding: 17px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.promax-metric-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.promax-metric-value { margin-top: 8px; font-size: 27px; font-weight: 650; letter-spacing: -0.04em; }
.promax-metric-note { margin-top: 5px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); overflow: hidden; }
.promax-attention-list { display: grid; }
.promax-attention-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 14px 16px; border-top: 1px solid var(--dsw-alias-border-l1); }
.promax-attention-item:first-child { border-top: 0; }
.promax-attention-title { font-size: 13px; font-weight: 610; }
.promax-attention-meta { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.promax-empty { padding: 34px 18px; color: var(--dsw-alias-label-secondary); text-align: center; font-size: 13px; }

.promax-status { display: inline-flex; align-items: center; gap: 6px; min-height: 25px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 650; }
.promax-status::before { width: 6px; height: 6px; border-radius: 999px; background: currentColor; content: ""; }
.promax-status--never { background: var(--dsw-promax-status-never-bg); color: var(--dsw-alias-state-error-primary); }
.promax-status--stale { background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-state-warn-primary); }
.promax-status--ok { background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); }

.promax-table-wrap { overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; }
.promax-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.promax-table th { padding: 10px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 620; text-align: left; white-space: nowrap; }
.promax-table td { padding: 13px 14px; border-top: 1px solid var(--dsw-alias-border-l1); vertical-align: middle; }
.promax-table tbody tr:first-child td { border-top: 0; }
.promax-table tbody tr:hover td { background: var(--dsw-alias-interactive-bg-hover); }
.promax-primary-cell { font-weight: 610; }
.promax-secondary-line { margin-top: 3px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-number { font-variant-numeric: tabular-nums; }
.promax-filter-bar { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)) auto; gap: 10px; align-items: end; margin-bottom: 14px; }

.promax-tracks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.promax-track { min-width: 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; overflow: hidden; }
.promax-track--hook { background: var(--dsw-promax-track-hook-bg); }
.promax-track--llm { background: var(--dsw-promax-track-llm-bg); }
.promax-track-header { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 17px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.promax-track-name { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 650; }
.promax-track-dot { width: 8px; height: 8px; border-radius: 99px; background: currentColor; }
.promax-track--hook .promax-track-name, .promax-track--hook .promax-bar-fill { color: var(--dsw-promax-track-hook); }
.promax-track--llm .promax-track-name, .promax-track--llm .promax-bar-fill { color: var(--dsw-promax-track-llm); }
.promax-track-total { font-size: 24px; font-weight: 660; font-variant-numeric: tabular-nums; }
.promax-track-caption { margin-top: 2px; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: right; }
.promax-series { display: grid; gap: 13px; padding: 16px; background: var(--dsw-alias-bg-base); }
.promax-bar-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 12px; }
.promax-bar-label span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-bar-track { height: 6px; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.promax-bar-fill { height: 100%; border-radius: inherit; background: currentColor; }

.promax-state-panel { display: grid; min-height: 360px; place-items: center; padding: 28px; color: var(--dsw-alias-label-secondary); text-align: center; }
.promax-state-panel strong { display: block; margin-bottom: 6px; color: var(--dsw-alias-label-primary); }
.promax-alert { margin-bottom: 14px; padding: 11px 13px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-promax-status-never-bg); color: var(--dsw-alias-state-error-primary); font-size: 12px; }

.promax-login { display: grid; grid-template-columns: 1fr; min-height: 100%; place-items: center; padding: 28px; background: var(--dsw-alias-bg-layer-1); }
.promax-login-card { width: min(392px, 100%); padding: 30px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-base); box-shadow: 0 18px 52px var(--dsw-promax-shadow); }
.promax-login-mark { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 10px; background: var(--dsw-alias-brand-primary); color: var(--dsw-promax-on-accent); }
.promax-login h1 { margin: 18px 0 0; font-size: 22px; letter-spacing: -0.025em; }
.promax-login-intro { margin: 7px 0 22px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.55; }
.promax-login-form { display: grid; gap: 14px; }
.promax-login-form .promax-button { width: 100%; margin-top: 4px; }
.promax-login-foot { margin: 18px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }

.promax-sidebar-action { display: flex; width: calc(100% + 4px); height: 42px; align-items: center; gap: 8px; margin: 4px -2px; padding: 0 10px 0 8px; overflow: hidden; border: 0; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; white-space: nowrap; }
.promax-sidebar-action:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-sidebar-action--rail { width: 36px; height: 36px; justify-content: center; gap: 0; margin: 8px 0 10px; padding: 0; border-radius: 50%; }

.promax-agent-status { display: flex; width: 100%; min-height: 34px; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-agent-status-summary, .promax-agent-status-facts { display: flex; min-width: 0; align-items: center; gap: 7px; }
.promax-agent-status-summary strong { flex: none; color: var(--dsw-alias-label-primary); font-size: 12px; }
.promax-agent-status-dot { width: 7px; height: 7px; flex: none; border-radius: 99px; background: currentColor; }
.promax-agent-status-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-agent-status-facts { flex: none; }
.promax-agent-status-fact { padding: 2px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 99px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.promax-agent-status-trajectory { color: var(--dsw-alias-label-tertiary); }
.promax-agent-status--active { color: var(--dsw-alias-brand-primary); }
.promax-agent-status--warning { color: var(--dsw-alias-state-warn-primary); }
.promax-agent-status--error { color: var(--dsw-alias-state-error-primary); }
.promax-agent-status--idle { color: var(--dsw-alias-state-success-primary); }

.promax-dialog-backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 22px; background: var(--dsw-promax-backdrop); }
.promax-dialog { position: relative; width: min(1240px, 96vw); height: min(820px, 92vh); overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-base); box-shadow: 0 24px 70px var(--dsw-promax-shadow); }
.promax-dialog .promax-console { height: 100%; }
.promax-dialog .promax-console-header { padding-right: 72px; }
.promax-dialog-close { position: absolute; top: 18px; right: 18px; z-index: 5; }

@media (max-width: 900px) {
  .promax-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .promax-filter-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .promax-filter-bar .promax-button { align-self: end; }
}
@media (max-width: 680px) {
  .promax-console { grid-template-columns: 64px minmax(0, 1fr); }
  .promax-console-rail { padding-inline: 9px; }
  .promax-console-brand > span:last-child, .promax-nav-button > span, .promax-console-account { display: none; }
  .promax-console-brand, .promax-nav-button { justify-content: center; padding-inline: 0; }
  .promax-page { padding: 20px 14px; }
  .promax-console-header { padding-inline: 16px; }
  .promax-metrics, .promax-tracks, .promax-filter-bar { grid-template-columns: 1fr; }
  .promax-dialog-backdrop { padding: 0; }
  .promax-dialog { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
  .promax-agent-status { align-items: flex-start; flex-direction: column; gap: 5px; }
  .promax-agent-status-facts { flex-wrap: wrap; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
`
