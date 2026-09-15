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
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        DocumentPickerPlugin.handleActivityResult(requestCode, resultCode, data);
    }

    private void handleIncomingIntent(Intent intent) {
        MicrosoftAuthPlugin.handleRedirect(intent);
        ShareInboxPlugin.acceptIntent(this, intent);
    }
}
