import { PROMAX_WORKBENCH_CSS } from './workbench-styles.ts'

const STYLE_ID = 'promax-ui-console-styles'
let consumers = 0

export function installPromaxConsoleStyles(): () => void {
  consumers += 1
  const existing = document.getElementById(STYLE_ID)
  if (existing === null) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `${PROMAX_CONSOLE_CSS}\n${PROMAX_WORKBENCH_CSS}`
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
.promax-icon-button:focus-visible, .promax-nav-button:focus-visible, .promax-sidebar-button:focus-visible, .promax-button:focus-visible, .promax-input:focus-visible, .promax-select:focus-visible, .promax-session-actions:focus-visible, .promax-session-menu button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }

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
.promax-button--danger { border-color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-state-error-primary); color: var(--dsw-promax-on-accent); }
.promax-button--danger:hover { filter: brightness(.92); }
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
body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) { grid-template-columns: auto auto; }
body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) > [class*="_fishHitbox"] { display: none; }
body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) > [class*="_headlineText"] { grid-column: 1; }
body:has(.app-shell) [class*="_composerHero"] [class*="_headline"]:has(> [class*="_fishHitbox"]) > [class*="_previewBadge"] { grid-column: 2; }

*:has(> [data-shell-overlay] .promax-team-rail--open) > :nth-child(2) { padding-inline-end: 288px; transition: padding-inline-end var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
*:has(> [data-shell-overlay] .promax-team-rail--collapsed) > :nth-child(2) { padding-inline-end: 56px; transition: padding-inline-end var(--ds-transition-duration-fast) var(--ds-ease-in-out); }

.promax-eyebrow { display: block; margin-bottom: 4px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 680; letter-spacing: .08em; text-transform: uppercase; }
.promax-context-rail-button { display: grid; width: 36px; height: 36px; margin: 8px auto; place-items: center; border: 0; border-radius: 9px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.promax-context-rail-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-room-mark { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border-radius: 10px 10px 4px 10px; background: var(--dsw-promax-accent); color: var(--dsw-promax-on-accent); font-size: 14px; font-weight: 780; letter-spacing: -.05em; box-shadow: 0 8px 18px var(--dsw-promax-shadow); }
.promax-session-browser { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 10px; padding: 16px 9px 10px; background: var(--dsw-promax-rail); }
.promax-session-browser-heading { display: flex; min-height: 48px; align-items: center; gap: 10px; padding: 0 7px; }
.promax-session-browser-heading-copy { display: grid; min-width: 0; flex: 1; gap: 1px; }
.promax-session-browser-heading strong { display: block; overflow: hidden; font-size: 14px; font-weight: 720; letter-spacing: -.015em; text-overflow: ellipsis; white-space: nowrap; }
.promax-new-session { display: flex; min-height: 40px; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--dsw-promax-accent); border-radius: 11px; background: var(--dsw-promax-panel-strong); color: var(--dsw-promax-accent-strong); cursor: pointer; font-size: 12px; font-weight: 680; box-shadow: 0 7px 18px var(--dsw-promax-shadow); }
.promax-new-session:hover { background: var(--dsw-promax-accent-soft); }
.promax-new-session:disabled { cursor: not-allowed; opacity: .48; }
.promax-session-note { padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45; }
.promax-session-list { display: grid; min-height: 0; align-content: start; gap: 5px; overflow: auto; }
.promax-session-row-shell { position: relative; display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) 30px; align-items: center; gap: 2px; border-radius: 11px; }
.promax-session-row-shell--menu-open { z-index: 12; }
.promax-session-row { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px 7px 12px; border: 1px solid transparent; border-radius: 11px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-session-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-session-row[aria-current="page"] { border-color: var(--dsw-promax-accent); background: var(--dsw-promax-accent-soft); box-shadow: inset 3px 0 0 var(--dsw-promax-accent); }
.promax-session-row-copy { display: grid; min-width: 0; gap: 3px; }
.promax-session-row-title { overflow: hidden; font-size: 12px; font-weight: 540; text-overflow: ellipsis; white-space: nowrap; }
.promax-session-row-copy small { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-session-indicator { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-alias-border-l2); }
.promax-session-indicator--running { background: var(--dsw-promax-accent); animation: promax-working-pulse 1.3s ease-in-out infinite; }
.promax-session-indicator--done { background: var(--dsw-alias-state-success-primary); }
.promax-session-actions { display: grid; width: 30px; height: 30px; place-items: center; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.promax-session-actions:hover, .promax-session-actions[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.promax-session-menu { position: absolute; z-index: 20; top: calc(100% - 3px); right: 0; display: grid; width: 136px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-base); box-shadow: 0 12px 30px var(--dsw-promax-shadow); }
.promax-session-menu button { display: flex; width: 100%; min-height: 34px; align-items: center; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; cursor: pointer; font-size: 11px; font-weight: 650; text-align: left; }
.promax-session-menu-delete { color: var(--dsw-alias-state-error-primary); }
.promax-session-menu-delete:hover { background: var(--dsw-promax-status-never-bg); }
.promax-session-empty { padding: 20px 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; text-align: center; }
.promax-session-error, .promax-team-page-error { padding: 8px 9px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: 8px; background: var(--dsw-promax-status-never-bg); color: var(--dsw-alias-state-error-primary); font-size: 10px; }
.promax-session-success { padding: 8px 9px; border: 1px solid var(--dsw-alias-state-success-primary); border-radius: 8px; background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); font-size: 10px; }
.promax-session-browser-foot { margin: auto 5px 0; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.55; }

.promax-team-rail { position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 10; pointer-events: auto; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-promax-rail); box-shadow: -10px 0 34px var(--dsw-promax-shadow); transition: width var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.promax-team-rail::before { position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--dsw-promax-accent); content: ""; }
.promax-team-rail--open { width: 288px; }
.promax-team-rail--collapsed { width: 56px; }
.promax-team-rail-content { display: flex; height: 100%; min-height: 0; flex-direction: column; padding: 20px 14px 14px 16px; }
.promax-team-rail-header { display: flex; min-height: 50px; align-items: center; justify-content: space-between; gap: 10px; padding: 0 2px; }
.promax-team-rail-brand { display: flex; min-width: 0; align-items: center; gap: 10px; }
.promax-team-rail-brand > div { min-width: 0; }
.promax-team-rail-header h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
.promax-team-rail-actions { display: flex; gap: 5px; }
.promax-team-create { display: grid; gap: 8px; margin: 12px 0 8px; padding: 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.promax-team-create label { color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 650; }
.promax-team-create > div { display: flex; justify-content: flex-end; gap: 6px; }
.promax-team-nav { display: flex; min-height: 0; flex: 1; flex-direction: column; gap: 5px; margin-top: 19px; overflow: hidden; }
.promax-team-nav-pages { display: grid; min-height: 0; align-content: start; gap: 4px; overflow: auto; }
.promax-team-nav-label { padding: 17px 9px 6px; color: var(--dsw-alias-label-secondary); font-size: 9px; font-weight: 720; letter-spacing: .1em; text-transform: uppercase; }
.promax-team-nav-row { display: grid; width: 100%; min-height: 58px; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 9px; padding: 7px 8px; border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-team-nav-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-team-nav-row[aria-current="page"] { border-color: var(--dsw-promax-accent); background: var(--dsw-promax-accent-soft); box-shadow: 0 8px 20px var(--dsw-promax-shadow); }
.promax-team-nav-monogram { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px 11px 4px 11px; background: var(--dsw-promax-panel-strong); color: var(--dsw-promax-accent-strong); font-size: 12px; font-weight: 760; }
.promax-team-nav-row[aria-current="page"] .promax-team-nav-monogram { border-color: var(--dsw-promax-accent); background: var(--dsw-promax-accent); color: var(--dsw-promax-on-accent); }
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

.promax-shell-layer:has(> .promax-team-home), .promax-shell-layer:has(> .promax-team-session-toolbar) { display: contents; }
[data-shell-overlay]:has(.promax-team-home), [data-shell-overlay]:has(.promax-team-session-toolbar) { display: grid; grid-template-columns: inherit; grid-template-rows: 100%; }
.promax-team-home { position: relative; z-index: 5; display: grid; height: 100%; min-width: 0; min-height: 0; grid-column: 2; grid-row: 1; overflow: hidden; grid-template-columns: minmax(0, 1fr); pointer-events: auto; background: var(--dsw-promax-canvas); }
.promax-team-session-toolbar { z-index: 8; display: flex; min-width: 0; min-height: 54px; grid-column: 2; grid-row: 1; align-self: start; align-items: center; margin: 12px 320px 0 12px; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 13px; background: var(--dsw-promax-panel); box-shadow: 0 9px 24px var(--dsw-promax-shadow); pointer-events: auto; }
.promax-team-session-toolbar > .promax-native-team-header { width: 100%; }
.promax-team-home--rail-collapsed { inset-inline-end: 56px; }
.promax-count-badge { display: grid; min-width: 24px; height: 24px; place-items: center; border-radius: 99px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 650; }
.promax-team-home-main { display: flex; height: 100%; min-width: 0; min-height: 0; overflow: hidden; flex-direction: column; background: var(--dsw-promax-canvas); }
.promax-team-home-header { z-index: 2; display: flex; min-height: 132px; flex: none; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 32px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-promax-panel); }
.promax-team-identity { display: flex; min-width: 0; align-items: center; gap: 16px; }
.promax-team-identity-mark { display: grid; width: 58px; height: 58px; flex: none; place-items: center; border-radius: 19px 19px 6px 19px; background: var(--dsw-promax-accent); color: var(--dsw-promax-on-accent); font-size: 23px; font-weight: 760; box-shadow: 0 14px 30px var(--dsw-promax-shadow); }
.promax-team-identity-copy { min-width: 0; }
.promax-team-breadcrumb { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.promax-team-breadcrumb button { padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
.promax-team-breadcrumb button:hover { color: var(--dsw-alias-label-primary); }
.promax-team-title-line { display: flex; align-items: center; gap: 9px; }
.promax-team-title-line h1 { margin: 0; font-size: 21px; letter-spacing: -.025em; }
.promax-team-home-header p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-team-home-header .promax-team-mission { max-width: 620px; overflow: hidden; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: nowrap; }
.promax-team-home-header .promax-team-meta { font-size: 9px; }
.promax-team-state { padding: 3px 7px; border-radius: 99px; font-size: 9px; font-weight: 680; }
.promax-team-state--published { background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); }
.promax-team-state--draft { background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-state-warn-primary); }
.promax-team-home-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.promax-team-interaction { width: min(960px, 100%); min-height: 0; flex: 1; margin: 0 auto; padding: 48px 32px 72px; overflow: auto; }
.promax-team-prompt-block { position: relative; display: grid; gap: 18px; overflow: hidden; padding: 28px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 20px 20px 8px 20px; background: var(--dsw-promax-panel-strong); box-shadow: 0 18px 46px var(--dsw-promax-shadow); }
.promax-team-prompt-block::before { position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--dsw-promax-accent); content: ""; }
.promax-room-intro { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: start; gap: 16px; }
.promax-room-sequence { display: grid; min-height: 32px; place-items: center; border-bottom: 2px solid var(--dsw-promax-accent); color: var(--dsw-promax-accent-strong); font-size: 10px; font-weight: 760; letter-spacing: .08em; }
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
.promax-team-conversation-empty { display: grid; min-height: 128px; place-items: center; align-content: center; gap: 7px; padding: 20px; border: 1px dashed var(--dsw-promax-accent); border-radius: 14px 14px 6px 14px; background: var(--dsw-promax-accent-soft); color: var(--dsw-alias-label-secondary); text-align: center; }
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

.promax-native-team-header { display: flex; min-width: 0; align-items: center; gap: 6px; flex-wrap: wrap; }
.promax-native-breadcrumb { display: flex; min-width: 0; align-items: center; gap: 5px; margin-inline-end: auto; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-native-breadcrumb button { max-width: 132px; padding: 0; overflow: hidden; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; text-decoration: underline; text-overflow: ellipsis; text-underline-offset: 3px; white-space: nowrap; }
.promax-native-breadcrumb button:hover { color: var(--dsw-alias-label-primary); }
.promax-native-room-context { display: inline-flex; min-width: 0; align-items: center; gap: 9px; padding: 5px 10px 5px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 13px 13px 5px 13px; background: var(--dsw-promax-panel-strong); box-shadow: 0 7px 18px var(--dsw-promax-shadow); }
.promax-native-room-context .promax-room-mark { width: 30px; height: 30px; border-radius: 9px 9px 3px 9px; box-shadow: none; font-size: 12px; }
.promax-native-room-copy { display: grid; min-width: 0; gap: 1px; }
.promax-native-room-copy strong, .promax-native-room-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-native-room-copy strong { max-width: 150px; color: var(--dsw-alias-label-primary); font-size: 11px; font-weight: 720; }
.promax-native-room-copy small { max-width: 170px; color: var(--dsw-alias-label-secondary); font-size: 8px; }
.promax-native-room-state { display: inline-flex; flex: none; align-items: center; gap: 5px; padding: 3px 6px; border-radius: 99px; background: var(--dsw-promax-status-ok-bg); color: var(--dsw-alias-state-success-primary); font-size: 8px; font-weight: 680; }
.promax-native-room-state::before { width: 5px; height: 5px; border-radius: 50%; background: currentColor; content: ""; }
.promax-native-room-state--running { background: var(--dsw-promax-accent-soft); color: var(--dsw-promax-accent-strong); }
.promax-native-room-state--running::before { animation: promax-working-pulse 1.3s ease-in-out infinite; }
.promax-native-members-trigger { display: inline-flex; flex: none; min-height: 34px; align-items: center; gap: 6px; padding: 0 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-promax-panel-strong); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 9px; font-weight: 650; white-space: nowrap; }
.promax-native-members-trigger:hover, .promax-native-members-trigger[aria-expanded="true"] { border-color: var(--dsw-promax-accent); background: var(--dsw-promax-accent-soft); color: var(--dsw-promax-accent-strong); }
.promax-native-members-trigger:disabled { cursor: not-allowed; opacity: .48; }

body:has(.promax-native-room-context) [data-phase="active"] { --dsh-chat-content-width: 800px; background: var(--dsw-promax-canvas); }
body:has(.promax-native-room-context) [data-phase="active"] > header { border-bottom-color: var(--dsw-promax-accent); background: var(--dsw-promax-panel); box-shadow: 0 9px 24px var(--dsw-promax-shadow); }
body:has(.promax-native-room-context) [data-phase="active"] > header [role="tablist"] { padding: 3px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-promax-rail); }
body:has(.promax-native-room-context) [data-phase="active"] > header [role="tab"] { min-height: 28px; padding-inline: 11px; border-radius: 7px; }
body:has(.promax-native-room-context) [data-phase="active"] > header [role="tab"][aria-selected="true"] { background: var(--dsw-promax-panel-strong); color: var(--dsw-promax-accent-strong); box-shadow: 0 3px 10px var(--dsw-promax-shadow); }
body:has(.promax-native-room-context) [data-conversation-scroll] { background-color: var(--dsw-promax-canvas); background-image: linear-gradient(var(--dsw-promax-grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--dsw-promax-grid-line) 1px, transparent 1px); background-size: 32px 32px; }
body:has(.promax-native-room-context) [data-chat-flow] { padding-top: 28px; }
body:has(.promax-native-room-context) [data-composer-seat] { padding-inline: 22px; background: linear-gradient(transparent, var(--dsw-promax-canvas)); }
body:has(.promax-native-room-context) [data-composer-card] { border-color: var(--dsw-promax-accent); border-radius: 18px 18px 7px 18px; background: var(--dsw-promax-panel-strong); box-shadow: 0 16px 38px var(--dsw-promax-shadow); }
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
.promax-files-drawer { width: min(470px, 94vw); }
.promax-file-tree { display: grid; min-height: 0; align-content: start; gap: 12px; padding: 16px 0; overflow: auto; }
.promax-file-tree > section { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-layer-1); }
.promax-file-tree > section > strong { display: flex; align-items: center; gap: 7px; font-size: 11px; }
.promax-file-tree > section > span, .promax-file-tree > section > small, .promax-file-tree > section > p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.5; }
.promax-file-tree ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.promax-file-tree li { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 9px; padding: 8px 9px; border-radius: 8px; background: var(--dsw-alias-bg-base); }
.promax-file-tree li > span:first-child { display: flex; min-width: 0; align-items: center; gap: 7px; }
.promax-file-tree li > span:first-child > span { display: grid; min-width: 0; gap: 2px; }
.promax-file-tree li strong, .promax-file-tree li small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-file-tree li strong { font-size: 10px; }
.promax-file-tree li small { color: var(--dsw-alias-label-secondary); font-size: 8px; }
.promax-files-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 13px; border-top: 1px solid var(--dsw-alias-border-l1); }
.promax-files-footer > span { color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }

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
.promax-session-delete-dialog { width: min(430px, 100%); }
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
  .promax-team-rail--open { width: 264px; }
  *:has(> [data-shell-overlay] .promax-team-rail--open) > :nth-child(2) { padding-inline-end: 264px; }
  .promax-team-home-header { align-items: flex-start; flex-direction: column; padding-inline: 20px; }
  .promax-team-identity-mark { width: 48px; height: 48px; border-radius: 16px 16px 5px 16px; font-size: 19px; }
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
  .promax-team-identity { align-items: flex-start; }
  .promax-team-identity-mark { display: none; }
  .promax-room-intro { grid-template-columns: 1fr; }
  .promax-room-sequence { width: 52px; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }

/* Promax 0.4 information architecture: drafts → fixed product team → projects. */
body:has(.promax-session-browser) button[class*="_newSession"][aria-label="新建会话"],
body:has(.promax-session-browser) button[class*="_newSession"][aria-label="New session"] { display: none; }
.promax-session-browser { overflow: auto; }
.promax-nav-section { display: grid; gap: 7px; }
.promax-nav-section > h2, .promax-project-tree-header > h3 { margin: 0; padding: 2px 8px; color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 700; letter-spacing: .04em; }
.promax-nav-divider { height: 1px; margin: 4px 3px; background: var(--dsw-alias-border-l1); }
.promax-team-root-row { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) 32px; align-items: center; gap: 2px; }
.promax-team-root { display: grid; width: 100%; min-height: 52px; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 9px; padding: 7px 8px; border: 1px solid transparent; border-radius: 11px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-team-root:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-team-root[aria-current="page"] { border-color: var(--dsw-promax-accent); background: var(--dsw-promax-accent-soft); }
.promax-team-root > span:last-child { display: grid; min-width: 0; gap: 2px; }
.promax-team-root strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.promax-team-root small { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-project-tree { display: grid; gap: 4px; margin-left: 17px; padding-left: 10px; border-left: 1px solid var(--dsw-alias-border-l1); }
.promax-project-tree-header { display: flex; min-height: 32px; align-items: center; }
.promax-project-node { display: grid; gap: 3px; border-radius: 9px; }
.promax-project-header { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) 32px; align-items: center; gap: 2px; }
.promax-project-heading { min-width: 0; margin: 0; }
.promax-project-row { display: flex; width: 100%; min-height: 34px; align-items: center; gap: 7px; padding: 5px 6px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-project-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.promax-project-chevron { display: grid; width: 14px; flex: none; place-items: center; color: var(--dsw-alias-label-secondary); }
.promax-project-chevron svg { transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.promax-project-row[aria-expanded="true"] .promax-project-chevron svg { transform: rotate(90deg); }
.promax-project-title { min-width: 0; flex: 1; overflow: hidden; font-size: 11px; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.promax-project-create, .promax-project-new-session { display: grid; width: 30px; height: 30px; place-items: center; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.promax-project-create:hover, .promax-project-new-session:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-promax-accent-strong); }
.promax-project-sessions { display: grid; gap: 2px; padding: 2px 0 3px 26px; }
.promax-project-new-session:disabled { cursor: not-allowed; opacity: .48; }
.promax-project-session-empty { padding: 8px 10px; color: var(--dsw-alias-label-secondary); font-size: 9px; }
.promax-project-sessions .promax-session-row { min-height: 38px; padding-block: 5px; }
.promax-link-button { margin-top: 12px; padding: 0; border: 0; background: transparent; color: var(--dsw-promax-accent-strong); cursor: pointer; font-size: 11px; font-weight: 650; }
.promax-custom-path { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 9px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); }
.promax-custom-path > span { min-width: 0; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.promax-notice-card { padding: 16px; border: 1px solid var(--dsw-promax-accent); border-radius: 12px; background: var(--dsw-promax-accent-soft); }
.promax-notice-card strong { font-size: 12px; }
.promax-notice-card p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.55; }
.promax-choice-list { display: grid; gap: 9px; }
.promax-choice-list > button { display: grid; gap: 5px; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 11px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.promax-choice-list > button:hover { border-color: var(--dsw-promax-accent); background: var(--dsw-promax-accent-soft); }
.promax-choice-list strong { font-size: 12px; }
.promax-choice-list span { color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.promax-team-progress-rail { position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 9; display: flex; width: 304px; min-height: 0; flex-direction: column; padding: 18px 14px; overflow: auto; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-promax-rail); box-shadow: -10px 0 34px var(--dsw-promax-shadow); pointer-events: auto; }
.promax-team-progress-rail > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding-bottom: 11px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.promax-team-progress-rail h2 { margin: 0; font-size: 18px; letter-spacing: -.025em; }
.promax-progress-revision { padding: 3px 7px; border-radius: 99px; background: var(--dsw-promax-accent-soft); color: var(--dsw-promax-accent-strong); font-size: 9px; font-weight: 720; }
.promax-progress-evidence { margin: 10px 0 4px; padding: 8px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
.promax-progress-tree, .promax-progress-branches > ul { margin: 0; padding: 0; list-style: none; }
.promax-progress-tree { display: grid; align-content: start; padding: 8px 2px 4px; }
.promax-progress-step { position: relative; min-height: 38px; padding: 8px 0 8px 18px; }
.promax-progress-step::before, .promax-progress-branches::before { position: absolute; inset-block: 0; inset-inline-start: 5px; width: 1px; background: var(--dsw-alias-border-l2); content: ""; }
.promax-progress-step::after { position: absolute; inset-block-start: 14px; inset-inline-start: 2px; width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-promax-rail); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2); content: ""; }
.promax-progress-step--delivery::before { inset-block-end: 22px; }
.promax-progress-branches { position: relative; display: grid; gap: 7px; padding: 7px 0 9px 18px; }
.promax-progress-branches > span { color: var(--dsw-alias-label-secondary); font-size: 9px; font-weight: 700; letter-spacing: .04em; }
.promax-progress-branches > ul { display: grid; gap: 7px; }
.promax-progress-branches > ul > li { position: relative; display: grid; min-width: 0; gap: 7px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.promax-progress-branches > ul > li::before { position: absolute; inset-block-start: 17px; inset-inline-start: -13px; width: 12px; height: 1px; background: var(--dsw-alias-border-l2); content: ""; }
.promax-progress-artifact-title { display: flex; min-width: 0; align-items: center; gap: 7px; }
.promax-progress-artifact-title > span { display: grid; min-width: 0; gap: 2px; }
.promax-progress-artifact-title strong, .promax-progress-artifact-title small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-progress-artifact-title strong { font-size: 10px; }
.promax-progress-artifact-title small { color: var(--dsw-alias-label-secondary); font-size: 8px; }
.promax-progress-artifact-stages { display: flex; flex-wrap: wrap; gap: 5px; }
.promax-progress-mark { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.3; }
.promax-progress-mark > span { font-weight: 800; }
.promax-progress-mark--done { color: var(--dsw-alias-state-success-primary); }
.promax-progress-mark--blocked { color: var(--dsw-alias-state-error-primary); }
.promax-progress-mark--appealed,
.promax-progress-mark--human-required,
.promax-progress-mark--force-released { color: var(--dsw-alias-state-warn-primary); }
.promax-progress-mark--running { color: var(--dsw-promax-accent-strong); }
.promax-progress-mark--unverified { color: var(--dsw-alias-state-warn-primary); }
.promax-progress-open { justify-self: start; padding: 2px 0; border: 0; background: transparent; color: var(--dsw-promax-accent-strong); cursor: pointer; font-size: 9px; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; }
.promax-progress-open:disabled { color: var(--dsw-alias-label-secondary); cursor: not-allowed; opacity: .55; }
.promax-progress-empty { padding: 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1.45; }
*:has(> [data-shell-overlay] .promax-team-progress-rail) > :nth-child(2) { padding-inline-end: 304px; transition: padding-inline-end var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
[data-shell-overlay]:has(.promax-team-progress-rail) .promax-team-home { margin-inline-end: 304px; }
.promax-draft-panel { position: absolute; inset-block: 0; inset-inline-end: 0; z-index: 8; width: 300px; padding: 18px 15px; overflow: auto; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-promax-rail); box-shadow: -10px 0 34px var(--dsw-promax-shadow); pointer-events: auto; transition: width var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.promax-draft-panel--collapsed { width: 52px; padding-inline: 8px; overflow: hidden; }
.promax-draft-panel > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.promax-draft-panel h2 { margin: 0; font-size: 17px; }
.promax-draft-panel > p { margin: 12px 0; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.5; }
.promax-draft-outline { display: grid; gap: 9px; }
.promax-draft-outline > section { padding: 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-base); }
.promax-draft-outline h3 { margin: 0 0 7px; font-size: 11px; }
.promax-draft-outline section > span { color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.promax-draft-outline ul { display: grid; gap: 7px; margin: 0; padding-left: 17px; }
.promax-draft-outline li { color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45; }
.promax-draft-outline em { display: inline-block; margin-right: 5px; color: var(--dsw-alias-state-warn-primary); font-size: 9px; font-style: normal; font-weight: 700; }
*:has(> [data-shell-overlay] .promax-draft-panel:not(.promax-draft-panel--collapsed)) > :nth-child(2) { padding-inline-end: 300px; }
*:has(> [data-shell-overlay] .promax-draft-panel--collapsed) > :nth-child(2) { padding-inline-end: 52px; }
.promax-draft-composer-actions { display: inline-flex; min-width: 0; align-items: center; gap: 7px; }
.promax-tracking-warning { display: inline-flex; min-height: 28px; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-state-warn-primary); font-size: 9px; }
.promax-tracking-warning button { padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font-weight: 750; text-decoration: underline; }
.promax-handoff-button { min-height: 28px; padding: 0 10px; border: 1px solid var(--dsw-promax-accent); border-radius: 8px; background: var(--dsw-promax-accent-soft); color: var(--dsw-promax-accent-strong); cursor: pointer; font-size: 10px; font-weight: 700; }
.promax-transfer-dialog { width: min(760px, 100%); max-height: min(820px, calc(100vh - 44px)); overflow: auto; padding: 24px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-base); box-shadow: 0 24px 70px var(--dsw-promax-shadow); }
.promax-transfer-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 16px; }
.promax-transfer-dialog h2 { margin: 0; font-size: 21px; }
.promax-transfer-dialog header p { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.promax-transfer-dialog > .promax-field { margin-top: 14px; }
.promax-transfer-editor { min-height: 150px; }
.promax-transfer-step { display: grid; gap: 8px; margin-top: 16px; }
.promax-transfer-step h3 { margin: 0; font-size: 14px; }
.promax-transfer-step > p, .promax-transfer-step-title p, .promax-slot-preview > p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.promax-transfer-step > small { color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.5; }
.promax-transfer-step-title { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.promax-transfer-step-title h3 { margin-bottom: 4px; }
.promax-understanding-summary { display: grid; gap: 6px; padding: 11px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-subtle); }
.promax-understanding-summary p { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.promax-understanding-summary strong { color: var(--dsw-alias-label-primary); }
.promax-artifact-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.promax-artifact-choice { display: flex; align-items: flex-start; gap: 8px; padding: 10px 11px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; background: var(--dsw-alias-bg-subtle); cursor: pointer; }
.promax-artifact-choice input { flex: none; margin-top: 2px; accent-color: var(--dsw-alias-brand-primary); }
.promax-artifact-choice > span { display: grid; gap: 3px; min-width: 0; }
.promax-artifact-choice strong { color: var(--dsw-alias-label-primary); font-size: 11px; }
.promax-artifact-choice strong em { display: inline-flex; margin-left: 6px; padding: 1px 5px; border-radius: 999px; background: var(--dsw-promax-accent-soft); color: var(--dsw-promax-accent-strong); font-size: 9px; font-style: normal; }
.promax-artifact-choice small { color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.4; }
.promax-link-button { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); cursor: pointer; font-size: 10px; font-weight: 700; }
.promax-advanced-details { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; }
.promax-advanced-details summary { color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 10px; font-weight: 650; }
.promax-advanced-details[open] summary { margin-bottom: 8px; }
.promax-handoff-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; margin-top: 8px; }
.promax-handoff-options label { display: flex; align-items: flex-start; gap: 7px; color: var(--dsw-alias-label-primary); font-size: 12px; overflow-wrap: anywhere; }
.promax-slot-preview { margin-top: 16px; }
.promax-slot-preview h3 { margin: 0 0 9px; font-size: 13px; }
.promax-slot-list, .promax-slot-preview { display: grid; gap: 7px; }
.promax-slot { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1); border-left-width: 3px; border-radius: 8px; background: var(--dsw-alias-bg-subtle); }
.promax-slot > svg { flex: 0 0 auto; margin-top: 1px; }
.promax-slot > span { display: grid; gap: 2px; min-width: 0; }
.promax-slot strong { font-size: 12px; }
.promax-slot small { color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.45; }
.promax-slot--green { border-left-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.promax-slot--blue { border-left-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.promax-slot--gray { border-left-color: var(--dsw-alias-label-tertiary); color: var(--dsw-alias-label-secondary); }
.promax-slot--yellow { border-left-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.promax-transfer-dialog > footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; padding-top: 15px; border-top: 1px solid var(--dsw-alias-border-l1); }
.promax-inline-warning { display: grid; gap: 3px; margin: 9px 0; padding: 10px 11px; border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 9px; background: var(--dsw-promax-status-stale-bg); color: var(--dsw-alias-state-warn-primary); font-size: 10px; line-height: 1.45; }
.promax-draft-settings { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 18px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.promax-draft-settings strong { font-size: 13px; }
.promax-draft-settings p { margin: 5px 0 0; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
.promax-switch { display: inline-flex; flex: none; align-items: center; gap: 7px; color: var(--dsw-alias-label-primary); font-size: 11px; font-weight: 650; }
.promax-switch input { width: 18px; height: 18px; accent-color: var(--dsw-alias-brand-primary); }
@media (max-width: 900px) {
  .promax-team-progress-rail { width: 264px; }
  *:has(> [data-shell-overlay] .promax-team-progress-rail) > :nth-child(2) { padding-inline-end: 264px; }
  [data-shell-overlay]:has(.promax-team-progress-rail) .promax-team-home { margin-inline-end: 264px; }
  .promax-team-session-toolbar { margin-inline-end: 280px; }
  .promax-draft-panel { width: 252px; }
  *:has(> [data-shell-overlay] .promax-draft-panel:not(.promax-draft-panel--collapsed)) > :nth-child(2) { padding-inline-end: 252px; }
}
`
