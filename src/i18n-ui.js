function localizePage(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const msg = browser.i18n.getMessage(el.getAttribute("data-i18n"));
    if (msg) {
      el.textContent = msg;
    }
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const msg = browser.i18n.getMessage(el.getAttribute("data-i18n-placeholder"));
    if (msg) {
      el.placeholder = msg;
    }
  });

  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const msg = browser.i18n.getMessage(el.getAttribute("data-i18n-title"));
    if (msg) {
      el.title = msg;
      el.setAttribute("aria-label", msg);
    }
  });
}

function renderAdminLoginMessage(el, booruUrl, { beforeKey, linkKey, afterKey }) {
  const adminUrl = adminUrlFromBooruUrl(booruUrl);
  const before = browser.i18n.getMessage(beforeKey);
  const linkText = browser.i18n.getMessage(linkKey);
  const after = browser.i18n.getMessage(afterKey);

  el.replaceChildren();

  if (before) {
    el.appendChild(document.createTextNode(before));
  }

  if (adminUrl) {
    const link = document.createElement("a");
    link.href = adminUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = linkText;
    el.appendChild(link);
  } else {
    el.appendChild(document.createTextNode(linkText));
  }

  if (after) {
    el.appendChild(document.createTextNode(after));
  }
}
