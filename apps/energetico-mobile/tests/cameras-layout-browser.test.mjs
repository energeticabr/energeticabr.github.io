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
  for (const {width,height} of viewports) for (const mode of ['list', 'visuals', 'player', 'pair', 'single', 'full-grid',
    ...(height < width ? ['twelve-grid'] : []), ...([390, 844].includes(width) && [390, 844].includes(height) ? ['stacked-grid'] : []),
    ...(width === 844 && height === 390 ? ['live-grid'] : [])]) {
    const { stdout, screenshot } = await runBrowserLayout(browser, { width,height,mobile:width < 700 || height < 500,
      captureScreenshot: width === 390 && mode === 'single' && Boolean(process.env.CAMERA_CONTROLS_SCREENSHOT),
      url:`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/cameras-layout.html?${mode}` });
    if (screenshot) writeFileSync(process.env.CAMERA_CONTROLS_SCREENSHOT, screenshot);
    const dom=new JSDOM(stdout), layout=JSON.parse(dom.window.document.documentElement.dataset.layout); dom.window.close();
    if (layout.closeButtons) {
      assert.equal(layout.closeButtons.length, layout.tiles.length);
      for (const { tile, button, overlays, clickable } of layout.closeButtons) {
        const context = `${mode} at ${width}x${height}`;
        assert.deepEqual(overlays, [], `Unexpected text or tile controls in ${context}`);
        assert.ok(clickable, `Close button is covered in ${context}`);
        assert.equal(button.width, 44);
        assert.equal(button.height, 44);
        assert.equal(button.top, tile.top);
        assert.equal(button.right, tile.right);
        assert.ok(button.left >= tile.left && button.bottom <= tile.bottom);
      }
    }
    if (mode === 'stacked-grid') {
      const { saved, live, advanced, regularSplit, expanded, restored, contextFallback, contextRestored,
        visibleWidth, originalWidth, tileWidth } = layout.stacked;
      assert.equal(regularSplit, false);
      assert.equal(expanded, false);
      assert.equal(contextFallback, true);
      if (width > height) {
        assert.deepEqual(saved, ['red', 'green']);
        assert.deepEqual(live, ['red', 'green']);
        assert.deepEqual(advanced, ['blue', 'green']);
        assert.equal(contextRestored, true);
        assert.equal(restored, true);
        assert.ok(visibleWidth >= tileWidth - 2 && visibleWidth > originalWidth * 1.5);
      } else {
        assert.deepEqual([saved, live, advanced], [null, null, null]);
        assert.equal(restored, false);
      }
    } else if (mode === 'live-grid') {
      assert.equal(layout.playbackError, undefined);
      assert.deepEqual(layout.cycles, Array.from({ length: 3 }, () => ({
        zoomedVideoIsOnTop: true, renderableVideos: 5, restored: Array(5).fill(true),
      })));
    } else if (mode === 'full-grid' || mode === 'twelve-grid') {
      const columns = height > width ? 3 : 4;
      const count = mode === 'full-grid' ? 16 : 12;
      assert.equal(layout.tiles.length, count);
      assert.equal(new Set(layout.tiles.map(tile => tile.left)).size, columns);
      assert.equal(new Set(layout.tiles.map(tile => tile.top)).size, Math.ceil(count / columns));
      assert.ok(layout.tiles.every(tile => tile.width >= 100 && tile.height >= 44
        && tile.left >= 0 && tile.right <= width && tile.top >= 0 && tile.bottom <= height));
    } else if (mode === 'list') {
      assert.equal(layout.cards.length,9);
      assert.ok(layout.cards.every(card => card.left >= 0 && card.right <= width));
      const { create, filter, createEditor, nameFocused, clear, filteredCount, assignment, checkbox, checked } = layout.tagsLayout;
      for (const [name, bounds] of Object.entries({ create, filter, createEditor, clear, assignment })) {
        assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height,
          `${name} at ${width}x${height}: ${JSON.stringify(bounds)}; ${JSON.stringify(layout.tagsLayout)}`);
      }
      assert.ok(create.right > width / 2 && create.right <= layout.tabs.right && create.bottom <= layout.tabs.top);
      assert.ok(filter.height >= 44 && clear.width >= 44 && clear.height >= 44);
      assert.ok(checkbox.width > 0 && checkbox.width <= 24 && checkbox.height <= 24);
      assert.equal(nameFocused, true);
      assert.equal(filteredCount, 3);
      assert.equal(checked, true);
      for (const { plus, pencil, heading } of layout.listCameraHeadings) {
        assert.ok(plus.left >= pencil.right && plus.right <= heading.right && plus.width === 44 && plus.height === 44);
      }
      assert.ok(layout.noSignalStatus, `Channel status ribbon missing at ${width}x${height}`);
      const { ribbon, label, lastOnline, preview } = layout.noSignalStatus;
      assert.equal(label, 'Canal sem sinal');
      assert.ok(ribbon.left >= preview.left && ribbon.right <= preview.right
        && ribbon.top >= preview.top && ribbon.bottom <= preview.bottom,
      `Channel status ribbon is outside its preview at ${width}x${height}: ${JSON.stringify(layout.noSignalStatus)}`);
      assert.ok(lastOnline.left >= preview.left && lastOnline.right <= preview.right
        && lastOnline.top >= preview.top && lastOnline.bottom <= preview.bottom,
      `Last-online text is outside its preview at ${width}x${height}: ${JSON.stringify(layout.noSignalStatus)}`);
      assert.equal(layout.listHeadings.length, 9);
      assert.equal(layout.selectionHeadings.length, 9);
      assert.ok(layout.listHeadings.every(({ checkbox }) => !checkbox));
      assert.ok(layout.selectionHeadings.every(({ checkbox }) => checkbox));
      for (const cards of [layout.listHeadings, layout.selectionHeadings]) {
        assert.deepEqual(cards.map(card => card.channelLabel),
          ['Canal 1', 'Canal 2', 'Canal 3', ...Array(6).fill('Canal 1')]);
        for (const { heading, checkbox, hasPencil } of cards) {
          assert.equal(hasPencil, false);
          if (checkbox) assert.ok(checkbox.right <= heading.right);
        }
      }
      for (const headings of [layout.listCameraHeadings, layout.selectionCameraHeadings]) {
        assert.equal(headings.length, 7);
        for (const { heading, title, pencil, pencilCount } of headings) {
          assert.equal(pencilCount, 1);
          assert.ok(pencil.left - title.right >= 0 && pencil.left - title.right <= 12,
            `Pencil must sit directly after the camera name at ${width}x${height}`);
          assert.ok(pencil.width === 44 && pencil.height === 44 && pencil.right <= heading.right,
            `Pencil must be fully visible with a 44px circular touch target at ${width}x${height}`);
        }
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
      for (const { bounds, title, pencil, open, edit } of layout.visualCards) {
        assert.ok(bounds.left >= 0 && bounds.right <= width);
        assert.ok(pencil.left - title.right >= 0 && pencil.left - title.right <= 12,
          `Pencil must sit directly after the visual name at ${width}x${height}`);
        assert.equal(pencil.width, 44);
        assert.equal(pencil.height, 44);
        assert.ok(pencil.right < open.left && open.right < bounds.right);
        assert.ok(edit.top >= open.bottom && edit.bottom <= bounds.bottom);
        assert.ok(edit.width === open.width && edit.height >= 44 && edit.right < bounds.right);
      }
      const { bounds, inputFocused } = layout.visualEditor;
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= height);
      assert.ok(inputFocused);
      const { checked, save, cancel, lastSelectable } = layout.visualCameraEditor;
      assert.deepEqual(checked, ['camera-1', 'camera-2', 'missing-camera']);
      assert.ok(lastSelectable, `The last selected camera is covered at ${width}x${height}`);
      assert.ok(cancel.left >= 0 && cancel.right <= save.left && save.right <= width);
      assert.ok(save.bottom <= height && cancel.bottom <= height);
    } else {
      assert.equal(layout.portrait,String(height > width));
      if (height < width) assert.equal(layout.liveStateColor, 'rgb(242, 244, 246)');
      if (mode === 'single') {
        assert.equal(layout.liveStateText, 'Canal sem sinal');
        assert.deepEqual(layout.movableActions, ['PTZ', 'Áudio', 'Foto', 'Gravações']);
        assert.deepEqual(layout.fixedActions, ['Áudio', 'Foto', 'Gravações']);
        assert.equal(layout.fixedHasPtzPanel, false);
      }
      const expectedTiles = mode === 'single' ? 1 : mode === 'pair' ? 2 : 8;
      assert.equal(layout.tiles.length,expectedTiles);
      assert.equal(layout.savedFrames.length, 1);
      const [{ label, tile, imageLoaded }] = layout.savedFrames;
      assert.ok(imageLoaded);
      if (mode === 'single') assert.ok(label.left >= tile.left && label.right <= tile.right && label.bottom <= tile.bottom);
      else assert.equal(label, null);
      assert.ok(layout.player.width <= width + 1 && layout.player.height <= height + 1);
      const minimumTileHeight = height < 400 ? 40 : 100;
      assert.ok(layout.tiles.every(tile => tile.width > 100 && tile.height > minimumTileHeight
        && tile.left >= 0 && tile.right <= width && tile.top >= 0 && tile.bottom <= height));
      if (mode === 'player') {
        assert.deepEqual(layout.unavailableChannels.map(({ label, offline }) => ({ label, offline })), [
          { label: 'Canal sem sinal', offline: false }, { label: 'OFF-LINE', offline: true },
        ]);
        for (const { tile, ribbon, noSpinner } of layout.unavailableChannels) {
          assert.ok(noSpinner);
          assert.ok(ribbon.left >= tile.left && ribbon.right <= tile.right
            && ribbon.top >= tile.top && ribbon.bottom <= tile.bottom);
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
