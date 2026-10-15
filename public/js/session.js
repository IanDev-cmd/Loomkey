(function () {
  const KEY = "loomkey_token";
  function token() {
    return localStorage.getItem(KEY) || "dev-owner";
  }
  async function session() {
    const res = await fetch("/api/session", { headers: { Authorization: "Bearer " + token() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Please sign in.");
    return data;
  }
  window.Loomkey = window.Loomkey || {};
  window.Loomkey.Session = { token, session };
})();
