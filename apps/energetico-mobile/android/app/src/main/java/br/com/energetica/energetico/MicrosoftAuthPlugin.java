package br.com.energetica.energetico;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Small Android OAuth bridge for the same Microsoft public client used by the
 * iOS and browser builds.  It uses the system browser and PKCE, then returns
 * the access token only to the in-process Capacitor bridge.
 */
@CapacitorPlugin(name = "MicrosoftAuth")
public class MicrosoftAuthPlugin extends Plugin {
    private static final String TAG = "EnergeticoAuth";
    private static final String PREFS = "energetico.microsoft.auth";
    private static final String PREF_PENDING_REDIRECT = "pendingRedirect";
    private static final String PREF_PENDING_STATE = "pendingState";
    private static final String PREF_PENDING_VERIFIER = "pendingVerifier";
    private static final String PREF_PENDING_CLIENT_ID = "pendingClientId";
    private static final String PREF_PENDING_TENANT_ID = "pendingTenantId";
    private static final String PREF_PENDING_REDIRECT_URI = "pendingRedirectUri";
    private static final String PREF_PENDING_STARTED_AT = "pendingStartedAt";
    private static final long PENDING_TRANSACTION_TTL_MS = 10 * 60 * 1000L;
    private static final long TOKEN_SKEW_MS = 60_000L;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static volatile MicrosoftAuthPlugin instance;
    private static volatile Uri queuedRedirect;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();
    private SharedPreferences preferences;
    private PluginCall pendingSignIn;
    private String pendingState;
    private String pendingVerifier;
    private String clientId;
    private String tenantId;
    private String redirectUri;

    private static final class PendingTransaction {
        final String state;
        final String verifier;
        final String clientId;
        final String tenantId;
        final String redirectUri;
        final long startedAt;

        PendingTransaction(String state, String verifier, String clientId, String tenantId,
                           String redirectUri, long startedAt) {
            this.state = state;
            this.verifier = verifier;
            this.clientId = clientId;
            this.tenantId = tenantId;
            this.redirectUri = redirectUri;
            this.startedAt = startedAt;
        }
    }

    @Override
    public void load() {
        super.load();
        instance = this;
        preferences = getContext().getApplicationContext().getSharedPreferences(PREFS, 0);
        Uri redirect = queuedRedirect;
        queuedRedirect = null;
        if (redirect != null) main.post(() -> finishRedirect(redirect));
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        String suppliedClientId = clean(call.getString("clientId"));
        String suppliedTenantId = clean(call.getString("tenantId"));
        String suppliedRedirect = clean(call.getString("redirectUri"));
        if (suppliedClientId.isEmpty() || suppliedTenantId.isEmpty() || suppliedRedirect.isEmpty()) {
            call.reject("Configuração de login inválida.", "AUTH_CONFIG_INVALID");
            return;
        }
        synchronized (lock) {
            clientId = suppliedClientId;
            tenantId = suppliedTenantId;
            redirectUri = suppliedRedirect;
        }
        JSObject result = new JSObject();
        JSObject account = accountFromPreferences();
        result.put("account", account == null ? null : account);
        call.resolve(result);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        final String localClientId;
        final String localTenantId;
        final String localRedirect;
        final PendingTransaction savedTransaction;
        final Uri savedRedirect;
        synchronized (lock) {
            String suppliedClientId = clean(call.getString("clientId"));
            String suppliedTenantId = clean(call.getString("tenantId"));
            String suppliedRedirect = clean(call.getString("redirectUri"));
            localClientId = suppliedClientId.isEmpty() ? clientId : suppliedClientId;
            localTenantId = suppliedTenantId.isEmpty() ? tenantId : suppliedTenantId;
            localRedirect = suppliedRedirect.isEmpty() ? redirectUri : suppliedRedirect;
            if (pendingSignIn != null) {
                call.reject("Já existe um login em andamento.", "AUTH_IN_PROGRESS");
                return;
            }
            if (localClientId != null && localTenantId != null && localRedirect != null) {
                // An explicit sign-in carries everything it needs. Persist it
                // in memory for token refreshes after the browser returns.
                clientId = localClientId;
                tenantId = localTenantId;
                redirectUri = localRedirect;
            }
            pendingSignIn = call;
            savedTransaction = readPendingTransaction();
            savedRedirect = readPendingRedirect();
        }
        if (localClientId == null || localTenantId == null || localRedirect == null) {
            synchronized (lock) { pendingSignIn = null; }
            call.reject("Inicialize o login antes de entrar.", "AUTH_NOT_INITIALIZED");
            return;
        }
        try {
            // If the browser returned while the Activity/WebView was being
            // recreated, consume the durable transaction instead of opening a
            // second browser tab. The callback may have been saved before the
            // JavaScript call was registered.
            if (savedTransaction != null && savedRedirect != null) {
                main.post(() -> finishRedirect(savedRedirect));
                return;
            }
            if (savedTransaction == null && savedRedirect != null) clearPendingRedirect();

            String verifier = savedTransaction == null ? randomUrlToken(32) : savedTransaction.verifier;
            String state = savedTransaction == null ? randomUrlToken(24) : savedTransaction.state;
            String challenge = base64Url(MessageDigest.getInstance("SHA-256")
                .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
            synchronized (lock) {
                pendingVerifier = verifier;
                pendingState = state;
            }
            persistPendingTransaction(state, verifier, localClientId, localTenantId, localRedirect);
            List<String> scopes = scopes(call);
            if (!scopes.contains("openid")) scopes.add("openid");
            if (!scopes.contains("profile")) scopes.add("profile");
            if (!scopes.contains("email")) scopes.add("email");
            if (!scopes.contains("offline_access")) scopes.add("offline_access");
            String authorize = "https://login.microsoftonline.com/" + encode(localTenantId)
                + "/oauth2/v2.0/authorize?client_id=" + encode(localClientId)
                + "&response_type=code&redirect_uri=" + encode(localRedirect)
                + "&response_mode=query&scope=" + encode(String.join(" ", scopes))
                + "&code_challenge=" + encode(challenge)
                + "&code_challenge_method=S256&state=" + encode(state)
                + "&prompt=select_account";
            Uri authorizeUri = Uri.parse(authorize);
            // Capacitor invokes plugin methods on its own HandlerThread. UI
            // navigation from that worker is not reliable across Android
            // vendors (notably Samsung). Always launch the browser from the
            // Activity's main thread and report a launch failure immediately.
            Log.i(TAG, "oauth_browser_launch_requested");
            main.post(() -> launchBrowserOnMainThread(call, authorizeUri));
        } catch (Exception error) {
            Log.e(TAG, "oauth_prepare_failed: " + error.getClass().getSimpleName());
            failPendingSignIn(call, "O login Microsoft não pôde ser iniciado.", "AUTH_FAILED");
        }
    }

    private void launchBrowserOnMainThread(PluginCall call, Uri authorizeUri) {
        synchronized (lock) {
            if (pendingSignIn != call) return;
        }
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            Log.e(TAG, "oauth_browser_activity_unavailable");
            failPendingSignIn(call, "A tela do aplicativo não está disponível para abrir o login.", "AUTH_BROWSER_OPEN_FAILED");
            return;
        }
        Intent browser = new Intent(Intent.ACTION_VIEW, authorizeUri);
        browser.addCategory(Intent.CATEGORY_BROWSABLE);
        if (browser.resolveActivity(activity.getPackageManager()) == null) {
            Log.e(TAG, "oauth_browser_handler_unavailable");
            failPendingSignIn(call, "Nenhum navegador está disponível para abrir o login Microsoft.", "AUTH_BROWSER_UNAVAILABLE");
            return;
        }
        try {
            activity.startActivity(browser);
            Log.i(TAG, "oauth_browser_opened");
        } catch (ActivityNotFoundException | SecurityException error) {
            Log.e(TAG, "oauth_browser_open_failed: " + error.getClass().getSimpleName());
            failPendingSignIn(call, "Não foi possível abrir o navegador para entrar na Microsoft.", "AUTH_BROWSER_OPEN_FAILED");
        }
    }

    @PluginMethod
    public void cancelSignIn(PluginCall call) {
        PluginCall active;
        synchronized (lock) {
            active = pendingSignIn;
            pendingSignIn = null;
            pendingState = null;
            pendingVerifier = null;
            clearPendingTransaction();
            clearPendingRedirect();
        }
        if (active != null) rejectOnMain(active, "Login cancelado.", "MSALErrorUserCanceled");
        call.resolve();
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        final String token = preferences.getString("accessToken", "");
        final long expiresAt = preferences.getLong("expiresAt", 0L);
        if (!token.isEmpty() && expiresAt > System.currentTimeMillis() + TOKEN_SKEW_MS) {
            JSObject result = new JSObject();
            result.put("accessToken", token);
            result.put("expiresOn", expiresAt);
            call.resolve(result);
            return;
        }
        final String refreshToken = preferences.getString("refreshToken", "");
        if (refreshToken.isEmpty() || clientId == null || tenantId == null || redirectUri == null) {
            call.reject("É necessário entrar novamente.", "MSALErrorInteractionRequired");
            return;
        }
        final String localClientId = clientId;
        final String localTenantId = tenantId;
        final String localRedirect = redirectUri;
        executor.execute(() -> {
            try {
                JSONObject response = tokenRequest(localTenantId, localClientId, localRedirect,
                    "grant_type=refresh_token&refresh_token=" + encode(refreshToken)
                    + "&scope=" + encode("openid profile email offline_access User.Read"));
                saveTokenResponse(response, localTenantId);
                resolveToken(call, response);
            } catch (Exception error) {
                rejectOnMain(call, "É necessário entrar novamente.", "MSALErrorInteractionRequired");
            }
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        preferences.edit().clear().apply();
        call.resolve();
    }

    /** Called by MainActivity when the browser redirects back to the app. */
    public static void handleRedirect(Intent intent) {
        MicrosoftAuthPlugin plugin = instance;
        if (intent == null || intent.getData() == null) return;
        Uri redirect = intent.getData();
        if (plugin == null) {
            queuedRedirect = redirect;
            return;
        }
        plugin.finishRedirect(redirect);
    }

    /** Keeps MainActivity's routing limited to this app's registered callback. */
    public static boolean isRedirectIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri data = intent.getData();
        return "msauth.br.com.energetica.energetico".equalsIgnoreCase(data.getScheme())
            && "auth".equalsIgnoreCase(data.getHost());
    }

    private void finishRedirect(Uri responseUri) {
        Log.i(TAG, "oauth_callback_received");
        final PluginCall call;
        final PendingTransaction transaction;
        synchronized (lock) {
            call = pendingSignIn;
            transaction = readPendingTransaction();
            if (call == null) {
                // The browser can deliver the callback before Capacitor has
                // recreated the WebView and registered the PluginCall. Keep it
                // alongside the PKCE verifier; signIn() will consume it.
                if (transaction != null) storePendingRedirect(responseUri);
                return;
            }
            pendingSignIn = null;
            pendingState = null;
            pendingVerifier = null;
            clearPendingTransaction();
            clearPendingRedirect();
        }
        if (transaction == null) {
            rejectOnMain(call, "A tentativa de login expirou. Tente novamente.", "AUTH_FAILED");
            return;
        }
        final String expectedState = transaction.state;
        final String verifier = transaction.verifier;
        String returnedState = responseUri.getQueryParameter("state");
        if (expectedState == null || returnedState == null || !constantTimeEquals(expectedState, returnedState)) {
            rejectOnMain(call, "A resposta do login Microsoft é inválida.", "AUTH_FAILED");
            return;
        }
        String error = responseUri.getQueryParameter("error");
        if (error != null && !error.isEmpty()) {
            rejectOnMain(call, "Login cancelado.", "MSALErrorUserCanceled");
            return;
        }
        String code = responseUri.getQueryParameter("code");
        if (code == null || code.trim().isEmpty() || verifier == null) {
            rejectOnMain(call, "O login Microsoft não pôde ser concluído.", "AUTH_FAILED");
            return;
        }
        executor.execute(() -> {
            try {
                JSONObject response = tokenRequest(transaction.tenantId, transaction.clientId, transaction.redirectUri,
                    "grant_type=authorization_code&code=" + encode(code)
                    + "&redirect_uri=" + encode(transaction.redirectUri)
                    + "&client_id=" + encode(transaction.clientId)
                    + "&code_verifier=" + encode(verifier)
                    + "&scope=" + encode("openid profile email offline_access User.Read"));
                saveTokenResponse(response, transaction.tenantId);
                JSObject account = accountFromResponse(response, transaction.tenantId);
                if (account == null) account = accountFromPreferences();
                if (account == null) throw new Exception("A conta não foi retornada.");
                JSObject result = new JSObject();
                result.put("account", account);
                resolveOnMain(call, result);
            } catch (Exception failure) {
                rejectOnMain(call, "O login Microsoft não pôde ser concluído.", "AUTH_FAILED");
            }
        });
    }

    private JSONObject tokenRequest(String localTenantId, String localClientId, String localRedirect, String body) throws Exception {
        URL url = new URL("https://login.microsoftonline.com/" + encode(localTenantId) + "/oauth2/v2.0/token");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(30_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        int status = connection.getResponseCode();
        String response = read(connection, status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        if (status < 200 || status >= 300) throw new Exception("Token request failed");
        return new JSONObject(response);
    }

    private void saveTokenResponse(JSONObject response, String accountTenantId) throws Exception {
        String accessToken = response.optString("access_token", "");
        if (accessToken.isEmpty()) throw new Exception("Token inexistente");
        String refreshToken = response.optString("refresh_token", "");
        long expiresIn = response.optLong("expires_in", 3600L);
        SharedPreferences.Editor editor = preferences.edit()
            .putString("accessToken", accessToken)
            .putLong("expiresAt", System.currentTimeMillis() + Math.max(60L, expiresIn) * 1000L);
        if (!refreshToken.isEmpty()) editor.putString("refreshToken", refreshToken);
        JSObject account = accountFromResponse(response, accountTenantId);
        if (account != null) {
            editor.putString("homeAccountId", account.optString("homeAccountId", ""));
            editor.putString("username", account.optString("username", ""));
            editor.putString("name", account.optString("name", ""));
        }
        editor.apply();
    }

    private JSObject accountFromResponse(JSONObject response, String accountTenantId) {
        String idToken = response.optString("id_token", "");
        if (idToken.isEmpty()) return null;
        try {
            String[] parts = idToken.split("\\.");
            if (parts.length < 2) return null;
            JSONObject claims = new JSONObject(new String(android.util.Base64.decode(parts[1], android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP), StandardCharsets.UTF_8));
            String oid = claims.optString("oid", claims.optString("sub", ""));
            String tid = claims.optString("tid", accountTenantId == null ? "" : accountTenantId);
            String username = claims.optString("preferred_username", claims.optString("upn", ""));
            String name = claims.optString("name", username);
            if (oid.isEmpty()) return null;
            JSObject account = new JSObject();
            account.put("homeAccountId", oid + "." + tid);
            account.put("username", username);
            account.put("name", name);
            return account;
        } catch (Exception ignored) {
            return null;
        }
    }

    private JSObject accountFromPreferences() {
        String id = preferences.getString("homeAccountId", "");
        if (id.isEmpty()) return null;
        JSObject account = new JSObject();
        account.put("homeAccountId", id);
        account.put("username", preferences.getString("username", ""));
        account.put("name", preferences.getString("name", preferences.getString("username", "")));
        return account;
    }

    private void persistPendingTransaction(String state, String verifier, String localClientId,
                                           String localTenantId, String localRedirect) {
        preferences.edit()
            .putString(PREF_PENDING_STATE, state)
            .putString(PREF_PENDING_VERIFIER, verifier)
            .putString(PREF_PENDING_CLIENT_ID, localClientId)
            .putString(PREF_PENDING_TENANT_ID, localTenantId)
            .putString(PREF_PENDING_REDIRECT_URI, localRedirect)
            .putLong(PREF_PENDING_STARTED_AT, System.currentTimeMillis())
            // The browser may be killed immediately after the intent is
            // launched. Commit the PKCE transaction before leaving our task.
            .commit();
    }

    private PendingTransaction readPendingTransaction() {
        long startedAt = preferences.getLong(PREF_PENDING_STARTED_AT, 0L);
        String state = preferences.getString(PREF_PENDING_STATE, "");
        String verifier = preferences.getString(PREF_PENDING_VERIFIER, "");
        String savedClientId = preferences.getString(PREF_PENDING_CLIENT_ID, "");
        String savedTenantId = preferences.getString(PREF_PENDING_TENANT_ID, "");
        String savedRedirect = preferences.getString(PREF_PENDING_REDIRECT_URI, "");
        if (startedAt <= 0L || System.currentTimeMillis() - startedAt > PENDING_TRANSACTION_TTL_MS
            || state.isEmpty() || verifier.isEmpty() || savedClientId.isEmpty()
            || savedTenantId.isEmpty() || savedRedirect.isEmpty()) {
            if (startedAt > 0L || !state.isEmpty() || !verifier.isEmpty()) clearPendingTransaction();
            return null;
        }
        return new PendingTransaction(state, verifier, savedClientId, savedTenantId, savedRedirect, startedAt);
    }

    private Uri readPendingRedirect() {
        String value = preferences.getString(PREF_PENDING_REDIRECT, "");
        return value.isEmpty() ? null : Uri.parse(value);
    }

    private void storePendingRedirect(Uri responseUri) {
        if (responseUri == null) return;
        preferences.edit().putString(PREF_PENDING_REDIRECT, responseUri.toString()).commit();
    }

    private void clearPendingRedirect() {
        preferences.edit().remove(PREF_PENDING_REDIRECT).commit();
    }

    private void clearPendingTransaction() {
        preferences.edit()
            .remove(PREF_PENDING_STATE)
            .remove(PREF_PENDING_VERIFIER)
            .remove(PREF_PENDING_CLIENT_ID)
            .remove(PREF_PENDING_TENANT_ID)
            .remove(PREF_PENDING_REDIRECT_URI)
            .remove(PREF_PENDING_STARTED_AT)
            .commit();
    }

    private void resolveToken(PluginCall call, JSONObject response) {
        JSObject result = new JSObject();
        result.put("accessToken", response.optString("access_token", ""));
        result.put("expiresOn", preferences.getLong("expiresAt", 0L));
        resolveOnMain(call, result);
    }

    private List<String> scopes(PluginCall call) {
        List<String> values = new ArrayList<>();
        try {
            com.getcapacitor.JSArray array = call.getArray("scopes");
            if (array != null) {
                for (int i = 0; i < array.length(); i++) {
                    String value = array.getString(i);
                    if (value != null && !value.trim().isEmpty() && !values.contains(value.trim())) values.add(value.trim());
                }
            }
        } catch (Exception ignored) { }
        if (values.isEmpty()) values.add("User.Read");
        return values;
    }

    private void clearPendingSignIn() {
        synchronized (lock) {
            pendingSignIn = null;
            pendingState = null;
            pendingVerifier = null;
            clearPendingTransaction();
            clearPendingRedirect();
        }
    }

    private void failPendingSignIn(PluginCall expected, String message, String code) {
        boolean shouldReject;
        synchronized (lock) {
            shouldReject = pendingSignIn == expected;
            if (shouldReject) {
                pendingSignIn = null;
                pendingState = null;
                pendingVerifier = null;
                clearPendingTransaction();
                clearPendingRedirect();
            }
        }
        if (shouldReject) rejectOnMain(expected, message, code);
    }

    private void resolveOnMain(PluginCall call, JSObject result) { main.post(() -> call.resolve(result)); }
    private void rejectOnMain(PluginCall call, String message, String code) { main.post(() -> call.reject(message, code)); }

    private static String read(HttpURLConnection connection, InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private static String randomUrlToken(int size) {
        byte[] bytes = new byte[size];
        RANDOM.nextBytes(bytes);
        return base64Url(bytes);
    }

    private static String base64Url(byte[] bytes) {
        return android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING);
    }

    private static String encode(String value) throws Exception { return URLEncoder.encode(value, StandardCharsets.UTF_8.name()); }
    private static String clean(String value) { return value == null ? "" : value.trim(); }
    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
