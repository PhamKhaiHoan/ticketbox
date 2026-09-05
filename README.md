# Ticketbox · Trợ lý mua vé thủ công

Tiện ích Chrome/Edge hỗ trợ canh giờ và chỉ dẫn luồng mua vé Ticketbox. Tiện ích nhận diện trạng thái trang, tô sáng đúng bước cần thao tác và đưa người dùng tới nút tương ứng. Mọi lần bấm mua vé, chọn vé, CAPTCHA, hàng chờ và thanh toán đều do người dùng thực hiện trực tiếp trên Ticketbox.

## Các luồng đã bao phủ

Đối chiếu theo 5 video trong `tutorials/`:

1. **Show có sơ đồ ghế cụ thể:** nhận diện nút `Mua vé ngay`, chờ người dùng kéo CAPTCHA, tìm ghế ưu tiên, theo dõi số ghế đã chọn và định vị `Tiếp tục`.
2. **Show chọn số lượng:** định vị đúng khu, nhận diện hộp `− / số lượng / +`, hướng dẫn về đúng số vé rồi định vị `Tiếp tục`.
3. **Show có nhiều ngày:** ghép nút `Mua vé ngay` với chuỗi ngày/suất đã cấu hình thay vì lấy nút đầu tiên.
4. **Show phải chọn khu trước:** định vị khu ưu tiên trước; khi Ticketbox mở bước ghế/số lượng, trợ lý tiếp tục nhận diện bước mới.
5. **Ghế vừa bị giữ hoặc vé vừa hết:** phát cảnh báo, nhận diện nút `Chọn ghế khác`/`OK`, bỏ qua mã ghế bị xung đột và chuyển sang ghế ưu tiên tiếp theo sau khi người dùng đóng thông báo.

Khi trang đã hiện `Bảng câu hỏi`, `Thông tin nhận vé` hoặc phương thức thanh toán, trợ lý coi như đã đạt mục tiêu và dừng lịch canh giờ.

## Cài đặt

1. Mở `chrome://extensions` trên Chrome hoặc `edge://extensions` trên Edge.
2. Bật **Chế độ dành cho nhà phát triển / Developer mode**.
3. Chọn **Tải tiện ích đã giải nén / Load unpacked**.
4. Chọn thư mục dự án này (thư mục chứa `manifest.json`).
5. Ghim tiện ích `Ticketbox Trợ lý mua vé` lên thanh công cụ.

Không cần chạy server và không cần cài package npm.

## Cách sử dụng

1. Đăng nhập Ticketbox trước giờ mở bán và mở đúng trang sự kiện.
2. Mở tiện ích, bấm **Lấy tab** để điền link hiện tại.
3. Nhập giờ mở bán theo giờ máy tính. Tiện ích sẽ mở hoặc nạp lại trang đúng **một lần** tại thời điểm đó.
4. Nếu sự kiện nhiều ngày, nhập phần ngày giống nội dung Ticketbox, ví dụ `25 Tháng 09, 2026`.
5. Chọn một trong hai kiểu:
   - `Ghế cụ thể`: nhập khu nếu show yêu cầu chọn khu trước, số ghế cần mua và danh sách như `E1-11, E1-10, E1-12`.
   - `Theo số lượng`: nhập khu như `VIP` và số vé cần mua.
6. Bấm **Lưu & canh giờ** và giữ trình duyệt mở.
7. Trên trang Ticketbox, làm theo bảng nổi. Bấm **Đưa tới…** chỉ để cuộn tới và tô sáng; sau đó tự bấm phần tử gốc của Ticketbox.
8. Khi CAPTCHA xuất hiện, trợ lý phát cảnh báo, tô sáng hộp xác minh và có nút **Đưa tới hộp xác minh CAPTCHA**. Tự kéo mũi tên rồi ghép/xoay hình cho khớp; trợ lý sẽ tự nhận diện và tiếp tục hướng dẫn khi Ticketbox chuyển sang sơ đồ vé.

## Lưu ý vận hành

- Dùng đồng hồ hệ điều hành đã đồng bộ thời gian và giữ máy không chuyển sang chế độ ngủ.
- Trình duyệt có thể trì hoãn lịch một khoảng nhỏ nếu máy ngủ, tab bị đóng băng hoặc Chrome bị tắt.
- Không tải lại khi đã vào hàng chờ.
- CAPTCHA không được giải tự động: đây là bước xác minh chống bot của Ticketbox và luôn cần người dùng thao tác trực tiếp.
- Khi báo hết vé, chỉ đóng thông báo và thử lại thủ công với nhịp hợp lý. Tiện ích không lặp click, không quay vòng số lượng và không né giới hạn của Ticketbox.
- Sơ đồ ghế của một số show được vẽ bằng canvas và không công khai mã ghế trong HTML. Khi đó tiện ích không thể định vị từng ghế, nhưng vẫn nhận diện trạng thái, khu và nút tiếp tục.
- Tiện ích này chạy trên Chrome/Edge máy tính. Nó không chạy trong trình duyệt Facebook trên iPhone như giao diện trong video. Để dùng, hãy mở cùng trang Ticketbox trên máy tính.

## Quyền và dữ liệu

- `storage`: lưu cấu hình show trong hồ sơ trình duyệt.
- `alarms`: đặt một lịch tại giờ mở bán.
- `tabs`: tìm tab Ticketbox hiện tại và mở/nạp lại link đã cấu hình.
- Quyền truy cập trang chỉ áp dụng cho `ticketbox.vn` và các tên miền con.

Tiện ích không gửi dữ liệu ra máy chủ, không đọc thông tin thanh toán và không tự điền thông tin cá nhân.

## Kiểm tra mã nguồn

Yêu cầu Node.js 20 trở lên:

```powershell
npm run check
npm test
```

## Cấu trúc

```text
manifest.json          Khai báo Chrome Extension Manifest V3
src/background.js      Lịch mở bán và mở/nạp lại tab một lần
src/common.js          Chuẩn hóa văn bản và nhận diện trạng thái
src/content.js         Bảng nổi, phân tích DOM và định vị bước thao tác
src/content.css        Hiệu ứng tô sáng phần tử Ticketbox
src/popup.html         Màn hình cấu hình
src/popup.css          Giao diện cấu hình
src/popup.js           Lưu cấu hình, đặt/dừng lịch và giao tiếp với tab
test/core.test.js      Kiểm thử logic nhận diện độc lập
```
