// --- NGUỒN CHÂN LÝ DUY NHẤT CHO URL ---
// Tên file: url_builder.js
// Mục đích: Cung cấp một hàm duy nhất để tạo URL, đảm bảo tính nhất quán
// cho cả trinh sát viên và công nhân.

const BASE_URL = "https://www.topcv.vn";

/**
 * Tạo URL tìm kiếm cho TopCV dựa trên từ khóa và số trang.
 * @param {string} keyword - Từ khóa tìm kiếm (ví dụ: 'ke-toan', 'data-analyst').
 * @param {number} page - Số trang cần truy cập.
 * @returns {string} URL hoàn chỉnh.
 */
function buildUrl(keyword, page) {
    // Logic tạo URL đã được kiểm chứng, giờ đây được tập trung tại một nơi duy nhất.
    if (keyword === 'ke-toan') {
        return ${BASE_URL}/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393;
    } else {
        // Cấu trúc URL mặc định cho các từ khóa khác
        return ${BASE_URL}/tim-viec-lam-${keyword}?type_keyword=1&page=${page}&sba=1;
    }
}

// "Xuất bản" hàm này để các file khác có thể "nhập khẩu" và sử dụng.
module.exports = { buildUrl };