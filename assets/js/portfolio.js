const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const motion = matchMedia("(prefers-reduced-motion: reduce)");

const home = $(".home-template");
const entrance = $("#entrance");
const searchDialog = $("#search-dialog");
const searchInput = $("#search-input");
const searchResults = $("#search-results");
const content = $("#main-content");
let signalFrame;
let introTimer;
let entranceAnimations = [];

function safeFocusMain() {
  content?.focus({ preventScroll: true });
}

function finishEntrance(animate = true, explicit = false) {
  clearTimeout(introTimer);
  entranceAnimations.forEach((animation) => animation.cancel());
  entranceAnimations = [];
  if (entrance?.open) entrance.close();
  try {
    sessionStorage.setItem("2202-intro-seen", "1");
  } catch {}
  if (animate && home) heroMotion(explicit);
}

function heroMotion(explicit = false) {
  if (!home || (motion.matches && !explicit)) return;
  const options = { duration: 650, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" };
  [
    [".hero-copy h1", 0],
    [".hero-copy h2", 180],
    [".hero-copy p:not(.eyebrow)", 300],
    [".location", 380],
    [".hero-art", 420],
    [".hero-bottom", 560]
  ].forEach(([selector, delay]) => {
    $(selector)?.animate([{ opacity: 0, transform: "translateY(22px)" }, { opacity: 1, transform: "none" }], { ...options, delay });
  });

  cancelAnimationFrame(signalFrame);
  const path = $("#signal-path");
  const dot = $("#signal");
  if (!path || !dot) return;
  const length = path.getTotalLength();
  let begin;
  function frame(time) {
    if (!begin) begin = time;
    const progress = (time - begin - 650) / 1300;
    if (progress < 0) {
      signalFrame = requestAnimationFrame(frame);
      return;
    }
    if (progress >= 1) {
      dot.style.opacity = 0;
      return;
    }
    const point = path.getPointAtLength(progress * length);
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
    dot.style.opacity = 1;
    signalFrame = requestAnimationFrame(frame);
  }
  signalFrame = requestAnimationFrame(frame);
}

function startEntrance(explicit = false) {
  if (!home || (motion.matches && !explicit)) return;
  clearTimeout(introTimer);
  entranceAnimations.forEach((animation) => animation.cancel());
  if (!entrance.open) entrance.showModal();
  entranceAnimations = [
    $(".entrance-title").animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 420, fill: "both" }),
    $(".entrance-title > span").animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 650, fill: "both", easing: "ease-out" })
  ];
  introTimer = setTimeout(() => finishEntrance(true, explicit), 1100);
}

function filterArticles(topic) {
  const cards = $$("[data-article-card]");
  let shown = 0;
  cards.forEach((card) => {
    const match = topic === "All" || card.dataset.topics.toLowerCase().includes(topic.toLowerCase());
    card.hidden = !match;
    if (match) shown += 1;
  });
  $$("[data-topic]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.topic === topic)));
  $("[data-empty-articles]")?.toggleAttribute("hidden", shown > 0);
  if (!motion.matches) {
    $("#article-list")?.animate([{ opacity: 0, transform: "translateX(8px)" }, { opacity: 1, transform: "none" }], { duration: 220 });
  }
}

const searchIndex = [
  { title: "Home", type: "PAGE", href: "/" },
  { title: "Experience", type: "PAGE", href: "/#experience" },
  { title: "Projects", type: "PAGE", href: "/#projects" },
  { title: "Articles", type: "PAGE", href: "/#articles" },
  { title: "Contact", type: "PAGE", href: "/#contact" },
  { title: "Splunk Utility Tool 4.0", type: "PROJECT", href: "/projects/splunk-utility-tool.html" },
  { title: "Operational Log Onboarding", type: "PROJECT", href: "/projects/log-onboarding-governance.html" },
  { title: "Splunk Platform Maintenance Automation", type: "PROJECT", href: "/projects/splunk-platform-maintenance-automation.html" },
  { title: "Timesheet Reconciliation & Reporting", type: "PROJECT", href: "/projects/timesheet-workflow-automation.html" },
  { title: "From Search to Detection", type: "ARTICLE", href: "/articles/from-search-to-detection/" },
  { title: "Splunk", type: "TOPIC", href: "/#articles", topic: "Splunk" },
  { title: "Detection", type: "TOPIC", href: "/#articles", topic: "Detection" },
  { title: "Reliability", type: "TOPIC", href: "/#articles", topic: "Reliability" },
  { title: "SRE", type: "TOPIC", href: "/#articles", topic: "SRE" },
  { title: "AI", type: "TOPIC", href: "/#articles", topic: "AI" }
];
let activeResult = 0;
let lastFocus;

function drawResults() {
  const query = searchInput.value.trim().toLowerCase();
  const results = searchIndex.filter((item) => `${item.type} ${item.title}`.toLowerCase().includes(query)).slice(0, 9);
  activeResult = Math.min(activeResult, Math.max(results.length - 1, 0));
  searchResults.innerHTML = results.length ? results.map((item, index) => `<button class="search-result ${index === activeResult ? "selected" : ""}" type="button" data-result="${index}"><span>${item.title}</span><small>${item.type}</small></button>`).join("") : '<p class="empty">No results. Try “Splunk” or “projects”.</p>';
  $$("[data-result]", searchResults).forEach((button) => {
    button.addEventListener("click", () => activateResult(results[Number(button.dataset.result)]));
  });
  return results;
}

function activateResult(item) {
  if (!item) return;
  closeSearch();
  if (item.topic) {
    filterArticles(item.topic);
  }
  window.location.href = item.href;
}

function openSearch() {
  lastFocus = document.activeElement;
  if (entrance?.open) finishEntrance(false);
  searchDialog.showModal();
  activeResult = 0;
  searchInput.value = "";
  drawResults();
  searchInput.focus();
}

function closeSearch() {
  if (searchDialog?.open) searchDialog.close();
  lastFocus?.focus?.();
}

function updateProgress() {
  const bar = $(".reading-progress");
  if (!bar) return;
  const max = document.documentElement.scrollHeight - innerHeight;
  const pct = max > 0 ? (scrollY / max) * 100 : 0;
  bar.style.width = `${pct}%`;
}

document.addEventListener("DOMContentLoaded", () => {
  $(".skip-link")?.addEventListener("click", (event) => {
    event.preventDefault();
    content?.scrollIntoView();
    safeFocusMain();
  });

  $$("[data-topic]").forEach((button) => button.addEventListener("click", () => filterArticles(button.dataset.topic)));
  $("[data-topic-reset]")?.addEventListener("click", () => filterArticles("All"));

  $(".search-open")?.addEventListener("click", openSearch);
  $("#close-search")?.addEventListener("click", closeSearch);
  searchDialog?.addEventListener("click", (event) => {
    if (event.target === searchDialog) closeSearch();
  });
  searchDialog?.addEventListener("close", () => lastFocus?.focus?.());
  searchInput?.addEventListener("input", () => {
    activeResult = 0;
    drawResults();
  });
  searchInput?.addEventListener("keydown", (event) => {
    const results = drawResults();
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
      event.preventDefault();
      activeResult = (activeResult + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      drawResults();
    }
    if (event.key === "Enter" && results[activeResult]) {
      event.preventDefault();
      activateResult(results[activeResult]);
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchDialog.open ? closeSearch() : openSearch();
    }
  });

  $("#skip-intro")?.addEventListener("click", () => finishEntrance(false));
  entrance?.addEventListener("cancel", () => finishEntrance(false));
  $("#replay")?.addEventListener("click", () => startEntrance(true));
  if (motion.matches) $("#replay") && ($("#replay").textContent = "▶ Play intro (motion)");
  let seen = false;
  try {
    seen = sessionStorage.getItem("2202-intro-seen") === "1";
  } catch {}
  if (!seen && home && !motion.matches) startEntrance();
  motion.addEventListener("change", () => {
    if (motion.matches) {
      finishEntrance(false);
      cancelAnimationFrame(signalFrame);
      $("#signal") && ($("#signal").style.opacity = 0);
    }
    $("#replay") && ($("#replay").textContent = motion.matches ? "▶ Play intro (motion)" : "↻ Replay intro");
  });

  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();
});
