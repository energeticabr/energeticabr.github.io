package br.com.energetica.energetico;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class OAuthScopeSupportTest {
    @Test
    public void reusesTokenOnlyWhenEveryRequestedScopeWasGranted() {
        assertTrue(OAuthScopeSupport.covers(
            "openid profile email Sites.Read.All",
            Collections.singletonList("Sites.Read.All")));
        assertFalse(OAuthScopeSupport.covers(
            "openid profile email User.Read",
            Collections.singletonList("Sites.Read.All")));
    }

    @Test
    public void keepsGraphAndSharePointResourcesSeparate() {
        assertFalse(OAuthScopeSupport.covers(
            "Sites.Read.All",
            Collections.singletonList("https://energeticaltda.sharepoint.com/AllSites.Read")));
        assertFalse(OAuthScopeSupport.covers(
            "https://energeticaltda.sharepoint.com/AllSites.Read",
            Collections.singletonList("Sites.Read.All")));
        assertTrue(OAuthScopeSupport.covers(
            "openid https://energeticaltda.sharepoint.com/AllSites.Read profile",
            Arrays.asList("https://energeticaltda.sharepoint.com/AllSites.Read")));
    }

    @Test
    public void doesNotMatchPartialOrEmptyGrantedScopeTokens() {
        assertFalse(OAuthScopeSupport.covers("Sites.Read.All.Extra", Collections.singletonList("Sites.Read.All")));
        assertFalse(OAuthScopeSupport.covers("", Collections.singletonList("Sites.Read.All")));
        assertTrue(OAuthScopeSupport.covers("", Collections.emptyList()));
    }

    @Test
    public void incrementalAuthorizationMustKeepTheActiveAccount() {
        assertTrue(OAuthScopeSupport.matchesAccount("user-1.tenant-1", "user-1.tenant-1"));
        assertFalse(OAuthScopeSupport.matchesAccount("user-1.tenant-1", "user-2.tenant-1"));
        assertTrue(OAuthScopeSupport.matchesAccount("", "user-2.tenant-1"));
    }
}
