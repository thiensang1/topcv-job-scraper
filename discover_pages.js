// --- TRINH SÁT VIÊN - PHIÊN BẢN "ĐIỀU TRA CÓ TUẦN TỰ" (Tối thượng) ---
// Cập nhật: Chờ nội dung chính ổn định trước, sau đó mới đọc tiêu đề kết quả.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const { buildUrl } = require('./url_builder');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 60000;
const PAGE_LOAD_TIMEOUT = 45000;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
        
        // --- LOGIC "ĐIỀU TRA CÓ TUẦN TỰ" ---
        // 1. Chờ "Nhân chứng Chính" (danh sách việc làm) xuất hiện trước.
        const jobListSelector = 'div.job-list-search-result';
        console.error("[Trinh sát] Đang chờ 'nhân chứng chính' (danh sách việc làm)...");
        await page.waitForSelector(jobListSelector, { timeout: 30000 });
        console.error("[Trinh sát] 'Nhân chứng chính' đã có mặt.");
        
        // 2. Thêm một khoảnh khắc "Quan sát" để đảm bảo "nhân chứng phụ" cũng đã ổn định.
        await sleep(3000); // Chờ 3 giây

        // 3. Bây giờ mới "thẩm vấn" "Nhân chứng Tấm biển".
        const headerSelector = 'div.search-result-header h1';
        console.error("[Trinh sát] Đang đọc 'tấm biển' thông báo kết quả...");
        
        const content = await page.content();
        const $ = cheerio.load(content);

        const headerText = $(headerSelector).text();
        
        let lastPage = 1;
        // Sử dụng biểu thức chính quy (regex) để tách ra con số cuối cùng
        const match = headerText.match(/\/ \s*(\d+)\s* trang/);
        
        if (match && match[1]) {
            const pageNumber = parseInt(match[1], 10);
            if (!isNaN(pageNumber)) {
                lastPage = pageNumber;
            }
        } else {
             console.error(`[Trinh sát] Cảnh báo: Không thể đọc số trang từ tiêu đề: "${headerText}". Mặc định là 1 trang.`);
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

