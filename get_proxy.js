// --- TỔNG QUẢN PROXY ---
// Nhiệm vụ: Quản lý và cung cấp một proxy hợp lệ, tuân thủ "luật chơi" của nhà cung cấp.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- CẤU HÌNH ---
// Thời gian tối thiểu giữa các lần gọi API (2.5 phút = 150000 ms)
const MIN_REQUEST_INTERVAL_MS = 150000; 
const STATE_FILE_PATH = path.join(__dirname, 'proxy_state.json');

async function getQuartermasterProxy() {
    const PROXY_API_KEY = process.env.PROXY_API_KEY;
    const PROXY_API_ENDPOINT = process.env.PROXY_API_ENDPOINT;

    if (!PROXY_API_KEY || !PROXY_API_ENDPOINT) {
        throw new Error("Lỗi nghiêm trọng: Thiếu thông tin PROXY_API_KEY hoặc PROXY_API_ENDPOINT trong GitHub Secrets.");
    }

    let currentState = {};
    if (fs.existsSync(STATE_FILE_PATH)) {
        try {
            currentState = JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf-8'));
        } catch (error) {
            console.warn("Cảnh báo: Không thể đọc file trạng thái proxy, sẽ yêu cầu proxy mới.");
            currentState = {};
        }
    }

    const timeSinceLastRequest = Date.now() - (currentState.lastRequestTimestamp || 0);

    // Quyết định Thông minh: Chỉ yêu cầu IP mới khi cần thiết
    if (currentState.proxy && timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
        console.log(`   -> [Tổng Quản] Tái sử dụng proxy cũ. Lần làm mới tiếp theo sau ${((MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest) / 1000).toFixed(0)} giây.`);
        return currentState.proxy;
    }

    // Yêu cầu một IP mới
    console.log("   -> [Tổng Quản] Đã đến lúc yêu cầu một proxy mới từ API...");
    try {
        const response = await axios.get(PROXY_API_ENDPOINT, {
            params: { key: PROXY_API_KEY, region: 'random' },
            timeout: 20000
        });

        // --- NÂNG CẤP "SIÊU PHIÊN DỊCH VIÊN" ---
        // Đọc chính xác cấu trúc phản hồi của KiotProxy
        if (response.data && response.data.success && response.data.data && response.data.data.http) {
            const proxyString = response.data.data.http;
            const [host, port] = proxyString.split(':');
            
            if (host && port) {
                const newProxy = { host, port, user: null, pass: null };
                
                // Cập nhật "Sổ sách"
                const newState = {
                    proxy: newProxy,
                    lastRequestTimestamp: Date.now()
                };
                fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(newState, null, 2));
                
                console.log(`   -> [Tổng Quản] Đã nhận và lưu proxy mới thành công: ${host}:${port}`);
                return newProxy;
            }
        }
        
        // Báo cáo chi tiết nếu cấu trúc không như mong đợi
        throw new Error(`Phản hồi từ API proxy không hợp lệ. Dữ liệu nhận được: ${JSON.stringify(response.data)}`);

    } catch (error) {
        let errorMessage = `Lỗi nghiêm trọng khi yêu cầu proxy mới: ${error.message}`;
        if (error.response) {
            errorMessage += `\n   -> BÁO CÁO: API trả về lỗi với mã trạng thái ${error.response.status}`;
            errorMessage += `\n   -> NỘI DUNG PHẢN HỒI TỪ API: ${JSON.stringify(error.response.data)}`;
        }
        console.error(errorMessage);
        throw new Error(errorMessage);
    }
}


// Chạy khi được gọi từ dòng lệnh
(async () => {
    try {
        const proxy = await getQuartermasterProxy();
        // Xuất ra output để GitHub Actions có thể "đọc" được
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `proxy_host=${proxy.host}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `proxy_port=${proxy.port}\n`);
    } catch (error) {
        console.error("Không thể lấy proxy. Dừng lại.");
        process.exit(1);
    }
})();

