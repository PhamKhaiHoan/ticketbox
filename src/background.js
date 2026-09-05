"use strict";

const ALARM_NAME = "ticketbox-sale-time";
const RUNTIME_KEY = "ticketboxRuntime";
const CONFIG_KEY = "ticketboxConfig";

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.sync.get(CONFIG_KEY);
  if (!stored[CONFIG_KEY]) {
    await chrome.storage.sync.set({
      [CONFIG_KEY]: {
        eventUrl: "",
        saleTime: "",
        targetDate: "",
        mode: "seat",
        area: "",
        quantity: 1,
        seats: [],
        sound: true
      }
    });
  }
  await updateBadge(false);
});

chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(RUNTIME_KEY);
  await updateBadge(Boolean(stored[RUNTIME_KEY]?.armed));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "ARM_SCHEDULE") {
    armSchedule(message.saleAt)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "DISARM_SCHEDULE") {
    disarmSchedule()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "GET_RUNTIME") {
    chrome.storage.local.get(RUNTIME_KEY)
      .then((stored) => sendResponse({ ok: true, runtime: stored[RUNTIME_KEY] || { armed: false } }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const [syncStored, localStored] = await Promise.all([
    chrome.storage.sync.get(CONFIG_KEY),
    chrome.storage.local.get(RUNTIME_KEY)
  ]);
  const config = syncStored[CONFIG_KEY] || {};
  const runtime = localStored[RUNTIME_KEY] || {};
  if (!runtime.armed || !isTicketboxUrl(config.eventUrl)) {
    await disarmSchedule();
    return;
  }

  await openOrReloadEvent(config.eventUrl);
  await chrome.storage.local.set({
    [RUNTIME_KEY]: {
      ...runtime,
      armed: false,
      firedAt: Date.now()
    }
  });
  await updateBadge(false, "GO");
});

async function armSchedule(saleAt) {
  const timestamp = Number(saleAt);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new Error("Giờ mở bán phải nằm trong tương lai.");
  }

  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when: timestamp });
  await chrome.storage.local.set({
    [RUNTIME_KEY]: {
      armed: true,
      saleAt: timestamp,
      armedAt: Date.now(),
      firedAt: null
    }
  });
  await updateBadge(true);
}

async function disarmSchedule() {
  await chrome.alarms.clear(ALARM_NAME);
  const stored = await chrome.storage.local.get(RUNTIME_KEY);
  await chrome.storage.local.set({
    [RUNTIME_KEY]: {
      ...(stored[RUNTIME_KEY] || {}),
      armed: false
    }
  });
  await updateBadge(false);
}

async function openOrReloadEvent(eventUrl) {
  const url = new URL(eventUrl);
  const patterns = [
    `https://${url.hostname}/*`
  ];
  const tabs = await chrome.tabs.query({ url: patterns });
  const exactTab = tabs.find((tab) => {
    if (!tab.url) return false;
    try {
      const candidate = new URL(tab.url);
      return candidate.origin === url.origin && candidate.pathname === url.pathname;
    } catch {
      return false;
    }
  });

  if (exactTab?.id) {
    await chrome.tabs.update(exactTab.id, { active: true });
    if (exactTab.windowId) await chrome.windows.update(exactTab.windowId, { focused: true });
    await chrome.tabs.reload(exactTab.id, { bypassCache: false });
    return;
  }

  await chrome.tabs.create({ url: eventUrl, active: true });
}

async function updateBadge(armed, text) {
  await chrome.action.setBadgeBackgroundColor({ color: armed ? "#ffb020" : "#18b86b" });
  await chrome.action.setBadgeText({ text: text || (armed ? "ON" : "") });
  if (text) {
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 15_000);
  }
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
