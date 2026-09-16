package br.com.energetica.energetico;

import static androidx.test.espresso.intent.Intents.getIntents;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.Context;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.espresso.intent.rule.IntentsTestRule;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    private static final String AUTHORIZE_ENDPOINT =
        "https://login.microsoftonline.com/0c10f511-7ede-4702-a2d9-bedb26937e0e/oauth2/v2.0/authorize?";

    @Rule
    public IntentsTestRule<MainActivity> activityRule = new IntentsTestRule<>(MainActivity.class);

    private Intent waitForAuthorizeIntent() {
        long deadline = SystemClock.uptimeMillis() + 5_000L;
        do {
            for (Intent intent : getIntents()) {
                String data = intent.getDataString();
                if (Intent.ACTION_VIEW.equals(intent.getAction())
                    && data != null && data.startsWith(AUTHORIZE_ENDPOINT)) return intent;
            }
            SystemClock.sleep(100L);
        } while (SystemClock.uptimeMillis() < deadline);
        return null;
    }

    private boolean clickMicrosoftButtonInWebView() throws InterruptedException {
        long deadline = SystemClock.uptimeMillis() + 15_000L;
        do {
            CountDownLatch resultReady = new CountDownLatch(1);
            AtomicBoolean clicked = new AtomicBoolean(false);
            activityRule.getActivity().runOnUiThread(() ->
                activityRule.getActivity().getBridge().getWebView().evaluateJavascript(
                    "(() => { const button = document.querySelector(\"[data-action='sign-in']\");" +
                    " if (!button) return false; button.click(); return true; })()",
                    value -> {
                        clicked.set("true".equals(value));
                        resultReady.countDown();
                    }
                )
            );
            resultReady.await(2, TimeUnit.SECONDS);
            if (clicked.get()) return true;
            SystemClock.sleep(100L);
        } while (SystemClock.uptimeMillis() < deadline);
        return false;
    }

    private boolean waitForMicrosoftButtonToUnlock() throws InterruptedException {
        long deadline = SystemClock.uptimeMillis() + 10_000L;
        do {
            CountDownLatch resultReady = new CountDownLatch(1);
            AtomicBoolean unlocked = new AtomicBoolean(false);
            activityRule.getActivity().runOnUiThread(() ->
                activityRule.getActivity().getBridge().getWebView().evaluateJavascript(
                    "(() => { const button = document.querySelector(\"[data-action='sign-in']\");" +
                    " const error = document.querySelector('.error-banner');" +
                    " return Boolean(button && !button.disabled" +
                    " && button.textContent.includes('Entrar com a Microsoft') && error); })()",
                    value -> {
                        unlocked.set("true".equals(value));
                        resultReady.countDown();
                    }
                )
            );
            resultReady.await(2, TimeUnit.SECONDS);
            if (unlocked.get()) return true;
            SystemClock.sleep(100L);
        } while (SystemClock.uptimeMillis() < deadline);
        return false;
    }

    @Test
    public void applicationIdMatchesMicrosoftRedirectRegistration() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("br.com.energetica.energetico", appContext.getPackageName());
    }

    @Test
    public void microsoftCallbackReturnsToExistingMainActivity() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Intent callback = new Intent(Intent.ACTION_VIEW,
            Uri.parse("msauth.br.com.energetica.energetico://auth?code=test&state=test"));
        callback.setPackage(appContext.getPackageName());
        ResolveInfo resolved = appContext.getPackageManager().resolveActivity(callback, 0);
        assertNotNull("O retorno Microsoft não encontrou a Activity principal", resolved);
        assertEquals("br.com.energetica.energetico.MainActivity",
            resolved.activityInfo.name);
    }

    @Test
    public void microsoftButtonRequestsSystemBrowserWithoutWaitingForSessionRestore() throws InterruptedException {
        intending(hasAction(Intent.ACTION_VIEW)).respondWith(
            new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null));

        assertTrue("O botão Microsoft não ficou disponível", clickMicrosoftButtonInWebView());

        assertNotNull("O toque não solicitou a abertura do login Microsoft", waitForAuthorizeIntent());
    }

    @Test
    public void microsoftBrowserCallbackCompletesPendingLoginAndUnlocksInterface() throws InterruptedException {
        intending(hasAction(Intent.ACTION_VIEW)).respondWith(
            new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null));

        assertTrue("O botão Microsoft não ficou disponível", clickMicrosoftButtonInWebView());
        Intent authorizeIntent = waitForAuthorizeIntent();
        assertNotNull("O toque não solicitou a abertura do login Microsoft", authorizeIntent);
        String state = authorizeIntent.getData().getQueryParameter("state");
        assertNotNull("O login Microsoft não enviou o estado PKCE", state);

        Intent callback = new Intent(Intent.ACTION_VIEW, new Uri.Builder()
            .scheme("msauth.br.com.energetica.energetico")
            .authority("auth")
            .appendQueryParameter("error", "access_denied")
            .appendQueryParameter("state", state)
            .build());
        activityRule.getActivity().runOnUiThread(() ->
            activityRule.getActivity().onNewIntent(callback));

        assertTrue("O retorno Microsoft não concluiu a chamada nem liberou uma nova tentativa",
            waitForMicrosoftButtonToUnlock());
    }
}
