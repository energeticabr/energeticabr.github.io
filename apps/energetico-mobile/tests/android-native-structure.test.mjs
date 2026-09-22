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
  assert.match(activity, /setIntent\(new Intent\(\)\)/, "a Activity principal deve continuar consumindo callbacks legados uma única vez");
  assert.doesNotMatch(activity, /MicrosoftAuthPlugin\.clearInstance\(this\)/, "a saída para o navegador não deve apagar a chamada de login pendente");
  const mainActivity = manifest.match(/<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?<\/activity>/)?.[0] || "";
  assert.match(mainActivity, /android:scheme="msauth\.br\.com\.energetica\.energetico"/, "o callback deve retornar à mesma Activity que mantém a chamada de login");
  assert.doesNotMatch(manifest, /android:name="\.AuthRedirectActivity"/, "o callback não deve passar por outra Activity e perder a chamada pendente");
  assert.match(manifest, /android:name="android\.intent\.action\.SEND_MULTIPLE"/);
  assert.match(auth, /pendingRedirect/, "o callback deve sobreviver à recriação da Activity");
  assert.doesNotMatch(auth, /clearInstance\(Activity host\)/, "o retorno deve alcançar a mesma ponte que iniciou o login");
  assert.match(auth, /cancelSignIn/, "a tentativa nativa deve poder ser cancelada após timeout");
  assert.match(auth, /main\.post\(\(\) -> launchBrowserOnMainThread\(/,
    "a abertura do navegador deve ser transferida da thread do Capacitor para a thread principal do Android");
  assert.match(auth, /resolveActivity\(/,
    "o login deve falhar imediatamente quando o tablet não tiver um navegador capaz de abrir a Microsoft");
});

test("Android preserva escopos OAuth e não reutiliza token de outra API SharePoint", async () => {
  const auth = await readFile(new URL("app/src/main/java/br/com/energetica/energetico/MicrosoftAuthPlugin.java", android), "utf8");
  assert.match(auth, /PREF_PENDING_SCOPES/);
  assert.match(auth, /PREF_GRANTED_SCOPES/);
  assert.match(auth, /PREF_PENDING_ACCOUNT_ID/);
  assert.match(auth, /expectedHomeAccountId/);
  assert.match(auth, /OAuthScopeSupport\.matchesAccount/);
  assert.match(auth, /OAuthScopeSupport\.covers/);
  assert.match(auth, /String\.join\(" ",\s*requestedScopes\)/);
  assert.match(auth, /transaction\.scopes/);
  assert.doesNotMatch(auth, /scope=["']openid profile email offline_access User\.Read/,
    "a troca e a renovação não podem fixar permissões antigas, ignorando o recurso solicitado");
  const refreshRequest = auth.match(/"grant_type=refresh_token&refresh_token="[\s\S]*?\);/)?.[0] || "";
  assert.match(refreshRequest, /client_id=/, "a renovação do token precisa enviar o client_id do aplicativo");
});

test("iOS fixa a autorização incremental na conta já autenticada", async () => {
  const ios = await readFile(new URL("../ios/App/App/MicrosoftAuthPlugin.swift", import.meta.url), "utf8");
  assert.match(ios, /authorizationMode.*incremental/);
  assert.match(ios, /expectedHomeAccountId/);
  assert.match(ios, /result\.account\.identifier.*expectedAccountId/);
  assert.match(ios, /parameters\.loginHint/);
  assert.match(ios, /parameters\.promptType\s*=\s*\.consent/);
});
