(function exposeCore(root) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    eventUrl: "",
    saleTime: "",
    targetDate: "",
    mode: "seat",
    area: "",
    quantity: 1,
    seats: [],
    sound: true
  });

  const STATE_LABELS = Object.freeze({
    captcha: "Đang chờ bạn xác minh CAPTCHA",
    queue: "Đang ở hàng chờ Ticketbox",
    seat_conflict: "Ghế vừa được người khác giữ",
    sold_out: "Loại vé/khu vực đang hết vé",
    customer_info: "Đã tới bước điền thông tin",
    payment: "Đã tới bước thanh toán",
    selection: "Đang ở bước chọn vé",
    event: "Đang ở trang sự kiện",
    unknown: "Đang chờ trang Ticketbox"
  });

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function parseSeatPreferences(value) {
    const source = Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]/);
    const seen = new Set();
    const result = [];

    for (const item of source) {
      const seat = String(item ?? "").trim().replace(/\s+/g, " ");
      const key = normalizeText(seat);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(seat);
    }

    return result;
  }

  function isTicketboxUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" &&
        (url.hostname === "ticketbox.vn" || url.hostname.endsWith(".ticketbox.vn"));
    } catch {
      return false;
    }
  }

  function sanitizeConfig(input) {
    const config = { ...DEFAULT_CONFIG, ...(input || {}) };
    config.eventUrl = String(config.eventUrl || "").trim();
    config.saleTime = String(config.saleTime || "").trim();
    config.targetDate = String(config.targetDate || "").trim();
    config.mode = config.mode === "quantity" ? "quantity" : "seat";
    config.area = String(config.area || "").trim();
    config.quantity = Math.max(1, Math.min(10, Number.parseInt(config.quantity, 10) || 1));
    config.seats = parseSeatPreferences(config.seats);
    config.sound = config.sound !== false;
    return config;
  }

  function classifyPageText(value) {
    const text = normalizeText(value);

    if (/(xac minh nguoi dung|chong bot tu dong mua ve|keo mui ten)/.test(text)) {
      return "captcha";
    }
    if (/(ghe lua chon).*(duoc dat truoc|nguoi khac)|(uii+ xin loi).*(ghe|dat truoc)/.test(text)) {
      return "seat_conflict";
    }
    if (/(khong con ve|tat ca ve).*(da duoc ban|qua trinh thanh toan|vui long dat)|ve da het/.test(text)) {
      return "sold_out";
    }
    if (/(hang cho|queue).*(mua ve|ticket|thu tu|vi tri)|vi tri cua ban trong hang cho/.test(text)) {
      return "queue";
    }
    if (/(bang cau hoi|thong tin nguoi mua|thong tin nhan ve|dia chi xuat hoa don)/.test(text)) {
      return "customer_info";
    }
    if (/(phuong thuc thanh toan|ma khuyen mai).*(tong tien|thanh toan)|thong tin thanh toan/.test(text)) {
      return "payment";
    }
    if (/(vui long chon ve|chon khu vuc khac|bam vao khu vuc de chon ve|stage|so luong)/.test(text)) {
      return "selection";
    }
    if (/(mua ve ngay|ve chua mo ban|lich dien|thong tin ve)/.test(text)) {
      return "event";
    }
    return "unknown";
  }

  function scoreText(value, target) {
    const haystack = normalizeText(value);
    const needle = normalizeText(target);
    if (!needle || !haystack) return 0;
    if (haystack === needle) return 100;
    if (haystack.startsWith(needle)) return 85;
    if (haystack.includes(needle)) return 70;

    const words = needle.split(" ").filter(Boolean);
    if (!words.length) return 0;
    const matches = words.filter((word) => haystack.includes(word)).length;
    return Math.round((matches / words.length) * 50);
  }

  function formatCountdown(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "00:00:00";
    const seconds = Math.ceil(milliseconds / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    return [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
  }

  function stateLabel(state) {
    return STATE_LABELS[state] || STATE_LABELS.unknown;
  }

  const api = {
    DEFAULT_CONFIG,
    STATE_LABELS,
    normalizeText,
    parseSeatPreferences,
    isTicketboxUrl,
    sanitizeConfig,
    classifyPageText,
    scoreText,
    formatCountdown,
    stateLabel
  };

  root.TicketboxAssistantCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
