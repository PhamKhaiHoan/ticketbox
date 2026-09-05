(function startTicketboxAssistant() {
  "use strict";

  if (window.top !== window || window.__ticketboxAssistantLoaded) return;
  window.__ticketboxAssistantLoaded = true;

  const Core = globalThis.TicketboxAssistantCore;
  const CONFIG_KEY = "ticketboxConfig";
  const RUNTIME_KEY = "ticketboxRuntime";
  const HIGHLIGHT_CLASS = "tbx-assistant-highlight";
  const MIN_ALERT_INTERVAL = 2_500;
  const INTERACTIVE_SELECTOR = [
    "button",
    "a[href]",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
    "[tabindex]",
    "[onclick]",
    "[aria-label]",
    "[title]",
    "[data-seat]",
    "[data-seat-name]",
    "[data-ticket-name]"
  ].join(",");

  let config = Core.sanitizeConfig();
  let runtime = { armed: false };
  let pageState = "unknown";
  let recommendation = null;
  let highlightedElement = null;
  let analyzeTimer = null;
  let lastAlertAt = 0;
  let minimized = false;
  let panel = null;
  const rejectedSeats = new Set();

  initialize().catch(() => undefined);

  async function initialize() {
    const [syncStored, localStored] = await Promise.all([
      chrome.storage.sync.get(CONFIG_KEY),
      chrome.storage.local.get(RUNTIME_KEY)
    ]);
    config = Core.sanitizeConfig(syncStored[CONFIG_KEY]);
    runtime = localStored[RUNTIME_KEY] || { armed: false };

    createPanel();
    analyzePage();
    setInterval(updatePanel, 1_000);

    const observer = new MutationObserver(scheduleAnalysis);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled", "aria-selected", "class"]
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes[CONFIG_KEY]) {
        config = Core.sanitizeConfig(changes[CONFIG_KEY].newValue);
        rejectedSeats.clear();
        scheduleAnalysis();
      }
      if (areaName === "local" && changes[RUNTIME_KEY]) {
        runtime = changes[RUNTIME_KEY].newValue || { armed: false };
        updatePanel();
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "GET_PAGE_STATUS") {
      sendResponse({
        ok: true,
        pageState,
        stateLabel: Core.stateLabel(pageState),
        recommendation: recommendation?.label || "",
        url: location.href
      });
      return false;
    }

    if (message?.type === "LOCATE_RECOMMENDATION") {
      const located = locateRecommendation();
      sendResponse({ ok: located });
      return false;
    }

    if (message?.type === "REFRESH_CONFIG") {
      chrome.storage.sync.get(CONFIG_KEY).then((stored) => {
        config = Core.sanitizeConfig(stored[CONFIG_KEY]);
        scheduleAnalysis();
        sendResponse({ ok: true });
      });
      return true;
    }

    return false;
  });

  function scheduleAnalysis() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(analyzePage, 180);
  }

  function analyzePage() {
    const rawText = document.body?.innerText || "";
    const nextState = Core.classifyPageText(rawText);
    const previousState = pageState;
    pageState = nextState;

    if (nextState === "seat_conflict") rememberRejectedSeat(rawText);
    recommendation = buildRecommendation(nextState, rawText);
    applyHighlight(recommendation?.element || null);

    if (previousState !== nextState) {
      handleStateChange(nextState);
    }
    updatePanel();
  }

  function buildRecommendation(state, rawText) {
    if (state === "captcha") {
      const captchaElement = findCaptchaContainer();
      return target(
        captchaElement,
        captchaElement ? "Đưa tới hộp xác minh CAPTCHA" : "",
        "Tự kéo mũi tên và ghép/xoay hình cho khớp. Trợ lý sẽ tiếp tục ngay khi Ticketbox xác minh xong."
      );
    }
    if (state === "queue") {
      return note("Giữ nguyên trang và chờ Ticketbox chuyển tiếp; không tải lại hàng chờ.");
    }
    if (state === "customer_info") {
      return note("Đã đạt mục tiêu: trang điền thông tin. Trợ lý không điền hoặc thanh toán thay bạn.");
    }
    if (state === "payment") {
      return note("Đã tới trang thanh toán. Hãy tự kiểm tra vé, tổng tiền và phương thức thanh toán.");
    }
    if (state === "seat_conflict") {
      const closeButton = findBestTextElement(["Chọn ghế khác", "OK", "Đóng"]);
      return target(
        closeButton,
        closeButton ? "Đưa tới nút chọn ghế khác" : "Đóng thông báo rồi chọn ghế ưu tiên tiếp theo.",
        "Ghế vừa chọn đã được giữ trước; danh sách ưu tiên sẽ bỏ qua ghế này."
      );
    }
    if (state === "sold_out") {
      const closeButton = findBestTextElement(["OK", "Đóng"]);
      return target(
        closeButton,
        closeButton ? "Đưa tới nút OK" : "Đóng thông báo hết vé",
        "Loại vé đang hết hoặc được giữ thanh toán. Chỉ thử lại thủ công với nhịp chậm."
      );
    }

    const buyButton = findTargetBuyButton();
    if (buyButton) {
      const suffix = config.targetDate ? ` (${config.targetDate})` : "";
      return target(buyButton, `Đưa tới “Mua vé ngay”${suffix}`, "Kiểm tra đúng suất trước khi bấm trên trang.");
    }

    if (state === "selection" || state === "unknown") {
      return config.mode === "quantity"
        ? recommendQuantityFlow(rawText)
        : recommendSeatFlow(rawText);
    }

    if (state === "event") {
      return note(config.targetDate
        ? `Chưa thấy nút mở bán cho suất ${config.targetDate}.`
        : "Chưa thấy nút “Mua vé ngay” đang khả dụng.");
    }

    return note("Mở trang sự kiện Ticketbox để bắt đầu.");
  }

  function recommendQuantityFlow() {
    const controls = findQuantityControls(config.area);
    if (controls.visible) {
      if (controls.current !== null && controls.current < config.quantity && controls.plus) {
        return target(
          controls.plus,
          `Đưa tới nút + (${controls.current}/${config.quantity})`,
          "Mỗi lần chỉ bấm một lần trên nút gốc của Ticketbox."
        );
      }
      if (controls.current !== null && controls.current > config.quantity && controls.minus) {
        return target(
          controls.minus,
          `Đưa tới nút − (${controls.current}/${config.quantity})`,
          "Giảm về đúng số lượng đã cấu hình."
        );
      }
      if (controls.current === null && controls.plus) {
        return target(controls.plus, `Đưa tới nút + để chọn ${config.quantity} vé`, "Kiểm tra số lượng sau mỗi lần bấm.");
      }

      const continueButton = findContinueButton();
      if (continueButton && !isDisabled(continueButton)) {
        return target(continueButton, "Đưa tới nút Tiếp tục", "Kiểm tra khu và số lượng trước khi bấm.");
      }
    }

    if (config.area) {
      const areaElement = findAreaElement(config.area);
      if (areaElement) {
        return target(areaElement, `Đưa tới khu ${config.area}`, "Bấm khu trên sơ đồ rồi chọn số lượng.");
      }
    }

    return note(config.area
      ? `Chưa nhận diện được khu “${config.area}”; hãy chọn trực tiếp trên sơ đồ.`
      : "Chọn khu vực trên sơ đồ, sau đó trợ lý sẽ nhận diện bộ chọn số lượng.");
  }

  function recommendSeatFlow() {
    const selected = findSelectedSeats();
    if (selected.length >= config.quantity) {
      const continueButton = findContinueButton();
      if (continueButton && !isDisabled(continueButton)) {
        return target(
          continueButton,
          `Đưa tới Tiếp tục (${selected.length} ghế)`,
          `Đã nhận diện: ${selected.join(", ")}.`
        );
      }
    }

    for (const seat of config.seats) {
      const normalizedSeat = Core.normalizeText(seat);
      if (rejectedSeats.has(normalizedSeat) || selected.some((item) => Core.normalizeText(item) === normalizedSeat)) {
        continue;
      }
      const seatElement = findSeatElement(seat);
      if (seatElement) {
        return target(seatElement, `Đưa tới ghế ${seat}`, "Bấm ghế được tô sáng trên sơ đồ Ticketbox.");
      }
    }

    if (config.area) {
      const areaElement = findAreaElement(config.area);
      if (areaElement) {
        return target(areaElement, `Đưa tới khu ${config.area}`, "Một số show yêu cầu chọn khu trước khi hiện ghế.");
      }
    }

    if (!config.seats.length) {
      return note("Hãy chọn ghế trực tiếp hoặc thêm danh sách ghế ưu tiên trong tiện ích.");
    }
    return note("Sơ đồ này không công khai mã ghế trong DOM; hãy chọn ghế ưu tiên trực tiếp trên sơ đồ.");
  }

  function findTargetBuyButton() {
    const buttons = findAllTextElements(["Mua vé ngay"])
      .filter((element) => !isDisabled(element));
    if (!buttons.length) return null;
    if (!config.targetDate) return buttons[0];

    let best = null;
    let bestScore = 0;
    for (const button of buttons) {
      const score = contextScore(button, config.targetDate);
      if (score > bestScore) {
        best = button;
        bestScore = score;
      }
    }
    return bestScore > 0 ? best : null;
  }

  function findAreaElement(area) {
    const candidates = visibleElements(INTERACTIVE_SELECTOR);
    let best = null;
    let bestScore = 0;

    for (const element of candidates) {
      const score = Core.scoreText(elementDescriptor(element), area);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }

    if (bestScore >= 70) return best;

    const textNodeElement = findInnermostTextElement(area);
    if (!textNodeElement) return null;
    return textNodeElement.closest("g, button, [role='button'], [tabindex], a") || textNodeElement;
  }

  function findSeatElement(seat) {
    const targetSeat = Core.normalizeText(seat).replace(/\s+/g, "");
    if (!targetSeat) return null;
    const selectors = [
      "[aria-label]",
      "[title]",
      "[data-seat]",
      "[data-seat-name]",
      "[data-name]",
      "[id]",
      "svg text"
    ].join(",");

    for (const element of visibleElements(selectors)) {
      const descriptor = Core.normalizeText(elementDescriptor(element)).replace(/\s+/g, "");
      if (!descriptor.includes(targetSeat)) continue;
      return element.closest("g, button, [role='button'], [tabindex]") || element;
    }
    return null;
  }

  function findSelectedSeats() {
    if (!config.seats.length) return [];
    const selected = new Set();
    const continueButton = findContinueButton();
    const contexts = [];

    if (continueButton) {
      let current = continueButton.parentElement;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const text = current.innerText || "";
        if (text.length <= 1_500) contexts.push(text);
      }
    }

    for (const element of visibleElements(".selected, [aria-selected='true'], [data-selected='true']")) {
      contexts.push(elementDescriptor(element));
    }

    const combined = Core.normalizeText(contexts.join(" "));
    for (const seat of config.seats) {
      if (combined.includes(Core.normalizeText(seat))) selected.add(seat);
    }
    return [...selected];
  }

  function findQuantityControls(area) {
    const plusButtons = visibleElements(INTERACTIVE_SELECTOR)
      .filter((element) => controlKind(element) === "plus");
    if (!plusButtons.length) return { visible: false, current: null, plus: null, minus: null };

    let plus = plusButtons[0];
    if (area) {
      plus = plusButtons
        .map((element) => ({ element, score: contextScore(element, area) }))
        .sort((a, b) => b.score - a.score)[0]?.element || plus;
    }

    const container = smallestUsefulContainer(plus, area);
    const minus = visibleElements(INTERACTIVE_SELECTOR, container)
      .find((element) => controlKind(element) === "minus") || null;
    const current = findSmallCounter(container, plus, minus);
    return { visible: true, current, plus, minus, container };
  }

  function findSmallCounter(container, plus, minus) {
    if (!container) return null;
    const candidates = [...container.querySelectorAll("input, [aria-valuenow], span, div")];
    for (const element of candidates) {
      if (!isVisible(element) || element === plus || element === minus) continue;
      const raw = element.getAttribute("aria-valuenow") || element.value || element.textContent || "";
      const value = raw.trim();
      if (!/^\d{1,2}$/.test(value)) continue;
      const number = Number(value);
      if (number >= 0 && number <= 10) return number;
    }
    return null;
  }

  function findContinueButton() {
    return findAllTextElements(["Tiếp tục"])
      .filter((element) => !/vui long chon ve/.test(Core.normalizeText(elementDescriptor(element))))
      .sort((a, b) => Number(isDisabled(a)) - Number(isDisabled(b)))[0] || null;
  }

  function findBestTextElement(terms) {
    return findAllTextElements(terms)[0] || null;
  }

  function findCaptchaContainer() {
    const marker = findInnermostTextElement("Xác Minh Người Dùng") ||
      findInnermostTextElement("Chống bot tự động mua vé");
    if (!marker) return null;

    const declaredDialog = marker.closest("[role='dialog'], [aria-modal='true']");
    if (declaredDialog && isVisible(declaredDialog)) return declaredDialog;

    let current = marker;
    let best = marker;
    for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
      const text = Core.normalizeText(current.innerText || "");
      if (text.includes("xac minh nguoi dung") &&
          (text.includes("keo mui ten") || text.includes("chong bot tu dong mua ve")) &&
          text.length < 1_500) {
        best = current;
      }
    }
    return best;
  }

  function findAllTextElements(terms) {
    const candidates = visibleElements(INTERACTIVE_SELECTOR);
    const scored = [];
    for (const element of candidates) {
      const descriptor = elementDescriptor(element);
      const score = Math.max(...terms.map((term) => Core.scoreText(descriptor, term)));
      if (score >= 70) scored.push({ element, score, length: descriptor.length });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.length - b.length)
      .map((entry) => entry.element);
  }

  function findInnermostTextElement(term) {
    const normalizedTerm = Core.normalizeText(term);
    if (!normalizedTerm || !document.body) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!Core.normalizeText(node.nodeValue).includes(normalizedTerm)) continue;
      if (node.parentElement && isVisible(node.parentElement)) return node.parentElement;
    }
    return null;
  }

  function contextScore(element, targetText) {
    const normalizedTarget = Core.normalizeText(targetText);
    const targetTokens = normalizedTarget.split(" ").filter((token) => token.length >= 2 || /^\d+$/.test(token));
    let current = element;
    let best = 0;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = current.innerText || "";
      const normalized = Core.normalizeText(text);
      let score = Core.scoreText(normalized, normalizedTarget);
      if (targetTokens.length) {
        const tokenHits = targetTokens.filter((token) => normalized.includes(token)).length;
        score = Math.max(score, Math.round((tokenHits / targetTokens.length) * 65));
      }
      if (score > 0) score += Math.max(0, 25 - depth * 3) + Math.max(0, 20 - text.length / 100);
      best = Math.max(best, score);
      if (text.length > 5_000) break;
    }
    return best;
  }

  function smallestUsefulContainer(element, contextTerm) {
    let current = element?.parentElement || null;
    let fallback = current;
    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const text = current.innerText || "";
      if (text.length <= 1_500) fallback = current;
      if (!contextTerm || Core.scoreText(text, contextTerm) >= 70) return current;
    }
    return fallback;
  }

  function visibleElements(selector, root = document) {
    try {
      return [...root.querySelectorAll(selector)].filter(isVisible).slice(0, 4_000);
    } catch {
      return [];
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05;
  }

  function isDisabled(element) {
    return Boolean(
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      /disabled|disable/.test(String(element.className).toLowerCase())
    );
  }

  function elementDescriptor(element) {
    const values = [
      element.innerText,
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-seat"),
      element.getAttribute("data-seat-name"),
      element.getAttribute("data-name"),
      element.getAttribute("data-ticket-name"),
      element.id
    ];
    return values.filter(Boolean).join(" ").trim();
  }

  function controlKind(element) {
    const raw = elementDescriptor(element).trim();
    if (/^[+＋]$/.test(raw)) return "plus";
    if (/^[-−–]$/.test(raw)) return "minus";
    const normalized = Core.normalizeText(raw);
    if (/^(tang|increase|plus)$/.test(normalized)) return "plus";
    if (/^(giam|decrease|minus)$/.test(normalized)) return "minus";
    return "";
  }

  function rememberRejectedSeat(rawText) {
    const match = rawText.match(/ghế\s+(?:lựa\s+chọn\s+)?([A-Za-z][A-Za-z0-9]*\s*-\s*\d+)/i);
    if (match?.[1]) rejectedSeats.add(Core.normalizeText(match[1]));
  }

  function target(element, label, detail) {
    return { element: element || null, label, detail, actionable: Boolean(element) };
  }

  function note(detail) {
    return { element: null, label: "", detail, actionable: false };
  }

  function applyHighlight(element) {
    if (highlightedElement === element) return;
    if (highlightedElement?.isConnected) highlightedElement.classList.remove(HIGHLIGHT_CLASS);
    highlightedElement = element;
    if (highlightedElement?.isConnected) highlightedElement.classList.add(HIGHLIGHT_CLASS);
  }

  function locateRecommendation() {
    const element = recommendation?.element;
    if (!element?.isConnected || !isVisible(element)) {
      scheduleAnalysis();
      return false;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    element.classList.remove(HIGHLIGHT_CLASS);
    requestAnimationFrame(() => element.classList.add(HIGHLIGHT_CLASS));
    return true;
  }

  function handleStateChange(state) {
    if (state === "captcha" || state === "seat_conflict" || state === "sold_out") {
      alertUser();
    }
    if (state === "customer_info" || state === "payment") {
      chrome.runtime.sendMessage({ type: "DISARM_SCHEDULE" }).catch(() => undefined);
    }
  }

  function alertUser() {
    if (Date.now() - lastAlertAt < MIN_ALERT_INTERVAL) return;
    lastAlertAt = Date.now();
    panel?.host.classList.add("tbx-alerting");
    setTimeout(() => panel?.host.classList.remove("tbx-alerting"), 1_500);
    if (config.sound) playAlertTone();
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
  }

  function playAlertTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.2);
    } catch {
      // Trình duyệt có thể chặn âm thanh trước tương tác đầu tiên.
    }
  }

  function createPanel() {
    const host = document.createElement("div");
    host.id = "ticketbox-assistant-root";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; font-family: Inter, system-ui, -apple-system, sans-serif; color: #f7faf9; }
        .card { width: min(344px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,.12); border-radius: 18px; background: rgba(18,22,21,.96); box-shadow: 0 18px 48px rgba(0,0,0,.45); overflow: hidden; backdrop-filter: blur(16px); }
        .header { display: flex; align-items: center; gap: 10px; padding: 13px 14px; background: linear-gradient(135deg,#123a2a,#171d1b); }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #31d982; box-shadow: 0 0 0 5px rgba(49,217,130,.12); flex: 0 0 auto; }
        .title { font-size: 13px; font-weight: 750; flex: 1; letter-spacing: .01em; }
        .minimize { width: 28px; height: 28px; border: 0; border-radius: 9px; color: #b9c3bf; background: rgba(255,255,255,.07); cursor: pointer; font-size: 18px; line-height: 1; }
        .body { padding: 14px; }
        .state { color: #31d982; font-weight: 720; font-size: 13px; margin-bottom: 7px; }
        .detail { color: #d6dcda; font-size: 12px; line-height: 1.48; }
        .countdown { display: none; margin-top: 10px; padding: 9px 10px; border-radius: 10px; background: #242b29; color: #ffca69; font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; }
        .action { display: none; width: 100%; margin-top: 12px; padding: 10px 12px; border: 0; border-radius: 11px; color: #062518; background: #31d982; font-size: 12px; font-weight: 780; cursor: pointer; }
        .action:hover { background: #54e49b; }
        .action:focus-visible, .minimize:focus-visible { outline: 3px solid rgba(255,255,255,.7); outline-offset: 2px; }
        .hint { margin-top: 9px; color: #89938f; font-size: 10px; }
        :host(.minimized) .body { display: none; }
        :host(.minimized) .card { width: 210px; }
        :host(.tbx-alerting) .card { animation: alert .35s ease-in-out 3; border-color: #ff675f; }
        :host(.tbx-alerting) .dot { background: #ff675f; }
        @keyframes alert { 50% { transform: translateX(-7px); } }
      </style>
      <section class="card" role="status" aria-live="polite">
        <header class="header">
          <span class="dot"></span>
          <span class="title">Ticketbox · Trợ lý thủ công</span>
          <button class="minimize" type="button" title="Thu gọn">−</button>
        </header>
        <div class="body">
          <div class="state"></div>
          <div class="detail"></div>
          <div class="countdown"></div>
          <button class="action" type="button"></button>
          <div class="hint">Trợ lý chỉ định vị; bạn tự bấm nút gốc trên Ticketbox.</div>
        </div>
      </section>`;
    document.documentElement.appendChild(host);

    panel = {
      host,
      state: shadow.querySelector(".state"),
      detail: shadow.querySelector(".detail"),
      countdown: shadow.querySelector(".countdown"),
      action: shadow.querySelector(".action"),
      minimize: shadow.querySelector(".minimize")
    };
    panel.action.addEventListener("click", locateRecommendation);
    panel.minimize.addEventListener("click", () => {
      minimized = !minimized;
      host.classList.toggle("minimized", minimized);
      panel.minimize.textContent = minimized ? "+" : "−";
      panel.minimize.title = minimized ? "Mở rộng" : "Thu gọn";
    });
  }

  function updatePanel() {
    if (!panel) return;
    panel.state.textContent = Core.stateLabel(pageState);
    panel.detail.textContent = recommendation?.detail || "Đang phân tích trang…";
    panel.action.textContent = recommendation?.label || "";
    panel.action.style.display = recommendation?.actionable ? "block" : "none";

    const saleAt = Number(runtime.saleAt);
    if (runtime.armed && Number.isFinite(saleAt) && saleAt > Date.now()) {
      panel.countdown.style.display = "block";
      panel.countdown.textContent = `Mở bán sau ${Core.formatCountdown(saleAt - Date.now())}`;
    } else if (runtime.firedAt && Date.now() - runtime.firedAt < 60_000) {
      panel.countdown.style.display = "block";
      panel.countdown.textContent = "Đã tới giờ — kiểm tra nút Mua vé ngay";
    } else {
      panel.countdown.style.display = "none";
    }
  }
})();
