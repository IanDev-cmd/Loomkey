(function () {
  const links = [
    { href: "/listings", label: "Listings", icon: '<path d="M4 10v4.2h3.2L20 20V4L7.2 10H4z"/><path d="M8 15.2 9.4 20"/>' },
    { href: "/dashboard", label: "Dashboard", icon: '<circle cx="12" cy="12" r="8"/><path d="M12 12l4-3.4"/>' },
    { href: "/providers", label: "Providers", icon: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5M8 16.5h3"/>' },
    { href: "/users", label: "Users", icon: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.4-3.2 2.6-5 5.5-5s5.1 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.2c2.2 0 4 1.4 4.4 4"/>' },
    { href: "/billing", label: "Billing", icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>' },
    { href: "/settings", label: "Settings", icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>' },
  ];
  const side = document.querySelector("#side");
  if (!side) return;
  const path = location.pathname;
  side.innerHTML =
    links.map((item) => {
      const on = path === item.href;
      return '<a class="navlink" href="' + item.href + '" aria-label="' + item.label + '" title="' + item.label + '"' +
        (on ? ' aria-current="page"' : "") + '><svg viewBox="0 0 24 24" aria-hidden="true">' + item.icon +
        "</svg><span>" + item.label + "</span></a>";
    }).join("") +
    '<label class="actor"><select id="actor" aria-label="Signed-in actor">' +
    '<option value="dev-owner">Owner</option>' +
    '<option value="dev-admin">Admin</option>' +
    '<option value="dev-guest">Guest</option>' +
    "</select></label>";
  const select = document.querySelector("#actor");
  const key = "loomkey_token";
  select.value = localStorage.getItem(key) || "dev-owner";
  if (!localStorage.getItem(key)) localStorage.setItem(key, "dev-owner");
  select.addEventListener("change", () => {
    localStorage.setItem(key, select.value);
    location.reload();
  });
})();
