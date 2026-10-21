package br.com.energetica.energetico;

import java.io.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

final class ScanCache {
    private static final String PROCESS_OWNER=UUID.randomUUID().toString();
    private static final String MARKER_PREFIX="ENERGETICO_SCAN_V1\n";
    interface PageInput { InputStream open(int index) throws IOException; }
    static final class Page {
        final File file; final String name; final long size;
        Page(File file, String name, long size) { this.file=file; this.name=name; this.size=size; }
    }
    static final class Session {
        final String id; final List<Page> pages;
        Session(String id, List<Page> pages) { this.id=id; this.pages=pages; }
    }
    private final File root;
    private final long maxBytes;
    private final String owner;
    private final Map<String,File> sessions=new HashMap<>();
    ScanCache(File root, long maxBytes) { this(root,maxBytes,PROCESS_OWNER); }
    ScanCache(File root, long maxBytes, String owner) {
        File resolved=root.getAbsoluteFile();try{resolved=root.getCanonicalFile();}catch(IOException ignored){}
        this.root=resolved;this.maxBytes=maxBytes;this.owner=owner;reclaimAbandonedSessions();
    }
    synchronized Session write(int count, PageInput input) throws IOException {
        if(count<1||count>20)throw new IOException("Escaneie de 1 a 20 páginas por vez.");
        String id=UUID.randomUUID().toString();
        File directory=new File(root,id);
        if(!directory.mkdirs())throw new IOException("Não foi possível preparar o scanner.");
        boolean committed=false;
        try {
            try(OutputStream marker=new FileOutputStream(new File(directory,".scanner-owner"))){marker.write((MARKER_PREFIX+owner).getBytes(StandardCharsets.UTF_8));}
            List<Page> pages=new ArrayList<>();long total=0;byte[] buffer=new byte[64*1024];
            for(int index=0;index<count;index++) {
                String name="documento-"+(index+1)+".jpg";File file=new File(directory,name);long size=0;
                try(InputStream source=input.open(index);OutputStream target=new FileOutputStream(file)) {
                    if(source==null)throw new IOException("Página do scanner indisponível.");
                    int read;
                    while((read=source.read(buffer))!=-1) {
                        total+=read;size+=read;
                        if(total>maxBytes)throw new IOException("O documento escaneado ultrapassa o limite de 60 MB.");
                        target.write(buffer,0,read);
                    }
                }
                if(size==0)throw new IOException("Página do scanner vazia.");
                pages.add(new Page(file,name,size));
            }
            sessions.put(id,directory);committed=true;return new Session(id,pages);
        } finally { if(!committed)deleteOwnedDirectory(directory); }
    }
    synchronized void release(String id) {
        File directory=sessions.remove(id);if(directory!=null)deleteOwnedDirectory(directory);
    }
    synchronized void releaseAll() {
        for(File directory:sessions.values())deleteOwnedDirectory(directory);sessions.clear();
    }
    private void reclaimAbandonedSessions() {
        File[] entries=root.listFiles();if(entries==null)return;
        for(File entry:entries)try{
            if(!entry.isDirectory()||!canonicalUUID(entry.getName())||!entry.getCanonicalFile().equals(entry.getAbsoluteFile()))continue;
            File marker=new File(entry,".scanner-owner");
            if(!marker.isFile()||marker.length()>=128||!marker.getCanonicalFile().equals(marker.getAbsoluteFile()))continue;
            byte[] bytes=new byte[128];int length;
            try(InputStream input=new FileInputStream(marker)){length=input.read(bytes);}
            if(length<=0)continue;String value=new String(bytes,0,length,StandardCharsets.UTF_8);
            if(!value.startsWith(MARKER_PREFIX))continue;
            String previousOwner=value.substring(MARKER_PREFIX.length());
            if(canonicalUUID(previousOwner)&&!previousOwner.equals(owner))deleteOwnedDirectory(entry);
        }catch(IOException ignored){/* Cache reclamation is best effort, never delete unverified paths. */}
    }
    private static boolean canonicalUUID(String value) {
        try{return UUID.fromString(value).toString().equalsIgnoreCase(value);}catch(IllegalArgumentException error){return false;}
    }
    private void deleteOwnedDirectory(File directory) {
        // Only directories constructed internally or retrieved from the owned-token map reach here.
        File[] files=directory.listFiles();if(files!=null)for(File file:files)file.delete();directory.delete();
    }
}
