import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const android = new URL("../android/", import.meta.url);

test("Android registra as pontes de autenticação, seleção e compartilhamento", async () => {
  const [activity, auth, picker, inbox, manifest] = await Promise.all([
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/MainActivity.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/MicrosoftAuthPlugin.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/DocumentPickerPlugin.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/ShareInboxPlugin.java", android), "utf8"),
    readFile(new URL("app/src/main/AndroidManifest.xml", android), "utf8"),
  ]);

  for (const source of [auth, picker, inbox]) assert.match(source, /@CapacitorPlugin\(name =/);
  assert.match(activity, /registerPlugin\(MicrosoftAuthPlugin\.class\)/);
  assert.match(activity, /registerPlugin\(DocumentPickerPlugin\.class\)/);
  assert.match(activity, /registerPlugin\(ShareInboxPlugin\.class\)/);
  assert.match(manifest, /android:scheme="msauth\.br\.com\.energetica\.energetico"/);
  assert.match(manifest, /android:name="android\.intent\.action\.SEND_MULTIPLE"/);
});
