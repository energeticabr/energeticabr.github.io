package br.com.energetica.energetico;

import android.app.Activity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.vision.documentscanner.*;
import java.io.File;

@CapacitorPlugin(name = "DocumentScanner")
public final class DocumentScannerPlugin extends Plugin {
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private volatile PluginCall pending;
    private volatile boolean destroyed;
    private ScanCache cache;

    @Override public void load() {
        cache=new ScanCache(new File(getContext().getCacheDir(),"energetico-scanner"),60_000_000);
        // Registry overload without a LifecycleOwner is valid even after Activity STARTED.
        launcher=getActivity().getActivityResultRegistry().register("energetico-document-scanner",
            new ActivityResultContracts.StartIntentSenderForResult(), result -> {
                PluginCall call=pending;if(call==null)return;
                if(result.getResultCode()!=Activity.RESULT_OK){pending=null;call.resolve(new JSObject().put("items",new JSArray()));return;}
                GmsDocumentScanningResult scan=GmsDocumentScanningResult.fromActivityResultIntent(result.getData());
                if(scan==null||scan.getPages()==null){pending=null;call.reject("O scanner não devolveu páginas.","SCAN_FAILED");return;}
                new Thread(()->{
                    try {
                        ScanCache.Session session=cache.write(scan.getPages().size(),index->
                            getContext().getContentResolver().openInputStream(scan.getPages().get(index).getImageUri()));
                        getActivity().runOnUiThread(()->{
                            if(destroyed||pending!=call){cache.release(session.id);return;}
                            JSArray items=new JSArray();
                            for(int index=0;index<session.pages.size();index++){
                                ScanCache.Page page=session.pages.get(index);
                                items.put(new JSObject().put("id",session.id+"-"+(index+1)).put("uri",page.file.toURI().toString())
                                    .put("name",page.name).put("size",page.size).put("type","image/jpeg"));
                            }
                            pending=null;call.resolve(new JSObject().put("id",session.id).put("items",items));
                        });
                    }catch(Exception error){getActivity().runOnUiThread(()->fail(call,error,"SCAN_EXPORT_FAILED"));}
                },"energetico-scanner-copy").start();
            });
    }
    @PluginMethod public void scan(PluginCall call) {
        getActivity().runOnUiThread(()->{
            if(destroyed){call.reject("Scanner indisponível.","SCAN_UNSUPPORTED");return;}
            if(pending!=null){call.reject("Já existe um scanner aberto.","SCAN_IN_PROGRESS");return;}
            if(GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext())!=ConnectionResult.SUCCESS){
                call.reject("Scanner indisponível neste dispositivo.","SCAN_UNSUPPORTED");return;
            }
            pending=call;
            GmsDocumentScannerOptions options=new GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(false)
                .setPageLimit(20).setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
                .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build();
            GmsDocumentScanning.getClient(options).getStartScanIntent(getActivity())
                .addOnSuccessListener(sender->{
                    if(destroyed||pending!=call)return;
                    try{launcher.launch(new IntentSenderRequest.Builder(sender).build());}
                    catch(Exception error){fail(call,error,"SCAN_FAILED");}
                }).addOnFailureListener(error->fail(call,error,
                    error instanceof MlKitException&&((MlKitException)error).getErrorCode()==MlKitException.UNSUPPORTED?"SCAN_UNSUPPORTED":"SCAN_FAILED"));
        });
    }
    private void fail(PluginCall call,Exception error,String code) {
        if(pending!=call)return;pending=null;
        call.reject("Não foi possível abrir ou preparar o scanner. Tente novamente.",code,error);
    }
    @PluginMethod public void release(PluginCall call) {
        cache.release(call.getString("id",""));call.resolve();
    }
    @Override protected void handleOnDestroy() {
        destroyed=true;PluginCall call=pending;pending=null;
        if(call!=null)call.reject("Scanner encerrado.","SCAN_CANCELLED");
        if(launcher!=null)launcher.unregister();cache.releaseAll();super.handleOnDestroy();
    }
}
