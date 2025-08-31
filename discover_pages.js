// --- TRINH SÁT VIÊN (SCOUT SCRIPT) ---
// Nhiệm vụ: Truy cập trang đầu tiên, tìm ra tổng số trang và báo cáo lại.
// Chạy cực kỳ nhanh, nhẹ và không cần proxy.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const KEYWORD = 'ke-toan'; // Từ khóa mục tiêu để trinh sát
const BASE_URL = "https://www.topcv.vn";

(async () => {
    let browser = null;
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Cấu hình cần thiết cho GitHub Actions
        });
        const page = await browser.newPage();
        
        const targetUrl = `${BASE_URL}/tim-viec-lam-${KEYWORD}-cr392cb393?type_keyword=1&page=1&category_family=r392~b393`;
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Chờ thanh phân trang xuất hiện
        await page.waitForSelector('ul.pagination', { timeout: 30000 });

        // Lấy số của trang cuối cùng từ thanh phân trang
        const lastPageNumber = await page.evaluate(() => {
            const pageItems = document.querySelectorAll('ul.pagination li a');
            // Tìm phần tử gần cuối cùng, vì phần tử cuối là nút "Next"
            const lastPageElement = pageItems[pageItems.length - 2]; 
            return lastPageElement ? parseInt(lastPageElement.textContent.trim(), 10) : 1;
        });

        // In ra kết quả để GitHub Actions có thể "bắt" được
        console.log(lastPageNumber);

    } catch (error) {
        console.error(`Lỗi khi trinh sát: ${error.message}`);
        // Nếu có lỗi, mặc định trả về 1 trang để tránh làm hỏng quy trình
        console.log(1); 
    } finally {
        if (browser) {
            await browser.close();
        }
    }
})();
