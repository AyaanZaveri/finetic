const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise transaction timing and cancellation without an account or browser.
class Element {
  constructor(top = 0) {
    this.top = top;
    this.left = 20;
    this.width = 600;
    this.height = 100;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = new Map([['id', 'original'], ['autofocus', '']]);
    this.children = [];
    this.calls = [];
  }
  getBoundingClientRect() { return { left: this.left, top: this.top, width: this.width, height: this.height, right: this.left + this.width, bottom: this.top + this.height }; }
  cloneNode() { return new Element(this.top); }
  querySelectorAll() { return []; }
  removeAttribute(name) { this.attributes.delete(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  append(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  animate(frames, options) {
    let finish, reject;
    const animation = {
      finished: new Promise((resolve, fail) => { finish = resolve; reject = fail; }),
      cancel() { this.cancelled = true; reject(new Error('cancelled')); },
      finish() { finish(); },
    };
    this.calls.push({ frames, options, animation });
    return animation;
  }
}

const body = new Element();
let reduced = false;
function load(file, requireModule = require) {
  const context = { exports: {}, require: requireModule, document: { body, createElement: () => new Element() },
    window: { matchMedia: () => ({ matches: reduced }) },
    getComputedStyle: () => ({ *[Symbol.iterator]() { yield 'grid-template-columns'; }, getPropertyValue: () => '40px 300px 200px' }),
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.exports;
}
const tokens = load('components/arc/motion-tokens.ts');
const { createAddonRemovalMotion } = load('components/addon-removal-motion.ts', () => tokens);
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

async function main() {
  const a = new Element(0), b = new Element(112), c = new Element(224);
  const rows = new Map([['a', a], ['b', b], ['c', c]]);
  const motion = createAddonRemovalMotion(rows);
  assert.equal(motion.prepare('a', false), undefined, 'Keyboard removal has no visual');
  assert.equal(body.children.length, 0);

  const play = motion.prepare('b', true);
  const host = body.children[0], visual = host.children[0];
  assert.equal(host.inert, true);
  assert.equal(visual.inert, true);
  assert.equal(visual.attributes.get('aria-hidden'), 'true');
  assert.equal(visual.attributes.has('id'), false);
  assert.equal(visual.attributes.has('autofocus'), false);
  assert.equal(visual.style['grid-template-columns'], '40px 300px 200px');
  rows.delete('b'); c.top = 112;
  play();
  assert.equal(a.calls.length, 0, 'Unmoved survivors do not animate');
  assert.equal(c.calls[0].frames[0].transform, 'translate(0px, 112px)');
  assert.equal(c.calls[0].options.duration, 240);
  assert.equal(visual.calls[0].options.duration, 160);
  assert.equal(visual.calls[0].options.easing, 'cubic-bezier(0.23,1,0.32,1)');
  visual.calls[0].animation.finish(); await tick();
  assert.equal(body.children.length, 0, 'Finished exit removes its snapshot');

  // Sample the currently displayed survivor position before replacing its animation.
  c.top = 150;
  const interrupted = motion.prepare('a', true);
  assert.equal(c.calls[0].animation.cancelled, true);
  rows.delete('a'); c.top = 0;
  interrupted();
  assert.equal(c.calls[1].frames[0].transform, 'translate(0px, 150px)');
  motion.cancel(); await tick();
  assert.equal(body.children.length, 0);
  assert.equal(c.calls[1].animation.cancelled, true);

  reduced = true;
  rows.set('a', a);
  const fade = motion.prepare('a', true);
  const reducedVisual = body.children[0].children[0];
  rows.delete('a'); fade();
  assert.equal(reducedVisual.calls[0].options.duration, 120);
  assert.ok(reducedVisual.calls[0].frames.every(frame => !('transform' in frame)));
  assert.equal(c.calls.length, 2, 'Reduced motion does not move survivors');
  motion.cancel();

  reduced = false;
  const stale = motion.prepare('c', true);
  motion.cancel();
  stale();
  assert.equal(body.children.length, 0, 'Invalidated transactions cannot restart');
  assert.equal(c.calls.length, 2);

  const last = motion.prepare('c', true);
  rows.clear(); last();
  const lastVisual = body.children[0].children[0];
  lastVisual.calls[0].animation.finish(); await tick();
  assert.equal(body.children.length, 0, 'Last-row exit needs no surviving list');

  rows.set('a', a); rows.set('c', c);
  const oldExit = motion.prepare('a', true);
  const oldVisual = body.children[0].children[0];
  rows.delete('a'); oldExit();
  oldVisual.calls[0].animation.finish();
  const newExit = motion.prepare('c', true);
  const newHost = body.children[0];
  rows.delete('c'); newExit();
  await tick();
  assert.equal(body.children[0], newHost, 'An old completion cannot remove a newer overlay');
  motion.cancel();

  const unsupported = new Element(); unsupported.animate = undefined;
  rows.set('unsupported', unsupported);
  assert.equal(motion.prepare('unsupported', true), undefined);
  assert.equal(body.children.length, 0);
  const broken = new Element();
  rows.clear(); rows.set('broken', broken);
  const brokenPlay = motion.prepare('broken', true);
  body.children[0].children[0].animate = () => { throw new Error('Unsupported animation'); };
  rows.clear();
  assert.doesNotThrow(brokenPlay, 'Animation errors cannot undo a successful uninstall');
  assert.equal(body.children.length, 0);
  motion.cancel(); await tick();
  // The horizontal rail waits until the optimistic removal commits and
  // clips the inert exit snapshot to the native scroll viewport.
  const viewport = new Element(10); viewport.left = 100; viewport.width = 440; viewport.height = 220;
  const first = new Element(15), second = new Element(15);
  first.left = 60; first.width = 320; second.left = 396; second.width = 320;
  const cards = new Map([['first', first], ['second', second]]);
  const railMotion = createAddonRemovalMotion(cards, { clipTo: () => viewport, deferAttachment: true });
  const railExit = railMotion.prepare('first', true);
  assert.equal(body.children.length, 0, 'No overlay is mounted before the removal commit');
  cards.delete('first'); second.left = 60;
  railExit();
  const clippedHost = body.children[0], clippedVisual = clippedHost.children[0];
  assert.equal(clippedHost.style.overflow, 'hidden');
  assert.equal(clippedHost.style.left, '100px');
  assert.equal(clippedHost.style.width, '440px');
  assert.equal(clippedVisual.style.left, '-40px', 'Partially visible cards remain clipped');
  assert.equal(second.calls[0].frames[0].transform, 'translate(336px, 0px)');
  railMotion.cancel();
  assert.equal(body.children.length, 0, 'Scrolling or rollback can immediately release the overlay');
  const cancelledExit = railMotion.prepare('second', true);
  railMotion.cancel(); cancelledExit();
  assert.equal(body.children.length, 0, 'A cancelled deferred removal never attaches its snapshot');
  second.left = 600;
  assert.equal(railMotion.prepare('second', true), undefined, 'A fully offscreen card never creates an exit visual');
  console.log('PASS: pointer-only removal, concurrent exit/FLIP, inert snapshots, retargeting, reduced motion, cancellation, last-row cleanup, and unsupported browsers');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
