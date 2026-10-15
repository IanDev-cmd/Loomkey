(function () {
  const id = location.pathname.split("/").filter(Boolean).pop();
  const params = new URLSearchParams(location.search);
  document.querySelectorAll("[data-pay-booking]").forEach((button) => {
    button.setAttribute("data-pay-booking", id);
    const token = params.get("token");
    if (token) button.setAttribute("data-pay-token", token);
  });
  const title = document.querySelector("#pay-title");
  if (title) title.textContent = "Pay booking " + id;
  document.querySelectorAll("[data-qr='pay']").forEach((img) => img.setAttribute("data-booking", id));
  window.Loomkey.Payments.init({
    publicKey: (window.LOOMKEY_CONFIG && window.LOOMKEY_CONFIG.publicKey) || "",
    apiBase: "/api",
    brand: { title: "Loomkey", description: "Booking payment" },
    getAuthToken: () => (window.Loomkey.Session ? window.Loomkey.Session.token() : ""),
    onSuccess: (result) => {
      const el = document.querySelector("#status");
      el.textContent = "Payment verified for " + (result.bookingId || id) + ".";
      el.className = "ok";
    },
    onFailure: (err) => {
      const el = document.querySelector("#status");
      el.textContent = err && err.cancelled ? "Payment window closed." : (err && err.message) || "Payment failed.";
      el.className = "bad";
    },
    onClose: () => {
      const el = document.querySelector("#status");
      el.textContent = "Payment window closed.";
      el.className = "bad";
    },
  });
})();
