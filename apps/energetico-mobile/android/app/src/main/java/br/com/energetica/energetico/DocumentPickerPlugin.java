package br.com.energetica.energetico;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Android document chooser matching the shared DocumentPicker bridge. */
@CapacitorPlugin(name = "DocumentPicker")
public class DocumentPickerPlugin extends Plugin {
    private static final int REQUEST_CODE = 4301;
    private static volatile DocumentPickerPlugin instance;
    private PluginCall pendingCall;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @PluginMethod
    public void pick(PluginCall call) {
        if (pendingCall != null) {
            call.reject("Já existe uma seleção de arquivos em andamento.", "PICK_IN_PROGRESS");
            return;
        }
        pendingCall = call;
        Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        picker.addCategory(Intent.CATEGORY_OPENABLE);
        picker.setType("*/*");
        picker.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            getActivity().startActivityForResult(picker, REQUEST_CODE);
        } catch (Exception error) {
            pendingCall = null;
            call.reject("Não foi possível abrir o seletor de arquivos.", "PICKER_UNAVAILABLE", error);
        }
    }

    /** Called by MainActivity after ACTION_OPEN_DOCUMENT returns. */
    public static void handleActivityResult(int requestCode, int resultCode, Intent data) {
        DocumentPickerPlugin plugin = instance;
        if (plugin == null || requestCode != REQUEST_CODE) return;
        PluginCall call = plugin.pendingCall;
        plugin.pendingCall = null;
        if (call == null) return;
        if (resultCode != Activity.RESULT_OK || data == null) {
            call.resolve(new JSObject().put("items", new JSArray()));
            return;
        }
        List<Uri> uris = extractUris(data);
        Context context = plugin.getContext().getApplicationContext();
        new Thread(() -> {
            try {
                JSArray items = new JSArray();
                for (Uri uri : uris) items.put(copyUri(context, uri));
                JSObject result = new JSObject();
                result.put("items", items);
                plugin.getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception error) {
                plugin.getActivity().runOnUiThread(() -> call.reject(
                    "Não foi possível preparar o arquivo selecionado.", "DOCUMENT_COPY_FAILED", error));
            }
        }, "energetico-document-picker").start();
    }

    private static List<Uri> extractUris(Intent data) {
        List<Uri> uris = new ArrayList<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                Uri uri = clipData.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        Uri single = data.getData();
        if (single == null) single = data.getParcelableExtra(Intent.EXTRA_STREAM);
        if (single != null && !uris.contains(single)) uris.add(single);
        return uris;
    }

    private static JSObject copyUri(Context context, Uri source) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        String id = UUID.randomUUID().toString();
        File directory = new File(new File(context.getCacheDir(), "energetico-picker"), id);
        if (!directory.mkdirs() && !directory.isDirectory()) throw new IOException("Não foi possível preparar o arquivo.");
        String name = displayName(resolver, source);
        if (name.isEmpty()) name = "arquivo-" + id;
        File destination = new File(directory, safeName(name));
        long size = 0;
        try (InputStream input = resolver.openInputStream(source)) {
            if (input == null) throw new IOException("O arquivo selecionado não está disponível.");
            try (OutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    size += read;
                    if (size > 60_000_000L) throw new IOException("O anexo excede 60 MB.");
                    output.write(buffer, 0, read);
                }
            }
        } catch (Exception error) {
            deleteRecursively(directory);
            if (error instanceof IOException) throw (IOException) error;
            throw new IOException("Não foi possível copiar o arquivo selecionado.", error);
        }
        JSObject result = new JSObject();
        result.put("id", id);
        result.put("uri", destination.toURI().toString());
        result.put("name", name);
        result.put("size", size);
        result.put("type", resolver.getType(source) == null ? "application/octet-stream" : resolver.getType(source));
        return result;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return String.valueOf(cursor.getString(0));
        } catch (Exception ignored) { }
        String last = uri.getLastPathSegment();
        return last == null ? "" : last;
    }

    private static String safeName(String value) {
        String cleaned = value.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "-").trim();
        return cleaned.isEmpty() ? "arquivo" : cleaned.substring(0, Math.min(180, cleaned.length()));
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) for (File child : children) deleteRecursively(child);
        }
        file.delete();
    }
}
