// --- TRINH SÁT VIÊN - PHIÊN BẢN "NHÀ THÁM HIỂM" ---
// Cập nhật: Tự mình đi tìm trang cuối cùng bằng cách "Đối chiếu Hành trình".

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { buildUrl } = require('./url_builder');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 90000; // Tăng thời gian chờ cho các nhiệm vụ phức tạp
const PAGE_LOAD_TIMEOUT = 45000;
const MAX_PAGES_TO_CHECK = 200; // Giới hạn an toàn để tránh vòng lặp vô tận

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
        console.error(`[Nhà Thám hiểm] Đang khởi tạo trình duyệt với danh tính ${PROXY_HOST}...`);
        
        browser = await puppeteer.launch({
            headless: true,
            executablePath: CHROME_EXECUTABLE_PATH,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        let currentPage = 1;
        let lastKnownGoodPage = 1;

        console.error("[Nhà Thám hiểm] Bắt đầu hành trình tìm kiếm 'rìa thế giới'...");

        for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
            const targetUrl = buildUrl(TARGET_KEYWORD, i);
            console.error(`   -> Đang thám hiểm trang ${i}...`);
            
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

            const currentUrl = page.url();

            // Lấy số trang từ URL thực tế mà trình duyệt đang ở
            const urlParams = new URLSearchParams(new URL(currentUrl).search);
            const actualPage = parseInt(urlParams.get('page') || '1', 10);

            // "Đối chiếu Hành trình"
            if (actualPage < i) {
                // Nếu chúng ta muốn đến trang `i` nhưng lại bị đưa về một trang nhỏ hơn,
                // có nghĩa là chúng ta đã "rơi khỏi rìa thế giới".
                // Trang tốt cuối cùng mà chúng ta đã đến được chính là tổng số trang.
                console.error(`   -> Đã đến rìa thế giới! Bị đưa về trang ${actualPage} khi cố gắng đến trang ${i}.`);
                break; // Thoát khỏi vòng lặp
            }
            
            // Nếu hành trình thành công, cập nhật lại vị trí đã biết
            lastKnownGoodPage = i;
            
            // Kiểm tra xem có nội dung không, nếu trang trống thì cũng dừng lại
             const jobListSelector = 'div.job-list-search-result';
             const jobItems = await page.$$(jobListSelector + ' div[class*="job-item"]');
             if (jobItems.length === 0) {
                 console.error(`   -> Phát hiện trang ${i} không có nội dung. Dừng lại.`);
                 break;
             }
        }
        
        console.error(`[Nhà Thám hiểm] Báo cáo: "Rìa thế giới" nằm ở trang ${lastKnownGoodPage}.`);
        return lastKnownGoodPage;

    } catch (error) {
        console.error(`[Nhà Thám hiểm] Nhiệm vụ thất bại: ${error.message}`);
        return 1;
    } finally {
        if (browser) {
            await browser.close();
            console.error("[Nhà Thám hiểm] Rút lui an toàn.");
        }
    }
}

// Chạy hàm và chỉ in kết quả cuối cùng ra stdout
discoverTotalPages().then(count => {
    process.stdout.write(count.toString());
});

