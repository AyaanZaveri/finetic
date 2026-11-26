// Opt-in paired live evaluation. No server, browser, playback or settings changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const arg = name => {
    const i = process.argv.indexOf(name);
    return i < 0 ? undefined : process.argv[i + 1];
};
const cases = [
    { id: 'kimmel', prompt: 'go to the scene in nathan for you where he goes on jimmy kimmel', mediaId: 'tt2297757:4:4', window: [1040, 1080], line: /welcome nathan fielder|nathan fielder!/i },
    { id: 'b99', prompt: 'go to that one scene in b99 where holt complains about phd', mediaId: 'tt2467372:5:14', window: [760, 805], line: /phd|doctorate|medical practitioners|doctor/i },
    { id: 'office', prompt: 'take me to the part in the office where andy thinks the fire is shooting at them', mediaId: 'tt0386676:5:13', window: [185, 225], line: /fire.{0,25}shooting/i },
    { id: 'saul', prompt: 'go to that part in better call saul where chuck loses it in front of the bar committee', mediaId: 'tt3032476:3:5', window: [2755, 2790], line: /not crazy|schizophrenic|swapped those numbers/i },
    { id: 'severance', prompt: 'take me to the part in severance where mark shouts shes alive', mediaId: 'tt11280740:1:9', window: [2290, 2330], line: /she.s alive/i },
    { id: 'lawyer', prompt: 'go to the scene in nathan for you where he takes the signed paper from the lawyer', mediaId: 'tt2297757:2:5', window: [250, 285], line: /not gonna give it back|give that back|put it in my pocket|don.t want it in your pocket/i },
    { id: 'community', prompt: 'go to the scene in community where troy comes back with the pizzas and everything is on fire', mediaId: 'tt1439629:3:4', visualReview: true },
    { id: 'movie', prompt: 'go to the whos on first scene in nathan fielders new movie', mediaId: 'tt45368240', window: [2820, 2920], line: /abbott|costello|who.s on first/i },
    { id: 'negative', prompt: 'go to the scene in nathan for you where SpongeBob meets Batman', abstain: true },
    { id: 'play', prompt: 'Play Interstellar (2014)', mediaId: 'tt0816692' },
    { id: 'ambiguity', prompt: 'Open Dune', clarify: true },
    { id: 'fact', prompt: 'Who directed You Can See Everything?', fact: /Nathan Fielder/i, also: /Lance Oppenheim/i },
    { id: 'open', prompt: 'Open The Matrix (1999)', mediaId: 'tt0133093', navigate: '/movie/tt0133093' },
    { id: 'episode', prompt: 'Open season 2 episode 1 of The Office (US)', mediaId: 'tt0386676:2:1', navigate: '/series/tt0386676/2/1' },
    { id: 'director', prompt: 'Who directed Interstellar?', fact: /Christopher Nolan/i },
    { id: 'hello', prompt: 'Hey, what can you do?', general: true },
];

function score(test, report) {
    const results = report.results || [];
    const actions = results.filter(result => result.execution === 'prepared');
    const action = actions[0];
    const names = (report.tools || []).map(item => item.toolName);
    const title = (report.progress || []).find(item => item.stage === 'verify' && item.state === 'completed')?.episode;
    const titleMedia = (report.progress || []).find(item => item.stage === 'title' && item.state === 'completed')?.media;
    const episode = test.mediaId ? (action?.mediaId ?? titleMedia?.id) === test.mediaId || (!!test.navigate && action?.url === test.navigate) : null;
    if (report.aborted || report.errors?.length || report.exitCode !== 0 || report.stopReason === 'refused') return { pass: false, episode, reason: 'provider-error' };
    if (results.some(result => result.failureStage)) return { pass: false, episode, reason: 'tool-error' };
    if (actions.length > 1) return { pass: false, episode, reason: 'duplicate-action' };
    if (test.abstain) return { pass: !actions.length && names.includes('skipToSubtitleContent') && results.some(result => result.success === false && (result.status === 'not_found' || /no confident subtitle match|couldn.t substantiate/i.test(result.error || ''))), episode, reason: 'abstention' };
    if (test.clarify) return { pass: !actions.length && (/\?/.test(report.answerText || '') || results.some(result => result.status === 'ambiguous')), episode, reason: 'clarification' };
    if (test.general) return { pass: !actions.length && /\b(movie|show|episode|scene|play|watch)\b/i.test(report.answerText || ''), episode, reason: 'general-answer' };
    if (test.fact) {
        const evidence = (report.tools || []).some((tool, index) => ['getMediaDetails', 'readMediaWebSources'].includes(tool.toolName) && results[index]?.success === true);
        return { pass: !actions.length && evidence && test.fact.test(report.answerText || '') && (!test.also || test.also.test(report.answerText || '')), episode, reason: 'grounded-fact' };
    }
    if (test.visualReview) return { pass: action && episode ? null : false, episode, reason: action ? 'manual-timestamp-review' : 'no-scene-match', title: title?.title };
    if (!action || !episode) return { pass: false, episode, reason: action ? 'wrong-identity' : 'no-action' };
    if (test.navigate) return { pass: action.url === test.navigate, episode, reason: 'navigation' };
    if (!test.window) return { pass: !names.includes('skipToSubtitleContent'), episode, reason: 'playback' };
    const inWindow = action.timestamp >= test.window[0] && action.timestamp <= test.window[1];
    const evidenceText = [action.text, ...(action.sceneEvidence || []).map(item => item.text)].join(' ');
    return { pass: names.includes('skipToSubtitleContent') && inWindow && test.line.test(evidenceText), episode, reason: 'scene-evidence', timestamp: action.timestamp };
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function main() {
    if (process.argv.includes('--list')) { for (const test of cases) console.log(test.id, test.prompt); return; }
    if (!process.argv.includes('--live')) { console.log('SKIP: --live runs repeated paid model and retrieval requests. See --list.'); return; }
    const fx = arg('--fx-module'), out = arg('--out');
    assert.ok(fx && fs.existsSync(fx), 'Pass the libfx node.cjs path with --fx-module');
    assert.ok(out, 'Pass a new report directory with --out');
    const repeats = Number(arg('--repeats') || 3);
    assert.ok(Number.isInteger(repeats) && repeats > 0 && repeats <= 10, 'Use 1–10 repetitions');
    const selected = arg('--cases')?.split(',') ?? cases.map(test => test.id);
    assert.ok(selected.every(id => cases.some(test => test.id === id)), 'Unknown case');
    const model = arg('--model') || 'gpt-6-luna';
    fs.mkdirSync(out, { recursive: true });
    const rows = [];
    // Alternate engine order across pairs to reduce warm-cache/order bias.
    // Run sequentially so one trial cannot contend with the other for quota.
    for (let run = 0; run < repeats; run++) {
        const order = run % 2 ? ['fx', 'sdk'] : ['sdk', 'fx'];
        for (let index = 0; index < selected.length; index++) {
            const test = cases.find(item => item.id === selected[(index + run) % selected.length]);
            for (const engine of order) {
                const args = ['scripts/test-navigator-episode-live.cjs', '--live', '--provider', 'openai', '--model', model,
                    '--prompt', test.prompt, '--timings', '--report-only', '--openai-chat-none',
                    '--system-prompt-file', 'scripts/fixtures/navigator-semantic-prompt.txt'];
                if (engine === 'fx') args.push('--fx-module', fx);
                const proc = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 145_000, maxBuffer: 4 * 1024 * 1024 });
                const json = (proc.stdout || '').split('\n').find(line => line.startsWith('{'));
                let report;
                try { report = json ? JSON.parse(json) : {}; } catch { report = {}; }
                report.exitCode = proc.status ?? 1;
                const result = score(test, report);
                const scene = report.results?.find(item => item.timings?.matchPasses > 0);
                const timings = scene?.timings;
                const strictPass = test.id === 'lawyer' && result.pass
                    ? result.timestamp <= 265 && /give that back|not gonna give it back|handed it to you/i.test([scene?.text, ...(scene?.sceneEvidence || []).map(item => item.text)].join(' '))
                    : result.pass;
                const row = { engine, case: test.id, run: run + 1, ms: report.durationMs ?? null, ...result, strictPass,
                    matchMs: timings?.matchSceneMs, matchPasses: timings?.matchPasses, matchInputTokens: timings?.matchInputTokens,
                    resolveMs: timings?.resolveTitleMs, loadMs: timings?.loadSubtitlesMs,
                    track: report.progress?.find(item => item.stage === 'subtitles' && item.state === 'completed')?.subtitles?.filename,
                    toolCount: report.tools?.length };
                rows.push(row);
                fs.writeFileSync(path.join(out, `${test.id}-${run + 1}-${engine}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
                console.log(JSON.stringify(row));
            }
        }
    }
    const summary = ['sdk', 'fx'].map(engine => {
        const subset = rows.filter(row => row.engine === engine), eligible = subset.filter(row => row.pass !== null);
        return { engine, pass: eligible.filter(row => row.pass).length, total: eligible.length,
            strictPass: eligible.filter(row => row.strictPass).length,
            episodeCorrect: subset.filter(row => row.episode === true).length,
            episodeTotal: subset.filter(row => row.episode !== null).length,
            manualReview: subset.filter(row => row.pass === null).length,
            medianMs: median(subset.flatMap(row => row.ms === null ? [] : [row.ms])),
            medianMatchMs: median(subset.flatMap(row => typeof row.matchMs === 'number' ? [row.matchMs] : [])),
            medianMatchInputTokens: median(subset.flatMap(row => typeof row.matchInputTokens === 'number' ? [row.matchInputTokens] : [])),
            successfulMedianMs: median(subset.filter(row => row.pass && row.ms !== null).map(row => row.ms)) };
    });
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ model, repeats, rows, summary }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(summary));
}
if (require.main === module) main();
module.exports = { cases, score, median };
