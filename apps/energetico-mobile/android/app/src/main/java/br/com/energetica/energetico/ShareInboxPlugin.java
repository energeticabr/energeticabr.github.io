package br.com.energetica.energetico;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Android counterpart of the iOS share extension inbox.
 *
 * Android sends a content URI to the activity instead of running a separate
 * extension.  We copy the bytes into private app storage before the sending
 * application can revoke the URI, then expose the same list/read/remove
 * contract consumed by the shared web code.
 */
@CapacitorPlugin(name = "ShareInbox")
public class ShareInboxPlugin extends Plugin {
    private static final long MAX_FILE_BYTES = 60_000_000L;
    private static final String ROOT_NAME = "energetico-share-inbox";
    private static final String META_NAME = "metadata.json";
    private static final String PAYLOAD_NAME = "payload";
    private static final String HANDLED_FLAG = "energetico.shareInboxHandled";
    private static final SimpleDateFormat ISO = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US);

    private static volatile Context applicationContext;

    @Override
    public void load() {
        super.load();
        applicationContext = getContext().getApplicationContext();
    }

    /** Called by MainActivity for ACTION_SEND/ACTION_SEND_MULTIPLE intents. */
    public static void acceptIntent(Context context, Intent intent) {
        if (context == null || intent == null || intent.getBooleanExtra(HANDLED_FLAG, false)) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        List<Uri> uris = extractUris(intent);
        if (uris.isEmpty()) return;
        intent.putExtra(HANDLED_FLAG, true);
        Context app = context.getApplicationContext();
        applicationContext = app;
        new Thread(() -> {
            for (Uri uri : uris) {
                try {
                    stageUri(app, uri);
                } catch (Exception ignored) {
                    // One invalid item must not discard other valid shared files.
                }
            }
        }, "energetico-share-inbox").start();
    }

    private static List<Uri> extractUris(Intent intent) {
        List<Uri> result = new ArrayList<>();
        ClipData clipData = intent.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                Uri uri = clipData.getItemAt(i).getUri();
                if (uri != null) result.add(uri);
            }
        }
        Uri single = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (single != null && !result.contains(single)) result.add(single);
        return result;
    }

    private static void stageUri(Context context, Uri source) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        String id = UUID.randomUUID().toString();
        File directory = new File(new File(context.getFilesDir(), ROOT_NAME), id);
        if (!directory.mkdirs() && !directory.isDirectory()) throw new IOException("Não foi possível criar o armazenamento do anexo.");
        File payload = new File(directory, PAYLOAD_NAME);
        long declaredSize = declaredSize(resolver, source);
        if (declaredSize > MAX_FILE_BYTES) throw new IOException("O anexo excede 60 MB.");
        long copied = 0;
        try (InputStream input = resolver.openInputStream(source)) {
            if (input == null) throw new IOException("O arquivo compartilhado não está disponível.");
            try (OutputStream output = new FileOutputStream(payload)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    copied += read;
                    if (copied > MAX_FILE_BYTES) throw new IOException("O anexo excede 60 MB.");
                    output.write(buffer, 0, read);
                }
            }
        } catch (Exception error) {
            deleteRecursively(directory);
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("Não foi possível copiar o anexo compartilhado.", error);
        }

        String name = displayName(resolver, source);
        if (name.isEmpty()) name = "arquivo-" + id;
        String type = resolver.getType(source);
        if (type == null || type.trim().isEmpty()) type = "application/octet-stream";
        JSONObject metadata = new JSONObject();
        metadata.put("id", id);
        metadata.put("name", name);
        metadata.put("size", copied);
        metadata.put("type", type);
        metadata.put("state", "needsAuthentication");
        metadata.put("createdAt", ISO.format(new Date()));
        try (FileOutputStream output = new FileOutputStream(new File(directory, META_NAME))) {
            output.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            deleteRecursively(directory);
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("Não foi possível salvar o anexo compartilhado.", error);
        }
    }

    private static long declaredSize(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getLong(0);
        } catch (Exception ignored) { }
        return -1;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return String.valueOf(cursor.getString(0));
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last == null ? "" : last;
    }

    private File root() {
        Context context = applicationContext != null ? applicationContext : getContext().getApplicationContext();
        File root = new File(context.getFilesDir(), ROOT_NAME);
        if (!root.isDirectory()) root.mkdirs();
        return root;
    }

    @PluginMethod
    public void list(PluginCall call) {
        try {
            JSArray items = new JSArray();
            File[] directories = root().listFiles(File::isDirectory);
            if (directories != null) {
                for (File directory : directories) {
                    JSONObject metadata = readMetadata(directory);
                    if (metadata == null || !new File(directory, PAYLOAD_NAME).isFile()) continue;
                    JSObject item = new JSObject();
                    item.put("id", metadata.optString("id", directory.getName()));
                    item.put("name", metadata.optString("name", "arquivo"));
                    item.put("size", metadata.optLong("size", new File(directory, PAYLOAD_NAME).length()));
                    item.put("type", metadata.optString("type", "application/octet-stream"));
                    item.put("state", metadata.optString("state", "needsAuthentication"));
                    item.put("createdAt", metadata.optString("createdAt", ""));
                    items.put(item);
                }
            }
            JSObject result = new JSObject();
            result.put("items", items);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Não foi possível ler os itens compartilhados.", "SHARED_INBOX_LIST_FAILED", error);
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        String id = call.getString("id");
        File directory = safeDirectory(id);
        if (directory == null) {
            call.reject("Identificador compartilhado inválido.", "SHARED_INBOX_INVALID_ID");
            return;
        }
        try {
            JSONObject metadata = readMetadata(directory);
            File payload = new File(directory, PAYLOAD_NAME);
            if (metadata == null || !payload.isFile()) throw new IOException("Item inexistente.");
            byte[] bytes = readBytes(payload);
            JSObject result = new JSObject();
            result.put("id", metadata.optString("id", id));
            result.put("name", metadata.optString("name", "arquivo"));
            result.put("size", bytes.length);
            result.put("type", metadata.optString("type", "application/octet-stream"));
            result.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("O item compartilhado não pôde ser lido.", "SHARED_INBOX_READ_FAILED", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        File directory = safeDirectory(call.getString("id"));
        if (directory == null) {
            call.reject("Identificador compartilhado inválido.", "SHARED_INBOX_INVALID_ID");
            return;
        }
        try {
            if (directory.exists() && !deleteRecursively(directory)) throw new IOException("Não foi possível remover o item.");
            call.resolve();
        } catch (Exception error) {
            call.reject("O item compartilhado não pôde ser removido.", "SHARED_INBOX_REMOVE_FAILED", error);
        }
    }

    private File safeDirectory(String id) {
        if (id == null || !id.matches("[0-9a-fA-F-]{36}")) return null;
        File candidate = new File(root(), id);
        try {
            String rootPath = root().getCanonicalPath() + File.separator;
            if (!candidate.getCanonicalPath().startsWith(rootPath)) return null;
        } catch (IOException error) {
            return null;
        }
        return candidate;
    }

    private JSONObject readMetadata(File directory) {
        try (FileInputStream input = new FileInputStream(new File(directory, META_NAME))) {
            byte[] bytes = readBytes(input);
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception error) {
            return null;
        }
    }

    private static byte[] readBytes(File file) throws IOException {
        try (FileInputStream input = new FileInputStream(file)) {
            return readBytes(input);
        }
    }

    private static byte[] readBytes(InputStream input) throws IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[64 * 1024];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        return output.toByteArray();
    }

    private static boolean deleteRecursively(File file) {
        if (file == null || !file.exists()) return true;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) if (!deleteRecursively(child)) return false;
        }
        return file.delete();
    }
}
