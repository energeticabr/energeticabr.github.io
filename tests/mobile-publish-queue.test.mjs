import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

function evaluate(expression, context) {
  // The workflow conditions use only the shared boolean/string expression
  // operators; evaluate the actual checked-in definition for each event.
  return runInNewContext(expression, context, {timeout: 100});
}

for (const platform of ['ios', 'android']) {
  const workflow = await readFile(new URL(`../.github/workflows/energetico-${platform}.yml`, import.meta.url), 'utf8');
  const block = workflow.match(/^concurrency:\s*\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(block, `${platform} workflow concurrency`);
  const condition = block.match(/^  cancel-in-progress:\s*(.+)$/m)?.[1].trim();
  const expression = condition?.match(/^\$\{\{([\s\S]*)\}\}$/)?.[1] ?? condition;
  const group = block.match(/^  group:\s*(.+)$/m)?.[1].trim();
  const context = (event, ref, inputs = {}) => ({github: {event_name: event, ref}, inputs});
  const events = [
    ['new main push', context('push', 'refs/heads/main'), false],
    ['manual main publication', context('workflow_dispatch', 'refs/heads/main', {distribute: true, build_play_aab: true, publish_play: true}), false],
    ['manual main validation', context('workflow_dispatch', 'refs/heads/main'), false],
    ['updated pull request', context('pull_request', 'refs/pull/42/merge'), true],
    ['updated feature branch', context('push', 'refs/heads/feat/mobile-example'), true],
    ['App Store validation on a feature ref', context('workflow_dispatch', 'refs/heads/feat/mobile-example', {validate_app_store: true}), platform === 'android'],
    ['App Store submission on a feature ref', context('workflow_dispatch', 'refs/heads/feat/mobile-example', {submit_app_store: true}), platform === 'android'],
  ];
  test(`${platform}: main releases finish while PR/feature checks remain supersedable`, async t => {
    for (const [name, input, expected] of events) {
      await t.test(name, () => assert.equal(evaluate(expression, input), expected));
    }
  });
  test(`${platform}: incoming main releases share the existing active build group`, () => {
    const interpolate = input => group.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, value) => String(evaluate(value, input)));
    const running = interpolate(context('push', 'refs/heads/main'));
    assert.equal(running, `energetico-${platform}-refs/heads/main${platform === 'ios' ? '-build' : ''}`);
    assert.equal(interpolate(context('workflow_dispatch', 'refs/heads/main', {distribute: true})), running);
    assert.notEqual(interpolate(context('pull_request', 'refs/pull/42/merge')), running);
    if (platform === 'ios') assert.equal(interpolate(context('workflow_dispatch', 'refs/heads/main', {submit_app_store: true})), 'energetico-ios-refs/heads/main-app-store');
  });
}
