"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/common.js");

test("normalizeText strips Vietnamese accents and normalizes spacing", () => {
  assert.equal(Core.normalizeText("  Mua VÉ  Ngay – 25 Tháng 09  "), "mua ve ngay 25 thang 09");
  assert.equal(Core.normalizeText("Đã được đặt trước"), "da duoc dat truoc");
});

test("parseSeatPreferences keeps order and removes duplicates", () => {
  assert.deepEqual(
    Core.parseSeatPreferences("E1-11, E1-10\ne1-11; L-5"),
    ["E1-11", "E1-10", "L-5"]
  );
});

test("only Ticketbox HTTPS URLs are accepted", () => {
  assert.equal(Core.isTicketboxUrl("https://ticketbox.vn/event/demo"), true);
  assert.equal(Core.isTicketboxUrl("https://stars.ticketbox.vn/demo"), true);
  assert.equal(Core.isTicketboxUrl("http://ticketbox.vn/event/demo"), false);
  assert.equal(Core.isTicketboxUrl("https://ticketbox.vn.example.com/event/demo"), false);
  assert.equal(Core.isTicketboxUrl("javascript:alert(1)"), false);
});

test("classifies the CAPTCHA shown in videos", () => {
  assert.equal(
    Core.classifyPageText("Mua vé ngay Xác Minh Người Dùng Chống bot tự động mua vé Kéo mũi tên qua phải"),
    "captcha"
  );
});

test("classifies a seat conflict before generic selection text", () => {
  assert.equal(
    Core.classifyPageText("Uiii, xin lỗi! Ghế lựa chọn L-5 đã được đặt trước. Chọn ghế khác"),
    "seat_conflict"
  );
});

test("classifies sold-out quantity dialog", () => {
  assert.equal(
    Core.classifyPageText("Không còn vé. Tất cả vé VIP-A đã được bán hoặc đang trong quá trình thanh toán."),
    "sold_out"
  );
});

test("classifies queue and does not mistake it for event page", () => {
  assert.equal(
    Core.classifyPageText("Hàng chờ mua vé. Vị trí của bạn trong hàng chờ là 42"),
    "queue"
  );
});

test("classifies customer information as the requested stopping point", () => {
  assert.equal(
    Core.classifyPageText("BẢNG CÂU HỎI Họ & tên Số điện thoại Địa chỉ xuất hóa đơn Tiếp tục"),
    "customer_info"
  );
});

test("classifies payment details", () => {
  assert.equal(
    Core.classifyPageText("Phương thức thanh toán VNPAY VietQR Mã khuyến mãi Tổng tiền Thanh toán"),
    "payment"
  );
});

test("classifies event and selection screens", () => {
  assert.equal(Core.classifyPageText("Lịch diễn 25 Tháng 09, 2026 Mua vé ngay"), "event");
  assert.equal(Core.classifyPageText("STAGE Bấm vào khu vực để chọn vé Vui lòng chọn vé"), "selection");
});

test("sanitizeConfig applies safe bounds and defaults", () => {
  assert.deepEqual(Core.sanitizeConfig({ mode: "other", quantity: 99, seats: "A-1, A-1" }), {
    eventUrl: "",
    saleTime: "",
    targetDate: "",
    mode: "seat",
    area: "",
    quantity: 10,
    seats: ["A-1"],
    sound: true
  });
});

test("formatCountdown rounds up to prevent an early zero", () => {
  assert.equal(Core.formatCountdown(3_600_000), "01:00:00");
  assert.equal(Core.formatCountdown(1_001), "00:00:02");
  assert.equal(Core.formatCountdown(-1), "00:00:00");
});
