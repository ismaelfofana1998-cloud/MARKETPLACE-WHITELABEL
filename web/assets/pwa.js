if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", async () => {
    try {
      const enregistrement = await navigator.serviceWorker.register(
        "../service-worker.js",
        { updateViaCache: "none" },
      );
      await enregistrement.update();
    } catch {
      // L'application web reste utilisable sans mode hors connexion.
    }
  });
}
