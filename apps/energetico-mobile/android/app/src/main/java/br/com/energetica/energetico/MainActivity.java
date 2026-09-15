package br.com.energetica.energetico;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MicrosoftAuthPlugin.class);
        registerPlugin(DocumentPickerPlugin.class);
        registerPlugin(ShareInboxPlugin.class);
        super.onCreate(savedInstanceState);
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
        MicrosoftAuthPlugin.handleRedirect(intent);
        ShareInboxPlugin.acceptIntent(this, intent);
    }
}
