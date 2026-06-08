/**
 * Render a recording as **steps-only** code for the standard Appium clients —
 * Appium-Python-Client (pytest) and Appium java-client (JUnit). This is a
 * best-effort translation of the taqwright recording: the common interactions
 * (tap, type, the assertions) map faithfully; taqwright's auto-retrying
 * `expect` becomes `WebDriverWait` + `ExpectedConditions`; gestures and a few
 * matchers without a clean Appium-client equivalent emit a clearly-commented
 * `# TODO` / `// TODO` line so the output is never silently wrong.
 *
 * Output is the action/assertion lines only — no imports, driver setup, or
 * fixtures. It assumes a `driver` (and, for Python, `AppiumBy`, `WebDriverWait`
 * and `expected_conditions as EC`) are in scope.
 */
import type { RecordedAction, RecordedLocator } from './recorder.js';
import type { LocatorDescriptor } from '../types/index.js';

/** A flattened leaf locator the Appium clients can express directly. */
interface Leaf {
  using: string;
  value: string;
  /** Index when the locator is an `.nth(n)` / `.first()` of a leaf. */
  n?: number;
}

// WebDriver strategy → Appium-Python-Client `AppiumBy.*` member.
const PY_BY: Record<string, string> = {
  id: 'AppiumBy.ID',
  'accessibility id': 'AppiumBy.ACCESSIBILITY_ID',
  xpath: 'AppiumBy.XPATH',
  '-android uiautomator': 'AppiumBy.ANDROID_UIAUTOMATOR',
  '-ios predicate string': 'AppiumBy.IOS_PREDICATE',
  '-ios class chain': 'AppiumBy.IOS_CLASS_CHAIN',
  'class name': 'AppiumBy.CLASS_NAME',
  name: 'AppiumBy.NAME',
  'css selector': 'AppiumBy.CSS_SELECTOR',
};

// WebDriver strategy → Appium java-client `AppiumBy.<factory>` method.
const JAVA_BY: Record<string, string> = {
  id: 'id',
  'accessibility id': 'accessibilityId',
  xpath: 'xpath',
  '-android uiautomator': 'androidUIAutomator',
  '-ios predicate string': 'iOSNsPredicateString',
  '-ios class chain': 'iOSClassChain',
  'class name': 'className',
  name: 'name',
};

/** JSON string literal — valid for both Python and Java string syntax. */
function str(s: string): string {
  return JSON.stringify(s);
}

/**
 * Flatten an action's locator to a single leaf the Appium clients can express.
 * Prefers the structured `descriptor`; handles plain leaves and `nth`/`first`
 * over a leaf. Anything richer (filter/child/and/or, text filters) returns null
 * so the caller emits a TODO rather than wrong code.
 */
function leafOf(loc: RecordedLocator): Leaf | null {
  const d: LocatorDescriptor | undefined = loc.descriptor;
  if (d) {
    if (d.kind === 'leaf') return { using: d.using, value: d.value };
    if (d.kind === 'nth' && d.on.kind === 'leaf')
      return { using: d.on.using, value: d.on.value, n: d.n };
    if (d.kind === 'first' && d.on.kind === 'leaf')
      return { using: d.on.using, value: d.on.value, n: 0 };
    return null;
  }
  if (loc.using !== undefined && loc.value !== undefined)
    return { using: loc.using, value: loc.value };
  return null;
}

/** Python `(AppiumBy.X, "value")` locator tuple, or null if unmappable. */
function pyTuple(leaf: Leaf): string | null {
  const by = PY_BY[leaf.using];
  if (!by) return null;
  return `(${by}, ${str(leaf.value)})`;
}

/** Python element-finding expression (handles `.nth(n)`), or null. */
function pyElement(leaf: Leaf): string | null {
  const tuple = pyTuple(leaf);
  if (!tuple) return null;
  return leaf.n === undefined
    ? `driver.find_element${tuple}`
    : `driver.find_elements${tuple}[${leaf.n}]`;
}

/** Java `AppiumBy.x("value")` locator, or null if unmappable. */
function javaBy(leaf: Leaf): string | null {
  const fn = JAVA_BY[leaf.using];
  if (!fn) return null;
  return `AppiumBy.${fn}(${str(leaf.value)})`;
}

/** Java element-finding expression (handles `.nth(n)`), or null. */
function javaElement(leaf: Leaf): string | null {
  const by = javaBy(leaf);
  if (!by) return null;
  return leaf.n === undefined
    ? `driver.findElement(${by})`
    : `driver.findElements(${by}).get(${leaf.n})`;
}

const PY_WAIT = 'WebDriverWait(driver, 10).until';
const JAVA_WAIT = 'new WebDriverWait(driver, Duration.ofSeconds(10)).until';

function pyTodo(a: RecordedAction): string {
  return `# TODO: ${a.kind} has no direct Appium-Python-Client equivalent (taqwright: ${tsHint(a)})`;
}
function javaTodo(a: RecordedAction): string {
  return `// TODO: ${a.kind} has no direct Appium java-client equivalent (taqwright: ${tsHint(a)})`;
}

/** A short reference to the taqwright form, for TODO breadcrumbs. */
function tsHint(a: RecordedAction): string {
  return 'code' in a && typeof a.code === 'string' ? a.code : a.kind;
}

// ─── Python ──────────────────────────────────────────────────────────────

function renderPy(a: RecordedAction): string {
  switch (a.kind) {
    case 'comment':
      return `# ${a.text}`;
    case 'sendKeys':
      return `driver.execute_script("mobile: type", {"text": ${str(a.text)}})`;
    case 'switchContext':
      return /^NATIVE_APP$/i.test(a.context)
        ? `driver.switch_to.context("NATIVE_APP")`
        : `driver.switch_to.context(${str(a.context)})  # NOTE: WebView handles vary across runs`;
    case 'tap':
    case 'swipe':
    case 'screenScroll':
      return pyTodo(a);
    default:
      break;
  }

  // Element-targeted actions.
  const leaf = leafOf(a as RecordedLocator);
  if (!leaf) return pyTodo(a);
  const el = pyElement(leaf);
  const tuple = pyTuple(leaf);
  if (!el || !tuple) return pyTodo(a);

  switch (a.kind) {
    case 'locatorClick':
      return `${el}.click()`;
    case 'locatorFill':
      return `${el}.send_keys(${str(a.text)})`;
    case 'locatorClear':
      return `${el}.clear()`;
    case 'locatorPressSequentially':
      return `${el}.send_keys(${str(a.text)})${a.delay ? '  # delay not supported by send_keys' : ''}`;
    case 'locatorCheck':
      return `${el}.click()  # check: taps to toggle — verify current state`;
    case 'locatorUncheck':
      return `${el}.click()  # uncheck: taps to toggle — verify current state`;
    case 'locatorFocus':
      return `${el}.click()  # focus`;
    case 'assertVisible':
      return `${PY_WAIT}(EC.visibility_of_element_located(${tuple}))`;
    case 'assertHidden':
      return `${PY_WAIT}(EC.invisibility_of_element_located(${tuple}))`;
    case 'assertAttached':
      return `${PY_WAIT}(EC.presence_of_element_located(${tuple}))`;
    case 'assertEnabled':
      return `${PY_WAIT}(EC.element_to_be_clickable(${tuple}))`;
    case 'assertDisabled':
      return `assert not ${el}.is_enabled()`;
    case 'assertText':
      return a.mode === 'contains'
        ? `${PY_WAIT}(EC.text_to_be_present_in_element(${tuple}, ${str(a.expected)}))`
        : `${PY_WAIT}(lambda d: d.find_element${tuple}.text == ${str(a.expected)})`;
    case 'assertValue':
      return `${PY_WAIT}(lambda d: d.find_element${tuple}.get_attribute("value") == ${str(a.expected)})`;
    case 'assertEmpty':
      return `${PY_WAIT}(lambda d: d.find_element${tuple}.text == "")`;
    case 'assertChecked':
      return `assert ${el}.get_attribute("checked") == "true"`;
    case 'assertUnchecked':
      return `assert ${el}.get_attribute("checked") != "true"`;
    case 'assertCount':
      return `${PY_WAIT}(lambda d: len(d.find_elements${tuple}) == ${a.expected})`;
    case 'assertAttribute':
      return `assert ${el}.get_attribute(${str(a.name)}) == ${str(a.expected)}`;
    default:
      // doubleTap, longPress, swipe, scrollIntoView, pinch, dragTo, press,
      // selectOption, blur, editable, readonly, focused, inViewport, …
      return pyTodo(a);
  }
}

// ─── Java ────────────────────────────────────────────────────────────────

function renderJava(a: RecordedAction): string {
  switch (a.kind) {
    case 'comment':
      return `// ${a.text}`;
    case 'sendKeys':
      return `driver.executeScript("mobile: type", java.util.Map.of("text", ${str(a.text)}));`;
    case 'switchContext':
      return /^NATIVE_APP$/i.test(a.context)
        ? `((io.appium.java_client.remote.SupportsContextSwitching) driver).context("NATIVE_APP");`
        : `((io.appium.java_client.remote.SupportsContextSwitching) driver).context(${str(a.context)});  // NOTE: WebView handles vary across runs`;
    case 'tap':
    case 'swipe':
    case 'screenScroll':
      return javaTodo(a);
    default:
      break;
  }

  const leaf = leafOf(a as RecordedLocator);
  if (!leaf) return javaTodo(a);
  const el = javaElement(leaf);
  const by = javaBy(leaf);
  if (!el || !by) return javaTodo(a);

  switch (a.kind) {
    case 'locatorClick':
      return `${el}.click();`;
    case 'locatorFill':
      return `${el}.sendKeys(${str(a.text)});`;
    case 'locatorClear':
      return `${el}.clear();`;
    case 'locatorPressSequentially':
      return `${el}.sendKeys(${str(a.text)});${a.delay ? '  // delay not supported by sendKeys' : ''}`;
    case 'locatorCheck':
      return `${el}.click();  // check: taps to toggle — verify current state`;
    case 'locatorUncheck':
      return `${el}.click();  // uncheck: taps to toggle — verify current state`;
    case 'locatorFocus':
      return `${el}.click();  // focus`;
    case 'assertVisible':
      return `${JAVA_WAIT}(ExpectedConditions.visibilityOfElementLocated(${by}));`;
    case 'assertHidden':
      return `${JAVA_WAIT}(ExpectedConditions.invisibilityOfElementLocated(${by}));`;
    case 'assertAttached':
      return `${JAVA_WAIT}(ExpectedConditions.presenceOfElementLocated(${by}));`;
    case 'assertEnabled':
      return `${JAVA_WAIT}(ExpectedConditions.elementToBeClickable(${by}));`;
    case 'assertDisabled':
      return `org.junit.jupiter.api.Assertions.assertFalse(${el}.isEnabled());`;
    case 'assertText':
      return a.mode === 'contains'
        ? `${JAVA_WAIT}(ExpectedConditions.textToBePresentInElementLocated(${by}, ${str(a.expected)}));`
        : `${JAVA_WAIT}(d -> d.findElement(${by}).getText().equals(${str(a.expected)}));`;
    case 'assertValue':
      return `${JAVA_WAIT}(d -> ${str(a.expected)}.equals(d.findElement(${by}).getAttribute("value")));`;
    case 'assertEmpty':
      return `${JAVA_WAIT}(d -> d.findElement(${by}).getText().isEmpty());`;
    case 'assertChecked':
      return `org.junit.jupiter.api.Assertions.assertEquals("true", ${el}.getAttribute("checked"));`;
    case 'assertUnchecked':
      return `org.junit.jupiter.api.Assertions.assertNotEquals("true", ${el}.getAttribute("checked"));`;
    case 'assertCount':
      return `${JAVA_WAIT}(d -> d.findElements(${by}).size() == ${a.expected});`;
    case 'assertAttribute':
      return `org.junit.jupiter.api.Assertions.assertEquals(${str(a.expected)}, ${el}.getAttribute(${str(a.name)}));`;
    default:
      return javaTodo(a);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

const EMPTY_PY = '# (no actions recorded yet — interact with the device in the inspector)';
const EMPTY_JAVA = '// (no actions recorded yet — interact with the device in the inspector)';

/** Render the recording as steps-only Appium-Python-Client (pytest) code. */
export function toStepsPython(actions: RecordedAction[]): string {
  if (actions.length === 0) return EMPTY_PY + '\n';
  return actions.map(renderPy).join('\n') + '\n';
}

/** Render the recording as steps-only Appium java-client (JUnit) code. */
export function toStepsJava(actions: RecordedAction[]): string {
  if (actions.length === 0) return EMPTY_JAVA + '\n';
  return actions.map(renderJava).join('\n') + '\n';
}
