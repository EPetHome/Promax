export const PROMAX_WORKBENCH_CSS = String.raw`
.promax-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.left-sidebar, .right-sidebar { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; background: var(--dsw-promax-sidebar-background); }
.brand-row { display: flex; height: 76px; flex: none; align-items: center; gap: 10px; padding: 0 16px 0 18px; border-bottom: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-header-background); }
.brand-mark { display: grid; width: 34px; height: 34px; flex: none; place-items: center; border-radius: 11px; background: var(--dsw-promax-ink); color: var(--dsw-promax-surface); box-shadow: 0 6px 16px var(--dsw-promax-shadow); font-size: 15px; font-weight: 850; }
.brand-name { min-width: 0; font-size: 17px; font-weight: 780; letter-spacing: -.025em; }
.brand-label { margin-top: 2px; color: var(--dsw-promax-ink-4); font-size: 9px; font-weight: 760; letter-spacing: .10em; }
.promax-workbench-icon-button { display: inline-grid; width: 42px; height: 42px; flex: none; place-items: center; padding: 0; border: 1px solid var(--dsw-promax-line); border-radius: 12px; background: var(--dsw-promax-card-background); color: var(--dsw-promax-text-icon); cursor: pointer; }
.promax-workbench-icon-button:hover { border-color: var(--dsw-promax-line-strong); background: var(--dsw-promax-surface); color: var(--dsw-promax-ink); box-shadow: var(--dsw-promax-shadow-sm); }
.collapse-button { margin-left: auto; }
.left-scroll, .right-scroll { min-height: 0; padding: 14px 12px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsw-promax-line-strong) transparent; }
.left-scroll { flex: 1; }
.left-scroll > .promax-session-browser { min-height: 100%; padding: 0; gap: 0; overflow: visible; background: transparent; }
.left-scroll .promax-new-session { width: 100%; min-height: 46px; padding: 0 14px; border: 1px solid var(--dsw-promax-primary-border); border-radius: 13px; background: var(--dsw-promax-primary-background); color: var(--dsw-promax-primary-text); box-shadow: none; font-size: 13px; font-weight: 730; }
.left-scroll .promax-new-session:hover { border-color: var(--dsw-promax-primary-border-hover); background: var(--dsw-promax-primary-background-hover); }
.left-scroll .promax-nav-section { margin-top: 20px; gap: 3px; }
.left-scroll .promax-nav-section > h2, .left-scroll .promax-project-tree-header > h3, .sidebar-section-title { margin: 0 8px 8px; padding: 0; color: var(--dsw-promax-text-section); font-size: 9px; font-weight: 820; letter-spacing: .13em; text-transform: uppercase; }
.left-scroll .promax-session-list { gap: 2px; overflow: visible; }
.left-scroll .promax-session-row { min-height: 44px; padding: 7px 10px; border: 0; border-radius: 10px; color: var(--dsw-promax-text-conversation); }
.left-scroll .promax-session-row:hover, .left-scroll .promax-session-row[aria-current="page"] { background: var(--dsw-promax-count-background); color: var(--dsw-promax-ink); box-shadow: none; }
.left-scroll .promax-session-row-shell { grid-template-columns: minmax(0, 1fr) 32px; }
.left-scroll .promax-session-actions { width: 32px; height: 32px; color: var(--dsw-promax-text-conversation-meta); }
.left-scroll .promax-session-actions:hover, .left-scroll .promax-session-actions[aria-expanded="true"] { background: var(--dsw-promax-count-background); color: var(--dsw-promax-ink); }
.left-scroll .promax-session-row-title { font-size: 11px; font-weight: 650; }
.left-scroll .promax-session-row-copy small { color: var(--dsw-promax-text-conversation-meta); font-size: 9px; }
.left-scroll .promax-nav-divider { height: 1px; margin: 20px 3px 0; background: var(--dsw-promax-line); }
.left-scroll .promax-team-root-row { grid-template-columns: minmax(0, 1fr) 36px; }
.left-scroll .promax-team-root { min-height: 46px; padding: 0 10px; grid-template-columns: 31px minmax(0,1fr); gap: 10px; border-radius: 13px; color: var(--dsw-promax-text-sidebar); }
.left-scroll .promax-team-root:hover { background: var(--dsw-promax-hover-background); color: var(--dsw-promax-ink); }
.left-scroll .promax-team-root[aria-current="page"] { border-color: var(--dsw-promax-shell-border); background: var(--dsw-promax-active-background); box-shadow: var(--dsw-promax-active-shadow); color: var(--dsw-promax-ink); }
.left-scroll .promax-team-nav-monogram { width: 31px; height: 31px; border-radius: 9px; background: var(--dsw-promax-surface); }
.left-scroll .promax-team-root[aria-current="page"] .promax-team-nav-monogram { border-color: var(--dsw-promax-primary-border); background: var(--dsw-promax-blue-soft-2); color: var(--dsw-promax-blue); }
.left-scroll .promax-team-root strong { font-size: 12px; font-weight: 650; }
.left-scroll .promax-team-root small { display: none; }
.left-scroll .promax-project-tree { gap: 2px; margin: 20px 0 0; padding: 0; border: 0; }
.left-scroll .promax-project-tree-header { min-height: 36px; }
.left-scroll .promax-project-node { padding: 2px 0; }
.left-scroll .promax-project-header { grid-template-columns: minmax(0, 1fr) 36px; }
.left-scroll .promax-project-row { min-height: 42px; padding: 7px 6px; border-radius: 10px; color: var(--dsw-promax-text-conversation); }
.left-scroll .promax-project-row:hover { border-color: transparent; background: var(--dsw-promax-count-background); color: var(--dsw-promax-ink); }
.left-scroll .promax-project-title { font-size: 11px; font-weight: 720; }
.left-scroll .promax-project-create, .left-scroll .promax-project-new-session { width: 36px; height: 36px; border-radius: 9px; color: var(--dsw-promax-text-conversation-meta); }
.left-scroll .promax-project-create:hover, .left-scroll .promax-project-new-session:hover { background: var(--dsw-promax-blue-soft-2); color: var(--dsw-promax-blue); }
.left-scroll .promax-project-sessions { gap: 3px; padding: 2px 8px 4px 26px; }
.sidebar-footer { display: grid; flex: none; gap: 3px; margin-top: auto; padding: 11px 12px 13px; border-top: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-header-background); }
.sidebar-footer .promax-sidebar-action, .footer-item { display: flex; width: 100%; min-height: 42px; align-items: center; gap: 10px; margin: 0; padding: 0 9px; border: 0; border-radius: 11px; background: transparent; color: var(--dsw-promax-text-footer); cursor: pointer; font-size: 11px; font-weight: 640; text-align: left; }
.sidebar-footer .promax-sidebar-action:hover, .footer-item:hover { background: var(--dsw-promax-hover-background); color: var(--dsw-promax-ink); }
.promax-preferences-dialog { width: min(560px, 100%); padding: 24px; border: 1px solid var(--dsw-promax-line); border-radius: 18px; background: var(--dsw-promax-surface); box-shadow: var(--dsw-promax-shadow-md); }
.promax-preferences-dialog > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.promax-preferences-dialog h2 { margin: 0; font-size: 21px; }

.promax-workbench-layer, .promax-draft-chrome { position: relative; z-index: 3; display: flex; min-width: 0; min-height: 0; grid-column: 2; flex-direction: column; overflow: hidden; pointer-events: none; }
.promax-workbench-layer .topbar, .promax-workbench-layer .view-tabs, .promax-workbench-layer .main-scroll, .promax-workbench-layer .promax-composer-host, .promax-draft-chrome .topbar, .promax-draft-chrome .promax-draft-status-banner, .promax-draft-chrome .promax-opaque-empty, .promax-draft-chrome .promax-composer-host { pointer-events: auto; }
.topbar { position: relative; z-index: 10; display: flex; min-height: 76px; flex: none; align-items: center; gap: 16px; padding: 0 22px; border-bottom: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-topbar-background); backdrop-filter: blur(18px) saturate(125%); }
.mobile-sidebar-button { display: none; }
.topbar-title-wrap { min-width: 0; }
.topbar-kicker { color: var(--dsw-promax-text-kicker); font-size: 9px; font-weight: 800; letter-spacing: .10em; }
.topbar-breadcrumb { display: flex; min-width: 0; align-items: center; gap: 5px; white-space: nowrap; }
.topbar-breadcrumb button { min-width: 0; overflow: hidden; padding: 0; border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; letter-spacing: inherit; text-overflow: ellipsis; text-transform: inherit; white-space: nowrap; }
.topbar-breadcrumb button:hover { color: var(--dsw-promax-blue); }
.topbar-title { margin-top: 3px; overflow: hidden; font-size: 16px; font-weight: 760; letter-spacing: -.02em; text-overflow: ellipsis; white-space: nowrap; }
.team-availability { display: inline-flex; min-height: 28px; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid var(--dsw-promax-team-availability-border); border-radius: 999px; background: var(--dsw-promax-team-availability-background); color: var(--dsw-promax-text-green); font-size: 10px; font-weight: 720; }
.status-dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-promax-green); box-shadow: var(--dsw-promax-green-glow); }
.team-availability--active { background: var(--dsw-promax-blue-soft); color: var(--dsw-promax-blue); }
.team-availability--active .status-dot { background: var(--dsw-promax-blue); box-shadow: var(--dsw-promax-blue-glow); animation: promax-workbench-pulse 1.65s ease-in-out infinite; }
.team-availability--warning { background: var(--dsw-promax-amber-soft); color: var(--dsw-promax-amber); }
.team-availability--warning .status-dot { background: var(--dsw-promax-amber); box-shadow: none; }
.team-availability--error { background: var(--dsw-promax-status-never-bg); color: var(--dsw-promax-red); }
.team-availability--error .status-dot { background: var(--dsw-promax-red); box-shadow: none; }
.topbar-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.toolbar-button { display: inline-flex; min-height: 42px; align-items: center; justify-content: center; gap: 8px; padding: 0 13px; border: 1px solid var(--dsw-promax-line); border-radius: 12px; background: var(--dsw-promax-card-background); color: var(--dsw-promax-text-toolbar); cursor: pointer; font-size: 11px; font-weight: 680; }
.toolbar-button:hover { border-color: var(--dsw-promax-line-strong); background: var(--dsw-promax-surface); color: var(--dsw-promax-ink); box-shadow: var(--dsw-promax-shadow-sm); }
.toolbar-button:disabled { cursor: not-allowed; opacity: .55; }
.promax-draft-status-banner { position: relative; z-index: 9; display: flex; min-height: 64px; flex: none; align-items: center; gap: 12px; padding: 10px 22px; border-bottom: 1px solid var(--dsw-promax-draft-banner-border); background: var(--dsw-promax-draft-banner-background); color: var(--dsw-promax-draft-banner-text); }
.promax-draft-status-banner.is-warning { border-bottom-color: var(--dsw-promax-draft-banner-border); background: var(--dsw-promax-draft-banner-background); }
.promax-draft-status-icon { display: grid; width: 36px; height: 36px; flex: none; place-items: center; border-radius: 11px; background: var(--dsw-promax-draft-banner-icon-background); color: var(--dsw-promax-amber); box-shadow: var(--dsw-promax-shadow-sm); }
.promax-draft-status-banner.is-warning .promax-draft-status-icon { color: var(--dsw-promax-amber); }
.promax-draft-status-copy { display: grid; min-width: 0; gap: 3px; }
.promax-draft-status-copy strong { color: var(--dsw-promax-ink); font-size: 11px; font-weight: 780; }
.promax-draft-status-copy span { color: var(--dsw-promax-draft-banner-text); font-size: 9px; line-height: 1.45; }
.promax-draft-status-actions { display: flex; flex: none; align-items: center; gap: 8px; margin-left: auto; }
.promax-draft-status-button { min-height: 36px; padding: 0 12px; border: 1px solid var(--dsw-promax-line-strong); border-radius: 10px; background: var(--dsw-promax-card-background-strong); color: var(--dsw-promax-ink-2); cursor: pointer; font-size: 10px; font-weight: 740; }
.promax-draft-status-button:hover { border-color: var(--dsw-promax-blue); color: var(--dsw-promax-blue); box-shadow: var(--dsw-promax-shadow-sm); }
.promax-draft-status-button.is-primary { border-color: var(--dsw-promax-blue); background: var(--dsw-promax-blue); color: var(--dsw-promax-surface); }
.promax-draft-status-button.is-primary:hover { background: var(--dsw-promax-blue-hover); color: var(--dsw-promax-surface); }
.promax-draft-status-button:disabled, .promax-draft-status-button:disabled:hover { cursor: not-allowed; border-color: var(--dsw-promax-line-strong); background: var(--dsw-promax-panel); color: var(--dsw-promax-ink-4); box-shadow: none; opacity: .72; }
.view-tabs { position: relative; z-index: 8; display: flex; min-height: 50px; flex: none; align-items: flex-end; gap: 22px; padding: 0 22px; border-bottom: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-tabs-background); }
.view-tab { position: relative; display: inline-flex; min-height: 49px; align-items: center; gap: 7px; padding: 0 2px; border: 0; background: transparent; color: var(--dsw-promax-ink-3); cursor: pointer; font-size: 11px; font-weight: 680; }
.view-tab::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 999px; background: var(--dsw-promax-blue); opacity: 0; transform: scaleX(.65); transition: opacity 160ms ease, transform 160ms ease; content: ""; }
.view-tab[aria-selected="true"] { color: var(--dsw-promax-ink); }
.view-tab[aria-selected="true"]::after { opacity: 1; transform: scaleX(1); }
.promax-overview-nav { position: relative; z-index: 8; display: flex; min-height: 50px; flex: none; align-items: center; gap: 8px; padding: 0 22px; border-bottom: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-tabs-background); color: var(--dsw-promax-text-muted-strong); font-size: 11px; }
.promax-overview-nav strong { color: var(--dsw-promax-ink); font-weight: 720; }
.promax-overview-nav span { margin-left: 4px; color: var(--dsw-promax-ink-4); font-size: 9px; }
.promax-workbench-layer .main-scroll { position: relative; z-index: 2; min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; background: var(--dsw-promax-main-background); scrollbar-width: thin; scrollbar-color: var(--dsw-promax-line-strong) transparent; }
.promax-workbench-layer--trace .main-scroll:empty { background: transparent; pointer-events: none; }
body:has(.promax-composer-host) .app-shell { --promax-composer-height: 97px; }
body:has(.promax-workbench-layer) .promax-conversation-seat { inset-block-start: 126px; inset-block-end: var(--promax-composer-height); }
body:has(.promax-draft-chrome) .promax-conversation-seat { inset-block-start: 76px; inset-block-end: var(--promax-composer-height); }
body:has(.promax-draft-status-banner) .promax-conversation-seat { inset-block-start: 140px; }
body:has(.promax-draft-chrome--empty) [data-chain-overlay-fallback="conversation.composer"] > * > :not([data-slot="conversation.composer.bar"]) { display: none !important; }
.promax-team-overview { width: min(960px, 100%); margin: 0 auto; padding: 28px 28px 38px; }
.promax-overview-hero { position: relative; display: flex; min-height: 154px; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 25px 26px; overflow: hidden; border: 1px solid var(--dsw-promax-line); border-radius: 22px; background: var(--dsw-promax-card-background); box-shadow: var(--dsw-promax-task-shadow); }
.promax-overview-hero::after { position: absolute; top: -110px; right: -60px; width: 290px; height: 250px; border-radius: 50%; background: var(--dsw-promax-task-glow); pointer-events: none; content: ""; }
.promax-overview-hero > * { position: relative; z-index: 1; }
.promax-overview-kicker { color: var(--dsw-promax-text-workspace-kicker); font-size: 9px; font-weight: 820; letter-spacing: .12em; }
.promax-overview-hero h1 { margin: 9px 0 0; font-size: clamp(26px, 2.4vw, 34px); line-height: 1.08; letter-spacing: -.04em; }
.promax-overview-hero p { max-width: 560px; margin: 10px 0 0; color: var(--dsw-promax-ink-3); font-size: 12px; line-height: 1.65; }
.promax-overview-revision { display: inline-flex; min-height: 30px; align-items: center; padding: 0 11px; border: 1px solid var(--dsw-promax-primary-border); border-radius: 999px; background: var(--dsw-promax-blue-soft); color: var(--dsw-promax-primary-text); font-size: 9px; font-weight: 760; white-space: nowrap; }
.promax-overview-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
.promax-overview-stats article { display: grid; min-height: 105px; align-content: center; padding: 15px 17px; border: 1px solid var(--dsw-promax-line); border-radius: 17px; background: var(--dsw-promax-card-background); }
.promax-overview-stats span { color: var(--dsw-promax-text-muted-strong); font-size: 9px; font-weight: 720; }
.promax-overview-stats strong { margin-top: 5px; color: var(--dsw-promax-ink); font-size: 25px; font-weight: 790; line-height: 1; font-variant-numeric: tabular-nums; }
.promax-overview-stats small { margin-top: 8px; overflow: hidden; color: var(--dsw-promax-ink-4); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.promax-overview-section { margin-top: 22px; }
.promax-overview-section > header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 10px; }
.promax-overview-section h2 { margin: 0; color: var(--dsw-promax-ink); font-size: 15px; font-weight: 750; letter-spacing: -.02em; }
.promax-overview-section header p { margin: 4px 0 0; color: var(--dsw-promax-ink-4); font-size: 9px; }
.promax-overview-section header > span { color: var(--dsw-promax-text-muted-strong); font-size: 9px; font-weight: 680; }
.promax-overview-project-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.promax-overview-project-card { display: grid; min-width: 0; min-height: 84px; grid-template-columns: 40px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 15px; border: 1px solid var(--dsw-promax-line); border-radius: 17px; background: var(--dsw-promax-card-background); color: var(--dsw-promax-ink); cursor: pointer; text-align: left; }
.promax-overview-project-card:hover { border-color: var(--dsw-promax-primary-border); background: var(--dsw-promax-active-background); box-shadow: var(--dsw-promax-shadow-sm); }
.promax-overview-project-card:focus-visible { outline: 2px solid var(--dsw-promax-blue); outline-offset: 2px; }
.promax-overview-project-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 12px; background: var(--dsw-promax-blue-soft-2); color: var(--dsw-promax-blue); }
.promax-overview-project-copy { min-width: 0; }
.promax-overview-project-copy strong, .promax-overview-project-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-overview-project-copy strong { font-size: 11px; font-weight: 730; }
.promax-overview-project-copy small { margin-top: 6px; color: var(--dsw-promax-ink-4); font-size: 8px; }
.promax-overview-project-open { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-promax-primary-text); font-size: 8px; font-weight: 720; white-space: nowrap; }
.promax-overview-project-empty { display: flex; min-height: 84px; align-items: center; gap: 12px; padding: 16px; border: 1px dashed var(--dsw-promax-line-strong); border-radius: 17px; color: var(--dsw-promax-text-muted-strong); }
.promax-overview-project-empty div { display: grid; gap: 4px; }
.promax-overview-project-empty strong { color: var(--dsw-promax-ink); font-size: 11px; }
.promax-overview-project-empty span { color: var(--dsw-promax-ink-4); font-size: 9px; }
.promax-overview-flow { display: grid; grid-template-columns: minmax(0,1fr) 32px minmax(0,1fr) 32px minmax(0,1fr); align-items: center; gap: 8px; margin-top: 22px; padding: 15px 18px; border: 1px solid var(--dsw-promax-line); border-radius: 18px; background: var(--dsw-promax-card-background); }
.promax-overview-flow > div { display: flex; min-width: 0; align-items: center; gap: 10px; }
.promax-overview-flow > div > span { display: grid; width: 28px; height: 28px; flex: none; place-items: center; border-radius: 9px; background: var(--dsw-promax-count-background); color: var(--dsw-promax-primary-text); font-size: 9px; font-weight: 800; }
.promax-overview-flow p { display: grid; min-width: 0; gap: 3px; margin: 0; }
.promax-overview-flow strong { font-size: 9px; font-weight: 720; }
.promax-overview-flow small { overflow: hidden; color: var(--dsw-promax-ink-4); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.promax-overview-flow > i { height: 1px; background: var(--dsw-promax-line-strong); }
.workspace-content { width: min(960px, 100%); margin: 0 auto; padding: 24px 28px 34px; }
.workspace-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.workspace-kicker { color: var(--dsw-promax-text-workspace-kicker); font-size: 9px; font-weight: 820; letter-spacing: .11em; }
.workspace-title { margin: 7px 0 0; font-size: clamp(25px, 2.25vw, 34px); line-height: 1.12; letter-spacing: -.04em; }
.workspace-description { margin: 8px 0 0; color: var(--dsw-promax-ink-3); font-size: 12px; line-height: 1.6; }
.workspace-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.meta-chip { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid var(--dsw-promax-line); border-radius: 999px; background: var(--dsw-promax-card-background); color: var(--dsw-promax-text-footer); font-size: 9px; font-weight: 650; }
.task-card { position: relative; margin-top: 20px; padding: 20px; overflow: hidden; border: 1px solid var(--dsw-promax-line); border-radius: 20px; background: var(--dsw-promax-card-background); box-shadow: var(--dsw-promax-task-shadow); }
.task-card::before { position: absolute; top: -90px; right: -60px; width: 240px; height: 190px; border-radius: 50%; background: var(--dsw-promax-task-glow); pointer-events: none; content: ""; }
.task-card-head { position: relative; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.task-label { color: var(--dsw-promax-ink-3); font-size: 9px; font-weight: 800; letter-spacing: .10em; }
.task-goal { margin-top: 6px; font-size: 14px; font-weight: 730; line-height: 1.45; }
.task-percent { min-width: 58px; color: var(--dsw-promax-blue); font-size: 20px; font-weight: 790; letter-spacing: -.03em; text-align: right; font-variant-numeric: tabular-nums; }
.progress-track { position: relative; height: 7px; margin-top: 15px; overflow: hidden; border-radius: 999px; background: var(--dsw-promax-progress-track); }
.progress-value { height: 100%; border-radius: inherit; background: var(--dsw-promax-progress-fill); box-shadow: var(--dsw-promax-progress-shadow); transition: width 500ms cubic-bezier(.2,.8,.2,1); }
.task-card-footer { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.coordinator-avatar { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border-radius: 10px; background: var(--dsw-promax-ink); color: var(--dsw-promax-surface); font-size: 10px; font-weight: 800; }
.coordinator-copy { min-width: 0; color: var(--dsw-promax-text-footer); font-size: 10px; line-height: 1.45; }
.run-button { display: inline-flex; min-height: 36px; align-items: center; justify-content: center; gap: 7px; margin-left: auto; padding: 0 12px; border: 1px solid var(--dsw-promax-primary-border); border-radius: 11px; background: var(--dsw-promax-blue-soft); color: var(--dsw-promax-primary-text); cursor: pointer; font-size: 9px; font-weight: 760; white-space: nowrap; }
.section-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 22px 0 9px; }
.section-name { color: var(--dsw-promax-text-muted-strong); font-size: 9px; font-weight: 810; letter-spacing: .08em; }
.section-meta { color: var(--dsw-promax-ink-4); font-size: 8px; font-weight: 770; letter-spacing: .10em; }
.agent-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 10px; }
.agent-card { min-width: 0; padding: 14px; border: 1px solid var(--dsw-promax-primary-border); border-radius: 16px; background: var(--dsw-promax-surface-glass); box-shadow: var(--dsw-promax-agent-card-shadow); transition: border-color 180ms ease, background 180ms ease, transform 180ms ease, box-shadow 180ms ease; }
.agent-card:hover { transform: translateY(-1px); box-shadow: var(--dsw-promax-agent-card-hover-shadow); }
.agent-card.is-running { border-color: var(--dsw-promax-running-border); background: var(--dsw-promax-running-background); }
.agent-card.is-done { border-color: var(--dsw-promax-done-border); background: var(--dsw-promax-done-background); }
.agent-card.is-blocked { border-color: var(--dsw-promax-red); background: var(--dsw-promax-status-never-bg); }
.agent-card-top { display: flex; align-items: center; gap: 9px; }
.agent-avatar { display: grid; width: 38px; height: 38px; flex: none; place-items: center; border-radius: 12px; background: var(--dsw-promax-avatar-1-background); color: var(--dsw-promax-avatar-1-text); font-size: 10px; font-weight: 820; letter-spacing: .04em; }
.agent-card:nth-child(3n+2) .agent-avatar { background: var(--dsw-promax-avatar-2-background); color: var(--dsw-promax-avatar-2-text); }
.agent-card:nth-child(3n) .agent-avatar { background: var(--dsw-promax-avatar-3-background); color: var(--dsw-promax-avatar-3-text); }
.agent-name { overflow: hidden; font-size: 11px; font-weight: 740; text-overflow: ellipsis; white-space: nowrap; }
.agent-role { margin-top: 3px; color: var(--dsw-promax-text-agent-role); font-size: 8px; }
.agent-task { min-height: 34px; margin-top: 12px; color: var(--dsw-promax-text-agent-task); font-size: 9px; line-height: 1.55; }
.agent-footer { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--dsw-promax-text-agent-footer); font-size: 8px; font-weight: 650; }
.agent-state-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-promax-line-strong); }
.is-running .agent-state-dot { background: var(--dsw-promax-blue); box-shadow: var(--dsw-promax-blue-glow); animation: promax-workbench-pulse 1.65s ease-in-out infinite; }
.is-done .agent-state-dot { background: var(--dsw-promax-green); box-shadow: var(--dsw-promax-green-glow); }
.is-blocked .agent-state-dot { background: var(--dsw-promax-red); box-shadow: 0 0 0 4px var(--dsw-promax-status-never-bg); }
@keyframes promax-workbench-pulse { 50% { opacity: .45; transform: scale(.72); } }
.deliverable-card { padding: 14px; border: 1px solid var(--dsw-promax-line); border-radius: 16px; background: var(--dsw-promax-card-background-soft); }
.file-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; margin-top: 10px; }
.file-item { display: flex; min-width: 0; min-height: 50px; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid var(--dsw-promax-line); border-radius: 12px; background: var(--dsw-promax-surface); color: var(--dsw-promax-text-file); cursor: pointer; text-align: left; }
.file-item.is-ready { border-color: var(--dsw-promax-ready-border); background: var(--dsw-promax-ready-background); color: var(--dsw-promax-text-ready); }
.file-item.is-optional-missing, .big-file.is-optional-missing, .promax-artifact-row.is-optional-missing { opacity: .55; }
.file-copy { min-width: 0; }
.file-name { display: block; overflow: hidden; font-size: 9px; font-weight: 720; text-overflow: ellipsis; white-space: nowrap; }
.file-meta { display: block; margin-top: 3px; color: var(--dsw-promax-text-file-meta); font-size: 7px; }
.timeline-list { display: grid; gap: 0; overflow: hidden; border: 1px solid var(--dsw-promax-line); border-radius: 18px; background: var(--dsw-promax-card-background); box-shadow: var(--dsw-promax-shadow-sm); }
.timeline-item { position: relative; min-height: 68px; padding: 14px 16px 14px 48px; border-bottom: 1px solid var(--dsw-promax-line); }
.timeline-item:last-child { border-bottom: 0; }
.timeline-dot { position: absolute; top: 18px; left: 20px; width: 10px; height: 10px; border: 2px solid var(--dsw-promax-surface); border-radius: 50%; background: var(--dsw-promax-green); box-shadow: var(--dsw-promax-green-glow); }
.timeline-item.is-active .timeline-dot { background: var(--dsw-promax-blue); box-shadow: var(--dsw-promax-blue-glow); animation: promax-workbench-pulse 1.65s ease-in-out infinite; }
.timeline-item.is-idle .timeline-dot { background: var(--dsw-promax-amber); box-shadow: 0 0 0 3px var(--dsw-promax-status-stale-bg); }
.timeline-item.is-blocked .timeline-dot { background: var(--dsw-promax-red); box-shadow: 0 0 0 3px var(--dsw-promax-status-never-bg); }
.timeline-title { padding-right: 54px; font-size: 10px; font-weight: 720; }
.timeline-copy { margin-top: 5px; color: var(--dsw-promax-ink-3); font-size: 9px; line-height: 1.55; }
.timeline-time { position: absolute; top: 15px; right: 16px; color: var(--dsw-promax-ink-4); font-size: 8px; font-variant-numeric: tabular-nums; }
.files-overview { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
.big-file { display: flex; min-height: 150px; flex-direction: column; padding: 18px; border: 1px solid var(--dsw-promax-line); border-radius: 18px; background: var(--dsw-promax-card-background); box-shadow: var(--dsw-promax-shadow-sm); }
.big-file-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 12px; background: var(--dsw-promax-green-soft); color: var(--dsw-promax-green); }
.big-file-name { margin-top: 18px; font-size: 12px; font-weight: 720; }
.big-file-meta { margin-top: 6px; color: var(--dsw-promax-ink-3); font-size: 9px; }
.big-file-status { margin-top: auto; color: var(--dsw-promax-green); font-size: 8px; font-weight: 700; }

.promax-composer-host { position: relative; z-index: 12; min-width: 0; flex: none; }
.promax-draft-chrome .promax-composer-host { margin-top: auto; }
.composer-wrap { position: relative; z-index: 12; width: 100%; flex: none; padding: 12px 20px 16px; border-top: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-composer-wrap-background); backdrop-filter: blur(18px); }
.composer { position: relative; display: grid; width: min(920px,100%); min-height: 68px; grid-template-columns: auto auto minmax(0,1fr) auto; align-items: center; gap: 4px; margin: 0 auto; padding: 9px 9px 9px 12px; border: 1px solid var(--dsw-promax-line-strong); border-radius: 18px; background: var(--dsw-promax-card-background-strong); box-shadow: var(--dsw-promax-composer-shadow); }
.composer-tool { display: grid; width: 40px; height: 40px; place-items: center; padding: 0; border: 0; border-radius: 11px; background: transparent; color: var(--dsw-promax-ink-3); cursor: pointer; }
.composer-tool:hover { background: var(--dsw-promax-panel); color: var(--dsw-promax-ink); }
.composer-tool:disabled { cursor: not-allowed; opacity: .45; }
.promax-composer-attachment-control { position: relative; display: grid; width: 40px; height: 40px; place-items: center; }
.promax-composer-format-tooltip { position: absolute; z-index: 4; bottom: calc(100% + 8px); left: 0; width: max-content; max-width: 220px; padding: 7px 9px; border: 1px solid var(--dsw-promax-line); border-radius: 8px; background: var(--dsw-promax-card-background-strong); box-shadow: var(--dsw-promax-shadow-sm); color: var(--dsw-promax-ink-2); font-size: 9px; font-weight: 650; line-height: 1.35; opacity: 0; pointer-events: none; transform: translateY(3px); transition: opacity 120ms ease, transform 120ms ease; }
.promax-composer-attachment-control:hover .promax-composer-format-tooltip, .promax-composer-attachment-control:focus-within .promax-composer-format-tooltip { opacity: 1; transform: translateY(0); }
.promax-composer-left-items { display: flex; min-width: 40px; align-items: center; }
.promax-composer-left-items .promax-native-mentions { display: flex; align-items: center; gap: 4px; }
.promax-composer-left-items .promax-native-mention-trigger { display: grid; width: 40px; height: 40px; place-items: center; border: 0; border-radius: 11px; background: transparent; color: var(--dsw-promax-ink-3); cursor: pointer; }
.promax-composer-mention-picker { position: relative; }
.promax-composer-mention-trigger { position: relative; font-size: 16px; font-weight: 750; }
.promax-composer-mention-trigger[aria-expanded="true"] { background: var(--dsw-promax-blue-soft-2); color: var(--dsw-promax-blue); }
.promax-composer-mention-count { position: absolute; top: 3px; right: 2px; display: grid; min-width: 15px; height: 15px; place-items: center; padding: 0 3px; border-radius: 99px; background: var(--dsw-promax-blue); color: var(--dsw-promax-surface); font-size: 8px; font-weight: 800; }
.promax-composer-mention-menu { position: absolute; z-index: 45; bottom: calc(100% + 11px); left: 0; width: min(340px, calc(100vw - 48px)); overflow: hidden; border: 1px solid var(--dsw-promax-line-strong); border-radius: 15px; background: var(--dsw-promax-card-background-strong); box-shadow: var(--dsw-promax-shadow-md); }
.promax-composer-mention-menu > header { display: grid; gap: 3px; padding: 12px 13px 10px; border-bottom: 1px solid var(--dsw-promax-line); }
.promax-composer-mention-menu > header strong { color: var(--dsw-promax-ink); font-size: 11px; }
.promax-composer-mention-menu > header span { color: var(--dsw-promax-ink-4); font-size: 8px; }
.promax-composer-mention-menu > div { display: grid; max-height: 330px; overflow-y: auto; padding: 6px; }
.promax-composer-mention-menu > div > button { display: grid; min-height: 52px; grid-template-columns: 34px minmax(0, 1fr) 22px; align-items: center; gap: 9px; padding: 7px 8px; border: 0; border-radius: 10px; background: transparent; color: var(--dsw-promax-ink); cursor: pointer; text-align: left; }
.promax-composer-mention-menu > div > button:hover, .promax-composer-mention-menu > div > button[aria-checked="true"] { background: var(--dsw-promax-blue-soft-2); }
.promax-composer-mention-avatar { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: var(--dsw-promax-panel); color: var(--dsw-promax-ink-2); font-size: 9px; font-weight: 760; }
.promax-composer-mention-menu button > span:nth-child(2) { display: grid; min-width: 0; gap: 2px; }
.promax-composer-mention-menu button strong, .promax-composer-mention-menu button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.promax-composer-mention-menu button strong { font-size: 10px; }
.promax-composer-mention-menu button small { color: var(--dsw-promax-ink-4); font-size: 8px; }
.promax-composer-mention-check { display: grid; width: 20px; height: 20px; place-items: center; border: 1px solid var(--dsw-promax-line-strong); border-radius: 7px; color: transparent; font-size: 10px; font-weight: 800; }
.promax-composer-mention-check.is-selected { border-color: var(--dsw-promax-blue); background: var(--dsw-promax-blue); color: var(--dsw-promax-surface); }
.composer textarea { width: 100%; height: 42px; max-height: 100px; padding: 11px 8px; resize: none; border: 0; outline: 0; background: transparent; color: var(--dsw-promax-ink); font-size: 11px; line-height: 1.45; }
.composer textarea::placeholder { color: var(--dsw-promax-text-placeholder); }
.send-button { display: grid; width: 44px; height: 44px; place-items: center; padding: 0; border: 0; border-radius: 13px; background: var(--dsw-promax-blue); color: var(--dsw-promax-surface); box-shadow: var(--dsw-promax-send-shadow); cursor: pointer; }
.send-button:hover { background: var(--dsw-promax-blue-hover); }
.send-button:disabled { cursor: not-allowed; opacity: .45; }
.promax-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.promax-composer-attachment-count { width: min(920px,100%); margin: 5px auto 0; color: var(--dsw-promax-ink-3); font-size: 8px; }

.right-header { display: flex; height: 76px; flex: none; align-items: center; justify-content: space-between; padding: 0 14px 0 18px; border-bottom: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-header-background); }
.right-kicker { color: var(--dsw-promax-text-agent-role); font-size: 8px; font-weight: 800; letter-spacing: .14em; }
.right-title { margin-top: 4px; font-size: 16px; font-weight: 760; }
.right-section { display: block; }
.right-section + .right-section { margin-top: 20px; }
.member-list { display: grid; min-width: 0; gap: 5px; }
.member-item { display: flex; min-width: 0; min-height: 58px; align-items: center; gap: 10px; padding: 8px; border-radius: 13px; }
.member-item:hover { background: var(--dsw-promax-hover-background); }
.member-avatar { display: grid; width: 34px; height: 34px; flex: none; place-items: center; border-radius: 10px; background: var(--dsw-promax-avatar-1-background); color: var(--dsw-promax-avatar-1-text); font-size: 8px; font-weight: 800; }
.member-item:nth-child(3n+2) .member-avatar { background: var(--dsw-promax-avatar-2-background); color: var(--dsw-promax-avatar-2-text); }
.member-item:nth-child(3n) .member-avatar { background: var(--dsw-promax-avatar-3-background); color: var(--dsw-promax-avatar-3-text); }
.member-copy { min-width: 0; flex: 1; }
.member-name { display: block; overflow: hidden; font-size: 10px; font-weight: 690; text-overflow: ellipsis; white-space: nowrap; }
.member-role { display: block; margin-top: 4px; overflow: hidden; color: var(--dsw-promax-text-member-role); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.presence { width: 7px; height: 7px; flex: none; margin-left: auto; border: 2px solid var(--dsw-promax-surface); border-radius: 50%; }
.presence--idle { background: var(--dsw-promax-amber); box-shadow: 0 0 0 4px var(--dsw-promax-status-stale-bg); }
.presence--running { background: var(--dsw-promax-blue); box-shadow: var(--dsw-promax-blue-glow); animation: promax-workbench-pulse 1.65s ease-in-out infinite; }
.presence--done { background: var(--dsw-promax-green); box-shadow: var(--dsw-promax-green-glow); }
.presence--blocked { background: var(--dsw-promax-red); box-shadow: 0 0 0 4px var(--dsw-promax-status-never-bg); }
.promax-overlay-right-sidebar { position: relative; z-index: 4; display: flex; min-width: 0; min-height: 0; grid-column: 3; flex-direction: column; overflow: hidden; border-left: 1px solid var(--dsw-promax-line); background: var(--dsw-promax-sidebar-background); pointer-events: auto; }
.promax-artifact-tree { overflow: hidden; border: 1px solid var(--dsw-promax-line); border-radius: 18px; background: var(--dsw-promax-card-background); box-shadow: var(--dsw-promax-shadow-sm); }
.promax-artifact-row { padding: 12px 14px; border-bottom: 1px solid var(--dsw-promax-line); }
.promax-artifact-row:last-child { border-bottom: 0; }
.promax-artifact-stages { display: flex; gap: 10px; margin-top: 7px; color: var(--dsw-promax-text-agent-footer); font-size: 8px; font-weight: 650; }
.promax-artifact-stages span { display: inline-flex; align-items: center; gap: 5px; }
.promax-artifact-stages i { width: 6px; height: 6px; flex: none; border-radius: 50%; background: var(--dsw-promax-line-strong); }
.promax-artifact-stages [data-state="running"] i { background: var(--dsw-promax-blue); box-shadow: var(--dsw-promax-blue-glow); animation: promax-workbench-pulse 1.65s ease-in-out infinite; }
.promax-artifact-stages [data-state="done"] i { background: var(--dsw-promax-green); box-shadow: var(--dsw-promax-green-glow); }
.promax-artifact-stages [data-state="blocked"] i { background: var(--dsw-promax-red); }
.promax-artifact-stages [data-state="appealed"] i,
.promax-artifact-stages [data-state="human-required"] i,
.promax-artifact-stages [data-state="force-released"] i { background: var(--dsw-promax-amber); }
.team-note { margin: 16px 2px 0; padding: 12px; border: 1px solid var(--dsw-promax-shell-border); border-radius: 14px; background: var(--dsw-promax-team-note-background); color: var(--dsw-promax-text-muted-strong); box-shadow: var(--dsw-promax-shadow-sm); font-size: 9px; line-height: 1.6; }
.toast { position: fixed; z-index: 80; left: 50%; bottom: 38px; display: flex; min-width: 280px; max-width: min(440px, calc(100vw - 32px)); align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid var(--dsw-promax-toast-border); border-radius: 15px; background: var(--dsw-promax-toast-background); color: var(--dsw-promax-toast-text); box-shadow: var(--dsw-promax-toast-shadow); opacity: 0; pointer-events: none; transform: translate(-50%, 14px); transition: opacity 180ms ease, transform 180ms ease; backdrop-filter: blur(18px); font-size: 11px; font-weight: 650; }
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast-icon { display: grid; width: 28px; height: 28px; flex: none; place-items: center; border-radius: 9px; background: var(--dsw-promax-green-soft); color: var(--dsw-promax-green); }
.right-sidebar .promax-draft-panel { position: static; width: auto; min-height: 0; padding: 0; overflow: visible; border: 0; background: transparent; box-shadow: none; }
.right-sidebar .promax-draft-panel > header { display: none; }
.promax-workbench-empty { display: grid; min-height: 100%; place-items: center; align-content: center; padding: 32px; text-align: center; }
.promax-workbench-empty h1 { margin: 18px 0 0; font-size: 28px; letter-spacing: -.04em; }
.promax-workbench-empty p { max-width: 460px; margin: 8px 0 0; color: var(--dsw-promax-ink-3); font-size: 12px; line-height: 1.6; }
.promax-opaque-empty { position: absolute; z-index: 3; inset: 76px 0 0; background: var(--dsw-promax-main-background); }

.app-shell.left-collapsed .mobile-sidebar-button { display: inline-grid; }
@media (max-width: 1180px) {
  .promax-overlay-right-sidebar { display: none; }
  .workspace-content, .promax-team-overview { width: min(900px,100%); }
}
@media (max-width: 820px) {
  body:has(.promax-composer-host) .app-shell { --promax-composer-height: 80px; }
  .promax-workbench-layer, .promax-draft-chrome { grid-column: 1; }
  .topbar { min-height: 68px; padding: 0 12px; }
  .mobile-sidebar-button { display: inline-grid; }
  .topbar-kicker, .team-availability, .toolbar-button .button-label { display: none; }
  .toolbar-button { width: 42px; padding: 0; }
  .view-tabs { gap: 20px; padding: 0 14px; overflow-x: auto; }
  .promax-overview-nav { padding: 0 14px; }
  body:has(.promax-workbench-layer) .promax-conversation-seat { inset-block-start: 118px; }
  body:has(.promax-draft-chrome) .promax-conversation-seat { inset-block-start: 68px; }
  body:has(.promax-draft-status-banner) .promax-conversation-seat { inset-block-start: 164px; }
  .promax-draft-status-banner { min-height: 96px; align-items: flex-start; padding: 12px 14px; }
  .promax-draft-status-copy span { max-width: 48ch; }
  .promax-draft-status-actions { align-self: center; }
  .workspace-content { padding: 20px 16px 28px; }
  .promax-team-overview { padding: 20px 16px 28px; }
  .promax-overview-hero { min-height: 0; padding: 21px; }
  .promax-overview-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .promax-overview-project-grid { grid-template-columns: 1fr; }
  .promax-overview-flow { grid-template-columns: 1fr; }
  .promax-overview-flow > i { width: 1px; height: 12px; margin-left: 13px; }
  .workspace-head { display: block; }
  .workspace-meta { margin-top: 14px; }
  .agent-grid, .file-grid, .files-overview { grid-template-columns: 1fr; }
  .file-item { min-height: 54px; }
  .composer-wrap { padding: 9px 10px max(10px, env(safe-area-inset-bottom)); }
  .composer { min-height: 60px; grid-template-columns: auto auto minmax(0,1fr) auto; border-radius: 16px; }
  .toast { bottom: 92px; }
}
@media (max-width: 480px) {
  body:has(.promax-draft-status-banner) .promax-conversation-seat { inset-block-start: 206px; }
  .promax-draft-status-banner { min-height: 138px; display: grid; grid-template-columns: 36px minmax(0, 1fr); align-content: center; }
  .promax-draft-status-actions { grid-column: 1 / -1; width: 100%; margin-left: 0; }
  .promax-draft-status-button { flex: 1; }
  .topbar-title { max-width: 140px; }
  .topbar-actions { gap: 5px; }
  .topbar-actions .toolbar-button:first-child { display: none; }
  .task-card { padding: 16px; }
  .promax-overview-hero { display: block; }
  .promax-overview-revision { margin-top: 16px; }
  .promax-overview-stats { grid-template-columns: 1fr 1fr; }
  .promax-overview-stats article { min-height: 92px; padding: 13px; }
  .promax-overview-project-card { grid-template-columns: 36px minmax(0, 1fr); }
  .promax-overview-project-icon { width: 36px; height: 36px; }
  .promax-overview-project-open { display: none; }
  .task-card-footer { align-items: flex-start; flex-wrap: wrap; }
  .run-button { width: 100%; margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .promax-workbench-layer *, .promax-workbench-layer *::before, .promax-workbench-layer *::after, .left-sidebar *, .left-sidebar *::before, .left-sidebar *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
}
`
