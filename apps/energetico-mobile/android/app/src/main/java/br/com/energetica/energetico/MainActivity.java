package br.com.energetica.energetico;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean landscapeReport;
    private boolean restoreReportStatusBar;

    @Override
    public void setRequestedOrientation(int orientation) {
        // The orientation plugin may call from the bridge thread. Insets must
        // change on the UI thread before Android chooses the rotation animation.
        runOnUiThread(() -> {
            boolean landscape = orientation == ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
            if (landscape && !landscapeReport) {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
                restoreReportStatusBar = insets == null || insets.isVisible(WindowInsetsCompat.Type.statusBars());
                // JUMPCUT requires a fullscreen top window. Use modern insets
                // rather than FLAG_FULLSCREEN, which disables keyboard resizing.
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                    .hide(WindowInsetsCompat.Type.statusBars());
            }
            landscapeReport = landscape;
            super.setRequestedOrientation(orientation);
            if (!landscape) {
                if (getResources().getConfiguration().orientation == Configuration.ORIENTATION_PORTRAIT) {
                    restoreStatusBarAfterReport();
                } else {
                    // Large-screen/multi-window policy can decline portrait,
                    // in which case no configuration callback will arrive.
                    getWindow().getDecorView().postDelayed(this::restoreStatusBarAfterReport, 1000);
                }
            }
        });
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (configuration.orientation == Configuration.ORIENTATION_PORTRAIT) restoreStatusBarAfterReport();
    }

    private void restoreStatusBarAfterReport() {
        if (landscapeReport || !restoreReportStatusBar) return;
        restoreReportStatusBar = false;
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .show(WindowInsetsCompat.Type.statusBars());
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MicrosoftAuthPlugin.class);
        registerPlugin(DocumentPickerPlugin.class);
        registerPlugin(DocumentScannerPlugin.class);
        registerPlugin(ShareInboxPlugin.class);
        super.onCreate(savedInstanceState);
        // Reports still rotate the native keyboard. Switch directly between
        // their landscape surface and portrait HOME, without a spinning window.
        WindowManager.LayoutParams attributes = getWindow().getAttributes();
        attributes.rotationAnimation = WindowManager.LayoutParams.ROTATION_ANIMATION_JUMPCUT;
        getWindow().setAttributes(attributes);
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Some Android browser versions deliver the custom-scheme callback
        // while resuming the existing singleTask activity without invoking
        // onNewIntent. Re-check the current intent so the pending OAuth call
        // is always completed when the user returns from Microsoft.
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        DocumentPickerPlugin.handleActivityResult(requestCode, resultCode, data);
    }

    private void handleIncomingIntent(Intent intent) {
        boolean authRedirect = MicrosoftAuthPlugin.isRedirectIntent(intent);
        MicrosoftAuthPlugin.handleRedirect(intent);
        if (authRedirect) {
            // singleTask activities retain the last intent. Clear a consumed
            // callback so onResume cannot submit the same authorization code
            // again after the WebView returns from the browser.
            setIntent(new Intent());
        } else {
            ShareInboxPlugin.acceptIntent(this, intent);
        }
    }
}
