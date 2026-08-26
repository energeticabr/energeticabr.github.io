export function createPageLifecycle() {
  let currentPage;

  function dispose() {
    currentPage?.cleanup?.();
    currentPage = undefined;
  }

  function activate(page) {
    dispose();
    currentPage = page;
    return page;
  }

  function replace(render) {
    dispose();
    currentPage = render?.();
    return currentPage;
  }

  return Object.freeze({ activate, replace, dispose });
}
