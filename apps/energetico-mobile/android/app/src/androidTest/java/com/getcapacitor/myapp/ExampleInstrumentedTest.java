package br.com.energetica.energetico;

import static androidx.test.espresso.intent.Intents.intended;
import static androidx.test.espresso.intent.Intents.intending;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasAction;
import static androidx.test.espresso.intent.matcher.IntentMatchers.hasData;
import static androidx.test.espresso.web.sugar.Web.onWebView;
import static androidx.test.espresso.web.webdriver.DriverAtoms.findElement;
import static androidx.test.espresso.web.webdriver.DriverAtoms.webClick;
import static org.hamcrest.Matchers.allOf;
import static org.hamcrest.Matchers.hasToString;
import static org.hamcrest.Matchers.startsWith;
import static org.junit.Assert.assertEquals;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.espresso.intent.rule.IntentsTestRule;
import androidx.test.espresso.web.webdriver.Locator;
import androidx.test.platform.app.InstrumentationRegistry;
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

    @Test
    public void applicationIdMatchesMicrosoftRedirectRegistration() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("br.com.energetica.energetico", appContext.getPackageName());
    }

    @Test
    public void microsoftButtonRequestsSystemBrowserWithoutWaitingForSessionRestore() {
        intending(hasAction(Intent.ACTION_VIEW)).respondWith(
            new Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null));

        onWebView()
            .forceJavascriptEnabled()
            .withElement(findElement(Locator.CSS_SELECTOR, "[data-action='sign-in']"))
            .perform(webClick());

        intended(allOf(
            hasAction(Intent.ACTION_VIEW),
            hasData(hasToString(startsWith(AUTHORIZE_ENDPOINT)))
        ));
    }
}
