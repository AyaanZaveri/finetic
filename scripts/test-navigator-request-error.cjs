const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./test-support/react-hooks.cjs');
const { NavigatorRequestError } = load('components/navigator/request-error.tsx', {
 'next/link': ({children,...props})=>React.createElement('a',props,children),
 '@/components/ui/button': { Button:({children,asChild,variant,size,...props})=>asChild?children:React.createElement('button',props,children) },
});
for(const message of ['OpenAI API key is required for OpenAI provider. Please set your API key in settings.', 'Google API key is required for Gemini provider.', 'Your AI provider rejected the API key. Check it in Settings.']) {
 const html=renderToStaticMarkup(React.createElement(NavigatorRequestError,{error:Error(message),busy:false,onRetry(){}}));
 assert.match(html,/Open settings/);assert.match(html,/href="\/settings\/navigator"/);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/Try again|underline|OpenAI|Gemini/);
}
const missingModel = renderToStaticMarkup(React.createElement(NavigatorRequestError,{error:Error('An Ollama model is required. Choose a model in Settings.'),busy:false,onRetry(){}}));
assert.match(missingModel,/Choose a model in Settings/);
assert.match(missingModel,/href="\/settings\/navigator"/);
assert.doesNotMatch(missingModel,/API key|Try again/);
const missingAnthropicModel = renderToStaticMarkup(React.createElement(NavigatorRequestError,{error:Error('An Anthropic model is required. Choose a model in Settings.'),busy:false,onRetry(){}}));
assert.match(missingAnthropicModel,/href="\/settings\/navigator"/);
assert.doesNotMatch(missingAnthropicModel,/API key|Try again/);
for (const message of ['No compatible lightweight model is available to your API key. Choose a model in Settings.', 'Choose a model for your custom OpenAI endpoint in Settings.']) {
    const setup = renderToStaticMarkup(React.createElement(NavigatorRequestError,{error:Error(message),busy:false,onRetry(){}}));
    assert.match(setup,/href="\/settings\/navigator"/);
    assert.doesNotMatch(setup,/>Try again</);
}
const retry=NavigatorRequestError({error:Error('Connection interrupted'),busy:true,onRetry(){}});
assert.equal(retry.props.children[1].props.disabled,true);
assert.equal(retry.props.children[1].props.children,'Try again');
console.log('PASS: provider-neutral setup action, no ineffective retry, accessible error and disabled transient retry');
