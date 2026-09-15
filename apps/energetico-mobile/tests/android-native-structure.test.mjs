import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const android = new URL("../android/", import.meta.url);

test("Android registra as pontes de autenticação, seleção e compartilhamento", async () => {
  const [activity, auth, picker, inbox, redirectActivity, manifest] = await Promise.all([
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/MainActivity.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/MicrosoftAuthPlugin.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/DocumentPickerPlugin.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/ShareInboxPlugin.java", android), "utf8"),
    readFile(new URL("app/src/main/java/br/com/energetica/energetico/AuthRedirectActivity.java", android), "utf8"),
    readFile(new URL("app/src/main/AndroidManifest.xml", android), "utf8"),
  ]);

  for (const source of [auth, picker, inbox]) assert.match(source, /@CapacitorPlugin\(name =/);
  assert.match(activity, /registerPlugin\(MicrosoftAuthPlugin\.class\)/);
  assert.match(activity, /registerPlugin\(DocumentPickerPlugin\.class\)/);
  assert.match(activity, /registerPlugin\(ShareInboxPlugin\.class\)/);
  assert.match(activity, /setIntent\(new Intent\(\)\)/, "a Activity principal deve continuar consumindo callbacks legados uma única vez");
  assert.match(activity, /onDestroy\(\)[\s\S]*?MicrosoftAuthPlugin\.clearInstance\(this\)/, "a ponte antiga deve ser descartada quando o Samsung recriar a Activity");
  assert.match(redirectActivity, /MicrosoftAuthPlugin\.handleRedirect\(callback\)/, "a Activity de callback deve encaminhar o retorno OAuth ao plugin");
  assert.match(redirectActivity, /startActivity\(launch\)/, "a Activity de callback deve devolver o usuário ao app");
  assert.match(manifest, /android:name="\.AuthRedirectActivity"[\s\S]*?android:exported="true"/);
  assert.match(manifest, /android:name="\.AuthRedirectActivity"[\s\S]*?android:scheme="msauth\.br\.com\.energetica\.energetico"/);
  const mainActivity = manifest.match(/<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?<\/activity>/)?.[0] || "";
  assert.doesNotMatch(mainActivity, /android:scheme="msauth\.br\.com\.energetica\.energetico"/, "o callback não deve disputar o filtro da Activity principal");
  assert.match(manifest, /android:name="android\.intent\.action\.SEND_MULTIPLE"/);
  assert.match(auth, /pendingRedirect/, "o callback deve sobreviver à recriação da Activity");
  assert.match(auth, /clearInstance\(Activity host\)/, "a ponte deve ignorar a instância estática de uma Activity destruída");
  assert.match(auth, /cancelSignIn/, "a tentativa nativa deve poder ser cancelada após timeout");
});
