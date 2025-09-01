// --- TRINH SÁT VIÊN - PHIÊN BẢN "BẢN ĐỒ" ---
// Nhiệm vụ: Sử dụng Proxy và "Bản đồ Dẫn đường" (executablePath) để do thám địa hình.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 60000;
const PAGE_LOAD_TIMEOUT = 45000;

async function discoverTotalPages() {
    let browser;
    // Đọc thông tin proxy và "bản đồ" từ "bộ não" điều phối
    const PROXY_HOST = process.env.PROXY_HOST;
    const PROXY_PORT = process.env.PROXY_PORT;
    const CHROME_EXECUTABLE_PATH = process.env.CHROME_PATH; // Nhận "tọa độ" của "chiếc xe"

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
        console.log(`[Trinh sát] Đang khởi tạo trình duyệt với danh tính ${PROXY_HOST}...`);
        console.log(`[Trinh sát] Sử dụng "chiếc xe" tại: ${CHROME_EXECUTABLE_PATH}`);
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROME_EXECUTABLE_PATH, // Sử dụng "Bản đồ" để khởi động đúng "chiếc xe"
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const targetUrl = `https://www.topcv.vn/tim-viec-lam-${TARGET_KEYWORD}-cr392cb393?type_keyword=1&page=1&category_family=r392~b393`;
        console.log("[Trinh sát] Đang do thám địa hình tại trang 1...");
        
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

        await page.waitForSelector('ul.pagination', { timeout: 30000 });
        console.log("[Trinh sát] Đã phát hiện thanh phân trang.");

        const content = await page.content();
        const $ = cheerio.load(content);

        let lastPage = 1;
        const lastPageLink = $('ul.pagination li:nth-last-child(2) a');

        if (lastPageLink.length > 0) {
            const pageText = lastPageLink.text().trim();
            const pageNumber = parseInt(pageText, 10);
            if (!isNaN(pageNumber)) {
                lastPage = pageNumber;
            }
        }
        
        console.log(`[Trinh sát] Báo cáo: Phát hiện có tổng cộng ${lastPage} trang.`);
        return lastPage;

    } catch (error) {
        console.error(`[Trinh sát] Nhiệm vụ thất bại: ${error.message}`);
        return 1;
    } finally {
        if (browser) {
            await browser.close();
            console.log("[Trinh sát] Rút lui an toàn.");
        }
    }
}

discoverTotalPages().then(count => {
    process.stdout.write(count.toString());
});

