(() => {
  const brand = document.querySelector(".brand");
  if (!brand) return;

  let tapCount = 0;
  let tapTimer = null;

  brand.addEventListener("click", (event) => {
    event.preventDefault();

    tapCount += 1;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      tapCount = 0;
    }, 1500);

    if (tapCount >= 5) {
      tapCount = 0;
      clearTimeout(tapTimer);
      if (typeof showScreen === "function") showScreen("admin");
    }
  });
})();
