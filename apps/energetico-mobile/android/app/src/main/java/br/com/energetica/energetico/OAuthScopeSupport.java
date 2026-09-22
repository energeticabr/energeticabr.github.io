package br.com.energetica.energetico;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/** Helpers for keeping cached OAuth access tokens bound to their granted API scopes. */
final class OAuthScopeSupport {
    private OAuthScopeSupport() {}

    static List<String> normalize(Collection<String> scopes) {
        Set<String> unique = new LinkedHashSet<>();
        if (scopes != null) {
            for (String scope : scopes) {
                if (scope == null) continue;
                String value = scope.trim();
                if (!value.isEmpty()) unique.add(value);
            }
        }
        return new ArrayList<>(unique);
    }

    static List<String> parse(String scopes) {
        if (scopes == null || scopes.trim().isEmpty()) return new ArrayList<>();
        String[] values = scopes.trim().split("\\s+");
        List<String> parsed = new ArrayList<>();
        for (String value : values) parsed.add(value);
        return normalize(parsed);
    }

    static List<String> withOpenIdScopes(Collection<String> scopes) {
        List<String> result = normalize(scopes);
        if (!result.contains("openid")) result.add("openid");
        if (!result.contains("profile")) result.add("profile");
        if (!result.contains("email")) result.add("email");
        if (!result.contains("offline_access")) result.add("offline_access");
        return result;
    }

    static boolean covers(String grantedScopes, Collection<String> requestedScopes) {
        Set<String> granted = new LinkedHashSet<>(parse(grantedScopes));
        for (String requested : normalize(requestedScopes)) {
            if (!granted.contains(requested)) return false;
        }
        return true;
    }

    static boolean matchesAccount(String expectedHomeAccountId, String actualHomeAccountId) {
        String expected = expectedHomeAccountId == null ? "" : expectedHomeAccountId.trim();
        String actual = actualHomeAccountId == null ? "" : actualHomeAccountId.trim();
        return expected.isEmpty() || expected.equals(actual);
    }
}
