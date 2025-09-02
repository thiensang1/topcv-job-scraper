// --- TRINH SÁT VIÊN - PHIÊN BẢN "ĐỌC HIỆU" ---
// Cập nhật: Đọc trực tiếp tổng số trang từ tiêu đề kết quả tìm kiếm.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const { buildUrl } = require('./url_builder');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 60000;
const PAGE_LOAD_TIMEOUT = 45000;

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
        console.error(`[Trinh sát] Đang khởi tạo trình duyệt với danh tính ${PROXY_HOST}...`);
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROME_EXECUTABLE_PATH,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const targetUrl = buildUrl(TARGET_KEYWORD, 1);
        console.error(`[Trinh sát] Đang do thám địa hình tại: ${targetUrl}`);
        
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
        
        // --- LOGIC MỚI: "ĐỌC HIỆU" ---
        // 1. Chờ đợi "tấm biển" chứa thông tin tổng số trang xuất hiện.
        const headerSelector = 'div.search-result-header h1';
        console.error("[Trinh sát] Đang chờ 'tấm biển' thông báo kết quả...");
        await page.waitForSelector(headerSelector, { timeout: 30000 });
        console.error("[Trinh sát] Đã phát hiện 'tấm biển'. Bắt đầu đọc.");

        const content = await page.content();
        const $ = cheerio.load(content);

        // 2. Đọc nội dung của "tấm biển"
        const headerText = $(headerSelector).text(); // Ví dụ: "Tìm thấy 2115 việc làm Kế Toán / 93 trang"
        
        let lastPage = 1;
        // 3. Sử dụng biểu thức chính quy (regex) để tách ra con số cuối cùng
        const match = headerText.match(/\/ \s*(\d+)\s* trang/);
        
        if (match && match[1]) {
            const pageNumber = parseInt(match[1], 10);
            if (!isNaN(pageNumber)) {
                lastPage = pageNumber;
            }
        } else {
             console.error("[Trinh sát] Cảnh báo: Không thể đọc số trang từ tiêu đề. Mặc định là 1 trang.");
        }
        
        console.error(`[Trinh sát] Báo cáo: Phát hiện có tổng cộng ${lastPage} trang.`);
        return lastPage;

    } catch (error) {
        console.error(`[Trinh sát] Nhiệm vụ thất bại: ${error.message}`);
        return 1;
    } finally {
        if (browser) {
            await browser.close();
            console.error("[Trinh sát] Rút lui an toàn.");
        }
    }
}

// Chạy hàm và chỉ in kết quả cuối cùng ra stdout
discoverTotalPages().then(count => {
    process.stdout.write(count.toString());
});

