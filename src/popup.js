(function startPopup() {
  "use strict";

  const Core = globalThis.TicketboxAssistantCore;
  const CONFIG_KEY = "ticketboxConfig";
  const form = document.querySelector("#configForm");
  const eventUrl = document.querySelector("#eventUrl");
  const saleTime = document.querySelector("#saleTime");
  const targetDate = document.querySelector("#targetDate");
  const area = document.querySelector("#area");
  const quantity = document.querySelector("#quantity");
  const seats = document.querySelector("#seats");
  const sound = document.querySelector("#sound");
  const seatField = document.querySelector("#seatField");
  const statusBadge = document.querySelector("#statusBadge");
  const pageStatus = document.querySelector(".page-status");
  const pageState = document.querySelector("#pageState");
  const pageHint = document.querySelector("#pageHint");
  const formMessage = document.querySelector("#formMessage");

  initialize().catch((error) => showMessage(error.message, "error"));

  form.addEventListener("submit", saveAndArm);
  document.querySelector("#useCurrentUrl").addEventListener("click", useCurrentTabUrl);
  document.querySelector("#locateButton").addEventListener("click", locateCurrentStep);
  document.querySelector("#disarmButton").addEventListener("click", disarm);
  document.querySelectorAll("input[name='mode']").forEach((input) => {
    input.addEventListener("change", updateModeVisibility);
  });

  async function initialize() {
    const [syncStored, runtimeResponse] = await Promise.all([
      chrome.storage.sync.get(CONFIG_KEY),
      chrome.runtime.sendMessage({ type: "GET_RUNTIME" })
    ]);
    fillForm(Core.sanitizeConfig(syncStored[CONFIG_KEY]));
    updateRuntimeBadge(runtimeResponse?.runtime);
    await refreshPageStatus();

    if (!eventUrl.value) await useCurrentTabUrl(false);
  }

  function fillForm(config) {
    eventUrl.value = config.eventUrl;
    saleTime.value = config.saleTime;
    targetDate.value = config.targetDate;
    area.value = config.area;
    quantity.value = config.quantity;
    seats.value = config.seats.join(", ");
    sound.checked = config.sound;
    const modeInput = document.querySelector(`input[name='mode'][value='${config.mode}']`);
    if (modeInput) modeInput.checked = true;
    updateModeVisibility();
  }

  function readForm() {
    return Core.sanitizeConfig({
      eventUrl: eventUrl.value,
      saleTime: saleTime.value,
      targetDate: targetDate.value,
      mode: document.querySelector("input[name='mode']:checked")?.value,
      area: area.value,
      quantity: quantity.value,
      seats: seats.value,
      sound: sound.checked
    });
  }

  async function saveAndArm(event) {
    event.preventDefault();
    clearMessage();
    const config = readForm();
    if (!Core.isTicketboxUrl(config.eventUrl)) {
      showMessage("Link phải là trang HTTPS thuộc ticketbox.vn.", "error");
      eventUrl.focus();
      return;
    }
    if (!config.saleTime) {
      showMessage("Hãy nhập giờ mở bán.", "error");
      saleTime.focus();
      return;
    }

    const saleAt = new Date(config.saleTime).getTime();
    if (!Number.isFinite(saleAt) || saleAt <= Date.now()) {
      showMessage("Giờ mở bán phải nằm trong tương lai.", "error");
      saleTime.focus();
      return;
    }
    if (config.mode === "quantity" && !config.area) {
      showMessage("Luồng số lượng cần tên khu ưu tiên để nhận diện đúng.", "error");
      area.focus();
      return;
    }
    if (config.mode === "seat" && config.seats.length > 0 && config.quantity > config.seats.length) {
      showMessage("Danh sách ghế ít hơn số ghế cần mua.", "error");
      seats.focus();
      return;
    }

    await chrome.storage.sync.set({ [CONFIG_KEY]: config });
    const response = await chrome.runtime.sendMessage({ type: "ARM_SCHEDULE", saleAt });
    if (!response?.ok) {
      showMessage(response?.error || "Không thể đặt lịch canh giờ.", "error");
      return;
    }

    await sendToActiveTab({ type: "REFRESH_CONFIG" });
    updateRuntimeBadge({ armed: true, saleAt });
    showMessage("Đã lưu. Hãy để trình duyệt mở; tiện ích sẽ mở hoặc nạp lại trang đúng một lần.", "success");
  }

  async function disarm() {
    clearMessage();
    const response = await chrome.runtime.sendMessage({ type: "DISARM_SCHEDULE" });
    if (!response?.ok) {
      showMessage(response?.error || "Không thể dừng lịch.", "error");
      return;
    }
    updateRuntimeBadge({ armed: false });
    showMessage("Đã dừng canh giờ; cấu hình vẫn được giữ lại.", "success");
  }

  async function useCurrentTabUrl(showSuccess = true) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Core.isTicketboxUrl(tab?.url || "")) {
      if (showSuccess) showMessage("Tab hiện tại không phải trang ticketbox.vn.", "error");
      return;
    }
    eventUrl.value = tab.url;
    if (showSuccess) showMessage("Đã lấy link từ tab hiện tại.", "success");
  }

  async function locateCurrentStep() {
    clearMessage();
    const response = await sendToActiveTab({ type: "LOCATE_RECOMMENDATION" });
    if (!response?.ok) {
      showMessage("Chưa có nút phù hợp để định vị trên trang hiện tại.", "error");
      return;
    }
    window.close();
  }

  async function refreshPageStatus() {
    const response = await sendToActiveTab({ type: "GET_PAGE_STATUS" });
    if (!response?.ok) {
      pageStatus.classList.remove("connected");
      pageState.textContent = "Chưa kết nối trang";
      pageHint.textContent = "Mở hoặc nạp lại một trang sự kiện Ticketbox.";
      return;
    }
    pageStatus.classList.add("connected");
    pageState.textContent = response.stateLabel;
    pageHint.textContent = response.recommendation || "Trợ lý đang theo dõi thay đổi trên trang.";
  }

  async function sendToActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !Core.isTicketboxUrl(tab.url || "")) return { ok: false };
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      return { ok: false };
    }
  }

  function updateModeVisibility() {
    const mode = document.querySelector("input[name='mode']:checked")?.value;
    seatField.hidden = mode === "quantity";
  }

  function updateRuntimeBadge(runtime) {
    const armed = Boolean(runtime?.armed);
    statusBadge.classList.toggle("armed", armed);
    if (!armed) {
      statusBadge.textContent = "Chưa canh giờ";
      return;
    }
    const saleAt = Number(runtime.saleAt);
    statusBadge.textContent = Number.isFinite(saleAt)
      ? new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(saleAt)
      : "Đang canh giờ";
  }

  function showMessage(message, type) {
    formMessage.textContent = message;
    formMessage.className = `form-message ${type}`;
  }

  function clearMessage() {
    formMessage.textContent = "";
    formMessage.className = "form-message";
  }
})();
