# KSK: Tra cứu kết quả khám sức khỏe định kỳ

Người lao động tự tra cứu kết quả khám sức khỏe của mình. Hệ thống chạy trên **máy chủ nội bộ**, dùng Node.js thuần: **không cần thư viện ngoài, không cần `npm install`, không cần Internet** ở phía máy chủ.

## Cơ chế bảo mật (Phase 1)

| Điểm | Cách làm | Vị trí trong code |
|---|---|---|
| Dữ liệu chỉ nằm trên máy chủ | CSDL SQLite `data/ksk.db`. Trình duyệt không tải danh sách nào | `server/db.js` |
| Xác thực 3 yếu tố | Mã nhân viên + Ngày sinh + **PIN 6 số** cá nhân | `server/server.js` → `handleLookup()` |
| PIN không lưu dạng gốc | Lưu dạng hash scrypt kèm salt | `server/db.js` → `hashPin()`, `verifyPin()` |
| Chống dò | Sai `MAX_FAILS` lần (mặc định 5) thì khóa mã đó `LOCK_MINUTES` phút (mặc định 30). Mỗi IP được tối đa `IP_MAX_REQUESTS` lần (mặc định 20) trong `IP_WINDOW_MINUTES` phút (mặc định 15) | `handleLookup()`, `ipRateLimited()` |
| Không lộ lý do sai | Sai mã, sai ngày sinh hay sai PIN đều nhận cùng một thông báo. Thời gian phản hồi được làm tương đương | `MSG_FAIL`, `DUMMY_HASH` |
| Nhật ký truy cập | `data/access.log` ghi thời gian, IP, mã NV và kết quả. **Không** ghi PIN, ngày sinh hay dữ liệu sức khỏe | `logAccess()` |
| Chống XSS | Dữ liệu chỉ được gán qua `textContent`. Có CSP chặn script lạ | `public/app.js`, `SECURITY_HEADERS` |
| Không tự bịa chỉ số | Ô trống hiển thị "—". Dòng CSV thiếu hoặc sai trường bắt buộc thì **cả file bị từ chối** | `server/records.js` |

## Yêu cầu

- Node.js **22.13 trở lên** (có sẵn `node:sqlite`). Kiểm tra bằng `node -v`.
- Lúc khởi động, Node in cảnh báo `ExperimentalWarning: SQLite`. Cảnh báo này là bình thường.

## Cài đặt và chạy

```bash
# 1. Import danh sách khám (CSV UTF-8, cột theo đúng sample_database.csv)
node server/cli.js import duong_dan/danh_sach.csv
#    -> nhân viên mới được cấp PIN, lưu ở data/pins-<thời gian>.csv

# 2. Chạy máy chủ
node server/server.js            # mặc định cổng 8080
```

Mở `http://<ip-máy-chủ>:8080` trên máy trong mạng nội bộ.

### Bật HTTPS (bắt buộc khi dùng thật)

```bash
# Windows PowerShell
$env:TLS_CERT="C:\ksk\cert.pem"; $env:TLS_KEY="C:\ksk\key.pem"; node server/server.js
```

Nếu không có HTTPS, ngày sinh và PIN đi qua mạng nội bộ ở dạng không mã hóa.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Địa chỉ lắng nghe |
| `TLS_CERT`, `TLS_KEY` | (trống) | Đường dẫn chứng chỉ để bật HTTPS |
| `TRUST_PROXY` | (tắt) | Đặt `1` nếu chạy sau reverse proxy (IIS/nginx), để lấy IP thật từ `X-Forwarded-For` |
| `MAX_FAILS`, `LOCK_MINUTES` | `5`, `30` | Khóa theo mã nhân viên |
| `IP_MAX_REQUESTS`, `IP_WINDOW_MINUTES` | `20`, `15` | Giới hạn theo IP |
| `KSK_DATA_DIR` | `./data` | Thư mục chứa CSDL, log và file PIN |

## Công cụ quản trị (chạy trên máy chủ)

```bash
node server/cli.js import <file.csv>      # import/cập nhật; nhân viên cũ giữ nguyên PIN
node server/cli.js reset-pin <mã_NV>      # cấp lại PIN (khi quên), đồng thời mở khóa
node server/cli.js unlock <mã_NV>         # mở khóa tra cứu
node server/cli.js stats                  # tổng số hồ sơ / số mã đang khóa
```

**Quy trình PIN:** sau khi import, chuyển file `data/pins-*.csv` cho bộ phận Nhân sự phát riêng cho từng người, sau đó **xóa file này**.

## Định dạng CSV

- 37 cột, **khớp theo tên cột**, không theo vị trí. Xem `sample_database.csv` (chỉ chứa dữ liệu giả).
- Dấu phân cách `,` hoặc `;` đều dùng được. Ô có dấu phẩy phải đặt trong ngoặc kép. File phải là UTF-8 (trong Excel chọn *CSV UTF-8*).
- Bắt buộc có: `họ_và_tên`, `mã_nhân_viên` (chữ/số, tối đa 20 ký tự), `ngày_sinh` (DD/MM/YYYY).

## Cấu trúc thư mục

```
public/        index.html, app.js, styles.css (chỉ trang tra cứu)
server/        server.js (HTTP + API), db.js (SQLite + PIN), records.js (CSV), cli.js (quản trị)
test/          test tự động: node --test
data/          CSDL, log, file PIN (đã loại khỏi git, KHÔNG commit)
```

## Kiểm thử

```bash
node --test
```

## Lưu ý vận hành

- Thư mục `data/` chứa dữ liệu sức khỏe thật. Cần giới hạn quyền truy cập thư mục trên máy chủ, mã hóa ổ đĩa (BitLocker) và sao lưu định kỳ.
- Trang có dùng font và icon từ CDN (Google Fonts, cdnjs). Nếu máy trạm không ra Internet được, trang vẫn chạy nhưng không có icon.
- Tab CMS (quản lý trên web) đã tạm gỡ. Trong Phase 1, dữ liệu được quản lý bằng CLI. Phase 2 sẽ làm CMS có đăng nhập quản trị.
