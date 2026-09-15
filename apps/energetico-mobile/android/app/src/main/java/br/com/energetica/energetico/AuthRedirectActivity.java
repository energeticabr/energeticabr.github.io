package br.com.energetica.energetico;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Receives the Microsoft custom-scheme callback outside the WebView Activity.
 *
 * Samsung browsers can recreate or resume the main Activity at a different
 * point in the callback lifecycle. A dedicated, no-history Activity gives the
 * native auth bridge one reliable entry point, then returns to the existing
 * app task without exposing the authorization URI to the WebView.
 */
public class AuthRedirectActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent callback = getIntent();
        if (MicrosoftAuthPlugin.isRedirectIntent(callback)) {
            MicrosoftAuthPlugin.handleRedirect(callback);
        }

        Intent launch = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launch);
        finish();
    }
}
