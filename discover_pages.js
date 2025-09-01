// --- TRINH SÁT VIÊN ---
// Nhiệm vụ: Truy cập trang đầu tiên và tìm ra tổng số trang kết quả.
// File: discover_pages.js

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const TARGET_URL = 'https://www.topcv.vn/tim-viec-lam-ke-toan-cr392cb393?type_keyword=1&page=1&category_family=r392~b393';

(async () => {
    let browser = null;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Chờ thanh phân trang xuất hiện
        const paginationSelector = 'ul.pagination';
        await page.waitForSelector(paginationSelector, { timeout: 30000 });

        // Tìm số của trang cuối cùng
        const totalPages = await page.evaluate((selector) => {
            const paginationItems = document.querySelectorAll(`${selector} li a`);
            let maxPage = 1;
            paginationItems.forEach(item => {
                const pageNum = parseInt(item.textContent.trim(), 10);
                if (!isNaN(pageNum) && pageNum > maxPage) {
                    maxPage = pageNum;
                }
            });
            return maxPage;
        }, paginationSelector);
        
        // In ra kết quả để GitHub Actions có thể "bắt" được
        console.log(totalPages);

    } catch (error) {
        console.error(`Lỗi khi trinh sát: ${error.message}`);
        console.log(1); // Nếu có lỗi, mặc định trả về 1 trang để tránh lỗi toàn hệ thống
    } finally {
        if (browser) {
            await browser.close();
        }
    }
})();

