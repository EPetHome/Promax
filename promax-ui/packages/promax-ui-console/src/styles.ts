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

.promax-shell-layer { position: absolute; inset: 0; z-index: 0; pointer-events: none; color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); }
.promax-shell-layer button, .promax-shell-layer input, .promax-shell-layer textarea { font: inherit; }
.promax-shell-layer button:focus-visible, .promax-shell-layer input:focus-visible, .promax-shell-layer textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

body:has(.promax-shell-layer) [class*="_composerHero"] [class*="_heroWorkspaceRow"] { display: none; }

*:has(> [data-shell-overlay] .promax-team-rail--open) > :nth-child(2) { padding-inline-end: 276px; transition: padding-inline-end var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
*:has(> [data-shell-overlay] .promax-team-rail--collapsed) > :nth-child(2) { padding-inline-end: 56px; transition: padding-inline-end var(--ds-transition-duration-fast) var(--ds-ease-in-out); }

.promax-eyebrow { display: block; margin-bottom: 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 680; letter-spacing: .08em; text-transform: uppercase; }
.promax-context-rail-button { display: grid; width: 36px; height: 36px; margin: 8px auto; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.promax-context-rail-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-session-browser { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 9px; padding: 11px 5px 7px; }
.promax-session-browser-heading, .promax-team-home-sessions-head { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 7px; }
.promax-session-browser-heading strong, .promax-team-home-sessions-head strong { display: block; overflow: hidden; font-size: 13px; font-weight: 670; text-overflow: ellipsis; white-space: nowrap; }
.promax-new-session { display: flex; min-height: 38px; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 12px; font-weight: 620; }
.promax-new-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-new-session:disabled { cursor: not-allowed; opacity: .48; }
.promax-session-note { padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45; }
.promax-session-list { display: grid; min-height: 0; align-content: start; gap: 3px; overflow: auto; }
.promax-session-row { display: flex; width: 100%; min-height: 43px; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-session-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-session-row[aria-current="page"] { background: var(--dsw-alias-interactive-bg-active); }
.promax-session-row-copy { display: grid; min-width: 0; gap: 3px; }
.promax-session-row-title { overflow: hidden; font-size: 12px; font-weight: 540; text-overflow: ellipsis; white-space: nowrap; }
.promax-session-row-copy small { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-session-indicator { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-alias-border-l2); }
.promax-session-indicator--running { background: var(--dsw-alias-brand-primary); }
.promax-session-indicator--done { background: var(--dsw-alias-state-success-primary); }
.promax-session-empty { padding: 20px 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.promax-session-error, .promax-team-page-error { padding: 8px 9px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-promax-status-never-bg); color: var(--dsw-alias-state-error-primary); font-size: 10px; }
.promax-session-browser-foot { margin: auto 5px 0; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }

.promax-team-rail { position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 10; pointer-events: auto; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-sidebar-fill); box-shadow: -10px 0 30px var(--dsw-promax-shadow); transition: width var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.promax-team-rail--open { width: 276px; }
.promax-team-rail--collapsed { width: 56px; }
.promax-team-rail-content { display: flex; height: 100%; min-height: 0; flex-direction: column; padding: 18px 12px 12px; }
.promax-team-rail-header { display: flex; min-height: 44px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
.promax-team-rail-header h2 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
.promax-team-rail-actions { display: flex; gap: 5px; }
.promax-team-create { display: grid; gap: 8px; margin: 12px 0 8px; padding: 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.promax-team-create label { color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 650; }
.promax-team-create > div { display: flex; justify-content: flex-end; gap: 6px; }
.promax-team-nav { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 4px; margin-top: 15px; overflow: hidden; }
.promax-team-nav-pages { display: grid; min-height: 0; align-content: start; gap: 4px; overflow: auto; }
.promax-team-nav-label { padding: 14px 8px 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 680; letter-spacing: .06em; text-transform: uppercase; }
.promax-team-nav-row { display: grid; width: 100%; min-height: 54px; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 6px 8px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-team-nav-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-team-nav-row[aria-current="page"] { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-active); }
.promax-team-nav-icon { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-base); }
.promax-team-nav-row > span:nth-child(2) { display: grid; min-width: 0; gap: 3px; }
.promax-team-nav-row strong { overflow: hidden; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.promax-team-nav-row small { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-team-nav-status { min-width: 34px; padding: 3px 5px; border-radius: 99px; font-size: 9px; font-weight: 650; text-align: center; }
.promax-team-nav-status--published { background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); }
.promax-team-nav-status--draft { background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-state-warn-primary); }
.promax-team-pagination, .promax-pagination { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 6px; padding: 9px 3px 3px; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-team-pagination .promax-button, .promax-pagination .promax-button { min-width: 56px; min-height: 28px; padding-inline: 8px; font-size: 9px; }
.promax-team-rail-error { margin-top: 10px; padding: 8px 9px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-promax-status-never-bg); color: var(--dsw-alias-state-error-primary); font-size: 10px; }
.promax-team-rail-foot { display: grid; gap: 7px; margin-top: auto; padding: 11px 5px 2px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.5; }
.promax-team-rail-foot .promax-sidebar-action { width: 100%; height: 36px; margin: 0; padding-inline: 7px; }
.promax-team-rail-toggle { display: flex; width: 100%; height: 100%; align-items: center; gap: 12px; padding-top: 20px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; flex-direction: column; }
.promax-team-rail-toggle span { font-size: 10px; font-weight: 650; writing-mode: vertical-rl; }

.promax-team-home { position: absolute; inset: 0 276px 0 0; z-index: 5; display: grid; height: 100%; min-width: 0; min-height: 0; overflow: hidden; grid-template-columns: minmax(220px, 252px) minmax(0, 1fr); pointer-events: auto; background: var(--dsw-alias-bg-base); transition: inset-inline-end var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.promax-team-home--rail-collapsed { inset-inline-end: 56px; }
.promax-team-home-sessions { display: flex; min-height: 0; flex-direction: column; gap: 9px; padding: 18px 11px 12px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-sidebar-fill); }
.promax-count-badge { display: grid; min-width: 24px; height: 24px; place-items: center; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 650; }
.promax-team-home-main { display: flex; height: 100%; min-width: 0; min-height: 0; overflow: hidden; flex-direction: column; background: var(--dsw-alias-bg-base); }
.promax-team-home-header { z-index: 2; display: flex; min-height: 92px; flex: none; align-items: center; justify-content: space-between; gap: 20px; padding: 18px 28px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.promax-team-breadcrumb { margin-bottom: 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.promax-team-title-line { display: flex; align-items: center; gap: 9px; }
.promax-team-title-line h1 { margin: 0; font-size: 21px; letter-spacing: -.025em; }
.promax-team-home-header p { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-team-state { padding: 3px 7px; border-radius: 99px; font-size: 9px; font-weight: 680; }
.promax-team-state--published { background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); }
.promax-team-state--draft { background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-state-warn-primary); }
.promax-team-home-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.promax-team-interaction { width: min(980px, 100%); min-height: 0; flex: 1; margin: 0 auto; padding: 40px 28px 70px; overflow: auto; }
.promax-team-prompt-block { display: grid; gap: 16px; padding: 24px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 14px 40px var(--dsw-promax-shadow); }
.promax-team-prompt-block h2 { margin: 0; font-size: 22px; letter-spacing: -.03em; }
.promax-team-prompt-block p { margin: 7px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.promax-team-prompt { width: 100%; min-height: 128px; resize: vertical; padding: 15px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.55; }
.promax-team-prompt::placeholder { color: var(--dsw-alias-label-secondary); }
.promax-team-prompt:disabled { cursor: not-allowed; opacity: .58; }
.promax-team-prompt-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.promax-team-runtime { margin-top: 30px; }
.promax-team-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
.promax-team-section-heading h2, .promax-team-section-heading h3 { margin: 0; font-size: 14px; }
.promax-team-section-heading p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.promax-team-member-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.promax-team-member-card { display: flex; min-width: 0; gap: 11px; padding: 15px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.promax-team-member-avatar { display: grid; width: 34px; height: 34px; flex: none; place-items: center; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.promax-team-member-copy { min-width: 0; flex: 1; }
.promax-team-member-copy > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.promax-team-member-copy strong { font-size: 12px; }
.promax-team-member-copy > div span { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-team-member-copy p { margin: 6px 0 8px; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45; }
.promax-team-member-copy small { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-runtime-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.promax-team-page-error { position: sticky; bottom: 16px; width: min(640px, calc(100% - 56px)); margin: 16px auto; }

.promax-team-editor { width: min(760px, 100%); min-height: 0; flex: 1; margin: 0 auto; padding: 32px 28px 70px; overflow: auto; }
.promax-team-editor > .promax-team-section-heading { justify-content: flex-start; align-items: flex-start; }
.promax-team-editor > .promax-team-section-heading > .promax-button { flex: none; margin-top: 1px; }
.promax-team-settings-layout { display: grid; min-height: 480px; grid-template-columns: 172px minmax(0, 1fr); overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-alias-bg-base); }
.promax-team-settings-tabs { display: grid; align-content: start; gap: 4px; padding: 12px; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.promax-team-settings-tab { display: grid; min-height: 42px; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; text-align: left; }
.promax-team-settings-tab:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.promax-team-settings-tab[aria-selected="true"] { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); font-weight: 650; }
.promax-team-settings-tab small { display: grid; min-width: 19px; height: 19px; place-items: center; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-team-settings-panel { min-width: 0; padding: 22px; }
.promax-settings-stack { display: grid; gap: 20px; }
.promax-team-editor-grid { display: grid; grid-template-columns: minmax(180px, .7fr) minmax(260px, 1.3fr); gap: 12px; }
.promax-team-editor-block { margin-top: 26px; }
.promax-team-editor-block--first { margin-top: 0; }
.promax-team-member-editor { display: grid; grid-template-columns: 28px minmax(150px, .65fr) minmax(240px, 1.35fr); align-items: center; gap: 9px; padding: 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); }
.promax-team-member-editor--worker { grid-template-columns: minmax(90px, .45fr) minmax(130px, .6fr) minmax(220px, 1.35fr) 34px; }
.promax-team-worker-editors { display: grid; gap: 7px; }
.promax-member-id { overflow: hidden; color: var(--dsw-alias-label-secondary); font-family: var(--dsw-font-family-mono, ui-monospace, monospace); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.promax-team-empty { padding: 24px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 11px; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.promax-settings-card { display: grid; gap: 13px; padding: 16px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.promax-settings-card > div:first-child > strong, .promax-settings-intro strong { font-size: 13px; }
.promax-settings-card p, .promax-settings-intro p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.promax-workspace-summary { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.promax-workspace-summary > span { display: grid; min-width: 0; gap: 3px; }
.promax-workspace-summary strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.promax-workspace-summary small { overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.promax-workspace-summary > .promax-button { width: 86px; min-width: 86px; flex: none; white-space: nowrap; }
.promax-settings-intro { display: flex; min-height: 52px; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.promax-settings-intro > span, .promax-release-summary > span { flex: none; padding: 4px 8px; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 9px; font-weight: 650; }
.promax-config-methods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.promax-config-methods > button { display: grid; min-height: 70px; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 10px; padding: 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-config-methods > button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-config-methods > button[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.promax-config-methods > button > svg { color: var(--dsw-alias-label-secondary); }
.promax-config-methods > button > span { display: grid; gap: 4px; }
.promax-config-methods strong { font-size: 11px; }
.promax-config-methods small { color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.4; }
.promax-config-method-panel { display: grid; gap: 16px; }
.promax-prompt-recipes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.promax-prompt-recipe { display: grid; min-height: 92px; align-content: start; gap: 7px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-prompt-recipe:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-prompt-recipe[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.promax-prompt-recipe:disabled { cursor: not-allowed; opacity: .58; }
.promax-prompt-recipe strong { font-size: 11px; }
.promax-prompt-recipe span { color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
.promax-textarea { width: 100%; min-height: 104px; resize: vertical; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 11px; line-height: 1.55; }
.promax-textarea--compact { min-height: 78px; }
.promax-textarea::placeholder { color: var(--dsw-alias-label-secondary); }
.promax-textarea:disabled { cursor: not-allowed; opacity: .58; }
.promax-member-prompt-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.promax-config-import-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.promax-button--disabled { cursor: not-allowed; opacity: .52; pointer-events: none; }
.promax-visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
.promax-imported-sources { display: flex; flex-wrap: wrap; gap: 7px; }
.promax-imported-sources span { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 99px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-inline-error { padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-promax-status-never-bg); color: var(--dsw-alias-state-error-primary); font-size: 10px; }
.promax-config-document-note { display: flex; align-items: flex-start; gap: 9px; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 9px; background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.promax-config-document-note svg { flex: none; color: var(--dsw-alias-state-warn-primary); }
.promax-config-document-note strong { color: var(--dsw-alias-state-warn-primary); }
.promax-config-document-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.promax-config-document-card { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); }
.promax-config-document-card > div { min-width: 0; }
.promax-config-document-card strong { font-size: 11px; }
.promax-config-document-card p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
.promax-config-document-card .promax-button { grid-column: 2 / -1; justify-self: start; }
.promax-config-document-status { padding: 4px 7px; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 9px; white-space: nowrap; }
.promax-resource-icon { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.promax-release-summary { display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 17px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.promax-release-summary > svg { padding: 9px; width: 42px; height: 42px; border-radius: 11px; background: var(--dsw-alias-bg-layer-2); }
.promax-release-summary strong { font-size: 13px; }
.promax-release-summary p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.promax-release-issues { padding: 13px 15px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 10px; background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-label-primary); font-size: 10px; }
.promax-release-issues strong { color: var(--dsw-alias-state-warn-primary); }
.promax-release-issues ul { margin: 8px 0 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }
.promax-release-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.promax-release-facts > div { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.promax-release-facts span { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-release-facts strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.promax-team-publish-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 28px; padding: 15px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.promax-team-publish-bar strong, .promax-team-publish-bar span { display: block; }
.promax-team-publish-bar strong { font-size: 12px; }
.promax-team-publish-bar span { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; }

.promax-simple-settings { display: grid; gap: 14px; margin-top: 18px; }
.promax-simple-settings > .promax-field { max-width: 620px; }
.promax-simple-settings > .promax-settings-card { grid-template-columns: minmax(0, 1fr); align-items: stretch; }
.promax-advanced-settings { overflow: hidden; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.promax-advanced-settings > summary { display: flex; min-height: 48px; align-items: center; justify-content: space-between; gap: 12px; padding: 0 15px; cursor: pointer; font-size: 12px; font-weight: 650; }
.promax-advanced-settings > summary small { color: var(--dsw-alias-label-secondary); font-size: 9px; font-weight: 500; }
.promax-advanced-settings[open] > summary { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.promax-advanced-settings > .promax-settings-stack { padding: 16px; }
.promax-team-setup-callout { display: flex; align-items: flex-start; gap: 11px; margin-bottom: 16px; padding: 13px 15px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 11px; background: var(--dsw-promax-status-stale-bg); }
.promax-team-setup-callout svg { flex: none; color: var(--dsw-alias-state-warn-primary); }
.promax-team-setup-callout > div { flex: 1; }
.promax-team-setup-callout > button { flex: none; align-self: center; }
.promax-team-setup-callout strong { font-size: 12px; }
.promax-team-setup-callout p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.promax-team-conversation-empty { display: grid; min-height: 150px; place-items: center; align-content: center; gap: 7px; padding: 20px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 12px; color: var(--dsw-alias-label-secondary); text-align: center; }
.promax-team-conversation-empty strong { color: var(--dsw-alias-label-primary); font-size: 12px; }
.promax-team-conversation-empty span { font-size: 10px; }
.promax-team-transcript { display: grid; max-height: 360px; gap: 12px; overflow: auto; padding: 4px; }
.promax-team-message { display: grid; max-width: 82%; gap: 5px; padding: 11px 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-base); }
.promax-team-message--user { justify-self: end; background: var(--dsw-alias-interactive-bg-active); }
.promax-team-message--system { max-width: 100%; border-color: var(--dsw-alias-state-warn-primary); background: var(--dsw-promax-status-stale-bg); }
.promax-team-message > span { color: var(--dsw-alias-label-secondary); font-size: 9px; font-weight: 650; }
.promax-team-message > p { margin: 0; white-space: pre-wrap; color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.6; }
.promax-team-composer { position: relative; }
.promax-team-composer .promax-team-prompt { padding-bottom: 42px; }
.promax-mention-button { position: absolute; bottom: 10px; left: 10px; display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 15px; font-weight: 680; }
.promax-mention-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-mention-button:disabled { cursor: not-allowed; opacity: .5; }
.promax-package-button { position: absolute; bottom: 10px; left: 10px; display: inline-flex; min-height: 30px; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 10px; font-weight: 620; }
.promax-package-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-mention-menu { position: absolute; z-index: 4; bottom: 48px; left: 10px; display: grid; width: min(390px, calc(100% - 20px)); max-height: 300px; overflow: auto; padding: 7px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-base); box-shadow: 0 16px 42px var(--dsw-promax-shadow); }
.promax-mention-menu > div { display: grid; gap: 3px; padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.promax-mention-menu > div strong { font-size: 11px; }
.promax-mention-menu > div span { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-mention-menu > button { display: grid; grid-template-columns: 32px minmax(0, 1fr) 18px; align-items: center; gap: 9px; min-height: 52px; padding: 7px 8px; border: 0; border-radius: 9px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-mention-menu > button:hover, .promax-mention-menu > button[aria-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.promax-mention-menu > button > span:nth-child(2) { display: grid; min-width: 0; gap: 3px; }
.promax-mention-menu > button strong, .promax-mention-menu > button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-mention-menu > button strong { font-size: 11px; }
.promax-mention-menu > button small { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-mention-targets { display: flex; flex-wrap: wrap; gap: 6px; }
.promax-mention-targets > button { display: inline-flex; min-height: 28px; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--dsw-alias-brand-primary); border-radius: 99px; background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 10px; }

.promax-native-team-label { display: inline-flex; min-width: 0; align-items: center; gap: 5px; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.promax-native-team-label > i { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-brand-primary); font-size: 9px; font-style: normal; }
.promax-native-team-label > i::before { width: 6px; height: 6px; border-radius: 99px; background: currentColor; content: ""; animation: promax-working-pulse 1.3s ease-in-out infinite; }
.promax-native-members-trigger { flex: none; min-height: 28px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 9px; font-weight: 620; white-space: nowrap; }
.promax-native-members-trigger:hover, .promax-native-members-trigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.promax-members-layer { position: fixed; inset: 0; z-index: 900; pointer-events: auto; }
.promax-members-scrim { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; background: var(--dsw-promax-backdrop); cursor: default; }
.promax-members-drawer { position: absolute; inset-block: 0; inset-inline-end: 0; display: flex; width: min(420px, 92vw); min-height: 0; flex-direction: column; padding: 22px; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); box-shadow: -18px 0 52px var(--dsw-promax-shadow); }
.promax-members-drawer > header { display: flex; flex: none; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.promax-members-drawer h2 { margin: 0; font-size: 20px; }
.promax-members-drawer header p { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.promax-members-list { display: grid; min-height: 0; align-content: start; gap: 8px; padding: 14px 0; overflow: auto; }
.promax-member-row { display: grid; min-width: 0; grid-template-columns: 36px minmax(0, 1fr) auto; align-items: start; gap: 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); }
.promax-member-row > div { display: grid; min-width: 0; gap: 4px; }
.promax-member-row strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.promax-member-row small { overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.promax-member-row p { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
.promax-member-row em { padding: 3px 6px; border-radius: 99px; background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); font-size: 9px; font-style: normal; white-space: nowrap; }
.promax-members-drawer > .promax-pagination { margin-top: auto; border-top: 1px solid var(--dsw-alias-border-l1); }

.promax-native-mentions { display: inline-flex; min-width: 0; align-items: center; gap: 5px; }
.promax-native-mention-trigger, .promax-native-mention-chip { display: inline-flex; min-height: 28px; align-items: center; justify-content: center; gap: 4px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 10px; font-weight: 650; }
.promax-native-mention-trigger { width: 28px; padding: 0; border-radius: 8px; font-size: 14px; }
.promax-native-mention-chip { max-width: 132px; padding: 0 8px; overflow: hidden; border-color: var(--dsw-alias-brand-primary); border-radius: 99px; background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: nowrap; }
.promax-native-mention-trigger:hover, .promax-native-mention-trigger[aria-expanded="true"], .promax-native-mention-chip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.promax-native-mention-trigger:disabled { cursor: not-allowed; opacity: .5; }

.promax-process-detail { position: relative; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-process-detail > summary { padding: 3px 6px; border-radius: 6px; cursor: pointer; list-style: none; font-weight: 620; white-space: nowrap; }
.promax-process-detail > summary::-webkit-details-marker { display: none; }
.promax-process-detail > summary:hover, .promax-process-detail[open] > summary { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.promax-process-panel { position: absolute; z-index: 30; right: 0; bottom: calc(100% + 7px); width: min(330px, 72vw); padding: 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 11px; background: var(--dsw-alias-bg-base); box-shadow: 0 14px 38px var(--dsw-promax-shadow); color: var(--dsw-alias-label-primary); }
.promax-process-panel strong { font-size: 11px; }
.promax-process-panel ol { margin: 8px 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); line-height: 1.65; }
.promax-process-panel p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
@keyframes promax-working-pulse { 0%, 100% { opacity: .35; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
.promax-team-create-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 24px; pointer-events: auto; background: var(--dsw-promax-backdrop); }
.promax-team-create-dialog { width: min(520px, 100%); max-height: min(720px, calc(100vh - 48px)); overflow: auto; padding: 24px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-base); box-shadow: 0 24px 70px var(--dsw-promax-shadow); }
.promax-team-create-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
.promax-team-create-dialog h2 { margin: 0; font-size: 21px; letter-spacing: -.025em; }
.promax-team-create-dialog header p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-create-description { margin-top: 16px; }
.promax-create-source { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin: 18px 0; padding: 0; border: 0; }
.promax-create-source legend { grid-column: 1 / -1; margin-bottom: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 560; }
.promax-create-source > button { display: grid; min-height: 94px; grid-template-columns: 26px minmax(0, 1fr); align-content: start; gap: 9px; padding: 13px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-create-source > button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-create-source > button[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-active); }
.promax-create-source > button span { display: grid; gap: 5px; }
.promax-create-source > button strong { font-size: 11px; }
.promax-create-source > button small { color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
.promax-create-documents { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 10px; }
.promax-create-documents > span { overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.promax-create-workspace-note { display: flex; align-items: center; gap: 10px; margin-top: 16px; padding: 11px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.promax-create-workspace-note > span { display: grid; gap: 3px; }
.promax-create-workspace-note strong { font-size: 10px; }
.promax-create-workspace-note small { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-team-create-dialog > footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--dsw-alias-border-l1); }

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
  .promax-team-rail--open { width: 248px; }
  .promax-team-home { inset-inline-end: 248px; grid-template-columns: 220px minmax(0, 1fr); }
  *:has(> [data-shell-overlay] .promax-team-rail--open) > :nth-child(2) { padding-inline-end: 248px; }
  .promax-team-home-header { align-items: flex-start; flex-direction: column; padding-inline: 20px; }
  .promax-team-home-actions { justify-content: flex-start; }
  .promax-team-member-grid { grid-template-columns: 1fr; }
  .promax-team-editor-grid { grid-template-columns: 1fr; }
  .promax-team-member-editor, .promax-team-member-editor--worker { grid-template-columns: 1fr; }
  .promax-team-settings-layout { grid-template-columns: 1fr; }
  .promax-team-settings-tabs { grid-template-columns: repeat(4, minmax(0, 1fr)); border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); overflow-x: auto; }
  .promax-team-settings-tab { grid-template-columns: 20px minmax(0, 1fr); }
  .promax-team-settings-tab small { display: none; }
  .promax-prompt-recipes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .promax-member-prompt-list, .promax-release-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
  .promax-config-methods, .promax-config-document-grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
`
