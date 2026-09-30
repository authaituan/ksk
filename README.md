# KSK: Tra cứu kết quả khám sức khỏe định kỳ

Người lao động tự tra cứu kết quả khám sức khỏe của mình. Hệ thống chạy trên **máy chủ nội bộ**, dùng Node.js thuần: **không cần thư viện ngoài, không cần `npm install`, không cần Internet** ở phía máy chủ.

## Cơ chế bảo mật: trang tra cứu

| Điểm | Cách làm | Vị trí trong code |
|---|---|---|
| Dữ liệu chỉ nằm trên máy chủ | CSDL SQLite `data/ksk.db`. Trình duyệt không tải danh sách nào | `server/db.js` |
| Xác thực 3 yếu tố | Mã nhân viên + Ngày sinh + **PIN 6 số** cá nhân | `server/server.js` → `handleLookup()` |
| PIN không lưu dạng gốc | Lưu dạng hash scrypt kèm salt | `server/db.js` → `hashSecret()`, `verifySecret()` |
| Chống dò | Sai `MAX_FAILS` lần (mặc định 5) thì khóa mã đó `LOCK_MINUTES` phút (mặc định 30). Mỗi IP được tối đa `IP_MAX_REQUESTS` lần (mặc định 20) trong `IP_WINDOW_MINUTES` phút (mặc định 15) | `handleLookup()`, `ipRateLimited()` |
| Không lộ lý do sai | Sai mã, sai ngày sinh hay sai PIN đều nhận cùng một thông báo. Thời gian phản hồi được làm tương đương | `MSG_FAIL`, `DUMMY_HASH` |
| Nhật ký truy cập | `data/access.log` ghi thời gian, IP, mã NV và kết quả. **Không** ghi PIN, ngày sinh hay dữ liệu sức khỏe | `logAccess()` |
| Chống XSS | Dữ liệu chỉ được gán qua `textContent`. Có CSP chặn script lạ | `public/app.js`, `SECURITY_HEADERS` |
| Không tự bịa chỉ số | Ô trống hiển thị "—". Dòng CSV thiếu hoặc sai trường bắt buộc thì **cả file bị từ chối** | `server/records.js` |

## Trang quản trị `/admin/` (Phase 2)

| Điểm | Cách làm | Vị trí trong code |
|---|---|---|
| Giới hạn máy truy cập | Chỉ IP trong `ADMIN_ALLOWED_IPS` mới thấy `/admin`. IP khác nhận 404, như thể trang không tồn tại | `server/admin.js` → `parseAllowList()` |
| Đăng nhập | Tài khoản riêng từng người. Mật khẩu hash scrypt. Sai 5 lần thì khóa 15 phút | `handleLogin()` |
| Lần đầu phải đổi mật khẩu | Mật khẩu tạm (do CLI hoặc quản trị cấp) bắt buộc đổi trước khi làm bất cứ việc gì. Mật khẩu mới dài ít nhất 10 ký tự, không chứa tên đăng nhập | `handleChangePassword()` |
| Phiên làm việc | Cookie `HttpOnly` + `SameSite=Strict`. Tự hết hạn khi không thao tác 30 phút hoặc sau 8 giờ. Mọi thao tác ghi cần header CSRF | `getSession()` |
| Phân quyền | Xem bảng vai trò bên dưới. Máy chủ kiểm tra quyền ở mọi API, không chỉ ẩn nút trên giao diện | `PERMS` |
| Không lộ dữ liệu sức khỏe | Danh sách nhân viên chỉ có mã, họ tên, bộ phận, đơn vị, trạng thái PIN/khóa. Không có ngày sinh, không có kết quả khám | `db.listEmployees()` |
| PIN chỉ thấy một lần | PIN gốc chỉ trả về đúng lúc cấp, để tải Excel hoặc in phiếu. Hệ thống chỉ lưu hash | `db.issueMissingPins()`, `db.resetPin()` |
| Nhật ký thao tác | `data/admin.log` ghi đăng nhập, import, cấp PIN, mở khóa, quản lý tài khoản. **Không** ghi PIN hay mật khẩu | `appendLog()` |

### Vai trò

| Vai trò | Được làm | Không được làm |
|---|---|---|
| `yte`: Y tế | Xem danh sách, **import** danh sách khám | Cấp PIN, mở khóa, quản lý tài khoản |
| `nhansu`: Nhân sự | Xem danh sách, **cấp PIN** (hàng loạt/cấp lại), **tải Excel, in phiếu PIN**, **mở khóa** | Import, quản lý tài khoản |
| `admin`: Quản trị | Tất cả, cộng thêm **quản lý tài khoản** và **xem nhật ký** | |

Việc tách vai trò như trên giúp người import (Y tế) không bao giờ thấy PIN, và người phát PIN (Nhân sự) không thấy kết quả khám.

## Yêu cầu

- Node.js **22.13 trở lên** (có sẵn `node:sqlite`). Kiểm tra bằng `node -v`.
- Lúc khởi động, Node in cảnh báo `ExperimentalWarning: SQLite`. Cảnh báo này là bình thường.

## Cài đặt và chạy

```powershell
# 1. Tạo tài khoản quản trị đầu tiên (in ra mật khẩu tạm)
node server/cli.js add-admin quantri admin

# 2. Khai báo các máy được vào trang quản trị, rồi chạy máy chủ
$env:ADMIN_ALLOWED_IPS="127.0.0.1,::1,192.168.1.20,192.168.1.21"
$env:PUBLIC_URL="http://192.168.1.10:8080/"     # địa chỉ in trên phiếu PIN
node server/server.js            # mặc định cổng 8080
```

- Người lao động tra cứu tại `http://<ip-máy-chủ>:8080/`.
- Quản trị vào `http://<ip-máy-chủ>:8080/admin/` từ một máy nằm trong `ADMIN_ALLOWED_IPS`.

### Quy trình hằng kỳ

1. **Y tế** đăng nhập `/admin/`, vào tab *Import dữ liệu*, chọn file CSV, bấm *Kiểm tra file*. Nếu không có lỗi thì bấm *Xác nhận import*. Nhân viên mới sẽ ở trạng thái "Chưa có PIN".
2. **Nhân sự** vào tab *Phát PIN*, bấm *Cấp PIN cho tất cả người chưa có PIN*. Sau đó bấm **Tải Excel** hoặc **In phiếu PIN** (A4, 2 phiếu/hàng, cắt theo đường kẻ). PIN chỉ hiển thị một lần.
3. Khi người lao động quên PIN hoặc bị khóa, **Nhân sự** vào tab *Nhân viên*, tìm tên người đó, rồi bấm *Cấp lại PIN* hoặc *Mở khóa*.

### Bật HTTPS (bắt buộc khi dùng thật)

```bash
# Windows PowerShell
$env:TLS_CERT="C:\ksk\cert.pem"; $env:TLS_KEY="C:\ksk\key.pem"; node server/server.js
```

Nếu không có HTTPS, ngày sinh và PIN đi qua mạng nội bộ ở dạng không mã hóa.

### Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `HOST` / `PORT` | (trống = mọi địa chỉ IPv4 + IPv6) / `8080` | Địa chỉ lắng nghe. Nếu cổng bị chiếm, máy chủ báo lỗi và dừng |
| `TLS_CERT`, `TLS_KEY` | (trống) | Đường dẫn chứng chỉ để bật HTTPS |
| `TRUST_PROXY` | (tắt) | Đặt `1` nếu chạy sau reverse proxy (IIS/nginx), để lấy IP thật từ `X-Forwarded-For` |
| `MAX_FAILS`, `LOCK_MINUTES` | `5`, `30` | Khóa theo mã nhân viên |
| `IP_MAX_REQUESTS`, `IP_WINDOW_MINUTES` | `20`, `15` | Giới hạn theo IP |
| `ADMIN_ALLOWED_IPS` | `127.0.0.1,::1` (chỉ chính máy chủ) | Danh sách IP được vào `/admin/`, phân tách bằng dấu phẩy. Hỗ trợ dải IPv4 dạng `192.168.1.0/24` |
| `PUBLIC_URL` | (trống = địa chỉ đang mở trang quản trị) | Địa chỉ trang tra cứu in trên phiếu PIN, ví dụ `http://192.168.1.10:8080/`. **Nên đặt**, nếu không thì mở `/admin/` bằng `localhost` sẽ in ra `localhost` |
| `KSK_DATA_DIR` | `./data` | Thư mục chứa CSDL, log và file PIN |

## Công cụ dòng lệnh (dùng khi cài đặt hoặc xử lý sự cố)

```bash
node server/cli.js add-admin <tên> [admin|yte|nhansu]   # tạo tài khoản, in mật khẩu tạm
node server/cli.js reset-admin-password <tên>          # quên mật khẩu quản trị
node server/cli.js import <file.csv>                   # như tab Import
node server/cli.js issue-pins                          # như tab Phát PIN, xuất ra data/pins-*.csv
node server/cli.js reset-pin <mã_NV>                   # cấp lại PIN, đồng thời mở khóa
node server/cli.js unlock <mã_NV>                      # mở khóa tra cứu
node server/cli.js stats                               # số hồ sơ / chưa có PIN / đang khóa
```

Nếu dùng `issue-pins`, anh nhớ **xóa file `data/pins-*.csv`** sau khi đã phát PIN.

## Định dạng CSV

- 37 cột, **khớp theo tên cột**, không theo vị trí. Xem `sample_database.csv` (chỉ chứa dữ liệu giả).
- Dấu phân cách `,` hoặc `;` đều dùng được. Ô có dấu phẩy phải đặt trong ngoặc kép. File phải là UTF-8 (trong Excel chọn *CSV UTF-8*).
- Bắt buộc có: `họ_và_tên`, `mã_nhân_viên` (chữ/số, tối đa 20 ký tự), `ngày_sinh` (DD/MM/YYYY).

## Cấu trúc thư mục

```
public/        trang tra cứu: index.html, app.js, styles.css
admin-ui/      trang quản trị: index.html, admin.js, admin.css, xlsx.js (tạo file Excel)
server/        server.js (HTTP + tra cứu), admin.js (API quản trị), db.js (SQLite, PIN, tài khoản),
               records.js (đọc CSV), http-util.js (hàm dùng chung), cli.js (dòng lệnh)
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
- Khởi động lại máy chủ thì mọi người quản trị phải đăng nhập lại, vì phiên làm việc được giữ trong bộ nhớ.
- Nâng cấp từ Phase 1: CSDL cũ được tự nâng cấp khi khởi động. Nhân viên đã có PIN từ Phase 1 vẫn giữ nguyên PIN.
