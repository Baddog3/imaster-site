(() => {
  const region = document.querySelector(".promotions");
  if (!region) return;
  const slides = [...region.querySelectorAll(".promo-slide")];
  if (slides.length < 2) return;

  const controls = region.querySelector(".promo-controls");
  const dotsContainer = region.querySelector(".promo-dots");
  const playback = region.querySelector("[data-promo-play]");
  const status = region.querySelector(".promo-status");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;
  let paused = false;
  let timer;

  const dots = slides.map((slide, index) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "promo-dot";
    dot.setAttribute("aria-label", slide.getAttribute("aria-label"));
    dot.setAttribute("aria-controls", "promo-slides");
    dot.addEventListener("click", () => navigate(index));
    dotsContainer.append(dot);
    return dot;
  });

  function show(index, announce = false) {
    active = (index + slides.length) % slides.length;
    slides.forEach((slide, position) => {
      slide.setAttribute("aria-hidden", String(position !== active));
      dots[position].setAttribute("aria-pressed", String(position === active));
    });
    if (announce) {
      status.textContent = `Акция ${active + 1} из ${slides.length}. ${slides[active].getAttribute("aria-label")}.`;
    }
  }

  function schedule() {
    window.clearTimeout(timer);
    if (paused || motion.matches || document.hidden || region.matches(":hover, :focus-within")) return;
    timer = window.setTimeout(() => {
      show(active + 1);
      schedule();
    }, 8000);
  }

  function navigate(index) {
    if (slides[active].contains(document.activeElement)) {
      dots[(index + slides.length) % slides.length].focus();
    }
    show(index, true);
    schedule();
  }

  function updatePlayback() {
    playback.textContent = paused ? "Автопрокрутка" : "Пауза";
    playback.setAttribute("aria-label", paused ? "Включить автопрокрутку" : "Остановить автопрокрутку");
    schedule();
  }

  playback.addEventListener("click", () => {
    paused = !paused;
    updatePlayback();
  });
  region.querySelector("[data-promo-prev]").addEventListener("click", () => navigate(active - 1));
  region.querySelector("[data-promo-next]").addEventListener("click", () => navigate(active + 1));
  region.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    navigate(active + (event.key === "ArrowRight" ? 1 : -1));
  });

  region.addEventListener("mouseenter", schedule);
  region.addEventListener("mouseleave", schedule);
  region.addEventListener("focusin", schedule);
  region.addEventListener("focusout", () => window.setTimeout(schedule, 0));
  document.addEventListener("visibilitychange", schedule);
  function updateMotionPreference() {
    playback.hidden = motion.matches;
    schedule();
  }

  motion.addEventListener("change", updateMotionPreference);

  region.querySelector(".promo-slides").setAttribute("data-carousel", "");
  show(0);
  updateMotionPreference();
  controls.hidden = false;
  updatePlayback();
})();
