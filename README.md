# VNPOST WORKER HEALTH LOOKUP SYSTEM & CMS
## Hệ Thống Tra Cứu Hồ Sơ Sức Khỏe Lao Động Bưu Điện (VNPost)

Dự án website tra cứu kết quả khám sức khỏe định kỳ của người lao động Bưu điện với giao diện phẳng hiện đại lấy cảm hứng từ thương hiệu **Vietnam Post** (Màu chủ đạo: Vàng Bưu điện `#F58B13` & Xanh Bưu điện `#00529C`).

---

### 1. GIẢI PHÁP BẢO MẬT THEO CẤU TRÚC DỮ LIỆU LAO ĐỘNG THỰC TẾ

#### A. Tra Cứu 2 Yếu Tố Khớp Dữ Liệu Thực Tế (Multi-Factor Lookup)
- **Đặc thù DB y tế Bưu điện:** Bảng danh sách khám sức khỏe Excel quản lý theo **Mã HRM (Mã nhân viên Bưu điện)**, **Họ tên** và **Ngày tháng năm sinh**.
- **Cơ chế xác thực 2 yếu tố:**
  1. `Mã HRM` (Ví dụ: `00269118`) hoặc `Họ và Tên`.
  2. `Ngày sinh` chính chủ (Ví dụ: `09/10/1992` - Định dạng DD/MM/YYYY).
  - **SQL Query đằng sau (Chuẩn Backend):**
    ```sql
    SELECT * FROM worker_health_records 
    WHERE (hrm_code = :hrm_code OR full_name = :full_name) 
      AND dob = :dob;
    ```
- **Lợi ích:** Dù đồng nghiệp biết Mã HRM của nhau nhưng không thể truy cập nếu không biết chính xác Ngày tháng năm sinh của người lao động đó.

#### B. Che Mờ Định Danh (Data Masking)
- Mã HRM trên phiếu và bảng CMS hiển thị dạng masked: `0026****`
- Tích hợp nút bật/tắt hiển thị đầy đủ Mã HRM.

---

### 2. DỮ LIỆU MẪU CHUẨN VÀ CẤU TRÚC BẢNG KHÁM SỨC KHỎE

Hệ thống đã khớp chuẩn 37 cột khám sức khỏe người lao động Bưu điện:
1. `STT` (Số thứ tự khám)
2. `HỌ TÊN` (EO CHANG HY...)
3. `HRM` (Mã nhân viên)
4. `GIỚI TÍNH` & `NGÀY SINH`
5. `Chức danh`, `Bưu cục/VHX`, `ĐƠN VỊ`
6. `Chiều cao`, `Cân nặng`, `Thể lực`, `Huyết áp`
7. `Thị lực Mắt` (Phải/Trái/Bệnh)
8. `TMH`, `RHM`, `Nội da liễu`, `Ngoại`, `X-quang`, `Siêu âm ổ bụng`
9. `12 Chỉ số xét nghiệm máu & nước tiểu` (CTM, Nước tiểu, Acid Uric, Creatinin, Glucose, Ure, SGOT, SGPT, Triglycerides, Cholesterol, GGT, Morphin)
10. `PHÂN LOẠI SỨC KHỎE` (Loại I, II, III, IV)
11. `KẾT LUẬN` & `TƯ VẤN BÁC SĨ`

---

### 3. CÁC FILE CHÍNH TRONG DỰ ÁN

- [`index.html`](file:///d:/Dev/ksk/index.html): Giao diện Trang chủ Tra cứu, Quản trị CMS và Panel Tư vấn bảo mật.
- [`styles.css`](file:///d:/Dev/ksk/styles.css): Bảng màu Vietnam Post, Flat Modern UI & Bảng chỉ số xét nghiệm.
- [`app.js`](file:///d:/Dev/ksk/app.js): Logic tra cứu Mã HRM + Ngày sinh, che mờ mã hóa, CSV Import chuẩn 37 cột Bưu điện và CRUD LocalStorage.
- [`sample_database.csv`](file:///d:/Dev/ksk/sample_database.csv): File mẫu CSV chứa dữ liệu thực tế worker (EO CHANG HY - HRM `00269118`).
- [`database_schema.json`](file:///d:/Dev/ksk/database_schema.json): File Schema JSON chuẩn.

---

### 4. HƯỚNG DẪN THỬ NGHIỆM TRA CỨU

1. Mở trực tiếp file [`index.html`](file:///d:/Dev/ksk/index.html) bằng trình duyệt web.
2. Thử nghiệm thông tin thực tế từ hình ảnh Excel:
   - **Mã HRM:** `00269118`
   - **Ngày sinh:** `09/10/1992`
   - **Mã CAPTCHA:** Nhập đúng 4 số trên màn hình.
   - Click nút **"TRA CỨU HỒ SƠ KHÁM"** -> Hiển thị kết quả khám sức khỏe lao động chi tiết của lao động **EO CHANG HY** (Phân loại sức khỏe: LOẠI II, Siêu âm: Polype túi mật).
