const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

function load(file, dependencies = {}, globals = {}) {
  const context = { exports: {}, console, setTimeout, clearTimeout, queueMicrotask, AbortController, AbortSignal, ...globals,
    require: name => {
      if (name in dependencies) {
        const dependency = dependencies[name];
        if (name === '@/lib/server/outbound-fetch' && dependency.outboundFetch === 'fixture-fetch') {
          if (!globals.fetch) throw new Error('The fixture must supply fetch');
          return { outboundFetch: globals.fetch };
        }
        return dependency;
      }
      if (name === '@/components/metadata-hydration') return { MetadataHydration: 'metadata-hydration', MetadataPage: 'metadata-page' };
      if (name === '@/lib/server/metadata-provider' || name === './metadata-provider') return { getMetadataProvider: async () => 'auto' };
      // Legacy fixtures isolate external provider boundaries. Shared query
      // behavior is exercised with a real QueryClient in test-stream-queries.
      if (name === '@/components/stream-query-provider') return { useStreamQueries: () => null, useMetadataQueries: () => undefined, useMetadataWarmup: () => undefined, StreamQueryProvider: 'stream-queries' };
      // Markup fixtures mock the routing boundary as an anchor. Intent and
      // scheduling behavior is exercised with the real component separately.
      if (name === '@/components/intent-link' && dependencies['next/link']) {
        const link = dependencies['next/link'];
        return { IntentLink: link.default ?? link };
      }
      if (name === '@/components/continue-watching-warmup' && dependencies['@/components/home-palette-provider']) return { useContinueWatchingWarmup: () => null, ContinueWatchingWarmup: 'warmup' };
      // Existing behavioral fixtures mock the previous auth module; preserve that boundary after its server-only split.
      if (name === '@/lib/server/auth') {
        const fixture = dependencies['@/app/actions/auth'] || dependencies['./auth'];
        if (fixture?.getAuthData) return { getAuthData: fixture.getAuthData };
      }
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
        const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (resolved) return load(resolved, dependencies, globals);
      }
      return require(name);
    } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, context);
  return context.exports;
}

// Commit effects only after refs are attached, and preserve hook slots across
// renders. This makes lifecycle tests exercise the component's actual effects.
function hooks() {
  const slots = [], effects = [];
  let cursor = 0, queued = [], updates = 0;
  const jsx = (type, props) => {
    if (type?.context) type.context.current = props.value;
    return { type, props };
  };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; updates++; }];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ??= { current: initial };
    },
    useEffect(setup, deps) {
      const index = cursor++;
      const old = effects[index];
      if (!old || !deps || deps.some((dep, i) => !Object.is(dep, old.deps?.[i]))) {
        queued.push(() => { old?.cleanup?.(); effects[index] = { setup, deps, cleanup: setup() }; });
      }
    },
    useCallback(callback, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useMemo(calculate, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) slots[index] = { value: calculate(), deps };
      return slots[index].value;
    },
    createContext(value) { const context = { current: value }; context.Provider = { context }; return context; },
    useContext(context) { return context.current; },
  };
  react.useLayoutEffect = react.useEffect;
  return { react, jsx: { jsx, jsxs: jsx },
    get updates() { return updates; },
    render(component, props) { cursor = 0; return component(props); },
    flush() { const work = queued; queued = []; work.forEach(run => run()); },
    replay() { effects.forEach(effect => { effect.cleanup?.(); effect.cleanup = effect.setup(); }); },
    unmount() { effects.forEach(effect => effect.cleanup?.()); },
  };
}
module.exports = { load, hooks };
