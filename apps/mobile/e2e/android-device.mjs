import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { DOMParser } from '@xmldom/xmldom';

const exec = promisify(execFile);
const MATCH_TIMEOUT = 18_000;

async function adb(args, serial) {
  const { stdout } = await exec('adb', serial ? ['-s', serial, ...args] : args, {
    timeout: 25_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

export async function connectAndroid(packageName, launcherScheme) {
  const listing = await adb(['devices', '-l']);
  const usb = [...listing.matchAll(/^(\S+)\s+device\s+[^\r\n]*\busb:/gm)].map(
    ([, serial]) => serial,
  );
  const serial = process.env.ANDROID_SERIAL ?? (usb.length === 1 ? usb[0] : undefined);
  assert.ok(
    serial && usb.includes(serial),
    'Connect and authorize one USB Android device, or select an attached device with ANDROID_SERIAL.',
  );
  const device = new AndroidDevice(serial, packageName, launcherScheme);
  const activity = await device.shell(
    'cmd',
    'package',
    'resolve-activity',
    '--brief',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `${launcherScheme}://expo-development-client/`,
    packageName,
  );
  assert.ok(activity.includes(`${packageName}/`), 'Install a compatible Welyt development client.');
  const sizes = await device.shell('wm', 'size');
  const [dimensions] = [...sizes.matchAll(/(\d+)x(\d+)/g)].slice(-1);
  assert.ok(dimensions, 'Unable to read the Android display size.');
  device.width = Number(dimensions[1]);
  device.height = Number(dimensions[2]);
  return device;
}

function bounds(node) {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(node.getAttribute('bounds'));
  if (!match) return null;
  const [left, top, right, bottom] = match.slice(1).map(Number);
  return right > left && bottom > top
    ? [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)]
    : null;
}

function matches(node, label) {
  return ['text', 'content-desc'].some((attribute) => {
    const value = node.getAttribute(attribute) ?? '';
    return typeof label === 'string' ? value === label : label.test(value);
  });
}

class AndroidDevice {
  constructor(serial, packageName, launcherScheme) {
    this.serial = serial;
    this.packageName = packageName;
    this.launcherScheme = launcherScheme;
  }

  shell(...args) {
    return adb(['shell', ...args], this.serial);
  }

  reverse(port) {
    return adb(['reverse', '--no-rebind', `tcp:${port}`, `tcp:${port}`], this.serial);
  }

  removeReverse(port) {
    return adb(['reverse', '--remove', `tcp:${port}`], this.serial);
  }

  async open(metroUrl) {
    await this.shell('input', 'keyevent', 'KEYCODE_WAKEUP');
    const uri = `${this.launcherScheme}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
    const result = await this.shell(
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      uri,
      this.packageName,
    );
    assert.match(result, /Status: ok/, 'Android did not open the Welyt development client.');
  }

  async coldRestart(metroUrl) {
    await this.shell('am', 'force-stop', this.packageName);
    await this.open(metroUrl);
  }

  async appHasFocus() {
    const content = await this.shell('dumpsys', 'window');
    const focus = content.match(/mCurrentFocus=[^\r\n]*/)?.[0] ?? '';
    return focus.includes(`${this.packageName}/`);
  }

  async leaveApp() {
    if (await this.appHasFocus()) {
      await this.shell('input', 'keyevent', 'KEYCODE_HOME');
    }
  }

  async nodes() {
    if (!(await this.appHasFocus())) return [];

    const output = await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], this.serial);
    const start = output.indexOf('<?xml');
    const end = output.lastIndexOf('</hierarchy>');
    if (start < 0 || end < 0) return [];
    const doc = new DOMParser().parseFromString(
      output.slice(start, end + '</hierarchy>'.length),
      'text/xml',
    );
    return Array.from(doc.getElementsByTagName('node')).filter(
      (node) => node.getAttribute('package') === this.packageName && bounds(node),
    );
  }

  async expect(...labels) {
    await this.expectWithin(MATCH_TIMEOUT, ...labels);
  }

  async expectWithin(timeout, ...labels) {
    const deadline = Date.now() + timeout;
    let visible = 0;
    do {
      const nodes = await this.nodes();
      visible = nodes.length;
      if (labels.every((label) => nodes.some((node) => matches(node, label)))) return;
      await delay(350);
    } while (Date.now() < deadline);
    assert.fail(
      `Not visible in Welyt: ${labels.join(', ')} (${visible} visible app nodes). Keep the device unlocked.`,
    );
  }

  async tap(label, { scroll = false, editor = false } = {}) {
    const deadline = Date.now() + MATCH_TIMEOUT;
    let remainingScrolls = scroll ? 3 : 0;
    do {
      const nodes = await this.nodes();
      const candidates = nodes.filter(
        (node) =>
          matches(node, label) &&
          (!editor || node.getAttribute('class') === 'android.widget.EditText'),
      );
      const node =
        candidates.find((candidate) => candidate.getAttribute('clickable') === 'true') ??
        candidates[0];
      if (await this.appHasFocus()) {
        if (node) {
          await this.shell('input', 'tap', ...bounds(node).map(String));
          await delay(350);
          return;
        }
        if (remainingScrolls > 0) {
          remainingScrolls--;
          const x = String(Math.floor(this.width / 2));
          await this.shell(
            'input',
            'swipe',
            x,
            String(Math.floor(this.height * 0.72)),
            x,
            String(Math.floor(this.height * 0.28)),
            '280',
          );
        }
      }
      await delay(350);
    } while (Date.now() < deadline);
    assert.fail(`Could not tap ${label} in Welyt. Keep the device unlocked.`);
  }

  async enter(label, text) {
    assert.match(text, /^[a-zA-Z0-9@. ]+$/, 'Use plain fixture text with ADB input.');
    await this.tap(label, { editor: true });
    await this.expect(label);
    assert.ok(await this.appHasFocus(), 'Welyt lost focus before typing.');
    await this.shell('input', 'text', text.replaceAll(' ', '%s'));
    const keyboard = await this.shell('dumpsys', 'input_method');
    if (/\bm(?:Input|IsInputView)Shown=true\b/.test(keyboard)) {
      await this.shell('input', 'keyevent', 'KEYCODE_BACK');
      await delay(350);
    }
  }
}
