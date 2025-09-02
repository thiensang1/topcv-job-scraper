// --- NGUỒN CHÂN LÝ DUY NHẤT CHO URL - PHIÊN BẢN SỬA LỖI CÚ PHÁP ---
// Tên file: url_builder.js
// Cập nhật: Sửa lỗi cú pháp bằng cách sử dụng dấu backtick (`) cho chuỗi mẫu.

const BASE_URL = "https://www.topcv.vn";

/**
 * Tạo URL tìm kiếm cho TopCV dựa trên từ khóa và số trang.
 * @param {string} keyword - Từ khóa tìm kiếm (ví dụ: 'ke-toan', 'data-analyst').
 * @param {number} page - Số trang cần truy cập.
 * @returns {string} URL hoàn chỉnh.
 */
function buildUrl(keyword, page) {
    // SỬA LỖI: Sử dụng dấu backtick `...` thay vì dấu nháy đơn '...'
    if (keyword === 'ke-toan') {
        return `${BASE_URL}/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393`;
    } else {
        return `${BASE_URL}/tim-viec-lam-${keyword}?type_keyword=1&page=${page}&sba=1`;
    }
}

// "Xuất bản" hàm này để các file khác có thể "nhập khẩu" và sử dụng.
module.exports = { buildUrl };

