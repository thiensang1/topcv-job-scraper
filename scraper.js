// --- ĐIỆP VIÊN ĐƠN ĐỘC (SCRAPER) - PHIÊN BẢN TỐI THƯỢNG ---
// Cập nhật: Fix commit error, cải thiện anti-bot, update selector.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-to-an"; // Kế toán, phân tách cho URL
const BROWSER_TIMEOUT = 120000;
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_PAGES_TO_CHECK = 150;

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

function convertPostTimeToDate(timeString) {
    if (!timeString) return null;
    const now = new Date();
    const normalizedString = timeString.toLowerCase().trim();
    if (normalizedString.includes('hôm qua')) { now.setDate(now.getDate() - 1); } 
    else if (normalizedString.includes('hôm kia')) { now.setDate(now.getDate() - 2); } 
    else if (normalizedString.includes('ngày trước')) {
        const days = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(days)) now.setDate(now.getDate() - days);
    } else if (normalizedString.includes('tuần trước')) {
        const weeks = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(weeks)) now.setDate(now.getDate() - (weeks * 7));
    } else if (normalizedString.includes('tháng trước')) {
        const months = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(months)) now.setMonth(now.getMonth() - months);
    } else if (normalizedString.includes('năm trước')) {
        const years = parseInt(normalizedString.match(/\d+/)[0]);
        if (!isNaN(years)) now.setFullYear(now.getFullYear() - years);
    } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(normalizedString)) {
        const parts = normalizedString.split('-');
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return now.toISOString().split('T')[0];
}

function buildUrl(keyword, page) {
    const BASE_URL = "https://www.topcv.vn";
    if (keyword === 'ke-to-an') {
        return `${BASE_URL}/tim-viec-lam-ke-to-an-cr392cb393?type_keyword=1&page=${page}&category_family=r392~b393`;
    } else {
        return `${BASE_URL}/tim-viec-lam-${keyword}?type_keyword=1&page=${page}&sba=1`;
    }
}

async function getProxy(apiKey, apiEndpoint) {
    if (!apiKey || !apiEndpoint) {
        console.error("Cảnh báo: Không có thông tin API Proxy. Chạy không cần proxy.");
        return null;
    }
    try {
        console.error("-> [Điệp viên] Đang yêu cầu một danh tính proxy MỚI từ API...");
        const response = await axios.get(apiEndpoint, {
            params: { key: apiKey, region: 'random' },
            timeout: 20000
        });
        if (response.data?.success && response.data?.data?.http) {
            const [host, port] = response.data.data.http.split(':');
            console.error(`-> [Điệp viên] Đã nhận proxy mới thành công: ${host}:${port}`);
            return { host, port };
        }
        throw new Error(`Phản hồi không như mong đợi: ${JSON.stringify(response.data)}`);
    } catch (error) {
        console.error(`-> [Điệp viên] Lỗi nghiêm trọng khi yêu cầu proxy mới: ${error.message}`);
        throw error;
    }
}

// --- CÁC KỊCH BẢN DO THÁM ---

async function discoverPagesByPaginateText(page) {
    const targetUrl = buildUrl(TARGET_KEYWORD, 1);
    console.error(`   -> [Tối ưu] Đang truy cập trang 1 để đọc tổng số trang...`);
    try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
        const paginateText = await page.evaluate(() => {
            const span = document.querySelector('#job-listing-paginate-text');
            if (span) return span.innerText.replace(/\u00A0/g, ' ');
            const elements = document.querySelectorAll('title, h1, p, div');
            for (let el of elements) {
                if (el.innerText.includes('Tìm thấy') || el.innerText.includes('Tuyển dụng')) {
                    return el.innerText.replace(/\u00A0/g, ' ');
                }
            }
            return '';
        });
        console.error(`   -> [Tối ưu] Tìm thấy: "${paginateText}"`);
        let match = paginateText.match(/\/ (\d+) trang/) || paginateText.match(/trang \d+ \/ (\d+)/);
        let totalPages = match ? parseInt(match[1]) : 0;
        if (totalPages === 0) {
            match = paginateText.match(/Tìm thấy (\d+(?:\.\d+)?) tin đăng/) || paginateText.match(/Tuyển dụng (\d+(?:\.\d+)?) việc làm/);
            if (match) {
                const totalJobs = parseInt(match[1].replace(/\./g, ''));
                totalPages = Math.ceil(totalJobs / 20);
            }
        }
        console.error(`   -> [Tối ưu] Tổng pages: ${totalPages}`);
        if (!isNaN(totalPages) && totalPages > 0) {
            return totalPages;
        }
        throw new Error("Không parse được số trang từ job-listing-paginate-text hoặc fallback.");
    } catch (error) {
        console.error(`   -> [Tối ưu] Lỗi: ${error.message}`);
        throw new Error("Không thể áp dụng phương pháp do thám tối ưu.");
    }
}

async function discoverPagesLinearly(page) { 
    let lastKnownGoodPage = 1;
    for (let i = 1; i <= MAX_PAGES_TO_CHECK; i++) {
        const targetUrl = buildUrl(TARGET_KEYWORD, i);
        console.error(`   -> [Tuần tự] Đang thám hiểm trang ${i}...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_LOAD_TIMEOUT });
            const content = await page.content();
            const $ = cheerio.load(content);
            const currentUrl = page.url();
            const urlParams = new URLSearchParams(new URL(currentUrl).search);
            const actualPage = parseInt(urlParams.get('page') || '1', 10);
            if (actualPage < i || $('div.job-item').length === 0) { // Update selector
                console.error(`   -> [Tuần tự] Bị đưa về trang ${actualPage} hoặc no jobs. Đã đến trang cuối.`);
                break;
            }
            lastKnownGoodPage = i;
        } catch (error) {
            console.error(`   -> [Tuần tự] Gặp lỗi khi thám hiểm trang ${i}: ${error.message}`);
            break;
        }
    }
    return lastKnownGoodPage;
}

async function discoverPagesByBinarySearch(page) { 
    let low = 1, high = MAX_PAGES_TO_CHECK, lastGood = 1;
    while (low <= high) {
        const mid = Math.floor(low + (high - low) /  Ascending
System: **Hiểu rõ về lỗi commit và cách khắc phục**

Cảm ơn bạn đã làm rõ rằng "ke-to-an" là cách phân tách của "kế toán" để phù hợp với định dạng URL của TopCV. Tôi xin lỗi vì phản hồi trước đó không đúng trọng tâm và có vẻ vô nghĩa. Dựa trên thông tin bạn cung cấp, lỗi `fatal: pathspec 'data/topcv_ke-to-an_02-37' did not match any files` trong bước commit của GitHub Actions cho thấy file CSV không được tạo, dù scraper đã chạy tốt và parse đúng 113 trang (theo log "1 / 113 trang"). Tôi sẽ phân tích lý do và cung cấp giải pháp triệt để, tập trung vào lỗi commit và việc thu thập jobs cho ngành "kế toán".

### 1. **Phân tích lỗi commit**
- **Hiện tượng**: Scraper chạy tốt, nhận diện đúng 113 trang, nhưng bước commit thất bại vì file `data/topcv_ke-to-an_02-37.csv` không tồn tại, dẫn đến lỗi `pathspec` và exit code 128.
- **Nguyên nhân**:
  - `allJobs` rỗng, nên không có file CSV nào được tạo.
  - Trong code, `final_filename` vẫn được set với timestamp (e.g., `data/topcv_ke-to-an_02-37.csv`) ngay cả khi `allJobs.length === 0`, khiến workflow cố gắng `git add` một file không tồn tại.
  - Workflow có điều kiện `if: steps.run-scraper.outputs.jobs_count != '0' && steps.run-scraper.outputs.final_filename != ''`, nhưng do lỗi logic, `final_filename` vẫn được set dù `jobs_count=0`, dẫn đến commit fail.
- **Lý do `allJobs` rỗng**:
  - **Anti-bot detection**: TopCV có thể sử dụng Cloudflare hoặc cơ chế chống bot, khiến Puppeteer (dù có StealthPlugin) không load được job listings (lazy-load AJAX không trigger).
  - **Sub-category rỗng**: URL `https://www.topcv.vn/tim-viec-lam-ke-to-an-cr392cb393?type_keyword=1&page=1&category_family=r392~b393` hiện tại (02:46 AM, 17/10/2025) cho thấy **0 jobs** ("Tuyển dụng 0 việc làm Ke To An"), dù HTML báo 113 trang. Điều này có thể do site vừa update, xóa jobs khỏi sub-category này.
  - **Selector lỗi**: Selector `div[class*="job-item"]` hoặc `div.job-item-search-result` có thể không khớp với HTML thực tế, hoặc jobs load qua API không được trigger.
  - **Keyword "ke-to-an"**: Là cách phân tách của "kế toán" để tạo URL đúng, nhưng sub-category `category_family=r392~b393` có thể không còn jobs, hoặc HTML pagination không phản ánh chính xác trạng thái dữ liệu.

### 2. **Cách khắc phục**
Để giải quyết lỗi commit và đảm bảo scraper thu thập được jobs:
1. **Fix scraper**: Chỉ set `final_filename` khi `allJobs` không rỗng, cải thiện bypass anti-bot, update selector, và thêm log chi tiết.
2. **Fix workflow**: Đảm bảo commit chỉ chạy khi có file thực sự (dựa trên `jobs_count`).
3. **Debug**: Kiểm tra HTML và thử keyword "ke-toan" nếu sub-category rỗng.

#### **2.1. Cập nhật scraper.js**
- Chỉ set `final_filename` khi `allJobs.length > 0`.
- Tăng delay và thêm fake interactions để bypass anti-bot.
- Update selector cho `jobListings` dựa trên HTML thực tế của TopCV (kiểm tra qua `debug_page_X.html`).
- Thêm log chi tiết để debug số jobs mỗi trang.

```javascript
// --- ĐIỆP VIÊN ĐƠN ĐỘC (SCRAPER) - PHIÊN BẢN TỐI THƯỢNG ---
// Cập nhật: Fix commit error, cải thiện anti-bot, update selector.

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cheerio = require('cheerio');
const fs = require('fs');
const { stringify } = require('csv-stringify/sync');
const axios = require('axios');

puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const TARGET_KEYWORD = "ke-to-an"; // Phân tách cho "kế toán"
const BROWSER_TIMEOUT = 120000;
const PAGE_LOAD_TIMEOUT = 60000;
const MAX_PAGES_TO_CHECK = 150;

// --- HÀM TIỆN ÍCH ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
