import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { runBrowserLayout } from './helpers/browser-layout-runner.mjs';
test('lista e visualizador cabem na orientação natural do telefone e do desktop', { timeout: 120000 }, async t => {
  const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(path => path && existsSync(path));
  if (!browser) return t.skip('Chrome unavailable');
  const cacheDir = await mkdtemp(join(tmpdir(), 'cameras-layout-'));
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir, logLevel: 'silent', server: { host:'127.0.0.1',port:0 } });
  await server.listen(); t.after(async () => { await server.close(); await rm(cacheDir, { recursive:true,force:true }); });
  const viewports = [{width:320,height:844},{width:390,height:844},{width:844,height:320},{width:844,height:390},{width:1365,height:768}];
  for (const {width,height} of viewports) for (const mode of ['list', 'visuals', 'player', 'pair', 'single', ...(width === 844 && height === 390 ? ['live-grid'] : [])]) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width,height,mobile:width < 700 || height < 500,
      captureScreenshot: width === 390 && mode === 'single' && Boolean(process.env.CAMERA_CONTROLS_SCREENSHOT),
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/cameras-layout.html?${mode}` });
    if (screenshot) writeFileSync(process.env.CAMERA_CONTROLS_SCREENSHOT, screenshot);
    const dom=new JSDOM(stdout), layout=JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (mode === 'live-grid') {
      assert.equal(layout.playbackError, undefined);
      assert.deepEqual(layout.cycles, Array.from({ length: 3 }, () => ({
        zoomedVideoIsOnTop: true, renderableVideos: 5, restored: Array(5).fill(true),
      })));
    } else if (mode === 'list') {
      assert.equal(layout.cards.length,9);
      assert.ok(layout.cards.every(card => card.left >= 0 && card.right <= width));
      assert.ok(layout.offlineStatus, `Offline status ribbon missing at ${width}x${height}`);
      const { ribbon, lastOnline, preview } = layout.offlineStatus;
      assert.ok(ribbon.left >= preview.left && ribbon.right <= preview.right
        && ribbon.top >= preview.top && ribbon.bottom <= preview.bottom,
      `Offline ribbon is outside its preview at ${width}x${height}: ${JSON.stringify(layout.offlineStatus)}`);
      assert.ok(lastOnline.left >= preview.left && lastOnline.right <= preview.right
        && lastOnline.top >= preview.top && lastOnline.bottom <= preview.bottom,
      `Last-online text is outside its preview at ${width}x${height}: ${JSON.stringify(layout.offlineStatus)}`);
      assert.equal(layout.listHeadings.length, 9);
      assert.equal(layout.selectionHeadings.length, 9);
      assert.ok(layout.listHeadings.every(({ checkbox }) => !checkbox));
      assert.ok(layout.selectionHeadings.every(({ checkbox }) => checkbox));
      for (const [{ titleText, pencil }] of [layout.listHeadings, layout.selectionHeadings]) {
        assert.ok(pencil.left - titleText.right >= 0 && pencil.left - titleText.right <= 12,
          `Pencil must sit directly after a short camera name at ${width}x${height}`);
      }
      for (const { heading, title, pencil, checkbox } of [...layout.listHeadings, ...layout.selectionHeadings]) {
        const context = `${width}x${height} ${checkbox ? 'selection' : 'list'}`;
        assert.ok(pencil.left - title.right >= 0 && pencil.left - title.right <= 12,
          `Pencil must sit directly after the camera name at ${context}`);
        assert.ok(pencil.width === 44 && pencil.height === 44 && pencil.right <= heading.right,
          `Pencil must be fully visible with a 44px circular touch target at ${context}`);
        if (checkbox) assert.ok(checkbox.left > pencil.right && checkbox.right <= heading.right);
      }
      assert.equal(layout.groups.length, 1);
      const [{ bounds, children }] = layout.groups;
      assert.equal(children.length, 3);
      assert.ok(children.every(card => card.left > bounds.left && card.right < bounds.right
        && card.top > bounds.top && card.bottom < bounds.bottom));
      const [first, second] = children;
      if (width < 700) assert.ok(second.top >= first.bottom);
      else assert.ok(second.left >= first.right && second.top === first.top);
    } else if (mode === 'visuals') {
      assert.equal(layout.visualCards.length, 2);
      assert.ok(layout.tabs.left >= 0 && layout.tabs.right <= width);
      for (const { bounds, title, pencil, open } of layout.visualCards) {
        assert.ok(bounds.left >= 0 && bounds.right <= width);
        assert.ok(pencil.left - title.right >= 0 && pencil.left - title.right <= 12,
          `Pencil must sit directly after the visual name at ${width}x${height}`);
        assert.equal(pencil.width, 44);
        assert.equal(pencil.height, 44);
        assert.ok(pencil.right < open.left && open.right < bounds.right);
      }
      const { bounds, inputFocused } = layout.visualEditor;
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height);
      assert.ok(inputFocused);
    } else {
      assert.equal(layout.portrait,String(height > width));
      if (height < width) assert.equal(layout.liveStateColor, mode === 'single' ? 'rgb(255, 170, 165)' : 'rgb(242, 244, 246)');
      const expectedTiles = mode === 'single' ? 1 : mode === 'pair' ? 2 : 8;
      assert.equal(layout.tiles.length,expectedTiles);
      assert.equal(layout.savedFrames.length, 1);
      const [{ label, tile, focus, imageLoaded }] = layout.savedFrames;
      assert.ok(imageLoaded);
      assert.ok(label.left >= tile.left && label.right <= tile.right && label.bottom <= tile.bottom);
      if (focus) assert.ok(label.right <= focus.left);
      assert.ok(layout.player.width <= width + 1 && layout.player.height <= height + 1);
      const minimumTileHeight = height < 400 ? 40 : 100;
      assert.ok(layout.tiles.every(tile => tile.width > 100 && tile.height > minimumTileHeight
        && tile.left >= 0 && tile.right <= width && tile.top >= 0 && tile.bottom <= height));
      if (mode === 'player') {
        const { tile, button, label, ribbon, clickable, noSpinner } = layout.playerOffline;
        assert.ok(clickable && noSpinner);
        assert.equal(button.width, 44);
        assert.equal(button.height, 44);
        assert.ok(label.right <= button.left);
        for (const bounds of [button, ribbon]) {
          assert.ok(bounds.left >= tile.left && bounds.right <= tile.right
            && bounds.top >= tile.top && bounds.bottom <= tile.bottom);
        }
        for (const [view, count] of [[layout.seven, 7], [layout.six, 6]]) {
          assert.equal(view.videos.length, count);
          const rows = new Map();
          for (const video of view.videos) {
            rows.set(video.top, (rows.get(video.top) ?? 0) + video.width);
            assert.ok(video.top >= view.stage.top && video.bottom <= view.stage.bottom);
          }
          assert.equal(rows.size, height > width ? Math.ceil(count / 2) : 2);
          assert.ok([...rows.values()].every(width => Math.abs(width - view.stage.width) < 2));
        }
        const first = layout.six.videos[0];
        assert.ok(height > width ? first.height > layout.tiles[0].height : first.width > layout.tiles[0].width);
        for (const view of ['focused', 'individual']) {
          const { stage, videos } = layout[view];
          assert.equal(videos.length, 1);
          const [video] = videos;
          assert.ok(Math.abs(video.left - stage.left) < 2 && Math.abs(video.top - stage.top) < 2
            && Math.abs(video.width - stage.width) < 2 && Math.abs(video.height - stage.height) < 2,
          `The camera must fill the stage in ${view} mode at ${width}x${height}: ${JSON.stringify(layout[view])}`);
        }
        assert.equal(layout.restored.videos.length, 8);
        assert.ok(layout.restored.videos.every((video, index) =>
          video.left === layout.tiles[index].left && video.top === layout.tiles[index].top
          && video.width === layout.tiles[index].width && Math.abs(video.height - layout.tiles[index].height) < 2));
      }
      if (mode === 'pair') {
        const [first, second] = layout.tiles;
        if (height > width) {
          assert.ok(Math.abs(first.left - second.left) < 2 && second.top > first.top);
        } else {
          assert.ok(second.left > first.left && Math.abs(first.top - second.top) < 2);
        }
      }
      if (mode === 'single') {
        assert.ok(layout.controls.width > 40 && layout.controls.height > 40);
        assert.ok(layout.drawer.width > 40 && layout.drawer.height > 25);
        assert.ok(layout.drawer.left >= 0 && layout.drawer.right <= width + 1);
        assert.ok(layout.recording.width > 0 && layout.recordingTime.width > 0);
        assert.ok(layout.recordingTime.top >= layout.drawer.top - 1
          && layout.recordingTime.bottom <= layout.drawer.bottom + 1,
        `Recording time is outside the drawer at ${width}x${height}: ${JSON.stringify(layout)}`);
      }
    }
  }
});
