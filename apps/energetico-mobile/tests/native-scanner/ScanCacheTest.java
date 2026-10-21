package br.com.energetica.energetico;
import java.io.*;
import java.nio.file.*;
public final class ScanCacheTest {
  public static void main(String[] args) throws Exception {
    Path root=Files.createTempDirectory("scanner-test-");
    byte[] jpeg={(byte)255,(byte)216,(byte)255,(byte)217};
    ScanCache cache=new ScanCache(root.resolve("owned").toFile(),12);
    ScanCache.Session session=cache.write(2,index->new ByteArrayInputStream(jpeg));
    if(session.pages.size()!=2||session.pages.get(0).size!=4||!session.pages.get(1).name.equals("documento-2.jpg"))throw new AssertionError("pages");
    if(!java.util.Arrays.equals(Files.readAllBytes(session.pages.get(0).file.toPath()),jpeg))throw new AssertionError("bytes");
    Path sentinel=root.resolve("keep.txt");Files.write(sentinel,new byte[]{1});
    cache.release("../keep.txt");if(!Files.exists(sentinel))throw new AssertionError("unsafe delete");
    cache.release(session.id);if(session.pages.get(0).file.exists())throw new AssertionError("cleanup");
    for(int count:new int[]{0,21,4}){
      boolean failed=false;try{cache.write(count,index->new ByteArrayInputStream(jpeg));}catch(IOException ex){failed=true;}
      if(!failed)throw new AssertionError("bounds");
    }
    boolean failed=false;try{cache.write(2,index->{if(index==1)throw new IOException("synthetic");return new ByteArrayInputStream(jpeg);});}catch(IOException ex){failed=true;}
    if(!failed||root.resolve("owned").toFile().list().length!=0)throw new AssertionError("atomic rollback");
    Files.delete(root.resolve("owned"));Files.delete(sentinel);Files.delete(root);
    System.out.println("PASS: native scanner ordered pages, byte/page limits, atomic rollback and scoped cleanup");
  }
}
