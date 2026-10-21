package br.com.energetica.energetico;

import java.io.*;
import java.util.*;

final class ScanCache {
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
    private final Map<String,File> sessions=new HashMap<>();
    ScanCache(File root, long maxBytes) { this.root=root; this.maxBytes=maxBytes; }
    synchronized Session write(int count, PageInput input) throws IOException {
        if(count<1||count>20)throw new IOException("Escaneie de 1 a 20 páginas por vez.");
        String id=UUID.randomUUID().toString();
        File directory=new File(root,id);
        if(!directory.mkdirs())throw new IOException("Não foi possível preparar o scanner.");
        boolean committed=false;
        try {
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
    private void deleteOwnedDirectory(File directory) {
        // Only directories constructed internally or retrieved from the owned-token map reach here.
        File[] files=directory.listFiles();if(files!=null)for(File file:files)file.delete();directory.delete();
    }
}
