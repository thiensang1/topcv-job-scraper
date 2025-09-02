// --- TRINH SÁT VIÊN - PHIÊN BẢN "KIÊN NHẪN" ---
// Cập nhật: Chờ danh sách việc làm ổn định trước khi đọc thanh phân trang.

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
        
        // --- LOGIC MỚI: "KIÊN NHẪN" ---
        // 1. Chờ đợi nội dung chính (danh sách việc làm) xuất hiện và ổn định
        const jobListSelector = 'div.job-list-search-result';
        console.error("[Trinh sát] Đang chờ nội dung chính ổn định...");
        await page.waitForSelector(jobListSelector, { timeout: 30000 });
        
        // 2. Thêm một khoảnh khắc "nhìn" để JavaScript cuối cùng chạy
        await sleep(3000); // Chờ 3 giây
        console.error("[Trinh sát] Nội dung chính đã ổn định. Bắt đầu đọc thanh phân trang thực sự.");
        
        const content = await page.content();
        const $ = cheerio.load(content);

        // 3. Đọc thanh phân trang đã được hiển thị đầy đủ
        const pagination = $('ul.pagination');
        if (pagination.length === 0) {
            console.error("[Trinh sát] Cảnh báo: Không tìm thấy thanh phân trang sau khi chờ. Mặc định là 1 trang.");
            return 1;
        }

        let lastPage = 1;
        const lastPageLink = pagination.find('li:nth-last-child(2) a');

        if (lastPageLink.length > 0) {
            const pageText = lastPageLink.text().trim();
            const pageNumber = parseInt(pageText, 10);
            if (!isNaN(pageNumber)) {
                lastPage = pageNumber;
            }
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

