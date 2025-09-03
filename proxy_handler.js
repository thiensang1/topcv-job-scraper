// --- NGƯỜI XỬ LÝ PROXY (BỘ ĐÀM) ---
// Nhiệm vụ: Cung cấp một hàm duy nhất để giao tiếp với API Proxy.
const axios = require('axios');

/**
 * Yêu cầu một danh tính proxy mới từ API của nhà cung cấp.
 * @param {string} apiKey - Chìa khóa API bí mật của bạn.
 * @param {string} apiEndpoint - Đường dẫn API để lấy proxy mới.
 * @returns {Promise<object|null>} Một đối tượng chứa { host, port } hoặc null nếu thất bại.
 */
async function getNewProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("Cảnh báo: Không có thông tin API Proxy.");
        return null;
    }
    try {
        // Sử dụng console.error để ghi nhật ký, tránh làm nhiễu output chính
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 15000 // Chờ tối đa 15 giây
        });

        // Dựa trên cấu trúc thực tế mà bạn đã cung cấp
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`   -> [Bộ đàm] Đã nhận danh tính mới thành công: ${host}:${port}`);
            return { host, port };
        }
        
        // Ném lỗi nếu cấu trúc phản hồi không như mong đợi
        throw new Error(`Phản hồi không như mong đợi: ${JSON.stringify(response.data)}`);

    } catch (error) {
        console.error(`   -> [Bộ đàm] Lỗi nghiêm trọng khi yêu cầu danh tính mới: ${error.message}`);
        return null; // Trả về null để báo hiệu thất bại
    }
}

// "Xuất bản" hàm này để các file khác có thể "nhập khẩu" và sử dụng.
module.exports = { getNewProxy };

