// --- NGƯỜI XỬ LÝ PROXY (BỘ ĐÀM) ---
// Nhiệm vụ: Cung cấp một hàm duy nhất để giao tiếp với API Proxy.
const axios = require('axios');

async function getNewProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("Cảnh báo: Không có thông tin API Proxy.");
        return null;
    }
    try {
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 15000
        });
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`   -> [Bộ đàm] Đã nhận danh tính mới thành công: ${host}:${port}`);
            return { host, port };
        }
        throw new Error(`Phản hồi không như mong đợi: ${JSON.stringify(response.data)}`);
    } catch (error) {
        console.error(`   -> [Bộ đàm] Lỗi nghiêm trọng khi yêu cầu danh tính mới: ${error.message}`);
        return null;
    }
}

module.exports = { getNewProxy };
