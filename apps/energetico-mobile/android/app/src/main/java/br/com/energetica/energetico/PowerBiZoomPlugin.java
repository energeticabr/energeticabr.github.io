package br.com.energetica.energetico;

import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Enables native pinch zoom only while the Power BI report is open. */
@CapacitorPlugin(name = "PowerBiZoom")
public class PowerBiZoomPlugin extends Plugin {
    private Boolean previousSupportZoom;
    private Boolean previousBuiltInZoomControls;
    private Boolean previousDisplayZoomControls;

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Informe se o zoom do Power BI deve ser habilitado.", "POWERBI_ZOOM_INVALID_ARGUMENT");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView == null) {
                call.reject("A tela do Power BI não está disponível.", "POWERBI_ZOOM_WEBVIEW_UNAVAILABLE");
                return;
            }

            WebSettings settings = webView.getSettings();
            if (enabled) {
                if (previousSupportZoom == null) {
                    previousSupportZoom = settings.supportZoom();
                    previousBuiltInZoomControls = settings.getBuiltInZoomControls();
                    previousDisplayZoomControls = settings.getDisplayZoomControls();
                }
                settings.setSupportZoom(true);
                settings.setBuiltInZoomControls(true);
                settings.setDisplayZoomControls(false);
            } else if (previousSupportZoom != null) {
                settings.setSupportZoom(previousSupportZoom);
                settings.setBuiltInZoomControls(previousBuiltInZoomControls);
                settings.setDisplayZoomControls(previousDisplayZoomControls);
                previousSupportZoom = null;
                previousBuiltInZoomControls = null;
                previousDisplayZoomControls = null;
            }
            call.resolve();
        });
    }
}
