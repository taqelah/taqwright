// Unit tests for the Appium Python/Java step renderers. Pure (no driver).
// Imports the compiled dist/ output, like the other suites.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { toStepsPython, toStepsJava } from '../dist/inspector/codegen-appium.js';

// Render a single action and return its (single) trimmed line.
function py(action) {
  return toStepsPython([action]).trim();
}
function java(action) {
  return toStepsJava([action]).trim();
}

// A leaf-id locator the way the server records it.
const idLoc = {
  code: 'mobile.getById("login_button")',
  using: 'id',
  value: 'com.app:id/login_button',
  descriptor: { kind: 'leaf', using: 'id', value: 'com.app:id/login_button' },
};

describe('codegen-appium — Python (Appium-Python-Client)', () => {
  test('click maps the id strategy to AppiumBy.ID', () => {
    assert.equal(
      py({ kind: 'locatorClick', ...idLoc }),
      'driver.find_element(AppiumBy.ID, "com.app:id/login_button").click()',
    );
  });

  test('fill → send_keys with the typed text', () => {
    assert.equal(
      py({ kind: 'locatorFill', ...idLoc, text: 'hunter2' }),
      'driver.find_element(AppiumBy.ID, "com.app:id/login_button").send_keys("hunter2")',
    );
  });

  test('clear → .clear()', () => {
    assert.equal(
      py({ kind: 'locatorClear', ...idLoc }),
      'driver.find_element(AppiumBy.ID, "com.app:id/login_button").clear()',
    );
  });

  test('assertVisible → WebDriverWait + visibility_of_element_located', () => {
    assert.equal(
      py({ kind: 'assertVisible', ...idLoc }),
      'WebDriverWait(driver, 10).until(EC.visibility_of_element_located((AppiumBy.ID, "com.app:id/login_button")))',
    );
  });

  test('assertText contains vs exact differ', () => {
    assert.equal(
      py({ kind: 'assertText', ...idLoc, expected: 'Hi', mode: 'contains' }),
      'WebDriverWait(driver, 10).until(EC.text_to_be_present_in_element((AppiumBy.ID, "com.app:id/login_button"), "Hi"))',
    );
    assert.match(
      py({ kind: 'assertText', ...idLoc, expected: 'Hi', mode: 'exact' }),
      /\.text == "Hi"/,
    );
  });

  test('assertCount uses find_elements length', () => {
    assert.equal(
      py({ kind: 'assertCount', ...idLoc, expected: 3 }),
      'WebDriverWait(driver, 10).until(lambda d: len(d.find_elements(AppiumBy.ID, "com.app:id/login_button")) == 3)',
    );
  });

  test('attribute strategy (accessibility id / xpath / uiautomator) maps correctly', () => {
    const a11y = { code: 'x', using: 'accessibility id', value: 'submit' };
    assert.match(py({ kind: 'locatorClick', ...a11y }), /AppiumBy\.ACCESSIBILITY_ID, "submit"/);
    const ua = { code: 'x', using: '-android uiautomator', value: 'new UiSelector()' };
    assert.match(py({ kind: 'locatorClick', ...ua }), /AppiumBy\.ANDROID_UIAUTOMATOR/);
  });

  test('nth descriptor renders find_elements[n]', () => {
    const nth = {
      code: 'x',
      descriptor: { kind: 'nth', n: 2, on: { kind: 'leaf', using: 'xpath', value: '//Button' } },
    };
    assert.equal(
      py({ kind: 'locatorClick', ...nth }),
      'driver.find_elements(AppiumBy.XPATH, "//Button")[2].click()',
    );
  });

  test('sendKeys → mobile: type', () => {
    assert.equal(
      py({ kind: 'sendKeys', text: 'abc' }),
      'driver.execute_script("mobile: type", {"text": "abc"})',
    );
  });

  test('no-equivalent action emits a TODO comment', () => {
    const line = py({ kind: 'locatorSelectOption', ...idLoc, value: { label: 'A' } });
    assert.match(line, /^# TODO: locatorSelectOption/);
  });

  test('empty recording yields a placeholder comment', () => {
    assert.match(toStepsPython([]), /^# \(no actions recorded yet/);
  });
});

describe('codegen-appium — Java (Appium java-client)', () => {
  test('click maps the id strategy to AppiumBy.id', () => {
    assert.equal(
      java({ kind: 'locatorClick', ...idLoc }),
      'driver.findElement(AppiumBy.id("com.app:id/login_button")).click();',
    );
  });

  test('fill → sendKeys', () => {
    assert.equal(
      java({ kind: 'locatorFill', ...idLoc, text: 'hunter2' }),
      'driver.findElement(AppiumBy.id("com.app:id/login_button")).sendKeys("hunter2");',
    );
  });

  test('assertVisible → WebDriverWait + ExpectedConditions', () => {
    assert.equal(
      java({ kind: 'assertVisible', ...idLoc }),
      'new WebDriverWait(driver, Duration.ofSeconds(10)).until(ExpectedConditions.visibilityOfElementLocated(AppiumBy.id("com.app:id/login_button")));',
    );
  });

  test('assertCount uses findElements().size()', () => {
    assert.match(
      java({ kind: 'assertCount', ...idLoc, expected: 2 }),
      /findElements\(AppiumBy\.id\("com\.app:id\/login_button"\)\)\.size\(\) == 2/,
    );
  });

  test('nth descriptor renders findElements().get(n)', () => {
    const nth = {
      code: 'x',
      descriptor: { kind: 'nth', n: 1, on: { kind: 'leaf', using: 'xpath', value: '//Button' } },
    };
    assert.equal(
      java({ kind: 'locatorClick', ...nth }),
      'driver.findElements(AppiumBy.xpath("//Button")).get(1).click();',
    );
  });

  test('no-equivalent action emits a // TODO comment', () => {
    assert.match(
      java({ kind: 'locatorPinch', ...idLoc, direction: 'in' }),
      /^\/\/ TODO: locatorPinch/,
    );
  });
});
