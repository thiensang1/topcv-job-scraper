// --- TRINH SÁT VIÊN - PHIÊN BẢN "THÁM TỬ TỰ CHỦ" ---
// Cập nhật: Kết hợp logic "Thám tử Dày dạn" và kiến trúc "Tự chủ".

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { buildUrl } = require('./url_builder');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-toan"; 
const BROWSER_TIMEOUT = 90000; 
const PAGE_LOAD_TIMEOUT = 45000;
const MAX_PAGES_TO_CHECK = 200; // Giới hạn an toàn để tránh vòng lặp vô tận

async function discoverTotalPages() {
    let browser;
    const PROXY_HOST = process.env.PROXY_HOST;
    const PROXY_PORT = process.env.PROXY_PORT;

    if (!PROXY_HOST || !PROXY_PORT) {
        console.error("Lỗi nghiêm trọng: Trinh sát viên không được trang bị proxy. Dừng lại.");
        return 1;
    }

    const browserArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--proxy-server=${PROXY_HOST}:${PROXY_PORT}`,
    ];

    try {
        console.error(`[Thám tử] Đang khởi tạo trình duyệt với danh tính ${PROXY_HOST}...`);
        
        // KIẾN TRÚC "TỰ CHỦ": Tin tưởng Puppeteer tự tìm trình duyệt
        browser = await puppeteer.launch({
            headless: true,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            timeout: BROWSER_TIMEOUT
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        let lastKnownGoodPage = 1;

        console.error("[Thám tử] Bắt đầu hành trình tìm kiếm 'rìa thế giới'...");

        // LOGIC "THÁM TỬ DÀY DẠN"
        for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
            const targetUrl = buildUrl(TARGET_KEYWORD, i);
            console.error(`   -> Đang thám hiểm trang ${i}...`);
            
            try {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });

                const currentUrl = page.url();

                // Lấy số trang từ URL thực tế mà trình duyệt đang ở
                const urlParams = new URLSearchParams(new URL(currentUrl).search);
                const actualPage = parseInt(urlParams.get('page') || '1', 10);

                // "Đối chiếu Hành trình" - Chỉ tin vào "la bàn"
                if (actualPage < i) {
                    console.error(`   -> Đã đến rìa thế giới! Bị đưa về trang ${actualPage} khi cố gắng đến trang ${i}.`);
                    break; // Thoát khỏi vòng lặp
                }
                
                // Nếu hành trình thành công, cập nhật lại vị trí đã biết
                lastKnownGoodPage = i;

            } catch (error) {
                 console.error(`   -> Gặp lỗi khi thám hiểm trang ${i}: ${error.message}. Coi như đã đến trang cuối.`);
                 break;
            }
        }
        
        console.error(`[Thám tử] Báo cáo: "Rìa thế giới" nằm ở trang ${lastKnownGoodPage}.`);
        return lastKnownGoodPage;

    } catch (error) {
        console.error(`[Thám tử] Nhiệm vụ thất bại: ${error.message}`);
        return 1;
    } finally {
        if (browser) {
            await browser.close();
            console.error("[Thám tử] Rút lui an toàn.");
        }
    }
}

// Chạy hàm và chỉ in kết quả cuối cùng ra stdout
discoverTotalPages().then(count => {
    process.stdout.write(count.toString());
});

