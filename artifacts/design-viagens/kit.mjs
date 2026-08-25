// Vocabulário visual real do Transhipping Desk, extraído de src/index.css
// (tema `current`/light) e dos componentes em src/components/ui + voyages.
// Nada aqui é inventado: cada valor foi copiado do código de produção.

export const T = {
  bg: '#f4f1ea',
  dots: 'radial-gradient(circle, rgba(168, 160, 145, 0.38) 1px, transparent 1px)',
  bgElevated: '#ece9e1',
  surface: '#ffffff',
  surfaceMuted: '#f8f6f1',
  surfaceHover: '#f1eee7',
  panel: '#ede9df',
  panelStrong: '#e2ddd2',
  border: '#cdc8bc',
  borderStrong: '#b8b2a5',
  text: '#1c1915',
  textStrong: '#0e0c0a',
  muted: '#5a5549',
  mutedSoft: '#8a8579',
  navy: '#152238',
  navy2: '#1e3050',
  topbar: '#0e1825',
  blue: '#2563a8',
  blueBtn: '#1d4d88',
  blueSoft: '#e8f0fb',
  gold: '#d4882e',
  goldStrong: '#8f4d08',
  goldSoft: '#fdf0dc',
  green: '#1a8c50',
  greenSoft: '#e6f7ee',
  red: '#c0393f',
  redSoft: '#fceaea',
  display: '"Syne", "DM Sans", sans-serif',
  body: '"DM Sans", "Segoe UI", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
}

/** Ícones no estilo lucide (stroke 2, grade 24) usados pelo app. */
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V21h14V9.8"/>',
  ship: '<path d="M2 20.5c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2"/><path d="M19.4 18.5A11.6 11.6 0 0 0 21 13l-9-4-9 4a11 11 0 0 0 1.6 5.5"/><path d="M19 12V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v5"/><path d="M12 9V2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  package: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  sliders: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  warning: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="17.5" r="2.5"/>',
  box: '<path d="M12 2 2 7v10l10 5 10-5V7z"/><path d="M2 7l10 5 10-5"/><path d="M12 22V12"/>',
  boxOpen: '<path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 8 5.5 3h13L21 8"/><path d="M12 3v5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
}

export function icon(name, size = 16, color = 'currentColor', strokeWidth = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex: none">${PATHS[name]}</svg>`
}

/** CSS compartilhado: só o que já existe em src/index.css, transposto 1:1. */
export const BASE_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=IBM+Plex+Mono:wght@400;500;600&display=swap");

  * { box-sizing: border-box; }
  body { margin: 0; font-family: ${T.body}; color: ${T.text}; -webkit-font-smoothing: antialiased; }
  a { color: ${T.blueBtn}; text-decoration: none; }
  a:hover { color: ${T.goldStrong}; }

  .shell {
    width: 1440px;
    background-color: ${T.bg};
    background-image: ${T.dots};
    background-size: 20px 20px;
    color: ${T.text};
    display: flex;
    flex-direction: column;
  }

  /* --- faixa de mercado (HeaderInfoBar) --- */
  .strip {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    height: 26px; padding: 0 34px; background: ${T.topbar};
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    color: rgba(255, 255, 255, 0.62);
  }
  .strip__warn { display: inline-flex; align-items: center; gap: 6px; color: ${T.gold}; }
  .strip__rate { color: rgba(255, 255, 255, 0.72); }
  .strip__rate b { color: #ffffff; font-weight: 600; font-family: ${T.mono}; }
  .strip__role { color: rgba(255, 255, 255, 0.42); letter-spacing: 0.08em; }

  /* --- header --- */
  .hdr {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    min-height: 56px; padding: 0 34px;
    background: linear-gradient(180deg, rgba(22, 36, 64, 0.98), rgba(21, 33, 58, 0.94));
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: #ffffff;
  }
  .hdr__brand { display: flex; align-items: center; gap: 14px; }
  .hdr__mark { display: flex; align-items: center; gap: 7px; }
  .hdr__wordmark { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #ffffff; }
  .hdr__eyebrow { font-family: ${T.display}; font-size: 14px; font-weight: 700; line-height: 1; }
  .hdr__subtitle {
    margin-top: 3px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
    line-height: 1.2; text-transform: uppercase; color: rgba(255, 255, 255, 0.56);
  }
  .hdr__actions { display: flex; align-items: center; gap: 12px; }
  .hdr__pill {
    display: inline-flex; align-items: center; gap: 8px; min-height: 40px;
    padding: 6px 12px; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
    font-size: 13px; font-weight: 600; color: rgba(255, 255, 255, 0.86);
  }

  /* --- barra de navegação --- */
  .nav {
    display: flex; align-items: center; gap: 6px; padding: 0 34px 12px;
    background: ${T.navy2}; border-bottom: 2px solid rgba(212, 136, 46, 0.85);
  }
  .nav__link {
    display: inline-flex; align-items: center; gap: 8px; min-height: 42px;
    padding: 10px 14px; border: 1px solid transparent; border-radius: 8px;
    font-size: 13px; font-weight: 600; letter-spacing: 0.2px; white-space: nowrap;
    color: rgba(255, 255, 255, 0.7);
  }
  .nav__link--active {
    color: #ffffff; border-color: rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.1); box-shadow: inset 0 -3px 0 rgba(242, 169, 59, 1);
  }
  .nav__badge {
    display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px;
    padding: 0 6px; border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 999px;
    background: ${T.gold}; color: #ffffff; font-size: 10px; font-weight: 700; line-height: 1;
  }
  .nav__dot {
    width: 10px; height: 10px; border: 2px solid rgba(255, 255, 255, 0.62);
    border-radius: 999px; background: ${T.gold};
  }
  .nav__divider { width: 1px; height: 28px; margin: 0 6px; background: rgba(255, 255, 255, 0.14); }

  /* --- área principal --- */
  .main { padding: 34px 28px 52px; display: flex; flex-direction: column; }

  /* --- page header --- */
  .page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; margin-bottom: 28px; padding-inline: 2px; }
  .page-header__title {
    margin: 0; color: ${T.textStrong}; font-family: ${T.display}; font-size: 35.2px;
    font-weight: 700; letter-spacing: -0.04em; line-height: 1.05;
  }
  .page-header__description { max-width: 880px; margin: 10px 0 0; color: ${T.muted}; font-size: 14px; line-height: 1.65; }
  .page-header__rule { width: 48px; height: 3px; margin-top: 14px; background: ${T.gold}; }

  /* --- botões (.app-btn) --- */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 44px; padding: 10px 16px; border: 1px solid transparent; border-radius: 8px;
    font-family: ${T.body}; font-size: 13px; font-weight: 600; line-height: 1.2; white-space: nowrap;
  }
  .btn--sm { min-height: 40px; padding: 6px 12px; font-size: 12px; gap: 6px; }
  .btn--primary { background: ${T.blueBtn}; border-color: ${T.blueBtn}; color: #ffffff; }
  .btn--secondary { background: ${T.surface}; border-color: ${T.borderStrong}; color: ${T.textStrong}; }
  .btn--ghost { background: transparent; border-color: transparent; color: ${T.muted}; }
  .btn--danger { background: linear-gradient(180deg, #fff7f8, #fff0f2); border-color: #f2b3bb; color: ${T.red}; }
  .btn--icon { width: 44px; min-height: 44px; padding: 0; }

  /* --- superfície (.app-surface) --- */
  .surface { border: 1.5px solid ${T.border}; border-radius: 8px; background: ${T.surface}; overflow: hidden; }
  .surface--padded { padding: 22px; }

  /* --- campos (.app-input / .app-field) --- */
  .input {
    display: flex; align-items: center; gap: 10px; min-height: 44px;
    border: 1px solid ${T.border}; border-radius: 8px; padding: 11px 14px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 247, 251, 0.98));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.86);
    font-size: 14px; color: ${T.textStrong};
  }
  .input__placeholder { color: ${T.mutedSoft}; }
  .field__label { font-size: 12px; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: ${T.muted}; }

  /* --- badges (.app-badge) --- */
  .badge {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    border: 1px solid transparent; border-radius: 999px; padding: 4px 10px;
    font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .badge--blue { background: ${T.blueSoft}; border-color: #bfdbfe; color: ${T.blueBtn}; }
  .badge--green { background: ${T.greenSoft}; border-color: #86efac; color: #157a45; }
  .badge--yellow { background: ${T.goldSoft}; border-color: #fde68a; color: #a85309; }
  .badge--red { background: ${T.redSoft}; border-color: #fecaca; color: ${T.red}; }
  .badge--slate { background: #f3f4f6; border-color: #e5e7eb; color: ${T.muted}; }

  /* --- abas no estilo do app (.app-tab) --- */
  .tab {
    display: inline-flex; align-items: center; justify-content: center; min-height: 40px;
    padding: 0 14px; border: 1px solid ${T.borderStrong}; border-radius: 8px;
    background: ${T.surface}; color: ${T.text}; font-size: 14px; font-weight: 700; letter-spacing: 0.01em;
  }
  .tab--active { background: ${T.navy}; border-color: ${T.navy}; color: #ffffff; box-shadow: inset 0 -2px 0 ${T.gold}; }

  /* --- tabela (.app-table) --- */
  .table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .table thead th {
    background: ${T.navy}; color: #ffffff; text-align: left;
    font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 12px 14px; white-space: nowrap;
  }
  .table tbody td { padding: 12px 14px; color: ${T.text}; white-space: nowrap; vertical-align: middle; }
  .table tbody tr + tr td { border-top: 1px solid ${T.border}; }
  .table tbody tr:nth-child(even) { background: rgba(19, 32, 51, 0.018); }
  .table--dense thead th, .table--dense tbody td { padding: 10px 10px; }
  .num { font-family: ${T.mono}; font-variant-numeric: tabular-nums; font-size: 12px; }
  .dash { color: ${T.mutedSoft}; }

  /* --- pill do rail (RailPill) --- */
  .pill {
    display: inline-flex; align-items: center; border: 1px solid ${T.border};
    border-radius: 999px; background: ${T.bgElevated}; padding: 2px 8px;
    font-size: 11px; font-weight: 600; color: ${T.muted}; white-space: nowrap;
  }

  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; flex: none; }
  .eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedSoft}; }
  .section-label { font-size: 11px; font-weight: 700; letter-spacing: 0.09em; text-transform: uppercase; color: ${T.muted}; }
`

export function stripBar() {
  return `<div class="strip">
    <span class="strip__warn">${icon('warning', 13)} 2 demurrages vencidos</span>
    <span class="strip__rate">PTAX Venda <b>R$ 5,4210</b> &rarr; PTAX &times; 1,065 = ROE <b>R$ 5,7734</b> (22/08)</span>
    <span style="display: flex; align-items: center; gap: 10px">${icon('user', 12)} Ana Ribeiro <span class="strip__role">ADMINISTRATIVO</span></span>
  </div>`
}

export function header() {
  return `<div class="hdr">
    <div class="hdr__brand">
      <span class="hdr__mark">${icon('ship', 22, '#ffffff', 1.6)}<span class="hdr__wordmark">TRANSHIPPING</span></span>
      <span style="width: 1px; height: 26px; background: rgba(255, 255, 255, 0.14)"></span>
      <span>
        <span class="hdr__eyebrow">Desk operacional</span>
        <div class="hdr__subtitle">Importa&ccedil;&atilde;o, exporta&ccedil;&atilde;o e faturamento</div>
      </span>
    </div>
    <div class="hdr__actions">
      <span class="hdr__pill">${icon('user', 15)} Ana Ribeiro</span>
      <span class="hdr__pill" style="border-color: transparent">${icon('logout', 15)} Sair</span>
    </div>
  </div>`
}

export function navBar() {
  const link = (name, label, extra = '', active = false) =>
    `<span class="nav__link${active ? ' nav__link--active' : ''}">${icon(name, 16)} ${label}${extra}</span>`
  return `<div class="nav">
    ${link('home', 'Painel')}
    ${link('ship', 'Viagens', '', true)}
    ${link('file', 'Importa&ccedil;&atilde;o', ' <span class="nav__badge">3</span> ' + icon('chevronDown', 14))}
    ${link('package', 'Exporta&ccedil;&atilde;o', ' ' + icon('chevronDown', 14))}
    ${link('users', 'Clientes')}
    ${link('bell', 'Alertas', ' <span class="nav__badge">3</span>')}
    ${link('dollar', 'Financeiro', ' <span class="nav__dot"></span> ' + icon('chevronDown', 14))}
    <span class="nav__divider"></span>
    ${link('shield', 'Admin', ' ' + icon('chevronDown', 14))}
  </div>`
}

/** Envelope de um artboard Design Component. */
export function artboard({ css = '', height, body }) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>${BASE_CSS}${css}</style>
</helmet>
<div class="shell" style="min-height: ${height}px">
  ${stripBar()}
  ${header()}
  ${navBar()}
  ${body}
</div>
</x-dc>
</body>
</html>
`
}
