const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const React = require('react');
const ts = require('typescript');

let url = new URL('http://localhost:3000/states/movie-collection');
const context = {
    exports: {}, URL,
    get location() { return url; },
    history: { pushState(_state, _title, next) { url = new URL(next); } },
    require(name) {
        if (name === 'react') return { ...React, useState: initial => [initial, () => {}], useEffect() {} };
        if (name === 'next/navigation') return { useSearchParams: () => url.searchParams };
        if (name === '@/components/media-page/production-companies-section') return { ProductionCompaniesSection: 'companies' };
        if (name === '@/components/media-page/movie-collection-section') return { MovieCollectionSection: 'collection' };
        if (name === '@/components/account-provider') return { AccountProvider: 'account-provider' };
        if (name === '@/components/jotai-provider') return { JotaiProvider: 'jotai-provider' };
        if (name.endsWith('.json')) return require(path.join(__dirname, name));
        if (name.endsWith('.module.css')) return { __esModule: true, default: {} };
        return require(name);
    },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, 'workbench.tsx'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, context);

const Workbench = context.exports.default().props.children.type;
function find(node, predicate) {
    if (!React.isValidElement(node)) return [];
    return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props.children).flatMap(child => find(child, predicate))];
}
const steps = [
    ['All companies', 4, 3], ['Missing logo', 4, 3], ['One company', 1, 3],
    ['No companies', 0, 3], ['Full collection', 4, 3],
    ['One related movie', 4, 1], ['No collection / unavailable', 4, 0],
    ['No English backdrop', 4, 3], ['Poster only', 4, 3], ['No artwork', 4, 3],
    ['All companies', 4, 3],
];
let tree = Workbench();
for (const [label, companyCount, movieCount] of steps) {
    const button = find(tree, node => node.type === 'button' && node.props.children === label)[0];
    assert.ok(button, label);
    button.props.onClick();
    tree = Workbench();
    const provider = find(tree, node => node.type === 'account-provider')[0];
    const children = React.Children.toArray(provider.props.children);
    assert.equal(new Set(children.map(child => child.key)).size, children.length, 'Sibling sections require unique keys so React removes previous states instead of retaining their DOM');
    assert.equal(children.length, 2);
    const companies = children.find(child => child.type === 'companies').props.companies;
    const collection = children.find(child => child.type === 'collection').props.collection;
    assert.equal(companies.length, companyCount, label);
    assert.equal(collection?.parts.length ?? 0, movieCount, label);
    if (label === 'Missing logo') assert.equal(companies[0].logo, undefined);
}
console.log('PASS: every menu selection supplies exactly one collection and one company section with unique sibling keys');
