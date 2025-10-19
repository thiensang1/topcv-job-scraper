# Hệ Thống Tự Động Thu Thập Dữ Liệu Việc Làm (Job Scraper)

Dự án cá nhân xây dựng một hệ thống tự động thu thập, xử lý và lưu trữ dữ liệu việc làm từ nhiều trang tuyển dụng lớn tại Việt Nam, được triển khai hoàn toàn bằng GitHub Actions.

## Mục Tiêu Dự Án

Mục tiêu của dự án là xây dựng một pipeline dữ liệu tự động để thu thập thông tin tuyển dụng. Dữ liệu này là nền tảng cho các phân tích sâu hơn nhằm:
- **Phân tích xu hướng tuyển dụng** trong các giai đoạn khác nhau.
- **Dự báo các ngành nghề và kỹ năng** có tiềm năng tăng trưởng trong tương lai.

## Tính Năng 

- **Thu thập đa nguồn:** Tự động cào dữ liệu từ 3 trang tuyển dụng hàng đầu: **TopCV**, **VietnamWorks**, và **CareerViet**.
- **Tự động hóa hoàn toàn:** Toàn bộ quy trình được tự động hóa bằng **GitHub Actions**, tự chạy theo lịch trình (4 lần/ngày), thu thập dữ liệu và commit kết quả vào repository. (hiện tại đã tạm dừng chạy tự động, có thể kích hoạt lại bằng cách thêm schedule và cron)
- **Kỹ thuật Scraping Nâng cao:** Áp dụng nhiều chiến thuật phức tạp để đối phó với các thách thức khác nhau từ mỗi trang web.
- **Khả năng chịu lỗi:** Tích hợp logic xử lý lỗi và cơ chế thử lại để đảm bảo hệ thống hoạt động ổn định.

## Công cụ đã sử dụng

- **Ngôn ngữ:** Node.js
- **Thư viện Scraping:**
  - **Puppeteer Extra & Stealth Plugin:** Để mô phỏng trình duyệt, vượt qua các hệ thống chống bot phức tạp (sử dụng cho TopCV).
  - **Axios & Cheerio:** Để gửi yêu cầu HTTP và phân tích dữ liệu API ẩn hoặc dữ liệu JSON nhúng trong HTML (sử dụng cho VietnamWorks & CareerViet).
- **Tự động hóa (CI/CD):** GitHub Actions
- **Lưu trữ:** Dữ liệu được xử lý và lưu dưới định dạng file CSV.

## Cách Hoạt Động & Cấu Trúc

Hệ thống bao gồm các scrapers độc lập, mỗi scraperđược trang bị kịch bản riêng để đối phó với từng mục tiêu:

### 1. Scraper TopCV
- **Thách thức:** TopCV có hệ thống chống bot rất mạnh và tải dữ liệu động bằng JavaScript.
- **Giải pháp:**
  - Sử dụng **Puppeteer Extra Stealth** kết hợp **Proxy động** để tạo ra một trình duyệt mô phỏng không thể bị phân biệt.
  - Áp dụng chiến thuật chờ trang tải xong hoàn toàn dữ liệu động trước khi khai thác.
  - Triển khai **3 kịch bản do thám ngẫu nhiên dự phòng** (Tuần tự, Nhị phân, Đảo ngược) để tìm tổng số trang một cách khó đoán.

### 2. Scraper VietnamWorks & CareerViet
- **Thách thức:** Các trang này không hiển thị dữ liệu trực tiếp trên HTML mà gọi qua các API ẩn.
- **Giải pháp:**
  - Phân tích Network Traffic để tìm ra các **API endpoint** và cấu trúc dữ liệu JSON.
  - Sử dụng **Axios** để gửi yêu cầu `POST` trực tiếp đến các API này, giúp lấy dữ liệu nhanh và hiệu quả hơn rất nhiều so với Puppeteer.
  - Xử lý và chuẩn hóa dữ liệu JSON trả về trước khi lưu.

## Cài Đặt & Chạy Thử

1.  Clone repository này về máy.
2.  Chạy `npm install` để cài đặt các thư viện cần thiết.
3.  Tạo các **Secrets** trên GitHub repository (nếu muốn chạy với Proxy):
    - `PROXY_API_ENDPOINT`: Đường dẫn API của nhà cung cấp proxy.
    - `PROXY_API_KEY`: API key.
4.  Để chạy thủ công, vào tab **Actions**, chọn workflow tương ứng và nhấn "Run workflow".
