/**
 * Rebrand Playwright's generated HTML report (`playwright-report/index.html`)
 * as taqwright's: the tab title `Taqwright Test Report` + the taqwright logo
 * favicon.
 *
 * Why a post-process and not config: the report TITLE is settable via the
 * `['html', { title }]` reporter option, but the FAVICON is injected at runtime
 * by Playwright's bundled `report.js` (`link.rel='shortcut icon'; …;
 * document.head.append(…)`) with no config hook — and editing `node_modules` is
 * off-limits. So we inject a tiny script into `index.html` that re-asserts our
 * favicon/title *after* report.js runs (and keeps re-asserting via a
 * MutationObserver), winning regardless of Playwright internals.
 *
 * `brandReportHtml` is pure (string → string) so it's unit-testable without
 * touching disk; `brandReportDir` is the best-effort IO wrapper the CLI calls.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAQWRIGHT_FAVICON_DATA_URI } from '../branding-assets.js';

/** Marker so re-running over an already-branded report is a no-op. */
const SENTINEL = '<!--taqwright-branding-->';

const REPORT_TITLE = 'Taqwright Test Report';

/**
 * Build the `<script>` (prefixed with the sentinel comment) that forces the
 * taqwright title + favicon. `JSON.stringify` quotes the data URI / title
 * safely; the base64 payload contains no `</script>` so it can't break out.
 */
function injectionMarkup(): string {
  const icon = JSON.stringify(TAQWRIGHT_FAVICON_DATA_URI);
  const title = JSON.stringify(REPORT_TITLE);
  const script =
    `(function(){` +
    `var ICON=${icon};var TITLE=${title};` +
    `function apply(){try{` +
    `document.title=TITLE;` +
    `var links=document.head?document.head.querySelectorAll('link[rel~="icon"]'):[];` +
    `for(var i=0;i<links.length;i++){var el=links[i];if(el.hasAttribute('data-tw-icon'))continue;if(el.parentNode)el.parentNode.removeChild(el);}` +
    `if(document.head&&!document.head.querySelector('link[data-tw-icon]')){` +
    `var l=document.createElement('link');l.setAttribute('rel','icon');l.setAttribute('type','image/png');l.setAttribute('href',ICON);l.setAttribute('data-tw-icon','');document.head.appendChild(l);}` +
    `}catch(e){}}` +
    `apply();` +
    `document.addEventListener('DOMContentLoaded',apply);` +
    `window.addEventListener('load',apply);` +
    `try{var mo=new MutationObserver(apply);mo.observe(document.head||document.documentElement,{childList:true});}catch(e){}` +
    `var n=0,t=setInterval(function(){apply();if(++n>10)clearInterval(t);},500);` +
    `})();`;
  return `${SENTINEL}<script>${script}</script>`;
}

/**
 * Inject the branding markup before `</head>`. Idempotent (skips if already
 * branded) and a no-op if there's no `</head>` to anchor to.
 */
export function brandReportHtml(html: string): string {
  if (html.includes(SENTINEL)) return html;
  const idx = html.indexOf('</head>');
  if (idx === -1) return html;
  return html.slice(0, idx) + injectionMarkup() + html.slice(idx);
}

/**
 * Best-effort: brand `<dir>/index.html` in place. No-op when the file is
 * absent or already branded. Callers should still wrap in try/catch — branding
 * must never fail a test run or `show-report`.
 */
export function brandReportDir(dir: string): void {
  const file = join(dir, 'index.html');
  if (!existsSync(file)) return;
  const html = readFileSync(file, 'utf8');
  const branded = brandReportHtml(html);
  if (branded !== html) writeFileSync(file, branded);
}
