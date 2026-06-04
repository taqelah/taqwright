import { Platform, type LocatorDescriptor, type LocatorStrategy } from '../types/index.js';

export type LocatorCategory = 'id' | 'uiautomator' | 'predicate' | 'classChain' | 'xpath' | 'css';

/**
 * A locator candidate generated from an element's attributes. Has not yet been
 * verified to uniquely match the element on the live device — see
 * `LocatorSuggestion` for the verified shape returned to the UI.
 */
export interface LocatorCandidate {
  category: LocatorCategory;
  /** Sub-label for the panel UI, e.g. "resource-id" or "type + name". */
  subLabel: string;
  /** Higher = preferred within its category. */
  priority: number;
  /** taqwright source-code snippet, e.g. `mobile.getById('login_btn')`. */
  code: string;
  /** WebDriver-level locator strategy. */
  using: string;
  /** WebDriver-level selector value. */
  value: string;
  /**
   * Chained-locator wire descriptor. Set on candidates that include a
   * `.nth(i)` / `.filter(...)` suffix; absent on plain (flat) candidates,
   * which the inspector replays via the legacy `{using, value}` shape.
   */
  descriptor?: LocatorDescriptor;
}

export interface LocatorSuggestion extends LocatorCandidate {
  /** Element count returned by `findElements` on the live device. */
  count: number;
  /** Shorthand for `count === 1`. */
  unique: boolean;
}

export type ElementAttrs = Record<string, string | undefined>;

/**
 * Display order for categories, by platform.
 *
 * Android: id → uiautomator → xpath.
 * iOS:     id → predicate    → classChain → xpath.
 */
export const CATEGORY_ORDER: Record<Platform, LocatorCategory[]> = {
  [Platform.ANDROID]: ['id', 'uiautomator', 'xpath'],
  [Platform.IOS]: ['id', 'predicate', 'classChain', 'xpath'],
};

/**
 * Display order inside a WebView context (platform-agnostic — the DOM is the
 * same web on both). CSS first, positional xpath as the brittle fallback.
 */
export const WEB_CATEGORY_ORDER: LocatorCategory[] = ['css', 'xpath'];

/**
 * Generate locator candidates for an element. Multiple candidates per category
 * are emitted; the caller is expected to verify uniqueness on the live device
 * and pick the highest-priority unique candidate per category.
 *
 * The `_xpath` argument is the element's positional path. We deliberately do
 * NOT generate it as a candidate — absolute paths are too brittle. Only
 * attribute-based locators are returned.
 */
export function generateCandidates(
  platform: Platform,
  attrs: ElementAttrs,
  _xpath: string,
  isWeb = false,
): LocatorCandidate[] {
  // Inside a WebView the page source is web DOM — generate CSS selectors
  // instead of native UiSelector/predicate/classChain strategies.
  if (isWeb) {
    return generateWebCandidates(attrs, _xpath);
  }

  const out: LocatorCandidate[] = [];

  if (platform === Platform.ANDROID) {
    const resourceId = attrs['resource-id'];
    const contentDesc = attrs['content-desc'];
    const text = attrs['text'];
    const hint = attrs['hint'];
    const cls = attrs['class'];

    // Each entry is one stable attribute we can disambiguate by, paired with
    // the priority for using it as a single-attr xpath.
    const stableAttrs: Array<{ key: string; val: string; priority: number }> = [];
    if (resourceId) stableAttrs.push({ key: 'resource-id', val: resourceId, priority: 700 });
    if (contentDesc) stableAttrs.push({ key: 'content-desc', val: contentDesc, priority: 680 });
    if (text) stableAttrs.push({ key: 'text', val: text, priority: 660 });
    if (hint) stableAttrs.push({ key: 'hint', val: hint, priority: 640 });

    // ─── Category: id ─────────────────────────────────────────────
    if (resourceId) {
      const shortId = resourceId.includes(':id/') ? resourceId.split(':id/')[1]! : resourceId;
      out.push({
        category: 'id',
        subLabel: 'resource-id',
        priority: 1000,
        code: `mobile.getById(${jsString(shortId)})`,
        using: 'id',
        value: resourceId,
      });
    }

    // ─── Category: uiautomator ────────────────────────────────────
    if (resourceId) {
      const ua = `new UiSelector().resourceId(${jsString(resourceId)})`;
      out.push({
        category: 'uiautomator',
        subLabel: 'resourceId',
        priority: 950,
        code: `mobile.getByUiSelector(${jsString(ua)})`,
        using: '-android uiautomator',
        value: ua,
      });
    }
    if (contentDesc) {
      const ua = `new UiSelector().description(${jsString(contentDesc)})`;
      out.push({
        category: 'uiautomator',
        subLabel: 'content-desc',
        priority: 920,
        code: `mobile.getByUiSelector(${jsString(ua)})`,
        using: '-android uiautomator',
        value: ua,
      });
      // Exact .description() can't carry a literal `\n` — Appium's UiSelector
      // parser takes the string verbatim (no escape processing), so a
      // multiline content-desc never matches. Fall back to a substring match
      // on the most distinctive line.
      const cdLine = contentDesc.includes('\n') ? longestLine(contentDesc) : undefined;
      if (cdLine) {
        const uac = `new UiSelector().descriptionContains(${jsString(cdLine)})`;
        out.push({
          category: 'uiautomator',
          subLabel: 'content-desc contains',
          priority: 915,
          code: `mobile.getByUiSelector(${jsString(uac)})`,
          using: '-android uiautomator',
          value: uac,
        });
      }
    }
    if (cls && contentDesc) {
      const ua = `new UiSelector().className(${jsString(cls)}).description(${jsString(contentDesc)})`;
      out.push({
        category: 'uiautomator',
        subLabel: 'class + content-desc',
        priority: 910,
        code: `mobile.getByUiSelector(${jsString(ua)})`,
        using: '-android uiautomator',
        value: ua,
      });
    }
    if (text) {
      const ua = `new UiSelector().text(${jsString(text)})`;
      out.push({
        category: 'uiautomator',
        subLabel: 'text',
        priority: 900,
        code: `mobile.getByUiSelector(${jsString(ua)})`,
        using: '-android uiautomator',
        value: ua,
      });
      // Same literal-`\n` limitation as content-desc above.
      const txtLine = text.includes('\n') ? longestLine(text) : undefined;
      if (txtLine) {
        const uac = `new UiSelector().textContains(${jsString(txtLine)})`;
        out.push({
          category: 'uiautomator',
          subLabel: 'text contains',
          priority: 895,
          code: `mobile.getByUiSelector(${jsString(uac)})`,
          using: '-android uiautomator',
          value: uac,
        });
      }
    }
    if (cls && text) {
      const ua = `new UiSelector().className(${jsString(cls)}).text(${jsString(text)})`;
      out.push({
        category: 'uiautomator',
        subLabel: 'class + text',
        priority: 890,
        code: `mobile.getByUiSelector(${jsString(ua)})`,
        using: '-android uiautomator',
        value: ua,
      });
    }
    if (cls) {
      const ua = `new UiSelector().className(${jsString(cls)})`;
      out.push({
        category: 'uiautomator',
        subLabel: 'class',
        priority: 700,
        code: `mobile.getByUiSelector(${jsString(ua)})`,
        using: '-android uiautomator',
        value: ua,
      });
    }

    // ─── Category: xpath (attribute-based only) ──────────────────
    // Single-attr xpaths. The category is the WebDriver strategy (xpath), so
    // we emit the underlying `mobile.getByXpath(...)` call rather than helper
    // shortcuts — keeps the badge and code in sync.
    for (const a of stableAttrs) {
      const xp = `//*[${xpathAttrEq(a.key, a.val)}]`;
      out.push({
        category: 'xpath',
        subLabel: a.key,
        priority: a.priority,
        code: `mobile.getByXpath(${jsString(xp)})`,
        using: 'xpath',
        value: xp,
      });
    }
    // Class-scoped single-attr xpaths.
    if (cls) {
      const shortCls = shortClassLabel(cls);
      for (const a of stableAttrs) {
        const xp = `//${cls}[${xpathAttrEq(a.key, a.val)}]`;
        out.push({
          category: 'xpath',
          subLabel: `${shortCls} + ${a.key}`,
          priority: a.priority - 50,
          code: `mobile.getByXpath(${jsString(xp)})`,
          using: 'xpath',
          value: xp,
        });
      }
    }
    // Class-scoped 2-attribute combos — only used if no single-attr is unique.
    if (cls && stableAttrs.length >= 2) {
      const shortCls = shortClassLabel(cls);
      for (let i = 0; i < stableAttrs.length; i++) {
        for (let j = i + 1; j < stableAttrs.length; j++) {
          const a = stableAttrs[i]!;
          const b = stableAttrs[j]!;
          const xp = `//${cls}[${xpathAttrEq(a.key, a.val)}]` + `[${xpathAttrEq(b.key, b.val)}]`;
          out.push({
            category: 'xpath',
            subLabel: `${shortCls} + ${a.key} + ${b.key}`,
            priority: 450,
            code: `mobile.getByXpath(${jsString(xp)})`,
            using: 'xpath',
            value: xp,
          });
        }
      }
    }
  } else {
    // ─── iOS / XCUITest ──────────────────────────────────────────
    // Note: on iOS, `name` doubles as the accessibility-id; `mobile.getById`
    // emits an `accessibility id` strategy.
    const name = attrs['name'];
    const label = attrs['label'];
    const value = attrs['value'];
    const placeholder = attrs['placeholderValue'];
    const type = attrs['type'];

    // Collect stable attrs (single-attr xpath candidates use these).
    const stableAttrs: Array<{ key: string; val: string; priority: number }> = [];
    if (name) stableAttrs.push({ key: 'name', val: name, priority: 500 });
    if (label) stableAttrs.push({ key: 'label', val: label, priority: 480 });
    if (value) stableAttrs.push({ key: 'value', val: value, priority: 460 });
    if (placeholder) stableAttrs.push({ key: 'placeholderValue', val: placeholder, priority: 470 });

    // ─── Category: id (accessibility id) ─────────────────────────
    if (name) {
      out.push({
        category: 'id',
        subLabel: 'accessibility id',
        priority: 1000,
        code: `mobile.getById(${jsString(name)})`,
        using: 'accessibility id',
        value: name,
      });
    }

    // ─── Category: predicate ─────────────────────────────────────
    if (name) {
      const expr = `name == ${nsString(name)}`;
      out.push({
        category: 'predicate',
        subLabel: 'name',
        priority: 950,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }
    if (label) {
      const expr = `label == ${nsString(label)}`;
      out.push({
        category: 'predicate',
        subLabel: 'label',
        priority: 920,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }
    if (value) {
      const expr = `value == ${nsString(value)}`;
      out.push({
        category: 'predicate',
        subLabel: 'value',
        priority: 900,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }
    if (placeholder) {
      const expr = `placeholderValue == ${nsString(placeholder)}`;
      out.push({
        category: 'predicate',
        subLabel: 'placeholderValue',
        priority: 890,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }
    if (type && name) {
      const expr = `type == ${nsString(type)} AND name == ${nsString(name)}`;
      out.push({
        category: 'predicate',
        subLabel: 'type + name',
        priority: 880,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }
    if (type && label) {
      const expr = `type == ${nsString(type)} AND label == ${nsString(label)}`;
      out.push({
        category: 'predicate',
        subLabel: 'type + label',
        priority: 870,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }
    if (type && placeholder) {
      const expr = `type == ${nsString(type)} AND placeholderValue == ${nsString(placeholder)}`;
      out.push({
        category: 'predicate',
        subLabel: 'type + placeholderValue',
        priority: 860,
        code: `mobile.getByPredicate(${jsString(expr)})`,
        using: '-ios predicate string',
        value: expr,
      });
    }

    // ─── Category: classChain ────────────────────────────────────
    if (type && name) {
      const chain = `**/${type}[\`name == ${classChainQuote(name)}\`]`;
      out.push({
        category: 'classChain',
        subLabel: 'type + name',
        priority: 800,
        code: `mobile.getByClassChain(${jsString(chain)})`,
        using: '-ios class chain',
        value: chain,
      });
    }
    if (type && label) {
      const chain = `**/${type}[\`label == ${classChainQuote(label)}\`]`;
      out.push({
        category: 'classChain',
        subLabel: 'type + label',
        priority: 780,
        code: `mobile.getByClassChain(${jsString(chain)})`,
        using: '-ios class chain',
        value: chain,
      });
    }
    if (type && value) {
      const chain = `**/${type}[\`value == ${classChainQuote(value)}\`]`;
      out.push({
        category: 'classChain',
        subLabel: 'type + value',
        priority: 770,
        code: `mobile.getByClassChain(${jsString(chain)})`,
        using: '-ios class chain',
        value: chain,
      });
    }
    if (type && placeholder) {
      const chain = `**/${type}[\`placeholderValue == ${classChainQuote(placeholder)}\`]`;
      out.push({
        category: 'classChain',
        subLabel: 'type + placeholderValue',
        priority: 760,
        code: `mobile.getByClassChain(${jsString(chain)})`,
        using: '-ios class chain',
        value: chain,
      });
    }
    if (type) {
      const chain = `**/${type}`;
      out.push({
        category: 'classChain',
        subLabel: 'type only',
        priority: 600,
        code: `mobile.getByClassChain(${jsString(chain)})`,
        using: '-ios class chain',
        value: chain,
      });
    }

    // ─── Category: xpath (attribute-based only) ──────────────────
    // Single-attr xpaths.
    for (const a of stableAttrs) {
      const xp = `//*[${xpathAttrEq(a.key, a.val)}]`;
      out.push({
        category: 'xpath',
        subLabel: a.key,
        priority: a.priority,
        code: `mobile.getByXpath(${jsString(xp)})`,
        using: 'xpath',
        value: xp,
      });
    }
    // Type-scoped single-attr xpaths.
    if (type) {
      const shortType = type.replace(/^XCUIElementType/, '');
      for (const a of stableAttrs) {
        const xp = `//${type}[${xpathAttrEq(a.key, a.val)}]`;
        out.push({
          category: 'xpath',
          subLabel: `${shortType} + ${a.key}`,
          priority: a.priority - 50,
          code: `mobile.getByXpath(${jsString(xp)})`,
          using: 'xpath',
          value: xp,
        });
      }
    }
    // Type-scoped 2-attribute combos.
    if (type && stableAttrs.length >= 2) {
      const shortType = type.replace(/^XCUIElementType/, '');
      for (let i = 0; i < stableAttrs.length; i++) {
        for (let j = i + 1; j < stableAttrs.length; j++) {
          const a = stableAttrs[i]!;
          const b = stableAttrs[j]!;
          const xp = `//${type}[${xpathAttrEq(a.key, a.val)}]` + `[${xpathAttrEq(b.key, b.val)}]`;
          out.push({
            category: 'xpath',
            subLabel: `${shortType} + ${a.key} + ${b.key}`,
            priority: 350,
            code: `mobile.getByXpath(${jsString(xp)})`,
            using: 'xpath',
            value: xp,
          });
        }
      }
    }
  }

  return out;
}

/**
 * Generate CSS-selector candidates for a web DOM element (WebView context).
 * Highest priority first; a positional xpath is appended as a brittle
 * always-works fallback. The element's tag name is read from a synthetic
 * `__tag` attr the inspector adds when parsing the HTML source.
 */
function generateWebCandidates(attrs: ElementAttrs, xpath: string): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  const tag = (attrs['__tag'] ?? '').toLowerCase();
  const pushCss = (value: string, subLabel: string, priority: number): void => {
    out.push({
      category: 'css',
      subLabel,
      priority,
      code: `mobile.getByCss(${jsString(value)})`,
      using: 'css selector',
      value,
    });
  };

  // data-test* hooks are the most stable web locators.
  const testKey =
    attrs['data-testid'] !== undefined
      ? 'data-testid'
      : attrs['data-test-id'] !== undefined
        ? 'data-test-id'
        : attrs['data-test'] !== undefined
          ? 'data-test'
          : undefined;
  if (testKey) {
    pushCss(`[${testKey}="${cssAttrValue(attrs[testKey]!)}"]`, testKey, 1000);
  }

  const id = attrs['id'];
  if (id) {
    // Simple idents → `#id`; anything else → attribute selector (avoids
    // escaping pitfalls with dots/colons that are legal in HTML ids).
    if (/^[A-Za-z][\w-]*$/.test(id)) pushCss('#' + id, 'id', 950);
    else pushCss(`[id="${cssAttrValue(id)}"]`, 'id', 950);
  }

  const name = attrs['name'];
  if (name) pushCss(`[name="${cssAttrValue(name)}"]`, 'name', 900);

  const cls = attrs['class'];
  if (cls) {
    // Only chain simple class tokens; skip ones with characters that would
    // need CSS escaping (the attribute selectors above cover those cases).
    const classes = cls.split(/\s+/).filter((c) => /^[A-Za-z_-][\w-]*$/.test(c));
    if (classes.length) {
      pushCss((tag || '') + '.' + classes.join('.'), tag ? 'tag + class' : 'class', 700);
    }
  }

  // Positional xpath — always resolves in a web context, but brittle. The
  // HTML parse yields uppercase tag names; XPath is case-sensitive on the web
  // DOM, so lowercase the element-name segments (indices/predicates untouched).
  if (xpath) {
    const webXpath = xpath.replace(
      /(^|\/)([A-Za-z][A-Za-z0-9]*)/g,
      (_m, sep: string, name: string) => sep + name.toLowerCase(),
    );
    out.push({
      category: 'xpath',
      subLabel: 'position',
      priority: 100,
      code: `mobile.getByXpath(${jsString(webXpath)})`,
      using: 'xpath',
      value: webXpath,
    });
  }

  return out;
}

/**
 * Pick the highest-priority unique candidate per category, returned in the
 * platform's display order. Falls back to the highest-priority non-unique
 * candidate (with `unique: false`) when no unique one exists for a category —
 * the UI can show that as a warning.
 */
export function selectBestPerCategory(
  platform: Platform,
  suggestions: LocatorSuggestion[],
  isWeb = false,
): LocatorSuggestion[] {
  const order = isWeb ? WEB_CATEGORY_ORDER : CATEGORY_ORDER[platform];
  const byCategory = new Map<LocatorCategory, LocatorSuggestion[]>();
  for (const s of suggestions) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }
  const out: LocatorSuggestion[] = [];
  for (const cat of order) {
    const list = byCategory.get(cat);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => b.priority - a.priority);
    const unique = list.find((s) => s.unique);
    out.push(unique ?? list[0]!);
  }
  return out;
}

/**
 * True when a suggestion is a synthesized positional/chained locator
 * (currently only `.nth(i)`). Positional locators are unique *right now*
 * but fragile — they break when sibling order or list contents change.
 * `makeNthSuggestion` is the only producer of a descriptor; flat
 * attribute candidates from `generateCandidates` carry none.
 */
export function isPositional(s: LocatorCandidate): boolean {
  return s.descriptor?.kind === 'nth';
}

/**
 * Pick the single best locator to recommend across ALL categories,
 * overriding the per-category display order. Selection order:
 *
 *   1. Highest-priority `unique && !positional` candidate (any category).
 *   2. Else highest-priority `unique` candidate (allows positional `.nth()`).
 *   3. Else `undefined` (nothing unique — UI shows no recommendation).
 *
 * Tie-break: higher `priority` wins; on equal priority the platform's
 * `CATEGORY_ORDER` index wins (lower = preferred); then earliest in
 * `verified` (stable). `selectBestPerCategory` is left untouched — it
 * still builds the per-category list; this is purely additive.
 */
export function pickRecommended(
  platform: Platform,
  verified: LocatorSuggestion[],
  isWeb = false,
): LocatorSuggestion | undefined {
  const order = isWeb ? WEB_CATEGORY_ORDER : CATEGORY_ORDER[platform];
  const rank = (s: LocatorSuggestion): number => {
    const ci = order.indexOf(s.category);
    return ci === -1 ? order.length : ci;
  };
  const better = (a: LocatorSuggestion, b: LocatorSuggestion): boolean => {
    if (a.priority !== b.priority) return a.priority > b.priority;
    return rank(a) < rank(b);
  };
  const unique = verified.filter((s) => s.unique);
  if (unique.length === 0) return undefined;
  const robust = unique.filter((s) => !isPositional(s));
  const pool = robust.length > 0 ? robust : unique;
  let best: LocatorSuggestion | undefined;
  for (const s of pool) if (!best || better(s, best)) best = s;
  return best;
}

// ─── helpers ──────────────────────────────────────────────────────

/** Trim "android.widget." / "android.view." prefixes for display sublabels. */
function shortClassLabel(cls: string): string {
  if (cls.startsWith('android.widget.')) return cls.slice('android.widget.'.length);
  if (cls.startsWith('android.view.')) return cls.slice('android.view.'.length);
  return cls.split('.').pop() || cls;
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

/** Escape a value for use inside a double-quoted CSS attribute selector. */
function cssAttrValue(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function xpathLiteral(s: string): string {
  if (!s.includes("'")) return `'${s}'`;
  if (!s.includes('"')) return `"${s}"`;
  const parts = s.split("'");
  return `concat(${parts.map((p, i) => (i === 0 ? `'${p}'` : `"'", '${p}'`)).join(', ')})`;
}

/** Trimmed, non-empty lines of a possibly-multiline attribute value. */
function nonEmptyLines(val: string): string[] {
  return val
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * The most distinctive single line of a multiline value — the longest
 * trimmed non-empty line. Multiline accessibility labels routinely pair a
 * short, non-unique token (a badge "1", a price) with the real label
 * ("Drag Item 3"); the longer line carries the discriminating text. Used for
 * substring matchers (UiSelector `descriptionContains` / `textContains`)
 * where a literal `\n` can't be embedded reliably.
 */
function longestLine(val: string): string | undefined {
  const lines = nonEmptyLines(val);
  if (lines.length === 0) return undefined;
  return lines.reduce((a, b) => (b.length > a.length ? b : a));
}

/**
 * Build an xpath attribute predicate. For a multiline value, AND a
 * `contains(@key, line)` for every non-empty line instead of a strict `=` —
 * multiline attribute equality is inconsistent across Appium driver versions
 * (some match literal `\n` in the page-source XML, others normalize to
 * `&#10;`), so `[@content-desc='Boho Wrap Dress\n$69.99']` can silently miss.
 * ANDing all lines is strictly narrower than any single-line form (never
 * matches more elements) and far more discriminating than the first line
 * alone, which is often a non-unique token. If it still isn't unique the
 * verifier marks the candidate non-unique and another category takes over.
 */
function xpathAttrEq(key: string, val: string): string {
  if (val.includes('\n')) {
    const lines = nonEmptyLines(val);
    if (lines.length > 0) {
      return lines.map((l) => `contains(@${key}, ${xpathLiteral(l)})`).join(' and ');
    }
  }
  return `@${key}=${xpathLiteral(val)}`;
}

/** Quote a string for use inside an NSPredicate. */
function nsString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Quote a string for use inside class-chain backticks. */
function classChainQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Synthesize a chain-suffixed `.nth(idx)` candidate from a non-unique flat
 * candidate, given that `idx` is the target element's position in the flat
 * candidate's `findElements` result. The output is guaranteed unique
 * (selects exactly one element) and carries a `descriptor` field so the
 * inspector server can replay it via `buildLocatorFromDescriptor`.
 */
export function makeNthSuggestion(base: LocatorCandidate, idx: number): LocatorSuggestion {
  const descriptor: LocatorDescriptor = {
    kind: 'nth',
    on: {
      kind: 'leaf',
      using: base.using as LocatorStrategy['using'],
      value: base.value,
    },
    n: idx,
  };
  return {
    ...base,
    code: `${base.code}.nth(${idx})`,
    subLabel: `${base.subLabel} + nth(${idx})`,
    // Drop priority slightly so a different category's truly-unique flat
    // candidate (e.g. resource-id) still wins over a chained xpath.
    priority: base.priority - 100,
    descriptor,
    count: 1,
    unique: true,
  };
}
