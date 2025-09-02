// --- TRINH SÁT VIÊN - PHIÊN BẢN "NGHE LÉN" ---
// Cập nhật: Lắng nghe các yêu cầu mạng và đọc tổng số trang trực tiếp từ API.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { buildUrl } = require('./url_builder');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 60000;
const PAGE_LOAD_TIMEOUT = 45000;
// URL của "tổng đài bí mật" (API) mà chúng ta cần nghe lén
const API_URL_TO_INTERCEPT = 'api-v2.topcv.vn/jobs/search';

async function discoverTotalPages() {
    let browser;
    const PROXY_HOST = process.env.PROXY_HOST;
    const PROXY_PORT = process.env.PROXY_PORT;
    const CHROME_EXECUTABLE_PATH = process.env.CHROME_PATH;

    if (!PROXY_HOST || !PROXY_PORT) {
        console.error("Lỗi nghiêm trọng: Trinh sát viên không được trang bị proxy. Dừng lại.");
        return 1;
    }
    
    if (!CHROME_EXECUTABLE_PATH) {
        console.error("Lỗi nghiêm trọng: Trinh sát viên không nhận được 'Bản đồ Dẫn đường' (CHROME_PATH). Dừng lại.");
        return 1;
    }

    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${PROXY_HOST}:${PROXY_PORT}`,
    ];

    try {
        console.error(`[Điệp viên] Đang khởi tạo trình duyệt với danh tính ${PROXY_HOST}...`);
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROME_EXECUTABLE_PATH,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        // --- LOGIC MỚI: "NGHE LÉN" ---
        let lastPage = 1; // Giá trị mặc định nếu không nghe lén được
        
        // 1. Tạo một "lời hứa" - chương trình sẽ chờ cho đến khi lời hứa này được hoàn thành
        const apiResponsePromise = new Promise((resolve, reject) => {
            // 2. Bật "máy nghe lén"
            page.on('response', async (response) => {
                // 3. Kiểm tra xem "cuộc hội thoại" có đến từ đúng "tổng đài" không
                if (response.url().includes(API_URL_TO_INTERCEPT) && response.request().method() === 'POST') {
                    console.error("[Điệp viên] Đã bắt được tín hiệu từ tổng đài API...");
                    try {
                        const jsonResponse = await response.json();
                        // 4. "Giải mã" gói tin và tìm thông tin tình báo
                        if (jsonResponse && jsonResponse.data && jsonResponse.data.meta && jsonResponse.data.meta.last_page) {
                            const totalPages = jsonResponse.data.meta.last_page;
                            console.error(`[Điệp viên] Giải mã thành công. Báo cáo: có tổng cộng ${totalPages} trang.`);
                            // 5. Hoàn thành "lời hứa" và gửi kết quả về
                            resolve(totalPages);
                        }
                    } catch (e) {
                        // Bỏ qua nếu không thể giải mã (ví dụ: các yêu cầu pre-flight OPTIONS)
                    }
                }
            });

            // Đặt một bộ đếm thời gian để tránh chờ đợi vô tận
            setTimeout(() => {
                reject(new Error("Hết thời gian chờ phản hồi từ API."));
            }, 25000);
        });

        const targetUrl = buildUrl(TARGET_KEYWORD, 1);
        console.error(`[Điệp viên] Đang tiếp cận mục tiêu để kích hoạt 'cuộc hội thoại': ${targetUrl}`);
        
        // 6. Kích hoạt "cuộc hội thoại" bằng cách truy cập trang
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

        // 7. Chờ "lời hứa" được hoàn thành (chờ "máy nghe lén" có kết quả)
        lastPage = await apiResponsePromise;
        
        return lastPage;

    } catch (error) {
        console.error(`[Điệp viên] Nhiệm vụ thất bại: ${error.message}`);
        return 1;
    } finally {
        if (browser) {
            await browser.close();
            console.error("[Điệp viên] Rút lui an toàn.");
        }
    }
}

// Chạy hàm và chỉ in kết quả cuối cùng ra stdout
discoverTotalPages().then(count => {
    process.stdout.write(count.toString());
});

