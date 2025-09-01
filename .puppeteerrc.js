// --- SÁCH HƯỚNG DẪN LẮP RÁP CHÍNH THỨC CHO PUPPETEER ---
// Tên file: .puppeteerrc.js (có dấu chấm ở đầu)
// Mục đích: Ra lệnh cho Puppeteer tự động tải về trình duyệt Chrome khi cài đặt.

const { join } = require('path');

module.exports = {
  // Đường dẫn lưu trữ cache cho trình duyệt đã tải về
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),

  // Chỉ thị quan trọng: Tải về trình duyệt 'chrome'
  // Điều này đảm bảo 'chiếc xe' luôn có sẵn cho 'robot tài xế'
  browser: 'chrome',
};
