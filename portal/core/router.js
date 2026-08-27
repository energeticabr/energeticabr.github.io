export const PORTAL_ROUTES = Object.freeze([
  Object.freeze({ name: "dashboard", pattern: Object.freeze(["dashboard"]) }),
  Object.freeze({ name: "audit", pattern: Object.freeze(["audit"]) }),
  Object.freeze({ name: "module", pattern: Object.freeze(["module", ":moduleId"]) }),
  Object.freeze({ name: "entity", pattern: Object.freeze(["entity", ":entityId"]) }),
  Object.freeze({ name: "item", pattern: Object.freeze(["entity", ":entityId", "item", ":itemId"]) }),
  Object.freeze({ name: "reports", pattern: Object.freeze(["reports"]) }),
  Object.freeze({ name: "analytics", pattern: Object.freeze(["analytics", ":panelId"]) }),
  Object.freeze({ name: "access", pattern: Object.freeze(["access"]) }),
]);

function dashboardRoute(flags = {}) {
  return { name: "dashboard", params: {}, hash: "#/dashboard", ...flags };
}

function safeSegments(hash) {
  const value = String(hash || "").trim().replace(/^#/, "");
  const path = value.replace(/^\/+|\/+$/g, "");
  if (!path) return ["dashboard"];
  try {
    return path.split("/").map(segment => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function routeFromSegments(routes, segments) {
  for (const definition of routes) {
    if (definition.pattern.length !== segments.length) continue;
    const params = {};
    let match = true;
    for (let index = 0; index < definition.pattern.length; index += 1) {
      const part = definition.pattern[index];
      const segment = segments[index];
      if (part.startsWith(":")) {
        if (!segment) {
          match = false;
          break;
        }
        params[part.slice(1)] = segment;
      } else if (part !== segment) {
        match = false;
        break;
      }
    }
    if (match) return { name: definition.name, params };
  }
  return null;
}

function routeHash(routes, name, params = {}) {
  const definition = routes.find(candidate => candidate.name === name);
  if (!definition) throw new RangeError(`Rota desconhecida: ${name}`);
  const parts = definition.pattern.map(part => {
    if (!part.startsWith(":")) return part;
    const value = params[part.slice(1)];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new RangeError(`Parametro obrigatorio ausente: ${part.slice(1)}`);
    }
    return encodeURIComponent(String(value));
  });
  return `#/${parts.join("/")}`;
}

export function createRouter(routes = PORTAL_ROUTES, options = {}) {
  const definitions = Object.freeze([...routes]);
  const browser = options.window || globalThis.window;
  const canRoute = options.canRoute || (() => true);
  const subscribers = new Set();

  function parse(hash = browser?.location?.hash || "") {
    const segments = safeSegments(hash);
    if (!segments) return dashboardRoute({ fallback: true });
    const candidate = routeFromSegments(definitions, segments);
    if (!candidate) return dashboardRoute({ fallback: true });
    const route = { ...candidate, hash: routeHash(definitions, candidate.name, candidate.params) };
    return canRoute(route) ? route : dashboardRoute({ fallback: true, denied: true });
  }

  function href(name, params = {}) {
    return routeHash(definitions, name, params);
  }

  function navigate(name, params = {}) {
    const hash = href(name, params);
    if (browser?.location) browser.location.hash = hash;
    return hash;
  }

  function notify() {
    const route = parse();
    subscribers.forEach(listener => listener(route));
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("O assinante de rota deve ser uma funcao.");
    subscribers.add(listener);
    browser?.addEventListener?.("hashchange", notify);
    listener(parse());
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) browser?.removeEventListener?.("hashchange", notify);
    };
  }

  return Object.freeze({ parse, href, navigate, subscribe });
}
