/** Group existing controls without replacing their handlers or navigation guards. */
export function applyScreenNavigation({ header, back, home, title }) {
  const doc = header.ownerDocument;
  const navigation = doc.createElement("nav");
  navigation.className = "screen-navigation";
  navigation.setAttribute("aria-label", "Navegação da tela");
  for (const [control, label, icon] of [[back, "Voltar", "↩️"], [home, "Início", "🏠"]]) {
    if (!control) continue;
    control.type = "button";
    control.classList.add("screen-nav-button");
    control.dataset.navigationIcon = icon;
    const accessibleLabel = control.getAttribute("aria-label") || label;
    control.setAttribute("aria-label", accessibleLabel);
    control.title = accessibleLabel;
    const caption = doc.createElement("span");
    caption.className = "screen-nav-label";
    caption.textContent = label;
    control.replaceChildren(caption);
    navigation.append(control);
  }
  title.classList.add("screen-navigation-title");
  header.classList.add("screen-navigation-header");
  header.prepend(navigation);
  navigation.after(title);
  return navigation;
}
