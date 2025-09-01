// --- TRINH SÁT VIÊN - PHIÊN BẢN "BÁO CÁO SẠCH" ---
// Cập nhật: Chuyển toàn bộ nhật ký sang stderr để không làm nhiễu output.

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
    const CHROME_EXECUTABLE_PATH = process.env.CHROME_PATH;

    if (!PROXY_HOST || !PROXY_PORT) {
        // Luồng phụ: Ghi nhật ký lỗi vào stderr
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
        console.error(`[Trinh sát] Sử dụng "chiếc xe" tại: ${CHROME_EXECUTABLE_PATH}`);
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROME_EXECUTABLE_PATH,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const targetUrl = `https://www.topcv.vn/tim-viec-lam-${TARGET_KEYWORD}-cr392cb393?type_keyword=1&page=1&category_family=r392~b393`;
        console.error("[Trinh sát] Đang do thám địa hình tại trang 1...");
        
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

        await page.waitForSelector('ul.pagination', { timeout: 30000 });
        console.error("[Trinh sát] Đã phát hiện thanh phân trang.");

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
    // Luồng chính thức: Chỉ ghi kết quả cuối cùng ra stdout để GitHub Actions đọc
    process.stdout.write(count.toString());
});

